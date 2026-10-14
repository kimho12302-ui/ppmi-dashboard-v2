import { expandBrands } from "@/lib/brand-groups";
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/db";
import { groupProductSalesDaily, tryRpc } from "@/lib/summary-rpc";
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
    // ★ ?shape=daily 일 때만 DB 합산 함수로 (날짜, 브랜드, 상품) 묶음을 받는다(2026-10-14).
    //   상품 추이 차트가 이걸 쓴다(다섯 칸 date·brand·product·revenue·quantity 만 씀).
    //   기본값은 옛 응답(원본 행 전체 칸) 그대로다. 크론 dashboard-daily-collect 가 키트 CPA 원장으로
    //   이 API 의 quantity 를 읽고, 판매처·라인업으로 거를 수 있어 모양을 바꾸면 안 된다.
    //   함수가 없으면(SQL 실행 전) 같은 묶음을 서버에서 JS 로 만든다(화면으로 가는 양은 같게 준다).
    if (sp.get("shape") === "daily") {
      const brands = brand !== "all" ? expandBrands(brand) : null;
      const summary = await tryRpc<unknown[]>("product_sales_daily", { p_from: from, p_to: to, p_brands: brands });
      if (summary) return NextResponse.json({ products: summary });
      let lean = supabase.from("product_sales").select("id,date,brand,product,revenue,quantity").gte("date", from).lte("date", to);
      if (brands) lean = lean.in("brand", brands);
      return NextResponse.json({ products: groupProductSalesDaily(await fetchAll(lean)) });
    }
    const data = await fetchAll(query);

    return NextResponse.json({ products: data });
  } catch (error) {
    console.error("Product sales API error:", error);
    return NextResponse.json({ error: "Failed to fetch data" }, { status: 500 });
  }
}

// 5분 캐시·쓰기 후 무효화 (src/lib/api-cache.ts)
export const GET = cachedGET(getImpl, ["product_sales"], ["brand", "from", "shape", "to"]);
