import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { revalidateAfter } from "@/lib/api-cache";
import { ingestWekeep, isCollectorSource, COLLECTOR_SOURCES } from "@/lib/wekeep-ingest";
import { kstDate } from "@/lib/date";
import { API_KEY_HEADER, isApiKeyValid } from "@/lib/team-auth";

// 원천(raw) 수집 값을 받는 자리. 2026-09-17 신설.
//
// 쓰는 쪽은 로컬 크론 dashboard-daily-collect 다. aside 로 화면을 읽어 볼트에 쌓고
// 같은 값을 여기로 보낸다. 보는 쪽은 /raw 페이지(테이블 직접 조회)다.
//
// 기존 집계 테이블(daily_funnel·daily_ad_spend)은 건드리지 않는다. 화면 숫자가 바뀌면 안 된다.
// 이 라우트는 raw_* 테이블만 쓴다.
//
// 인증(2026-11-09 대시보드 잠금 이후): 미들웨어(src/middleware.ts)가 팀 로그인 쿠키 또는 x-ppmi-key 를 요구한다.
//   볼트 수집기는 lib/push.mjs → lib/dashboard-key.mjs 로 x-ppmi-key 를 붙여 보낸다.
//   위킵 재고(wekeep-*, 2026-11-10)·쿠팡 로켓그로스 재고(coupang-rg-inventory · coupang-rg-sku-map, 2026-11-10)는
//   이 라우트에서 한 번 더 x-ppmi-key 를 본다(사람 쿠키로는 못 씀, /api/wekeep-ingest 와 같음).

type Source =
  | "cafe24-cart"
  | "smartstore-inflow"
  | "smartstore-customers"
  | "gfa-campaign"
  | "coupang-keyword";

// 소스 → 테이블과 충돌 키. 키가 자연키라 같은 날을 여러 번 보내도 덧쌓이지 않는다.
const TARGET: Record<Source, { table: string; onConflict: string }> = {
  "cafe24-cart": {
    table: "raw_cafe24_cart",
    onConflict: "ins_at,product,opt,qty,member,dup_no",
  },
  "smartstore-inflow": {
    table: "raw_smartstore_inflow",
    onConflict: "store,date,channel",
  },
  "smartstore-customers": {
    table: "raw_smartstore_customers",
    onConflict: "store,date",
  },
  "gfa-campaign": {
    table: "raw_gfa_campaign",
    onConflict: "account,date,campaign",
  },
  // 2026-09-18. 쿠팡 예약 일간 보고서의 키워드 행. row_key 는 수집기가 차원을 이어 붙여 만든다.
  "coupang-keyword": {
    table: "raw_coupang_keyword",
    onConflict: "row_key",
  },
};

// 한 번에 너무 많이 받으면 요청이 죽는다. 나눠 넣는다.
const CHUNK = 500;

async function postImpl(req: NextRequest) {
  let body: { source?: string; rows?: unknown[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON 파싱 실패" }, { status: 400 });
  }

  // 2026-11-10 위킵 재고(wekeep-snapshot · wekeep-daily)는 검증·심박이 따로 있어 전용 함수로 넘긴다(/api/wekeep-ingest 와 같음)
  // 쿠팡 RG 재고(coupang-rg-inventory · coupang-rg-sku-map, 같은 날 추가)도 같은 규칙·심박(coupang-rg-inventory)으로 받는다
  if (isCollectorSource(body.source)) {
    if (!isApiKeyValid(req.headers.get(API_KEY_HEADER))) {
      return NextResponse.json({ error: "수집기 접근 키(x-ppmi-key)가 필요합니다" }, { status: 401 });
    }
    const res = await ingestWekeep(body.source, body.rows, kstDate());
    return NextResponse.json(res.body, { status: res.status });
  }

  const source = body.source as Source | undefined;
  if (!source || !(source in TARGET)) {
    return NextResponse.json(
      { error: `모르는 source: ${String(body.source)}`, allowed: [...Object.keys(TARGET), ...COLLECTOR_SOURCES] },
      { status: 400 }
    );
  }

  const rows = Array.isArray(body.rows) ? body.rows : null;
  if (!rows) {
    return NextResponse.json({ error: "rows 가 배열이 아닙니다" }, { status: 400 });
  }
  // 0건은 성공이 아니라 실패로 본다. 못 읽은 것과 없는 것을 여기서 구분할 수 없다.
  // 수집기가 0건이면 애초에 보내지 않는다(그쪽에서 이미 실패로 끝낸다).
  if (rows.length === 0) {
    return NextResponse.json({ error: "rows 가 비었습니다" }, { status: 400 });
  }

  const { table, onConflict } = TARGET[source];

  try {
    let written = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const { error } = await supabase.from(table).upsert(slice, { onConflict });
      if (error) throw error;
      written += slice.length;
    }
    return NextResponse.json({ ok: true, table, written });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "저장 실패", message: msg, table }, { status: 500 });
  }
}

// 5분 캐시·쓰기 후 무효화 (src/lib/api-cache.ts)
export const POST = revalidateAfter(postImpl, ["raw_coupang_keyword", "raw_gfa_campaign", "raw_wekeep_snapshot", "raw_wekeep_daily",
  "raw_coupang_rg_inventory", "coupang_rg_sku_map", "sync_heartbeat"]);
