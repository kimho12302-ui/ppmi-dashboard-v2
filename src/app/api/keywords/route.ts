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
      .from("keyword_performance")
      .select("*")
      .gte("date", from)
      .lte("date", to)
      .order("clicks", { ascending: false });

    if (brand !== "all") {
      query = query.in("brand", expandBrands(brand));
    }

    // ★ DB 합산 함수가 있으면 (플랫폼, 키워드) 로 묶인 합계만 받는다(2026-10-14). 화면은 그 단위로만 더한다.
    //   올해 전체 기준 원본 2.66MB 가 묶음 수백 개로 준다. 함수가 없으면(SQL 실행 전) 옛 경로.
    //   마지막 수집일 조회는 서로 기다릴 이유가 없어 같이 보낸다.
    const latestQ = supabase.from("keyword_performance").select("date").order("date", { ascending: false }).limit(1);
    const [summary, { data: latestRow }] = await Promise.all([
      tryRpc<unknown[]>("keyword_summary", { p_from: from, p_to: to, p_brands: brand !== "all" ? expandBrands(brand) : null }),
      latestQ,
    ]);

    // PostgREST 의 db-max-rows(1000)가 클라이언트 range 보다 우선하므로
    // .range(0, 99999) 로는 캡을 넘을 수 없다 → 페이지네이션으로 전량 조회.
    const data = summary ?? await fetchAll(query);

    return NextResponse.json({ keywords: data, latestCollected: latestRow?.[0]?.date || null });
  } catch (error) {
    console.error("Keywords API error:", error);
    return NextResponse.json({ error: "Failed to fetch data" }, { status: 500 });
  }
}

// 5분 캐시·쓰기 후 무효화 (src/lib/api-cache.ts)
export const GET = cachedGET(getImpl, ["keyword_performance"]);
