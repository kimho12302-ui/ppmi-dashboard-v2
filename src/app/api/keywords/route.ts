import { expandBrands } from "@/lib/brand-groups";
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/db";
import { groupKeywordSummary, tryRpc } from "@/lib/summary-rpc";
import { cachedGET, NO_CACHE_HEADER } from "@/lib/api-cache";
import {
  KEYWORD_PLATFORMS, KEYWORD_SPEND_CAMPAIGN_TYPE, SHOPPING_SPEND_CHANNEL, mergeKeywordSummaries, shoppingNoteBrands,
  splitLegacyRows, splitPeriodAtLegacy, type KeywordSummaryRow, type SourceLatest, type SpendLatest,
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

/**
 * 키워드 단위 원천의 (플랫폼, 브랜드)별 마지막 광고비(>0) 날짜.
 * 파워링크 키워드에는 naver_campaign_daily 의 같은 범위 캠페인(campaign_type WEB_SITE) 비용을 댄다.
 * daily_ad_spend.naver_search 는 브랜드검색·파워컨텐츠까지 섞여 파워링크만 끈 브랜드를 「멈춤」으로 오판한다(QA 2026-11-13 M-2).
 */
async function lastSpendBySource(brands: string[]): Promise<SpendLatest[]> {
  const pairs = KEYWORD_PLATFORMS.flatMap((platform) => brands.map((brand) => ({ platform, brand })));
  const found = await Promise.all(pairs.map(async ({ platform, brand }) => {
    const { data, error } = await supabase.from("naver_campaign_daily").select("date")
      .eq("campaign_type", KEYWORD_SPEND_CAMPAIGN_TYPE[platform]).eq("brand", brand).gt("cost", 0)
      .order("date", { ascending: false }).limit(1);
    if (error) throw error;
    const lastSpend = data?.[0]?.date as string | undefined;
    return lastSpend ? { platform, brand, lastSpend } : null;
  }));
  return found.filter((x): x is SpendLatest => x !== null);
}

/** 고른 기간에 쇼핑검색 광고비가 있는 브랜드. 키워드 표에 없다는 안내를 그 브랜드에만 붙인다.
 *  브랜드마다 한 줄(limit 1)만 본다. 기간이 길어도(올해·전체) 행 한도(1,000)에 걸리지 않게. */
async function shoppingBrandsInPeriod(brands: string[], from: string, to: string): Promise<string[]> {
  const found = await Promise.all(brands.map(async (brand) => {
    const { data, error } = await supabase.from("daily_ad_spend").select("brand,spend")
      .eq("channel", SHOPPING_SPEND_CHANNEL).eq("brand", brand).gt("spend", 0).gte("date", from).lte("date", to)
      .limit(1);
    if (error) throw error;
    return (data || []) as { brand: string; spend: number }[];
  }));
  return shoppingNoteBrands(found.flat());
}

/** (플랫폼, 키워드) 묶음 합계. DB 합산 함수가 있으면 그것, 없으면(SQL 실행 전) 원본을 받아 JS 로 같은 묶음을 만든다. */
async function summaryOf(from: string, to: string, brand: string): Promise<KeywordSummaryRow[]> {
  const brands = brand !== "all" ? expandBrands(brand) : null;
  const rpc = await tryRpc<KeywordSummaryRow[]>("keyword_summary", { p_from: from, p_to: to, p_brands: brands });
  if (rpc) return rpc;
  // PostgREST 의 db-max-rows(1000)가 클라이언트 range 보다 우선하므로 페이지네이션으로 전량 조회(fetchAll).
  let query = supabase.from("keyword_performance").select("*").gte("date", from).lte("date", to).order("clicks", { ascending: false });
  if (brands) query = query.in("brand", brands);
  return groupKeywordSummary(await fetchAll(query)) as KeywordSummaryRow[];
}

async function getImpl(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";
  const brand = sp.get("brand") || "all";

  try {
    // ★ 2026-11-13: 05-04 이전 캠페인 이름 행(쇼핑·메타·GFA·구글 전부, 파워링크 3건)은 키워드가 아니다.
    //   기간을 05-04 까지(early)와 그 뒤(late)로 나눠 early 묶음에서만 그 행을 legacy 로 떼고, late 는 그대로 둔다
    //   (묶음 행에는 날짜가 없어 한 번에 받으면 05-05 이후 같은 이름을 가를 수 없다). 표·KPI·칩은 keywords 만 쓴다. DB 는 그대로다.
    const { early, late } = splitPeriodAtLegacy(from, to);
    const scope = brand === "all" ? ALL_BRANDS : expandBrands(brand);
    const [earlyRows, lateRows, status] = await Promise.all([
      early ? summaryOf(early[0], early[1], brand) : Promise.resolve([] as KeywordSummaryRow[]),
      late ? summaryOf(late[0], late[1], brand) : Promise.resolve([] as KeywordSummaryRow[]),
      // 원천 상태 조회가 실패해도 키워드 표는 낸다. 대신 sourcesError 로 알리고(빈 목록 = "멈춘 곳 없음"과 구별),
      // 그 응답은 캐시하지 않는다(5분 동안 "수집 상태 모름"이 박히지 않게). 광고비를 못 읽어도 같은 처리다.
      Promise.all([latestBySource(scope), lastSpendBySource(scope), shoppingBrandsInPeriod(scope, from, to)])
        .catch((e) => { console.error("keywords source status:", e); return null; }),
    ]);
    const split = splitLegacyRows(earlyRows);
    const keywords = early && late ? mergeKeywordSummaries(split.keywords, lateRows) : early ? split.keywords : lateRows;
    const legacy = split.legacy;

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

// 5분 캐시·쓰기 후 무효화 (src/lib/api-cache.ts). 원천 상태 판정에 파워링크 캠페인 비용·쇼핑 광고비도 읽는다.
export const GET = cachedGET(getImpl, ["keyword_performance", "naver_campaign_daily", "daily_ad_spend"], ["brand", "from", "to"]);
