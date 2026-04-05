import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Channel name mapping (English → Korean)
const CHANNEL_LABELS: Record<string, string> = {
  meta: "메타",
  naver_search: "네이버 검색",
  naver_shopping: "네이버 쇼핑",
  google_search: "구글 검색",
  google_ads: "구글 광고",
  google_pmax: "P-Max",
  "ga4_Performance Max": "퍼포먼스 맥스",
  "ga4_Search": "구글 검색(GA4)",
  coupang: "쿠팡",
  coupang_ads: "쿠팡 광고",
  smartstore: "스마트스토어",
  cafe24: "카페24",
  gfa: "GFA",
  gdn: "GDN",
  influencer: "인플루언서",
};

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";
  const brand = sp.get("brand") || "all";

  try {
    // Get sales data (with brand filter)
    let salesQ = supabase.from("daily_sales").select("*").gte("date", from).lte("date", to).neq("brand", "all");
    if (brand !== "all") salesQ = salesQ.eq("brand", brand);
    const { data: sales } = await salesQ;

    let adQ = supabase.from("daily_ad_spend").select("*").gte("date", from).lte("date", to).neq("brand", "all");
    if (brand !== "all") adQ = adQ.eq("brand", brand);
    const { data: adSpend } = await adQ;

    const { data: funnel } = await supabase.from("daily_funnel").select("*").gte("date", from).lte("date", to);

    let prodQ = supabase.from("product_sales").select("*").gte("date", from).lte("date", to).range(0, 9999);
    if (brand !== "all") prodQ = prodQ.eq("brand", brand);
    const { data: products } = await prodQ;

    const salesRows = sales || [];
    const adRows = adSpend || [];
    const funnelRows = funnel || [];
    const prodRows = products || [];

    const insights: { type: "critical" | "warning" | "opportunity" | "info"; text: string; detail?: string; actions?: string[] }[] = [];

    // ===== REVENUE ANALYSIS =====
    const totalRevenue = salesRows.reduce((s, r) => s + Number(r.revenue), 0);
    const _totalOrders = salesRows.reduce((s, r) => s + Number(r.orders), 0); // eslint-disable-line @typescript-eslint/no-unused-vars
    const totalAdSpend = adRows.reduce((s, r) => s + Number(r.spend), 0);
    const roas = totalAdSpend > 0 ? totalRevenue / totalAdSpend : 0;

    if (roas < 2.0 && totalAdSpend > 0) {
      insights.push({ type: "critical", text: `전체 ROAS ${roas.toFixed(2)}x — 목표 3.0x 미달`, detail: `매출 ₩${(totalRevenue/10000).toFixed(0)}만 대비 광고비 ₩${(totalAdSpend/10000).toFixed(0)}만`, actions: ["ROAS 1.0 미만 채널 예산 50% 감축", "상위 ROAS 크리에이티브 예산 집중", "리타겟팅 캠페인 신설 (ROAS 3x+ 기대)"] });
    } else if (roas >= 3.0) {
      insights.push({ type: "opportunity", text: `전체 ROAS ${roas.toFixed(2)}x — 양호! 예산 증액 검토`, detail: `현재 효율이 좋으므로 일 예산 증액 시 매출 성장 가능`, actions: ["일 예산 20% 증액 테스트 (1주)", "상위 소재 A/B 변형 추가", "유사 타겟 확장"] });
    }

    // ===== CHANNEL ANALYSIS =====
    const channelSpend = new Map<string, { spend: number; convValue: number }>();
    for (const r of adRows) {
      const existing = channelSpend.get(r.channel) || { spend: 0, convValue: 0 };
      existing.spend += Number(r.spend);
      existing.convValue += Number(r.conversion_value);
      channelSpend.set(r.channel, existing);
    }

    for (const [channel, d] of Array.from(channelSpend.entries())) {
      const chRoas = d.spend > 0 ? d.convValue / d.spend : 0;
      const chLabel = CHANNEL_LABELS[channel] || channel;
      if (d.spend > 100000 && chRoas < 1.0) {
        insights.push({ type: "critical", text: `${chLabel} ROAS ${chRoas.toFixed(2)}x — 적자 채널`, detail: `광고비 ₩${(d.spend/10000).toFixed(0)}만 투입 대비 전환매출 ₩${(d.convValue/10000).toFixed(0)}만`, actions: [`${chLabel} 일 예산 50% 감축`, "전환 추적 코드 재확인 (conversion_value=0이면 추적 문제)", "2주간 모니터링 후 중단 여부 결정"] });
      } else if (d.spend > 100000 && chRoas < 2.0) {
        insights.push({ type: "warning", text: `${chLabel} ROAS ${chRoas.toFixed(2)}x — 효율 저조`, detail: `크리에이티브 교체 또는 타겟팅 재설정 권장`, actions: ["하위 20% 소재 OFF", "새 크리에이티브 2-3개 테스트", "타겟 연령/관심사 재설정"] });
      }
    }

    // ===== BRAND ANALYSIS =====
    const brandSales = new Map<string, { revenue: number; orders: number }>();
    for (const r of salesRows) {
      const existing = brandSales.get(r.brand) || { revenue: 0, orders: 0 };
      existing.revenue += Number(r.revenue);
      existing.orders += Number(r.orders);
      brandSales.set(r.brand, existing);
    }

    const brandLabels: Record<string, string> = { nutty: "너티", ironpet: "아이언펫", saip: "사입", balancelab: "밸런스랩" };
    for (const [brand, d] of Array.from(brandSales.entries())) {
      const aov = d.orders > 0 ? d.revenue / d.orders : 0;
      const revShare = totalRevenue > 0 ? (d.revenue / totalRevenue) * 100 : 0;
      if (revShare > 40) {
        insights.push({ type: "info", text: `${brandLabels[brand] || brand} 매출 비중 ${revShare.toFixed(0)}% — 핵심 브랜드`, detail: `AOV ₩${Math.round(aov).toLocaleString()}, 총 ${d.orders}건` });
      }
      if (d.orders > 10 && aov > 50000) {
        insights.push({ type: "opportunity", text: `${brandLabels[brand] || brand} AOV ₩${Math.round(aov).toLocaleString()} — 고가 상품 번들 기회`, detail: `객단가가 높은 고객군. 업셀/크로스셀 전략 검토` });
      }
    }

    // ===== FUNNEL ANALYSIS =====
    const totalSessions = funnelRows.reduce((s, r) => s + Number(r.sessions), 0);
    const totalCartAdds = funnelRows.reduce((s, r) => s + Number(r.cart_adds), 0);
    const totalPurchases = funnelRows.reduce((s, r) => s + Number(r.purchases), 0);

    if (totalSessions > 0 && totalCartAdds > 0) {
      const convRate = (totalPurchases / totalSessions) * 100;
      const cartToOrder = (totalPurchases / totalCartAdds) * 100;
      const abandonRate = 100 - cartToOrder;

      if (convRate < 1.0) {
        insights.push({ type: "warning", text: `전환율 ${convRate.toFixed(2)}% — 업계 평균(2-3%) 미달`, detail: `세션 ${totalSessions} 중 ${totalPurchases}건만 구매. 랜딩페이지 및 상품페이지 최적화 필요` });
      }
      if (abandonRate > 70) {
        insights.push({ type: "critical", text: `장바구니 이탈률 ${abandonRate.toFixed(0)}% — 심각`, detail: `간편결제 추가, 무료배송 기준 조정, 장바구니 리마인더 설정 권장` });
      } else if (abandonRate > 50) {
        insights.push({ type: "warning", text: `장바구니 이탈률 ${abandonRate.toFixed(0)}% — 개선 여지`, detail: `배송비 사전 표시, 결제 단계 간소화 검토` });
      }
    }

    // ===== TOP PRODUCTS =====
    const prodMap = new Map<string, { revenue: number; quantity: number }>();
    for (const r of prodRows) {
      const existing = prodMap.get(r.product) || { revenue: 0, quantity: 0 };
      existing.revenue += Number(r.revenue);
      existing.quantity += Number(r.quantity);
      prodMap.set(r.product, existing);
    }
    const topProds = Array.from(prodMap.entries()).sort((a, b) => b[1].revenue - a[1].revenue);
    if (topProds.length > 0) {
      const topProd = topProds[0];
      const topShare = totalRevenue > 0 ? (topProd[1].revenue / totalRevenue) * 100 : 0;
      if (topShare > 20) {
        insights.push({ type: "info", text: `'${topProd[0]}' 매출 비중 ${topShare.toFixed(0)}% — 히어로 상품`, detail: `이 제품 중심 마케팅 강화 + 연관 상품 번들 추천` });
      }
    }

    // ===== CHANNEL CONCENTRATION =====
    const salesChannelMap = new Map<string, number>();
    for (const r of salesRows) {
      salesChannelMap.set(r.channel, (salesChannelMap.get(r.channel) || 0) + Number(r.revenue));
    }
    for (const [ch, rev] of Array.from(salesChannelMap.entries())) {
      const share = totalRevenue > 0 ? (rev / totalRevenue) * 100 : 0;
      const chLabel = CHANNEL_LABELS[ch] || ch;
      if (share > 40) {
        insights.push({ type: "warning", text: `${chLabel} 매출 비중 ${share.toFixed(0)}% — 채널 집중 리스크`, detail: `특정 채널 의존도가 높습니다. 자사몰 비중 확대 전략 필요` });
      }
    }

    // ===== AUTO ROOT CAUSE ANALYSIS (Month 9) =====
    // Compare with previous period
    const fromDate = new Date(from);
    const toDate = new Date(to);
    const diff = toDate.getTime() - fromDate.getTime();
    const prevFrom = new Date(fromDate.getTime() - diff - 86400000).toISOString().slice(0, 10);
    const prevTo = new Date(fromDate.getTime() - 86400000).toISOString().slice(0, 10);

    const { data: prevSales } = await supabase.from("daily_sales").select("*").gte("date", prevFrom).lte("date", prevTo);
    const { data: prevAds } = await supabase.from("daily_ad_spend").select("*").gte("date", prevFrom).lte("date", prevTo);

    const prevRevenue = (prevSales || []).reduce((s, r) => s + Number(r.revenue), 0);
    void (prevAds || []).reduce((s, r) => s + Number(r.spend), 0); // prevTotalAdSpend - reserved for future use

    if (prevRevenue > 0 && totalRevenue < prevRevenue * 0.85) {
      // Revenue dropped 15%+ → find root cause
      const revenueDropPct = ((1 - totalRevenue / prevRevenue) * 100).toFixed(0);

      // Brand-level drill
      const prevBrandSales = new Map<string, number>();
      for (const r of prevSales || []) {
        prevBrandSales.set(r.brand, (prevBrandSales.get(r.brand) || 0) + Number(r.revenue));
      }

      const brandChanges: string[] = [];
      for (const [brand, currData] of Array.from(brandSales.entries())) {
        const prevBrandRev = prevBrandSales.get(brand) || 0;
        if (prevBrandRev > 0) {
          const changePct = ((currData.revenue / prevBrandRev - 1) * 100);
          if (changePct < -10) {
            brandChanges.push(`${brandLabels[brand] || brand} ${changePct.toFixed(0)}%`);
          }
        }
      }

      // Channel-level drill
      const prevChannelSales = new Map<string, number>();
      for (const r of prevSales || []) {
        prevChannelSales.set(r.channel, (prevChannelSales.get(r.channel) || 0) + Number(r.revenue));
      }
      const channelChanges: string[] = [];
      for (const [ch, rev] of Array.from(salesChannelMap.entries())) {
        const prevChRev = prevChannelSales.get(ch) || 0;
        const chLabel = CHANNEL_LABELS[ch] || ch;
        if (prevChRev > 0) {
          const changePct = ((rev / prevChRev - 1) * 100);
          if (changePct < -10) {
            channelChanges.push(`${chLabel} ${changePct.toFixed(0)}%`);
          }
        }
      }

      // Product-level drill
      const prevProdMap = new Map<string, number>();
      const { data: prevProducts } = await supabase.from("product_sales").select("product,revenue").gte("date", prevFrom).lte("date", prevTo).range(0, 9999);
      for (const r of prevProducts || []) {
        prevProdMap.set(r.product, (prevProdMap.get(r.product) || 0) + Number(r.revenue));
      }
      const prodChanges: string[] = [];
      for (const [prod, data] of topProds.slice(0, 10)) {
        const prevProdRev = prevProdMap.get(prod) || 0;
        if (prevProdRev > 0) {
          const changePct = ((data.revenue / prevProdRev - 1) * 100);
          if (changePct < -15) {
            prodChanges.push(`${prod} ${changePct.toFixed(0)}%`);
          }
        }
      }

      let detail = `매출 ${revenueDropPct}% 하락 원인 분석:\n`;
      if (brandChanges.length > 0) detail += `\n📦 브랜드: ${brandChanges.join(", ")}`;
      if (channelChanges.length > 0) detail += `\n🏪 채널: ${channelChanges.join(", ")}`;
      if (prodChanges.length > 0) detail += `\n🏷️ 제품: ${prodChanges.join(", ")}`;

      insights.unshift({
        type: "critical",
        text: `📉 매출 ${revenueDropPct}% 하락 — 자동 원인 분석`,
        detail,
        actions: [
          brandChanges.length > 0 ? `${brandChanges[0]} 브랜드 집중 점검` : "브랜드별 매출 확인",
          channelChanges.length > 0 ? `${channelChanges[0]} 채널 광고/프로모션 확인` : "채널별 유입 확인",
          "경쟁사 프로모션/시즌 영향 확인",
        ],
      });
    }

    // Sort by priority
    const priority = { critical: 0, warning: 1, opportunity: 2, info: 3 };
    insights.sort((a, b) => priority[a.type] - priority[b.type]);

    return NextResponse.json({ insights });
  } catch (error) {
    console.error("Insights API error:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
