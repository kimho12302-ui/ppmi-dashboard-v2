import { expandBrands } from "@/lib/brand-groups";
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/db";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";
  const brand = sp.get("brand") || "all";

  try {
    let query = supabase
      .from("product_sales")
      .select("*")
      .gte("date", from)
      .lte("date", to)
      .order("revenue", { ascending: false });

    if (brand !== "all") {
      query = query.in("brand", expandBrands(brand));
    }

    // PostgREST 의 db-max-rows(1000)가 클라이언트 range 보다 우선하므로
    // .range(0, 99999) 로는 캡을 넘을 수 없다 → 페이지네이션으로 전량 조회.
    // (실측: 2026년 전체 조회 시 3,619행 중 1,000행만 반환돼 매출 72% 누락)
    const data = await fetchAll(query);

    return NextResponse.json({ products: data });
  } catch (error) {
    console.error("Product sales API error:", error);
    return NextResponse.json({ error: "Failed to fetch data" }, { status: 500 });
  }
}
