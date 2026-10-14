import { expandBrands } from "@/lib/brand-groups";
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/db";
import { tryRpc } from "@/lib/summary-rpc";
import { cachedGET } from "@/lib/api-cache";

async function getImpl(req: NextRequest) {
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
    // ★ DB 합산 함수가 있으면 (날짜, 브랜드, 상품) 묶음만 받는다(2026-10-14). 이 API 를 쓰는 곳은
    //   상품 추이 차트 하나이고 그 차트는 이 다섯 칸(date·brand·product·revenue·quantity)만 쓴다.
    //   함수가 없으면(SQL 실행 전) 옛 경로.
    const summary = await tryRpc<unknown[]>("product_sales_daily", { p_from: from, p_to: to, p_brands: brand !== "all" ? expandBrands(brand) : null });
    const data = summary ?? await fetchAll(query);

    return NextResponse.json({ products: data });
  } catch (error) {
    console.error("Product sales API error:", error);
    return NextResponse.json({ error: "Failed to fetch data" }, { status: 500 });
  }
}

// 5분 캐시·쓰기 후 무효화 (src/lib/api-cache.ts)
export const GET = cachedGET(getImpl, ["product_sales"]);
