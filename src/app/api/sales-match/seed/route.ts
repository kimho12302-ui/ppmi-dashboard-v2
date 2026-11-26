import { NextRequest, NextResponse } from "next/server";
import { revalidateAfter } from "@/lib/api-cache";
import { API_KEY_HEADER, isApiKeyValid } from "@/lib/team-auth";
import { runSeed } from "@/lib/sales-match-core";
import { seedDeps } from "../deps";

// 볼트 sales_match.json 을 대시보드 매칭표로 처음 옮긴다(2026-11-26). 볼트 sales_entry_push.py seed_match 가 부른다.
//   POST /api/sales-match/seed  {match:[[열쇠, 코드], ...], warehouse:[[코드, 이름, 출하창고], ...]}  (x-ppmi-key 만)
// 없는 것만 넣는다. 이미 있는 열쇠(대소문자 무시)·코드는 그대로 둔다. 같은 묶음 안에서는 먼저 나온 줄이 이긴다.
// 응답 {ok, match:{received, inserted, kept}, items:{received, inserted, kept}, skipped:{...}}
export const dynamic = "force-dynamic";

async function postImpl(req: NextRequest) {
  if (!isApiKeyValid(req.headers.get(API_KEY_HEADER))) {
    return NextResponse.json({ ok: false, error: "수집기 접근 키(x-ppmi-key)가 필요합니다" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "JSON 파싱 실패" }, { status: 400 });
  }
  try {
    const res = await runSeed(seedDeps, body);
    return NextResponse.json(res.body, { status: res.status });
  } catch (error) {
    console.error("sales-match seed error:", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export const POST = revalidateAfter(postImpl, ["sales_match", "sales_item_codes"]);
