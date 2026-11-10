import { expandBrands } from "@/lib/brand-groups";
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/db";
import { groupKeywordSummary, tryRpc } from "@/lib/summary-rpc";
import { cachedGET, NO_CACHE_HEADER } from "@/lib/api-cache";
import type { SourceLatest } from "@/lib/sa-balancelab";

// 키워드 분석 탭이 플랫폼별로 수집 멈춤을 가르려고 보는 플랫폼·브랜드. 기록이 한 번도 없던 조합은 빠진다.
const PLATFORMS = ["naver_search", "naver_shopping", "naver_gfa", "google_search", "google_display", "meta"];
const ALL_BRANDS = ["balancelab", "nutty", "ironpet", "saip"];

/**
 * (플랫폼, 브랜드)별 마지막 수집일. 기간과 무관하게 본다.
 * 조합마다 한 번씩(최대 24번) 부른다. 한 번에 묶으려면 GROUP BY 가 필요한데 PostgREST 기본 질의로는 안 되고
 * DB 함수·뷰(SQL)가 있어야 해서 만들지 않았다(2026-11-10). 각 조회는 정렬 + limit 1 이라 가볍다.
 * ★ 2026-11-10: 예전엔 표 전체의 마지막 날 하나(latestCollected)만 봐서, 밸런스랩 네이버 검색이 매일 들어오는 한
 *   05-04 에 멈춘 네이버 쇼핑·03-12 에 멈춘 GFA·구글·메타가 경고 없이 "그 기간 0" 처럼 보였다.
 */
async function latestBySource(brands: string[]): Promise<SourceLatest[]> {
  const pairs = PLATFORMS.flatMap((platform) => brands.map((brand) => ({ platform, brand })));
  const found = await Promise.all(pairs.map(async ({ platform, brand }) => {
    const { data, error } = await supabase.from("keyword_performance").select("date")
      .eq("platform", platform).eq("brand", brand).order("date", { ascending: false }).limit(1);
    if (error) throw error;
    const latest = data?.[0]?.date as string | undefined;
    return latest ? { platform, brand, latest } : null;
  }));
  return found.filter((x): x is SourceLatest => x !== null);
}

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
    const scope = brand === "all" ? ALL_BRANDS : expandBrands(brand);
    const [summary, sources] = await Promise.all([
      tryRpc<unknown[]>("keyword_summary", { p_from: from, p_to: to, p_brands: brand !== "all" ? expandBrands(brand) : null }),
      // 마지막 수집일 조회가 실패해도 키워드 표는 낸다. 대신 sourcesError 로 알리고(빈 목록 = "멈춘 곳 없음"과 구별),
      // 그 응답은 캐시하지 않는다(5분 동안 "수집 상태 모름"이 박히지 않게).
      latestBySource(scope).catch((e) => { console.error("keywords latestBySource:", e); return null; }),
    ]);

    // PostgREST 의 db-max-rows(1000)가 클라이언트 range 보다 우선하므로
    // .range(0, 99999) 로는 캡을 넘을 수 없다 → 페이지네이션으로 전량 조회.
    // 함수가 없으면(SQL 실행 전) 같은 묶음을 서버에서 JS 로 만든다. 화면으로 가는 양은 그때도 준다.
    const data = summary ?? groupKeywordSummary(await fetchAll(query));

    // latestCollected = 이 브랜드 범위에서 가장 늦은 수집일(예전엔 표 전체 기준이라 밸런스랩 수집이 다른 브랜드 멈춤을 가렸다).
    const sourcesError = sources === null;
    const list = sources ?? [];
    const latestCollected = list.reduce<string | null>((m, s) => (!m || s.latest > m ? s.latest : m), null);
    return NextResponse.json(
      { keywords: data, latestCollected, sources: list, sourcesError },
      sourcesError ? { headers: { [NO_CACHE_HEADER]: "1" } } : undefined,
    );
  } catch (error) {
    console.error("Keywords API error:", error);
    return NextResponse.json({ error: "Failed to fetch data" }, { status: 500 });
  }
}

// 5분 캐시·쓰기 후 무효화 (src/lib/api-cache.ts)
export const GET = cachedGET(getImpl, ["keyword_performance"], ["brand", "from", "to"]);
