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
    // 총 개수
    const { count, error: countErr } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true });

    if (countErr) throw countErr;

    // 데이터. 모든 표에 date 열이 있지는 않다(2026-09-21: raw_naver_search_term 이 이 정렬로 500 이 났다).
    // 정렬이 안 되면 정렬 없이 한 번 더 본다. 표를 아예 못 보는 것보다 순서가 없는 편이 낫다.
    let { data, error } = await supabase
      .from(table)
      .select("*")
      .order("date", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      ({ data, error } = await supabase
        .from(table)
        .select("*")
        .range(offset, offset + limit - 1));
    }
    if (error) throw error;

    return NextResponse.json({ rows: data || [], total: count || 0 });
  } catch (error) {
    // 사유를 감추지 않는다. "Failed to fetch data" 만 보면 표가 없는 건지 열이 없는 건지 알 수 없다.
    const why = error instanceof Error ? error.message : String(error);
    console.error("Raw API error:", table, why);
    return NextResponse.json({ error: `조회 실패: ${why}` }, { status: 500 });
  }
}
