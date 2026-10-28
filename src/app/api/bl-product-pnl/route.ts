import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/db";
import { cachedGET } from "@/lib/api-cache";
import { isGonggu, isGongguAggregate } from "@/lib/gonggu";
import { kstDate } from "@/lib/date";
import {
  PNL_PRODUCTS, GONGGU_UNTAGGED_MONTHS, classifyPnlProduct, classifyAdName, isHeavyIntentKeyword, isCampaignLabelKeyword, isMissingTable,
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
//   측정 범위 경고: P01 비용이 난 날 중 키워드 행이 없는 날이 있으면 "일부만"(2026-10-28 판정 변경.
//   옛 판정은 "키워드 행이 있는 날 수"라 광고비 0원 날을 빠진 날로, 캠페인 이름 행을 측정된 날로 셌다).
// 영양제 광고비는 0(시트도 0).
// 광고 외 마케팅비: bl_pnl_manual_cost(손 입력, 체험 키트 원가 등). 자체 마케팅비에 더한다.
// 공구 구분 불가 달: bl_gonggu_schedule 공구 기간이 그 달에 있는데 원장에 공구 표식 행이 0 인 달.
//   두 표 모두 SQL(docs/sql/2026-10-28-*.sql) 전에는 없다. 없으면 화면은 예전처럼 동작한다.

const SALES_TABLE = "product_sales";

type ProductMap = PnlMonthInput["products"];

function emptyMonth(month: string): PnlMonthInput {
  const products = {} as ProductMap;
  for (const p of PNL_PRODUCTS) {
    products[p.key] = {
      gonggu: { revenue: 0, quantity: 0, orders: 0 },
      self: { revenue: 0, quantity: 0, orders: 0 },
      ad: { naverSearch: 0, naverShopping: 0, meta: 0 },
      extra: [],
    };
  }
  return {
    month, products, lagWarning: false, gongguUntagged: false,
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
  // 큐모발 공통 파워링크(P01)에 돈이 나간 날. 이 날들만 키워드 원장이 있어야 중금속 몫을 가를 수 있다
  const hairDays = new Set<string>();
  let campaignRows = 0;
  for (const r of src.campaigns) if (String(r.date).startsWith(month)) {
    campaignRows++;
    const target = classifyAdName(String(r.campaign ?? ""));
    const cost = Number(r.cost) || 0;
    add(r.campaign_type === "SHOPPING" ? shopping : search, target, cost);
    if (target === "hair" && r.campaign_type !== "SHOPPING" && cost > 0) hairDays.add(String(r.date));
  }
  // 캠페인 일별 원장이 그 달에 아예 없으면 네이버 검색 광고비가 나간 날로 대신한다
  if (campaignRows === 0) {
    for (const r of src.spend) {
      if (String(r.date).startsWith(month) && r.channel === "naver_search" && (Number(r.spend) || 0) > 0) hairDays.add(String(r.date));
    }
  }
  let heavyKw = 0;
  const keywordDays = new Set<string>();
  for (const r of src.keywords) if (String(r.date).startsWith(month)) {
    const kw = String(r.keyword ?? "");
    if (isCampaignLabelKeyword(kw)) continue; // 옛 수집기가 캠페인 이름을 키워드 칸에 넣은 행
    keywordDays.add(String(r.date));
    if (isHeavyIntentKeyword(kw)) heavyKw += Number(r.cost) || 0;
  }
  let covered = 0;
  hairDays.forEach((d) => { if (keywordDays.has(d)) covered++; });
  const hair = search.hair || 0;
  const heavyFromHair = Math.min(heavyKw, hair);
  delete search.hair;
  add(search, "heavy", heavyFromHair);
  add(search, "generic", hair - heavyFromHair); // 구분불가 → 뉴트리션(시트 규칙)
  if (shopping.hair) { add(shopping, "generic", shopping.hair); delete shopping.hair; }
  return { search, shopping, hairDays: hairDays.size, coveredDays: covered };
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

  // 측정 범위 = P01 비용이 난 날 중 실제 키워드 행(캠페인 이름 행 제외)이 있는 날의 비율
  m.keywordCoverage = nv.coveredDays >= nv.hairDays ? "full" : nv.coveredDays === 0 ? "none" : "partial";
}

const sumValues = (o: Num) => Object.values(o).reduce((a, b) => a + b, 0);

/** 새 표(SQL 전에는 없음)를 읽는다. 없으면 null, 다른 오류는 던진다 */
async function readOptional(query: PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>) {
  const { data, error } = await query;
  if (isMissingTable(error)) return null;
  if (error) throw error;
  return (data ?? []) as Record<string, unknown>[];
}

/** 그 달에 공구 기간이 하루라도 걸치는지 */
function hasScheduleIn(month: string, schedule: Record<string, unknown>[]): boolean {
  const first = `${month}-01`, last = `${month}-31`;
  return schedule.some((w) => String(w.start_on) <= last && String(w.end_on) >= first);
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
  const [schedule, manual] = await Promise.all([
    readOptional(supabase.from("bl_gonggu_schedule").select("seller,start_on,end_on").lte("start_on", to).gte("end_on", from)),
    readOptional(supabase.from("bl_pnl_manual_cost").select("product,month,kind,amount,memo")
      .gte("month", from.slice(0, 7)).lte("month", to.slice(0, 7)).order("kind")),
  ]);
  return { sales, ads: { spend, campaigns, metaAds, metaProducts, keywords } as AdSources, schedule, manual };
}

async function getImpl(req: NextRequest) {
  const today = kstDate();
  const yearParam = req.nextUrl.searchParams.get("year") || today.slice(0, 4);
  if (!/^\d{4}$/.test(yearParam)) return NextResponse.json({ error: "year 는 YYYY" }, { status: 400 });
  const year = Number(yearParam);
  const from = `${year}-01-01`, to = `${year}-12-31`;

  try {
    const { sales, ads, schedule, manual } = await loadSources(from, to);
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

    for (const m of months) {
      const gongguRevenue = PNL_PRODUCTS.reduce((a, p) => a + m.products[p.key].gonggu.revenue, 0);
      m.gongguUntagged = schedule
        ? hasScheduleIn(m.month, schedule) && gongguRevenue === 0
        : GONGGU_UNTAGGED_MONTHS.includes(m.month);
    }

    for (const r of manual ?? []) {
      const m = byMonth.get(String(r.month));
      const key = String(r.product) as PnlProductKey;
      if (!m || !m.products[key]) continue;
      m.products[key].extra.push({ kind: String(r.kind), amount: Number(r.amount) || 0, memo: (r.memo as string | null) ?? null });
    }

    // 판매 동기화는 최근 5일이 덜 들어와 있다(메모리 reference_sales_sync_lag_4days)
    const lagFrom = kstDate(-5).slice(0, 7);
    for (const m of months) {
      if (m.month > today.slice(0, 7)) continue;
      allocateAds(m, ads);
      m.lagWarning = m.month === today.slice(0, 7) || m.month === lagFrom;
    }

    return NextResponse.json({
      year, months, asOf: new Date().toISOString(),
      manualCostReady: manual !== null, scheduleReady: schedule !== null,
    });
  } catch (error) {
    console.error("bl-product-pnl API error:", error);
    return NextResponse.json({ error: "Failed to fetch data" }, { status: 500 });
  }
}

export const GET = cachedGET(
  getImpl,
  [SALES_TABLE, "daily_ad_spend", "naver_campaign_daily", "meta_ad_daily", "ad_product_performance", "keyword_performance",
    "bl_gonggu_schedule", "bl_pnl_manual_cost"],
  ["year"],
);
