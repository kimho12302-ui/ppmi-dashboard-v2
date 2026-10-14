// 공구 후보를 팀이 이미 쓰는 협찬 리스트 시트에 넣는다. 정본은 시트다(2026-10-14 김호 결정).
// 대시보드에 따로 저장하면 같은 걸 두 번 적게 된다.
//
// ★ 기존 탭은 읽기만, 그것도 '채널 주소' 열만 읽는다. 제안 리스트에는 이름·연락처·주소가 있어서
//   그 열들은 대시보드로 가져오지 않는다. 쓰기는 새 탭 하나(TAB)에만 한다.

import { google } from "googleapis";
import type { Analysis } from "./ig-discovery";
import { normalizeHandle } from "./ig-discovery";

export const SHEET_ID = "18JWtyFX4fmvk8JI5hIf9lR9nCma9KjOLrqz2qzDi4Tw";
export const TAB = "인스타_공구후보";
export const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;

const HEADER = [
  "추가일", "추가한 사람", "핸들", "프로필", "이름", "팔로워", "최근 게시일", "평균 좋아요", "평균 댓글",
  "참여율(%)", "공구 게시물(최근25)", "관련 키워드", "이메일", "카카오", "링크", "발굴 경로", "점수",
  "컨택 상태", "메모",
];

// 이미 컨택한 사람을 다시 올리지 않으려고 보는 열들. 인스타 주소가 들어 있을 수 있는 칸만.
const LOOKUP_RANGES = [`'${TAB}'!C:C`, "'제안 리스트'!F:F", "'컨택타깃_키트체험자'!C:C", "'컨택타깃_키트체험자'!L:L"];

function sheets() {
  const saKey = process.env.GOOGLE_SA_KEY;
  if (!saKey) throw new Error("GOOGLE_SA_KEY not set");
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(saKey),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

async function ensureTab() {
  const s = sheets();
  const meta = await s.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: "sheets.properties.title" });
  const has = (meta.data.sheets || []).some((x) => x.properties?.title === TAB);
  if (has) return;
  await s.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: TAB, gridProperties: { frozenRowCount: 1 } } } }] },
  });
  await s.spreadsheets.values.update({
    spreadsheetId: SHEET_ID, range: `'${TAB}'!A1`, valueInputOption: "RAW",
    requestBody: { values: [HEADER] },
  });
}

/** 시트 어디든 이미 있는 인스타 핸들 → 어느 탭에 있는지 */
export async function knownHandles(): Promise<Record<string, string>> {
  const s = sheets();
  // 없는 탭이 범위에 섞이면 batchGet 전체가 실패한다(새 탭은 첫 추가 전엔 없다)
  const meta = await s.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: "sheets.properties.title" });
  const titles = new Set((meta.data.sheets || []).map((x) => x.properties?.title));
  const ranges = LOOKUP_RANGES.filter((r) => titles.has(r.split("!")[0].replace(/'/g, "")));
  const res = await s.spreadsheets.values.batchGet({ spreadsheetId: SHEET_ID, ranges });
  const out: Record<string, string> = {};
  for (const vr of res.data.valueRanges || []) {
    const tab = (vr.range || "").split("!")[0].replace(/'/g, "");
    for (const row of vr.values || []) {
      const cell = String(row[0] || "");
      // 새 탭의 핸들 칸은 맨 이름, 나머지는 instagram.com 주소일 때만 핸들로 본다
      const h = tab === TAB ? normalizeHandle(cell) : /instagram\.com\//i.test(cell) ? normalizeHandle(cell) : null;
      if (h && h !== "핸들" && !out[h]) out[h] = tab;
    }
  }
  return out;
}

const kst = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);

export async function appendCandidates(rows: (Analysis & { source?: string })[], addedBy: string) {
  await ensureTab();
  const known = await knownHandles();
  const fresh = rows.filter((r) => r.ok && !known[r.handle]);
  const skipped = rows.filter((r) => !r.ok || known[r.handle]).map((r) => ({ handle: r.handle, reason: r.ok ? `이미 ${known[r.handle]}에 있음` : "분석 실패" }));
  if (fresh.length) {
    const values = fresh.map((r) => [
      kst(), addedBy, r.handle, `https://www.instagram.com/${r.handle}/`, r.name || "",
      r.followers ?? "", r.lastPostAt ? r.lastPostAt.slice(0, 10) : "", r.avgLikes ?? "숨김", r.avgComments ?? "",
      r.engagementPct ?? "", r.gongguPosts ?? 0,
      Object.entries(r.keywordHits || {}).map(([k, n]) => `${k}${n}`).join(" "),
      (r.contacts?.emails || []).join(" "), (r.contacts?.kakao || []).join(" "), (r.contacts?.links || []).join(" "),
      r.source || "", r.score ?? "", "대기", "",
    ]);
    await sheets().spreadsheets.values.append({
      spreadsheetId: SHEET_ID, range: `'${TAB}'!A1`, valueInputOption: "RAW", insertDataOption: "INSERT_ROWS",
      requestBody: { values },
    });
  }
  return { added: fresh.map((r) => r.handle), skipped };
}
