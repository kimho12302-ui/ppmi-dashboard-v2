export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { isGongguInDailySales } from "@/lib/gonggu";

// 채널 성과 = 판매처별 매출 vs 그 판매처를 끌어온 광고비 (사용자 정의 매핑, 2026-06-11).
//  - 네이버(스마트스토어): 매출=smartstore, 광고비=네이버검색+네이버쇼핑+GFA
//  - 자사몰(카페24): 매출=cafe24, 광고비=메타+구글
//  - 쿠팡: 매출=coupang, 광고비=쿠팡광고
const GROUPS = [
  { key: "naver", label: "네이버 (스마트스토어)", salesCh: ["smartstore"], adCh: ["naver_search", "naver_shopping", "gfa"] },
  { key: "jasamol", label: "자사몰 (카페24)", salesCh: ["cafe24"], adCh: ["meta", "google_pmax"] },
  { key: "coupang", label: "쿠팡", salesCh: ["coupang"], adCh: ["coupang_ads"] },
];

const AD_LABELS: Record<string, string> = {
  naver_search: "네이버 검색", naver_shopping: "네이버 쇼핑", gfa: "GFA",
  meta: "메타", google_pmax: "구글", coupang_ads: "쿠팡 광고",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAll(q: any): Promise<any[]> {
  const PAGE = 1000;
  let from = 0;
  const all: unknown[] = [];
  while (true) {
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) break;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

type DayAgg = { rev: Record<string, number>; ad: Record<string, number> };

async function periodData(from: string, to: string, brand: string) {
  // 매출: daily_sales 채널별 (공구 채널 제외). 브랜드 필터 시 해당 브랜드만.
  let salesQ = supabase.from("daily_sales").select("date,brand,channel,revenue")
    .gte("date", from).lte("date", to).neq("channel", "total").not("channel", "like", "공구%");
  if (brand !== "all") salesQ = salesQ.eq("brand", brand);
  const sales = await fetchAll(salesQ);
  // 광고비: daily_ad_spend 채널별 (ga4 제외). all이면 매직행(brand=all) 제외, 특정 브랜드면 그 브랜드만.
  let adsQ = supabase.from("daily_ad_spend").select("date,channel,spend")
    .gte("date", from).lte("date", to).not("channel", "like", "ga4_%");
  adsQ = brand !== "all" ? adsQ.eq("brand", brand) : adsQ.neq("brand", "all");
  const ads = await fetchAll(adsQ);
  // 밸런스랩 형식-A 공구 → smartstore 매출에서 차감 (날짜별 + 합계). all/balancelab일 때만.
  let formA = 0;
  const formAByDate: Record<string, number> = {};
  if (brand === "all" || brand === "balancelab") {
    const ps = await fetchAll(
      supabase.from("product_sales").select("date,channel,lineup,product,revenue")
        .gte("date", from).lte("date", to).eq("brand", "balancelab")
    );
    for (const r of ps as { date: string; channel: string; lineup: string | null; product: string; revenue: number }[]) {
      if (isGongguInDailySales(r)) { const v = Number(r.revenue || 0); formA += v; formAByDate[r.date] = (formAByDate[r.date] || 0) + v; }
    }
  }

  const byDate: Record<string, DayAgg> = {};
  const day = (d: string): DayAgg => (byDate[d] ||= { rev: {}, ad: {} });

  const revByCh: Record<string, number> = {};
  for (const r of sales as { date: string; channel: string; revenue: number }[]) {
    const v = Number(r.revenue || 0);
    revByCh[r.channel] = (revByCh[r.channel] || 0) + v;
    const dd = day(r.date); dd.rev[r.channel] = (dd.rev[r.channel] || 0) + v;
  }
  revByCh["smartstore"] = Math.max(0, (revByCh["smartstore"] || 0) - formA);
  for (const d in formAByDate) {
    if (byDate[d]) byDate[d].rev["smartstore"] = Math.max(0, (byDate[d].rev["smartstore"] || 0) - formAByDate[d]);
  }

  const adByCh: Record<string, number> = {};
  for (const r of ads as { date: string; channel: string; spend: number }[]) {
    const v = Number(r.spend || 0);
    adByCh[r.channel] = (adByCh[r.channel] || 0) + v;
    const dd = day(r.date); dd.ad[r.channel] = (dd.ad[r.channel] || 0) + v;
  }
  return { revByCh, adByCh, byDate };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";
  const brand = sp.get("brand") || "all";

  try {
    if (!from || !to || isNaN(new Date(from).getTime()) || isNaN(new Date(to).getTime())) {
      return NextResponse.json({ error: "유효한 from/to 날짜가 필요합니다" }, { status: 400 });
    }
    // 직전 동일 길이 기간 (전주/전기간 대비)
    const fromD = new Date(from), toD = new Date(to);
    const diff = toD.getTime() - fromD.getTime();
    const prevTo = new Date(fromD.getTime() - 86400000).toISOString().slice(0, 10);
    const prevFrom = new Date(fromD.getTime() - diff - 86400000).toISOString().slice(0, 10);

    const [cur, prev] = await Promise.all([periodData(from, to, brand), periodData(prevFrom, prevTo, brand)]);

    const groups = GROUPS.map((g) => {
      const revenue = g.salesCh.reduce((s, c) => s + (cur.revByCh[c] || 0), 0);
      const adSpend = g.adCh.reduce((s, c) => s + (cur.adByCh[c] || 0), 0);
      const prevRev = g.salesCh.reduce((s, c) => s + (prev.revByCh[c] || 0), 0);
      const prevAd = g.adCh.reduce((s, c) => s + (prev.adByCh[c] || 0), 0);
      const roas = adSpend > 0 ? revenue / adSpend : 0;
      const prevRoas = prevAd > 0 ? prevRev / prevAd : 0;
      return {
        key: g.key,
        label: g.label,
        revenue,
        adSpend,
        roas,
        adRatio: revenue > 0 ? (adSpend / revenue) * 100 : 0,
        subAds: g.adCh.map((c) => ({ channel: c, label: AD_LABELS[c] || c, spend: cur.adByCh[c] || 0 })),
        revDelta: prevRev > 0 ? ((revenue / prevRev) - 1) * 100 : null,
        adDelta: prevAd > 0 ? ((adSpend / prevAd) - 1) * 100 : null,
        roasDelta: prevRoas > 0 ? ((roas / prevRoas) - 1) * 100 : null,
      };
    });

    const totalRev = groups.reduce((s, g) => s + g.revenue, 0);
    const totalAd = groups.reduce((s, g) => s + g.adSpend, 0);

    // 일별 시계열 (페이지에서 일/주/월로 롤업) — 채널그룹별 매출/광고비
    const series = Object.keys(cur.byDate).sort().map((date) => {
      const d = cur.byDate[date];
      const row: Record<string, unknown> = { date };
      for (const g of GROUPS) {
        row[g.key] = {
          revenue: g.salesCh.reduce((s, c) => s + (d.rev[c] || 0), 0),
          adSpend: g.adCh.reduce((s, c) => s + (d.ad[c] || 0), 0),
        };
      }
      return row;
    });

    return NextResponse.json({
      from, to, prevFrom, prevTo,
      groups,
      total: { revenue: totalRev, adSpend: totalAd, roas: totalAd > 0 ? totalRev / totalAd : 0, adRatio: totalRev > 0 ? (totalAd / totalRev) * 100 : 0 },
      series,
    });
  } catch (error) {
    console.error("channel-groups error:", error);
    return NextResponse.json({ error: "Failed to fetch channel groups" }, { status: 500 });
  }
}
