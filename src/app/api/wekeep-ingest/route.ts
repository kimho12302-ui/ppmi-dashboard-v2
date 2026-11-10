import { NextRequest, NextResponse } from "next/server";
import { revalidateAfter } from "@/lib/api-cache";
import { API_KEY_HEADER, isApiKeyValid } from "@/lib/team-auth";
import { ingestWekeep, isWekeepSource, WEKEEP_SOURCES } from "@/lib/wekeep-ingest";
import { kstDate } from "@/lib/date";

// 위킵 재고 원천을 받는 전용 자리 (2026-11-10). 규칙은 src/lib/wekeep-ingest.ts.
// 쓰는 쪽은 로컬 수집기 하나라 사람 로그인 쿠키로는 받지 않는다. x-ppmi-key 가 있어야 한다
// (미들웨어는 쿠키도 통과시키므로 여기서 한 번 더 본다).
// 볼트 lib/push.mjs 의 pushRaw 는 /api/raw-ingest 로 보내고, 그쪽도 같은 함수로 넘긴다.

async function postImpl(req: NextRequest) {
  if (!isApiKeyValid(req.headers.get(API_KEY_HEADER))) {
    return NextResponse.json({ error: "수집기 접근 키(x-ppmi-key)가 필요합니다" }, { status: 401 });
  }
  let body: { source?: unknown; rows?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON 파싱 실패" }, { status: 400 });
  }
  if (!isWekeepSource(body.source)) {
    return NextResponse.json({ error: `모르는 source: ${String(body.source)}`, allowed: WEKEEP_SOURCES }, { status: 400 });
  }
  const res = await ingestWekeep(body.source, body.rows, kstDate());
  return NextResponse.json(res.body, { status: res.status });
}

export const POST = revalidateAfter(postImpl, ["raw_wekeep_snapshot", "raw_wekeep_daily", "sync_heartbeat"]);
