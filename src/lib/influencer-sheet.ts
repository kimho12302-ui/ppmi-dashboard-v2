// 공구 셀러 발굴 — 대시보드 쪽 시트 읽기·쓰기. 정본은 협찬 리스트 시트다(2026-10-14 김호 결정).
// 수집은 PC 의 aside 수집기(scripts/influencer-collector.mjs)가 하고, 대시보드는
// ① 수집할 해시태그를 큐에 넣고 ② 후보를 보고 ③ 상태(후보·컨택함·제외)를 바꾼다.
// 시트 구조는 influencer-schema.json 하나에 있고 수집기와 같이 쓴다. 열은 이름으로 찾는다.
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
const col = (i: number) => String.fromCharCode(65 + i);
const kstStamp = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 16).replace("T", " ");

async function ensureTab(tab: string, header: string[]) {
  const s = sheets();
  const meta = await s.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: "sheets.properties.title" });
  if ((meta.data.sheets || []).some((x) => x.properties?.title === tab)) return;
  await s.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: tab, gridProperties: { frozenRowCount: 1 } } } }] },
  });
  await s.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `${q(tab)}!A1`, valueInputOption: "RAW", requestBody: { values: [header] } });
}

/** 세 탭을 한 번에 읽는다. 아직 없는 탭은 빈 것으로 본다(수집기를 한 번도 안 돌린 상태). */
export async function readBoard() {
  const s = sheets();
  const meta = await s.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: "sheets.properties.title" });
  const have = new Set((meta.data.sheets || []).map((x) => x.properties?.title));
  const tabs = [schema.candidates.tab, schema.tags.tab, schema.status.tab];
  const ranges = tabs.filter((t) => have.has(t)).map((t) => `${q(t)}!A1:Z`);
  const res = ranges.length ? await s.spreadsheets.values.batchGet({ spreadsheetId: SHEET_ID, ranges }) : { data: { valueRanges: [] } };
  const byTab: Record<string, Row[]> = {};
  for (const vr of res.data.valueRanges || []) {
    const tab = (vr.range || "").split("!")[0].replace(/'/g, "");
    const [header = [], ...rows] = (vr.values || []) as string[][];
    byTab[tab] = rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
  }
  const statusRows = byTab[schema.status.tab] || [];
  return {
    candidates: (byTab[schema.candidates.tab] || []).filter((r) => r["핸들"]),
    tags: (byTab[schema.tags.tab] || []).filter((r) => r["태그"]),
    collector: Object.fromEntries(statusRows.map((r) => [r["항목"], r["값"]])),
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

/** 후보 한 명의 상태·메모를 바꾼다. 핸들로 행을 찾는다(시트에서 정렬해도 안전하게). */
export async function reviewCandidate(handle: string, patch: { 상태?: string; 메모?: string }, who: string) {
  const s = sheets();
  const tab = schema.candidates.tab;
  const r = await s.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${q(tab)}!A1:Z` });
  const [header = [], ...rows] = (r.data.values || []) as string[][];
  const hi = header.indexOf("핸들");
  const idx = rows.findIndex((row) => (row[hi] || "").toLowerCase() === handle.toLowerCase());
  if (idx < 0) throw new Error(`시트에서 ${handle} 을 찾지 못했습니다`);
  const values: Row = { ...patch, 검토자: who, 검토일: kstStamp() } as Row;
  const data = Object.entries(values).filter(([k, v]) => v !== undefined && header.includes(k))
    .map(([k, v]) => ({ range: `${q(tab)}!${col(header.indexOf(k))}${idx + 2}`, values: [[v]] }));
  await s.spreadsheets.values.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { valueInputOption: "RAW", data } });
}
