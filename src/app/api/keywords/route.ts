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
      .from("keyword_performance")
      .select("*")
      .gte("date", from)
      .lte("date", to)
      .order("clicks", { ascending: false });

    if (brand !== "all") {
      query = query.in("brand", expandBrands(brand));
    }

    // PostgREST 의 db-max-rows(1000)가 클라이언트 range 보다 우선하므로
    // .range(0, 99999) 로는 캡을 넘을 수 없다 → 페이지네이션으로 전량 조회.
    const data = await fetchAll(query);

    // 이 테이블의 마지막 수집일. 화면이 "빈 결과"와 "수집 중단"을 구분할 수 있게 함께 내려준다
    // (keyword_performance 는 2026-05-04 이후 유입이 끊겼는데 경고가 없어 빈 화면만 보였다).
    const { data: latestRow } = await supabase
      .from("keyword_performance").select("date").order("date", { ascending: false }).limit(1);

    return NextResponse.json({ keywords: data, latestCollected: latestRow?.[0]?.date || null });
  } catch (error) {
    console.error("Keywords API error:", error);
    return NextResponse.json({ error: "Failed to fetch data" }, { status: 500 });
  }
}
