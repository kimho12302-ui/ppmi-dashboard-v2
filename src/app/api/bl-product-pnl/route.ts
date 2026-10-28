import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/db";
import { cachedGET } from "@/lib/api-cache";
import { isGonggu, isGongguAggregate } from "@/lib/gonggu";
import { kstDate } from "@/lib/date";
import {
  PNL_PRODUCTS, GONGGU_UNTAGGED_MONTHS, classifyPnlProduct, classifyAdName, isHeavyIntentKeyword,
  type PnlProductKey, type PnlMonthInput, type AdBreakdown, type SalesCell, type AdTarget,
} from "@/lib/bl-pnl";

// 밸런스랩 제품별 손익 원천 (2026-10-28). 계산식·설정은 src/lib/bl-pnl.ts.
//
// 매출·수량·주문건수: product_sales (밸런스랩). 공구/자체는 gonggu.ts isGonggu 그대로.
//   주문건수 칸이 원장에 없어 buyers(일자×상품별 구매자 수) 합으로 대신한다. 9월 시트와 전 칸 일치.
// 자체 마케팅비: 시트 손 입력값과 같은 규칙.
//   광고비 합계(daily_ad_spend 메타·네이버 검색·네이버 쇼핑, GFA 제외)에서
//   중금속·타액·음식물로 가를 수 있는 몫을 떼고 **나머지는 전부 뉴트리션**으로 둔다.
//   (시트가 큐모발 파워링크 구분불가 몫, 메타 제품 미구분 몫을 모두 뉴트리션에 넣었다. 1·9월 정확히 일치 확인)
//   큐모발 파워링크(P01)의 중금속 몫은 keyword_performance 의 중금속 검색어 광고비. 키워드 원장이 없는 달은 0.
// 영양제 광고비는 0(시트도 0).

const SALES_TABLE = "product_sales";

type ProductMap = PnlMonthInput["products"];

function emptyMonth(month: string): PnlMonthInput {
  const products = {} as ProductMap;
  for (const p of PNL_PRODUCTS) {
    products[p.key] = {
      gonggu: { revenue: 0, quantity: 0, orders: 0 },
      self: { revenue: 0, quantity: 0, orders: 0 },
      ad: { naverSearch: 0, naverShopping: 0, meta: 0 },
    };
  }
  return {
    month, products, lagWarning: false, gongguUntagged: GONGGU_UNTAGGED_MONTHS.includes(month),
    keywordCoverage: "none", adTotal: 0, gfa: 0, excluded: {},
  };
}

function addSales(cell: SalesCell, r: Record<string, unknown>) {
  cell.revenue += Number(r.revenue) || 0;
  cell.quantity += Number(r.quantity) || 0;
  cell.orders += Number(r.buyers) || 0;
}

type Num = Record<string, number>;
const add = (m: Num, k: string, v: number) => { m[k] = (m[k] || 0) + v; };

interface AdSources {
  spend: Record<string, unknown>[];
  campaigns: Record<string, unknown>[];
  metaAds: Record<string, unknown>[];
  metaProducts: Record<string, unknown>[];
  keywords: Record<string, unknown>[];
}

/** 메타: 광고 단위(meta_ad_daily)가 그 달 합계를 다 덮으면 그걸, 아니면 제품 단위(ad_product_performance)로 가른다 */
function metaSplit(month: string, total: number, src: AdSources): Num {
  const byAd: Num = {};
  let adSum = 0;
  for (const r of src.metaAds) if (String(r.date).startsWith(month)) {
    add(byAd, classifyAdName(String(r.campaign_name ?? "")), Number(r.spend) || 0);
    adSum += Number(r.spend) || 0;
  }
  if (total > 0 && Math.abs(adSum - total) <= total * 0.01) return byAd;
  const byProd: Num = {};
  for (const r of src.metaProducts) if (String(r.date).startsWith(month)) {
    add(byProd, classifyAdName(String(r.product_name ?? "")), Number(r.spend) || 0);
  }
  return byProd;
}

/** 네이버: 캠페인명으로 가르고, 큐모발 공통 파워링크는 중금속 검색어 몫만 중금속으로 */
function naverSplit(month: string, src: AdSources) {
  const search: Num = {}, shopping: Num = {};
  for (const r of src.campaigns) if (String(r.date).startsWith(month)) {
    const target = classifyAdName(String(r.campaign ?? ""));
    add(r.campaign_type === "SHOPPING" ? shopping : search, target, Number(r.cost) || 0);
  }
  let heavyKw = 0;
  const days = new Set<string>();
  for (const r of src.keywords) if (String(r.date).startsWith(month)) {
    days.add(String(r.date));
    if (isHeavyIntentKeyword(String(r.keyword ?? ""))) heavyKw += Number(r.cost) || 0;
  }
  const hair = search.hair || 0;
  const heavyFromHair = Math.min(heavyKw, hair);
  delete search.hair;
  add(search, "heavy", heavyFromHair);
  add(search, "generic", hair - heavyFromHair); // 구분불가 → 뉴트리션(시트 규칙)
  if (shopping.hair) { add(shopping, "generic", shopping.hair); delete shopping.hair; }
  return { search, shopping, keywordDays: days.size };
}

/** 그 달 광고비를 제품별로 채운다. 원장 합계에서 가를 수 있는 몫을 빼고 나머지는 뉴트리션 */
function allocateAds(m: PnlMonthInput, src: AdSources) {
  const totals: Num = {};
  for (const r of src.spend) if (String(r.date).startsWith(m.month)) add(totals, String(r.channel), Number(r.spend) || 0);
  m.gfa = Math.round(totals.gfa || 0);

  const meta = metaSplit(m.month, totals.meta || 0, src);
  const nv = naverSplit(m.month, src);
  const fill = (part: Num, total: number, field: keyof AdBreakdown) => {
    let used = 0;
    for (const [k, v] of Object.entries(part)) {
      if (k === "excluded") { add(m.excluded, field, v); used += v; continue; }
      if (k === "generic") continue;
      const key = (k as AdTarget) as PnlProductKey;
      if (!m.products[key]) continue;
      m.products[key].ad[field] += v;
      used += v;
    }
    // 원장 합계 − 갈라진 몫(제외 캠페인 포함) = 나머지 → 뉴트리션. 원장이 비면 갈라진 값 그대로
    const rest = total > 0 ? total - used : part.generic || 0;
    m.products.nutrition.ad[field] += rest;
  };
  fill(meta, totals.meta || 0, "meta");
  fill(nv.search, totals.naver_search || 0, "naverSearch");
  fill(nv.shopping, totals.naver_shopping || 0, "naverShopping");
  m.adTotal = Math.round((totals.meta || 0) + (totals.naver_search || 0) + (totals.naver_shopping || 0) - sumValues(m.excluded));

  const daysInMonth = monthDays(m.month);
  m.keywordCoverage = nv.keywordDays === 0 ? "none" : nv.keywordDays >= daysInMonth - 1 ? "full" : "partial";
}

const sumValues = (o: Num) => Object.values(o).reduce((a, b) => a + b, 0);

/** 그 달의 날 수. 이번 달이면 오늘까지 */
function monthDays(month: string): number {
  const today = kstDate();
  const [y, mo] = month.split("-").map(Number);
  const full = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return today.startsWith(month) ? Number(today.slice(8, 10)) : full;
}

async function loadSources(from: string, to: string) {
  const [sales, spend, campaigns, metaAds, metaProducts, keywords] = await Promise.all([
    fetchAll(supabase.from(SALES_TABLE).select("id,date,product,channel,lineup,category,revenue,quantity,buyers")
      .eq("brand", "balancelab").gte("date", from).lte("date", to)),
    fetchAll(supabase.from("daily_ad_spend").select("id,date,channel,spend").eq("brand", "balancelab").gte("date", from).lte("date", to)),
    // naver_campaign_daily 는 id 가 없다. 기본키 (date, campaign_id) 로 전순서
    fetchAll(supabase.from("naver_campaign_daily").select("date,campaign_id,campaign,campaign_type,cost")
      .eq("brand", "balancelab").gte("date", from).lte("date", to).order("date"), "campaign_id"),
    fetchAll(supabase.from("meta_ad_daily").select("date,ad_id,campaign_name,spend")
      .eq("brand", "balancelab").gte("date", from).lte("date", to).order("date"), "ad_id"),
    fetchAll(supabase.from("ad_product_performance").select("id,date,product_name,spend")
      .eq("brand", "balancelab").eq("channel", "meta").gte("date", from).lte("date", to)),
    fetchAll(supabase.from("keyword_performance").select("id,date,keyword,cost")
      .eq("brand", "balancelab").eq("platform", "naver_search").gte("date", from).lte("date", to)),
  ]);
  return { sales, ads: { spend, campaigns, metaAds, metaProducts, keywords } as AdSources };
}

async function getImpl(req: NextRequest) {
  const today = kstDate();
  const yearParam = req.nextUrl.searchParams.get("year") || today.slice(0, 4);
  if (!/^\d{4}$/.test(yearParam)) return NextResponse.json({ error: "year 는 YYYY" }, { status: 400 });
  const year = Number(yearParam);
  const from = `${year}-01-01`, to = `${year}-12-31`;

  try {
    const { sales, ads } = await loadSources(from, to);
    const months = Array.from({ length: 12 }, (_, i) => emptyMonth(`${year}-${String(i + 1).padStart(2, "0")}`));
    const byMonth = new Map(months.map((m) => [m.month, m]));

    for (const r of sales as Record<string, unknown>[]) {
      if (isGongguAggregate(r as { product?: string })) continue; // "공구 합계" 집계 행(2026 엔 없음)
      const m = byMonth.get(String(r.date).slice(0, 7));
      if (!m) continue;
      const key = classifyPnlProduct(String(r.product ?? ""), r.category as string | null);
      const gonggu = isGonggu(r as { product?: string; channel?: string; lineup?: string });
      addSales(gonggu ? m.products[key].gonggu : m.products[key].self, r);
    }

    // 판매 동기화는 최근 5일이 덜 들어와 있다(메모리 reference_sales_sync_lag_4days)
    const lagFrom = kstDate(-5).slice(0, 7);
    for (const m of months) {
      if (m.month > today.slice(0, 7)) continue;
      allocateAds(m, ads);
      m.lagWarning = m.month === today.slice(0, 7) || m.month === lagFrom;
    }

    return NextResponse.json({ year, months, asOf: new Date().toISOString() });
  } catch (error) {
    console.error("bl-product-pnl API error:", error);
    return NextResponse.json({ error: "Failed to fetch data" }, { status: 500 });
  }
}

export const GET = cachedGET(
  getImpl,
  [SALES_TABLE, "daily_ad_spend", "naver_campaign_daily", "meta_ad_daily", "ad_product_performance", "keyword_performance"],
  ["year"],
);
