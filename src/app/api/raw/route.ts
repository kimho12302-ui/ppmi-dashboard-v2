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

    // 데이터
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .order("date", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    return NextResponse.json({ rows: data || [], total: count || 0 });
  } catch (error) {
    console.error("Raw API error:", error);
    return NextResponse.json({ error: "Failed to fetch data" }, { status: 500 });
  }
}
