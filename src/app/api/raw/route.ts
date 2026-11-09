import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const ALLOWED_TABLES = [
  "daily_sales",
  "daily_ad_spend",
  "daily_funnel",
  "product_sales",
  "keyword_performance",
  // 원천(raw). 2026-09-17 신설. aside 수집기가 /api/raw-ingest 로 넣는다.
  // 사람이 손으로 넣던 것은 일별 합계뿐이었고 이쪽은 채널별·상품별·캠페인별이다.
  // 스키마는 docs/sql/raw-sources.sql.
  "raw_cafe24_cart",
  "raw_smartstore_inflow",
  "raw_smartstore_customers",
  "raw_gfa_campaign",
  "raw_coupang_keyword",
  // 2026-09-21: 표는 09-18 에 만들어졌는데 화이트리스트에 없어 /raw 에서 볼 수 없었다.
  "raw_naver_search_term",
] as const;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const table = sp.get("table") || "daily_sales";
  const offset = parseInt(sp.get("offset") || "0", 10);
  const limit = Math.min(parseInt(sp.get("limit") || "50", 10), 200);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!ALLOWED_TABLES.includes(table as any)) {
    return NextResponse.json({ error: "Invalid table" }, { status: 400 });
  }

  try {
    // 2026-11-09 속도 수정: 예전엔 표 전체 건수를 정확히 세느라(count exact) 큰 표에서 16초가 걸렸고
    // 그동안 DB 가 같이 느려졌다. 이제 데이터 질의 한 번에 "추정" 건수(작은 결과는 정확, 큰 표는 통계값)를 같이 받고,
    // 다음 쪽이 있는지는 한 행 더 받아(limit+1) 직접 확인한다. 응답 모양(rows·total)은 그대로이고
    // hasMore·totalIsEstimate 를 더했다. total 은 적어도 지금까지 본 행 수 + (다음 쪽이 있으면 1) 이다.
    //
    // 모든 표에 date 열이 있지는 않다(2026-09-21: raw_naver_search_term 이 이 정렬로 500 이 났다).
    // 정렬이 안 되면 정렬 없이 한 번 더 본다. 표를 아예 못 보는 것보다 순서가 없는 편이 낫다.
    const page = (ordered: boolean) => {
      const q = supabase.from(table).select("*", { count: "estimated" });
      return (ordered ? q.order("date", { ascending: false }) : q).range(offset, offset + limit);
    };
    let { data, error, count } = await page(true);
    if (error) ({ data, error, count } = await page(false));
    if (error) throw error;

    const all = data || [];
    const hasMore = all.length > limit;
    const rows = all.slice(0, limit);
    const seen = offset + rows.length + (hasMore ? 1 : 0);
    // 마지막 쪽이면 정확한 건수를 안다. 쪽 범위를 넘겨 빈 결과면 추정값을 그대로 쓴다.
    const exact = !hasMore && rows.length > 0;
    const total = exact ? seen : Math.max(count ?? 0, seen);

    return NextResponse.json({ rows, total, hasMore, totalIsEstimate: !exact });
  } catch (error) {
    // 사유를 감추지 않는다. "Failed to fetch data" 만 보면 표가 없는 건지 열이 없는 건지 알 수 없다.
    const why = error instanceof Error ? error.message : String(error);
    console.error("Raw API error:", table, why);
    return NextResponse.json({ error: `조회 실패: ${why}` }, { status: 500 });
  }
}
