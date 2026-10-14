// 공구 셀러 수집기·DM 워커가 같이 쓰는 것: aside 호출, 계정 확인, 시트 읽기·쓰기, 로그.
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const SCHEMA = JSON.parse(readFileSync(join(ROOT, "src/lib/influencer-schema.json"), "utf8"));
export const SHEET = SCHEMA.sheetId;
export const STATE_DIR = join(homedir(), ".ppmi-influencer-collector");
mkdirSync(STATE_DIR, { recursive: true });
const ASIDE = process.env.ASIDE_EXE || "C:/Users/harry/AppData/Local/Aside/CLI/current/aside.exe";

export const kstDate = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
export const kstStamp = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 16).replace("T", " ");

// 작업 스케줄러로 돌면 화면 출력이 남지 않아 파일에도 쓴다
export function makeLog(file) {
  return (...a) => {
    const line = [new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 19).replace("T", " "), ...a].join(" ");
    console.log(line);
    try { appendFileSync(join(STATE_DIR, file), line + "\n"); } catch { /* 로그 실패로 멈추지 않는다 */ }
  };
}

export class WallError extends Error {}

// aside repl 한 번 = 새 세션(앞 호출의 탭은 남지 않는다). 매번 openTab 으로 시작하고 끝나면 닫는다.
// 120초 제한. 결과는 '@@OUT@@' 줄로 받는다. 인스타 내부 API 는 부르지 않고 화면만 읽는다.
export function repl(account, body, timeout = 140000) {
  const code = `await (async () => {
    const pause = (a, b) => sleep(a + Math.floor(Math.random() * (b - a)));
    const isWall = (u) => /accounts\\/login|challenge|suspended/.test(u);
    ${body}
  })();`;
  const r = spawnSync(ASIDE, ["repl", "--account", account, code], { encoding: "utf8", timeout, windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
  const text = `${r.stdout || ""}\n${r.stderr || ""}`;
  const line = text.split(/\r?\n/).reverse().find((l) => l.startsWith("@@OUT@@"));
  if (!line) throw new Error(`aside 응답 없음 (exit ${r.status}): ${text.replace(/\s+/g, " ").slice(-400)}`);
  const out = JSON.parse(line.slice(7));
  if (out.wall) throw new WallError(`인스타가 로그인·확인 화면을 띄웠다: ${out.wall}`);
  return out;
}

/** 그 aside 프로필에 로그인된 인스타 핸들. 하나로 특정되지 않으면 null */
export function loggedInHandle(account) {
  const out = repl(account, `
    const p = await openTab('https://www.instagram.com/accounts/edit/');
    await pause(2000, 3000);
    const url = p.url();
    const alts = isWall(url) ? [] : await p.locator('img[alt$="님의 프로필 사진"]').evaluateAll(xs => xs.map(x => x.getAttribute('alt')));
    await closeTab(p);
    console.log('@@OUT@@' + JSON.stringify({ url, alts, wall: isWall(url) ? url : null }));`);
  const handles = Array.from(new Set(out.alts.map((a) => a.replace(/님의 프로필 사진$/, "").toLowerCase())));
  return handles.length === 1 ? handles[0] : null;
}

// ── 시트 ──
export function sheetsClient() {
  const file = process.env.GOOGLE_SA_KEY_FILE || join(homedir(), ".naver-searchad", "google-service-account.json");
  const credentials = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  return google.sheets({ version: "v4", auth });
}
export const q = (tab) => `'${tab}'`;
export const colLetter = (i) => (i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)));

/** 탭이 없으면 만들고, 머리글에 빠진 열이 있으면 맨 오른쪽에 붙인다. 최종 머리글을 돌려준다 */
export async function ensureTab(s, { tab, header }, seedRows = []) {
  const meta = await s.spreadsheets.get({ spreadsheetId: SHEET, fields: "sheets.properties.title" });
  if (!meta.data.sheets.some((x) => x.properties.title === tab)) {
    await s.spreadsheets.batchUpdate({ spreadsheetId: SHEET, requestBody: { requests: [{ addSheet: { properties: { title: tab, gridProperties: { frozenRowCount: 1 } } } }] } });
    await s.spreadsheets.values.update({ spreadsheetId: SHEET, range: `${q(tab)}!A1`, valueInputOption: "RAW", requestBody: { values: [header, ...seedRows] } });
    return header;
  }
  const r = await s.spreadsheets.values.get({ spreadsheetId: SHEET, range: `${q(tab)}!1:1` });
  const cur = (r.data.values || [[]])[0];
  const missing = header.filter((h) => !cur.includes(h));
  if (!missing.length) return cur;
  const next = [...cur, ...missing];
  await s.spreadsheets.values.update({ spreadsheetId: SHEET, range: `${q(tab)}!A1`, valueInputOption: "RAW", requestBody: { values: [next] } });
  return next;
}

export async function readTab(s, tab) {
  const r = await s.spreadsheets.values.get({ spreadsheetId: SHEET, range: `${q(tab)}!A1:AZ` }).catch(() => ({ data: { values: [] } }));
  const [header = [], ...rows] = r.data.values || [];
  return { header, rows: rows.map((row, i) => ({ rowNo: i + 2, obj: Object.fromEntries(header.map((h, j) => [h, row[j] ?? ""])) })) };
}

export async function setCells(s, tab, header, rowNo, patch) {
  const data = Object.entries(patch).filter(([k, v]) => v !== undefined && header.includes(k))
    .map(([k, v]) => ({ range: `${q(tab)}!${colLetter(header.indexOf(k))}${rowNo}`, values: [[v]] }));
  if (data.length) await s.spreadsheets.values.batchUpdate({ spreadsheetId: SHEET, requestBody: { valueInputOption: "RAW", data } });
}

export const normHandle = (cell) => {
  const m = String(cell || "").match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  const h = (m ? m[1] : String(cell || "")).replace(/^@/, "").replace(/\/+$/, "").toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(h) ? h : null;
};

/** 「발굴_상태」 탭의 항목만 고친다(수집기·DM 워커가 같은 탭을 쓰므로 통째로 덮지 않는다) */
export async function upsertStatus(s, items) {
  await ensureTab(s, SCHEMA.status);
  const t = await readTab(s, SCHEMA.status.tab);
  const rows = t.rows.map((r) => [r.obj["항목"], r.obj["값"]]);
  for (const [k, v] of Object.entries(items)) {
    const i = rows.findIndex((r) => r[0] === k);
    if (i >= 0) rows[i][1] = String(v); else rows.push([k, String(v)]);
  }
  await s.spreadsheets.values.update({ spreadsheetId: SHEET, range: `${q(SCHEMA.status.tab)}!A1`, valueInputOption: "RAW", requestBody: { values: [SCHEMA.status.header, ...rows] } });
}
