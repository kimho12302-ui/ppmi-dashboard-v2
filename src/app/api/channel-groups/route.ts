export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { isGongguInDailySales } from "@/lib/gonggu";

// 채널(판매처) 성과 — 판매처별 매출 vs 그 판매처를 끌어온 광고비.
// ★ 브랜드 판매처 구조 반영(2026-06 수정):
//   - 밸런스랩: 스마트스토어 전용 → 밸런스랩 메타/구글도 '스마트스토어'로 귀속(자사몰 아님).
//   - 너티/사입/아이언펫: 스마트스토어(네이버검색+쇼핑+GFA) + 자사몰(메타+구글) 별개.
//   즉 메타를 통째로 자사몰에 넣지 않고, 밸런스랩 메타/구글(blMG)만 스마트스토어로 이동.
const GROUPS = [
  { key: "naver", label: "스마트스토어 (네이버·GFA + 밸런스랩 메타)", salesCh: ["smartstore"] },
  { key: "jasamol", label: "자사몰 (카페24)", salesCh: ["cafe24"] },
  { key: "coupang", label: "쿠팡", salesCh: ["coupang"] },
];

// 판매처(그룹)별 광고비 — blMG = 밸런스랩 메타+구글(스마트스토어 귀속분)
function storeAd(key: string, ad: Record<string, number>, blMG: number): number {
  const g = (c: string) => ad[c] || 0;
  if (key === "naver") return g("naver_search") + g("naver_shopping") + g("gfa") + blMG;
  if (key === "jasamol") return Math.max(0, g("meta") + g("google_pmax") - blMG);
  if (key === "coupang") return g("coupang_ads");
  return 0;
}
function storeSubAds(key: string, ad: Record<string, number>, blMG: number) {
  const g = (c: string) => ad[c] || 0;
  if (key === "naver") return [
    { channel: "naver_search", label: "네이버 검색", spend: g("naver_search") },
    { channel: "naver_shopping", label: "네이버 쇼핑", spend: g("naver_shopping") },
    { channel: "gfa", label: "GFA", spend: g("gfa") },
    { channel: "bl_meta", label: "밸런스랩 메타/구글", spend: blMG },
  ];
  if (key === "jasamol") return [
    { channel: "meta", label: "메타/구글(밸런스랩 제외)", spend: Math.max(0, g("meta") + g("google_pmax") - blMG) },
  ];
  if (key === "coupang") return [{ channel: "coupang_ads", label: "쿠팡 광고", spend: g("coupang_ads") }];
  return [];
}

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

type DayAgg = { rev: Record<string, number>; ad: Record<string, number>; blMG: number };

async function periodData(from: string, to: string, brand: string) {
  let salesQ = supabase.from("daily_sales").select("date,brand,channel,revenue")
    .gte("date", from).lte("date", to).neq("channel", "total").not("channel", "like", "공구%");
  if (brand !== "all") salesQ = salesQ.eq("brand", brand);
  const sales = await fetchAll(salesQ);
  // 광고비: brand도 가져와 밸런스랩 메타/구글 분리. ga4 제외.
  let adsQ = supabase.from("daily_ad_spend").select("date,brand,channel,spend")
    .gte("date", from).lte("date", to).not("channel", "like", "ga4_%");
  adsQ = brand !== "all" ? adsQ.eq("brand", brand) : adsQ.neq("brand", "all");
  const ads = await fetchAll(adsQ);
  // 밸런스랩 형식-A 공구 → smartstore 매출에서 차감.
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
  const day = (d: string): DayAgg => (byDate[d] ||= { rev: {}, ad: {}, blMG: 0 });

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
  let blMG = 0; // 밸런스랩 메타+구글
  for (const r of ads as { date: string; brand: string; channel: string; spend: number }[]) {
    const v = Number(r.spend || 0);
    adByCh[r.channel] = (adByCh[r.channel] || 0) + v;
    const dd = day(r.date); dd.ad[r.channel] = (dd.ad[r.channel] || 0) + v;
    if (r.brand === "balancelab" && (r.channel === "meta" || r.channel === "google_pmax")) {
      blMG += v; dd.blMG += v;
    }
  }
  return { revByCh, adByCh, blMG, byDate };
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
    const fromD = new Date(from), toD = new Date(to);
    const diff = toD.getTime() - fromD.getTime();
    const prevTo = new Date(fromD.getTime() - 86400000).toISOString().slice(0, 10);
    const prevFrom = new Date(fromD.getTime() - diff - 86400000).toISOString().slice(0, 10);

    const [cur, prev] = await Promise.all([periodData(from, to, brand), periodData(prevFrom, prevTo, brand)]);

    const groups = GROUPS.map((g) => {
      const revenue = g.salesCh.reduce((s, c) => s + (cur.revByCh[c] || 0), 0);
      const adSpend = storeAd(g.key, cur.adByCh, cur.blMG);
      const prevRev = g.salesCh.reduce((s, c) => s + (prev.revByCh[c] || 0), 0);
      const prevAd = storeAd(g.key, prev.adByCh, prev.blMG);
      const roas = adSpend > 0 ? revenue / adSpend : 0;
      const prevRoas = prevAd > 0 ? prevRev / prevAd : 0;
      return {
        key: g.key,
        label: g.label,
        revenue,
        adSpend,
        roas,
        adRatio: revenue > 0 ? (adSpend / revenue) * 100 : 0,
        subAds: storeSubAds(g.key, cur.adByCh, cur.blMG),
        revDelta: prevRev > 0 ? ((revenue / prevRev) - 1) * 100 : null,
        adDelta: prevAd > 0 ? ((adSpend / prevAd) - 1) * 100 : null,
        roasDelta: prevRoas > 0 ? ((roas / prevRoas) - 1) * 100 : null,
      };
    });

    const totalRev = groups.reduce((s, g) => s + g.revenue, 0);
    const totalAd = groups.reduce((s, g) => s + g.adSpend, 0);

    const series = Object.keys(cur.byDate).sort().map((date) => {
      const d = cur.byDate[date];
      const row: Record<string, unknown> = { date };
      for (const g of GROUPS) {
        row[g.key] = {
          revenue: g.salesCh.reduce((s, c) => s + (d.rev[c] || 0), 0),
          adSpend: storeAd(g.key, d.ad, d.blMG),
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
