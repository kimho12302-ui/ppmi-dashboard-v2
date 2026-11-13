import { expandBrands } from "@/lib/brand-groups";
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/db";
import { groupKeywordSummary, tryRpc } from "@/lib/summary-rpc";
import { cachedGET, NO_CACHE_HEADER } from "@/lib/api-cache";
import {
  KEYWORD_PLATFORMS, KEYWORD_SPEND_CHANNEL, SHOPPING_SPEND_CHANNEL, shoppingNoteBrands, splitLegacyRows,
  type SourceLatest, type SpendLatest,
} from "@/lib/sa-balancelab";

const ALL_BRANDS = ["balancelab", "nutty", "ironpet", "saip"];

/**
 * 키워드 단위 원천(지금은 naver_search)의 (플랫폼, 브랜드)별 마지막 수집일. 기간과 무관하게 본다.
 * 조합마다 정렬 + limit 1 로 한 번씩 부른다(GROUP BY 는 PostgREST 기본 질의로 안 된다).
 * ★ 2026-11-13: 예전엔 네이버 쇼핑·GFA·구글·메타까지 봤다. 그 플랫폼 행은 05-04 이전 캠페인 이름이라 키워드 원천이 아니다
 *   (src/lib/sa-balancelab.ts 「키워드 원천 판정」). 그래서 키워드 단위 플랫폼만 본다.
 */
async function latestBySource(brands: string[]): Promise<SourceLatest[]> {
  const pairs = KEYWORD_PLATFORMS.flatMap((platform) => brands.map((brand) => ({ platform, brand })));
  const found = await Promise.all(pairs.map(async ({ platform, brand }) => {
    const { data, error } = await supabase.from("keyword_performance").select("date")
      .eq("platform", platform).eq("brand", brand).order("date", { ascending: false }).limit(1);
    if (error) throw error;
    const latest = data?.[0]?.date as string | undefined;
    return latest ? { platform, brand, latest } : null;
  }));
  return found.filter((x): x is SourceLatest => x !== null);
}

/** 키워드 단위 원천의 (플랫폼, 브랜드)별 마지막 광고비(>0) 날짜. daily_ad_spend 채널은 KEYWORD_SPEND_CHANNEL 로 잇는다. */
async function lastSpendBySource(brands: string[]): Promise<SpendLatest[]> {
  const pairs = KEYWORD_PLATFORMS.flatMap((platform) => brands.map((brand) => ({ platform, brand })));
  const found = await Promise.all(pairs.map(async ({ platform, brand }) => {
    const { data, error } = await supabase.from("daily_ad_spend").select("date")
      .eq("channel", KEYWORD_SPEND_CHANNEL[platform]).eq("brand", brand).gt("spend", 0)
      .order("date", { ascending: false }).limit(1);
    if (error) throw error;
    const lastSpend = data?.[0]?.date as string | undefined;
    return lastSpend ? { platform, brand, lastSpend } : null;
  }));
  return found.filter((x): x is SpendLatest => x !== null);
}

/** 고른 기간에 쇼핑검색 광고비가 있는 브랜드. 키워드 표에 없다는 안내를 그 브랜드에만 붙인다. */
async function shoppingBrandsInPeriod(brands: string[], from: string, to: string): Promise<string[]> {
  const { data, error } = await supabase.from("daily_ad_spend").select("brand,spend")
    .eq("channel", SHOPPING_SPEND_CHANNEL).in("brand", brands).gt("spend", 0).gte("date", from).lte("date", to)
    .limit(1000);
  if (error) throw error;
  return shoppingNoteBrands((data || []) as { brand: string; spend: number }[]);
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
    //   마지막 수집일·광고비 조회는 서로 기다릴 이유가 없어 같이 보낸다.
    const scope = brand === "all" ? ALL_BRANDS : expandBrands(brand);
    const [summary, status] = await Promise.all([
      tryRpc<unknown[]>("keyword_summary", { p_from: from, p_to: to, p_brands: brand !== "all" ? expandBrands(brand) : null }),
      // 원천 상태 조회가 실패해도 키워드 표는 낸다. 대신 sourcesError 로 알리고(빈 목록 = "멈춘 곳 없음"과 구별),
      // 그 응답은 캐시하지 않는다(5분 동안 "수집 상태 모름"이 박히지 않게). 광고비를 못 읽어도 같은 처리다:
      // 광고비 없이는 "멈춤"과 "광고 끔"을 가를 수 없다.
      Promise.all([latestBySource(scope), lastSpendBySource(scope), shoppingBrandsInPeriod(scope, from, to)])
        .catch((e) => { console.error("keywords source status:", e); return null; }),
    ]);

    // PostgREST 의 db-max-rows(1000)가 클라이언트 range 보다 우선하므로
    // .range(0, 99999) 로는 캡을 넘을 수 없다 → 페이지네이션으로 전량 조회.
    // 함수가 없으면(SQL 실행 전) 같은 묶음을 서버에서 JS 로 만든다. 화면으로 가는 양은 그때도 준다.
    const grouped = (summary ?? groupKeywordSummary(await fetchAll(query))) as { platform: string; keyword: string | null }[];
    // ★ 2026-11-13: 05-04 이전 캠페인 이름 행(쇼핑·메타·GFA·구글 전부, 파워링크의 "01.아이언펫_파워링크" 꼴)은
    //   키워드가 아니다. 표·KPI·칩에서 빼고 legacy 로 따로 보낸다(화면이 회색 한 줄로 알린다). DB 는 그대로다.
    const { keywords, legacy } = splitLegacyRows(grouped);

    const sourcesError = status === null;
    const [sources, spend, shoppingBrands] = status ?? [[], [], []];
    // latestCollected = 이 브랜드 범위에서 가장 늦은 키워드 수집일(키워드 단위 원천 기준).
    const latestCollected = sources.reduce<string | null>((m, s) => (!m || s.latest > m ? s.latest : m), null);
    return NextResponse.json(
      { keywords, legacy, latestCollected, sources, spend, shoppingBrands, sourcesError },
      sourcesError ? { headers: { [NO_CACHE_HEADER]: "1" } } : undefined,
    );
  } catch (error) {
    console.error("Keywords API error:", error);
    return NextResponse.json({ error: "Failed to fetch data" }, { status: 500 });
  }
}

// 5분 캐시·쓰기 후 무효화 (src/lib/api-cache.ts). 원천 상태 판정에 광고비(daily_ad_spend)도 읽는다.
export const GET = cachedGET(getImpl, ["keyword_performance", "daily_ad_spend"], ["brand", "from", "to"]);
