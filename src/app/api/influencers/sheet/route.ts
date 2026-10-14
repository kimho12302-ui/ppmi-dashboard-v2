import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { appendCandidates, SHEET_URL, TAB } from "@/lib/influencer-sheet";
import { USER_COOKIE } from "@/lib/team-auth";
import type { Analysis } from "@/lib/ig-discovery";

const MAX = 50;

// 화면에서 고른 행을 시트 새 탭에 붙인다. 이미 시트 어디든 있는 핸들은 건너뛴다.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const rows: (Analysis & { source?: string })[] = Array.isArray(body.rows) ? body.rows.slice(0, MAX) : [];
  if (!rows.length) return NextResponse.json({ error: "추가할 행이 없습니다" }, { status: 400 });
  const who = decodeURIComponent(cookies().get(USER_COOKIE)?.value || "") || "이름 없음";
  try {
    const r = await appendCandidates(rows, who);
    return NextResponse.json({ ...r, tab: TAB, sheetUrl: SHEET_URL });
  } catch (e) {
    return NextResponse.json({ error: `시트 쓰기 실패: ${(e as Error).message}` }, { status: 500 });
  }
}
