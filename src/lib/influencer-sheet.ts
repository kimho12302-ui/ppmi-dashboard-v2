// 공구 셀러 발굴·DM — 대시보드 쪽 시트 읽기·쓰기. 정본은 협찬 리스트 시트다(2026-10-14 김호 결정).
// 수집과 DM 발송은 PC 의 aside 스크립트(scripts/influencer-collector.mjs, influencer-dm-worker.mjs)가 하고,
// 대시보드는 ① 해시태그 큐 ② 후보 상태 ③ DM 조건 설정 ④ DM 초안 수정·발송 승인을 한다.
// 대시보드는 직접 보내지 않는다. '승인' 표시만 남기고 워커가 승인된 행만 보낸다.
// 시트 구조는 influencer-schema.json 하나에 있고 PC 스크립트와 같이 쓴다. 열은 이름으로 찾는다.
//
// ★ 기존 탭(제안 리스트 등)은 건드리지 않는다. 거기엔 이름·연락처·주소가 있다.

import { google } from "googleapis";
import schema from "./influencer-schema.json";

export const SHEET_ID = schema.sheetId;
export const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;
export const STATUSES = schema.candidates.statuses;

export type Row = Record<string, string>;

function sheets() {
  const saKey = process.env.GOOGLE_SA_KEY;
  if (!saKey) throw new Error("GOOGLE_SA_KEY not set");
  // 로컬 .env.local 은 private_key 의 \n 이 실제 줄바꿈으로 풀려 들어와 JSON 이 깨진다. 둘 다 받는다
  let credentials;
  try { credentials = JSON.parse(saKey); } catch { credentials = JSON.parse(saKey.replace(/\r?\n/g, "\\n")); }
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

const q = (tab: string) => `'${tab}'`;
// DM 열이 붙으면 Z 를 넘는다(AA, AB …)
const col = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)));
const kstStamp = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 16).replace("T", " ");

/** 탭이 없으면 만들고, 머리글에 빠진 열(예: 나중에 생긴 DM 열)은 맨 오른쪽에 붙인다 */
async function ensureTab(tab: string, header: string[], seedRows: string[][] = []) {
  const s = sheets();
  const meta = await s.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: "sheets.properties.title" });
  if ((meta.data.sheets || []).some((x) => x.properties?.title === tab)) {
    const r = await s.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${q(tab)}!1:1` });
    const cur = ((r.data.values || [[]])[0] || []) as string[];
    const missing = header.filter((h) => !cur.includes(h));
    if (missing.length) await s.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `${q(tab)}!A1`, valueInputOption: "RAW", requestBody: { values: [[...cur, ...missing]] } });
    return;
  }
  await s.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: tab, gridProperties: { frozenRowCount: 1 } } } }] },
  });
  await s.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `${q(tab)}!A1`, valueInputOption: "RAW", requestBody: { values: [header, ...seedRows] } });
}

/** 네 탭을 한 번에 읽는다. 아직 없는 탭은 빈 것으로 본다(PC 스크립트를 한 번도 안 돌린 상태). */
export async function readBoard() {
  const s = sheets();
  const meta = await s.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: "sheets.properties.title" });
  const have = new Set((meta.data.sheets || []).map((x) => x.properties?.title));
  const tabs = [schema.candidates.tab, schema.tags.tab, schema.status.tab, schema.dmSettings.tab];
  const ranges = tabs.filter((t) => have.has(t)).map((t) => `${q(t)}!A1:AZ`);
  const res = ranges.length ? await s.spreadsheets.values.batchGet({ spreadsheetId: SHEET_ID, ranges }) : { data: { valueRanges: [] } };
  const byTab: Record<string, Row[]> = {};
  for (const vr of res.data.valueRanges || []) {
    const tab = (vr.range || "").split("!")[0].replace(/'/g, "");
    const [header = [], ...rows] = (vr.values || []) as string[][];
    byTab[tab] = rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
  }
  const statusRows = byTab[schema.status.tab] || [];
  const saved = byTab[schema.dmSettings.tab] || [];
  return {
    candidates: (byTab[schema.candidates.tab] || []).filter((r) => r["핸들"]),
    tags: (byTab[schema.tags.tab] || []).filter((r) => r["태그"]),
    collector: Object.fromEntries(statusRows.map((r) => [r["항목"], r["값"]])),
    // 설정 탭이 아직 없으면 기본값을 보여 준다(참고 메시지는 워커가 처음 돌 때 채운다)
    settings: schema.dmSettings.defaults.map(([항목, 값, 설명]) => {
      const s2 = saved.find((r) => r["항목"] === 항목);
      return { 항목, 값: s2 ? s2["값"] : 값, 설명 };
    }),
  };
}

export async function addTags(tags: string[], who: string) {
  await ensureTab(schema.tags.tab, schema.tags.header);
  const { tags: existing } = await readBoard();
  const have = new Set(existing.map((r) => r["태그"].trim().toLowerCase()));
  const fresh = Array.from(new Set(tags.map((t) => (t.startsWith("#") ? t : `#${t}`).trim()))).filter((t) => t.length > 1 && !have.has(t.toLowerCase()));
  if (fresh.length) {
    const row = (t: string) => schema.tags.header.map((h) => ({ 태그: t, 상태: "대기", "추가한 사람": who, 추가일: kstStamp() } as Row)[h] ?? "");
    await sheets().spreadsheets.values.append({
      spreadsheetId: SHEET_ID, range: `${q(schema.tags.tab)}!A1`, valueInputOption: "RAW", insertDataOption: "INSERT_ROWS",
      requestBody: { values: fresh.map(row) },
    });
  }
  return { added: fresh, skipped: tags.length - fresh.length };
}

/** 후보 행을 핸들로 찾는다(시트에서 정렬해도 안전하게). 머리글에 빠진 열은 먼저 붙인다 */
async function findCandidate(handle: string) {
  const tab = schema.candidates.tab;
  await ensureTab(tab, schema.candidates.header);
  const r = await sheets().spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${q(tab)}!A1:AZ` });
  const [header = [], ...rows] = (r.data.values || []) as string[][];
  const idx = rows.findIndex((row) => (row[header.indexOf("핸들")] || "").toLowerCase() === handle.toLowerCase());
  if (idx < 0) throw new Error(`시트에서 ${handle} 을 찾지 못했습니다`);
  const get = (k: string) => rows[idx][header.indexOf(k)] || "";
  const write = async (patch: Row) => {
    const data = Object.entries(patch).filter(([k, v]) => v !== undefined && header.includes(k))
      .map(([k, v]) => ({ range: `${q(tab)}!${col(header.indexOf(k))}${idx + 2}`, values: [[v]] }));
    await sheets().spreadsheets.values.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { valueInputOption: "RAW", data } });
  };
  return { get, write };
}

/** 후보 한 명의 상태·메모를 바꾼다. */
export async function reviewCandidate(handle: string, patch: { 상태?: string; 메모?: string }, who: string) {
  const c = await findCandidate(handle);
  const values: Row = { ...patch, 검토자: who, 검토일: kstStamp() } as Row;
  // 후보로 고르면 PC 의 DM 워커가 다음 회차에 그 계정을 읽고 맞춤 초안을 쓴다
  if (patch.상태 === "후보" && !c.get("DM 상태")) values["DM 상태"] = "초안 대기";
  await c.write(values);
}

// ── DM ──

export async function saveSettings(items: { 항목: string; 값: string }[]) {
  const tab = schema.dmSettings.tab;
  await ensureTab(tab, schema.dmSettings.header);
  const desc = Object.fromEntries(schema.dmSettings.defaults.map(([k, , d]) => [k, d]));
  const values = [schema.dmSettings.header, ...items.map((i) => [i.항목, i.값, desc[i.항목] || ""])];
  await sheets().spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `${q(tab)}!A1`, valueInputOption: "RAW", requestBody: { values } });
}

export type DmAction = "save" | "approve" | "cancel" | "redraft";

/**
 * 후보 한 명의 DM 을 고친다.
 * save: 초안 저장 / approve: 발송 승인(워커가 다음 회차에 보낸다) / cancel: 승인 취소 / redraft: 초안 다시 쓰기 요청.
 * 이미 보낸 행은 아무것도 바꾸지 않는다(같은 사람에게 두 번 보내지 않게).
 */
export async function dmAction(handle: string, action: DmAction, who: string, text?: string, instruction?: string) {
  const c = await findCandidate(handle);
  if (c.get("DM 발송")) throw new Error("이미 보낸 계정입니다. 다시 보낼 수 없습니다");
  const st = c.get("DM 상태");
  if (action === "save") {
    if (st === "승인") throw new Error("승인된 초안입니다. 고치려면 먼저 승인을 취소하세요");
    return c.write({ "DM 초안": String(text || "").slice(0, 2000), "DM 상태": "초안" });
  }
  if (action === "approve") {
    const body = String(text ?? c.get("DM 초안")).trim();
    if (!body) throw new Error("초안이 비어 있습니다");
    if (c.get("상태") !== "후보") throw new Error("'후보' 상태인 계정만 보낼 수 있습니다");
    return c.write({ "DM 초안": body.slice(0, 2000), "DM 상태": "승인", "DM 승인": `${who} · ${kstStamp()}`, "DM 오류": "" });
  }
  if (action === "cancel") {
    if (st !== "승인") throw new Error("승인된 상태가 아닙니다");
    return c.write({ "DM 상태": "초안", "DM 승인": "" });
  }
  if (st === "승인") throw new Error("승인을 먼저 취소하세요");
  return c.write({ "DM 상태": "초안 대기", "DM 지시": String(instruction || "").slice(0, 300), "DM 오류": "" });
}
