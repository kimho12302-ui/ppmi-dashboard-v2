export const dynamic = "force-dynamic";

import { expandBrands } from "@/lib/brand-groups";
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/db";
import { isGonggu, isGongguAggregate, isGongguInDailySales } from "@/lib/gonggu";

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
    // 이전 기간 (원인 분석용) 날짜 계산
    const fromDate = new Date(from);
    const toDate = new Date(to);
    const diff = toDate.getTime() - fromDate.getTime();
    const prevFrom = new Date(fromDate.getTime() - diff - 86400000).toISOString().slice(0, 10);
    const prevTo = new Date(fromDate.getTime() - 86400000).toISOString().slice(0, 10);

    // 쿼리 빌드 (모두 독립적 → 한 번에 병렬 실행)
    // 자체매출만: 공구 채널 제외 (공구 별도 표시)
    let salesQ = supabase.from("daily_sales").select("*").gte("date", from).lte("date", to).neq("brand", "all").neq("channel", "total").not("channel", "like", "공구%");
    if (brand !== "all") salesQ = salesQ.in("brand", expandBrands(brand));

    let adQ = supabase.from("daily_ad_spend").select("*").gte("date", from).lte("date", to).neq("brand", "all").not("channel", "like", "ga4_%");
    if (brand !== "all") adQ = adQ.in("brand", expandBrands(brand));

    // 퍼널: brand=all이면 전체(brand="all" 채널행 + balancelab) 합산이 곧 전체 퍼널.
    // 특정 브랜드 선택 시 그 브랜드 퍼널만 → 타 브랜드 퍼널을 잘못 귀속하지 않음.
    let funnelQ = supabase.from("daily_funnel").select("*").gte("date", from).lte("date", to);
    if (brand !== "all") funnelQ = funnelQ.in("brand", expandBrands(brand));

    let prodQ = supabase.from("product_sales").select("*").gte("date", from).lte("date", to);
    if (brand !== "all") prodQ = prodQ.in("brand", expandBrands(brand));

    // ── 이전 기간 쿼리: 현재 기간과 "같은 스코프"여야 비교가 성립한다 ──
    // 이전에는 브랜드 필터가 빠져 있어 '현재=선택 브랜드 vs 이전=전 브랜드 합계'로 비교됐고,
    // 그 결과 브랜드를 고르면 거의 항상 "매출 급락" 오탐이 발생했다(2026-08 수정).
    let prevSalesQ = supabase.from("daily_sales").select("*").gte("date", prevFrom).lte("date", prevTo).neq("brand", "all").neq("channel", "total").not("channel", "like", "공구%");
    if (brand !== "all") prevSalesQ = prevSalesQ.in("brand", expandBrands(brand));

    // .range(0, 99999) 는 PostgREST db-max-rows(1000)에 막혀 무력했다 → fetchAll 로 전량 조회.
    // 정렬이 없으면 어느 1000행이 올지 비결정적이었으므로 date 정렬도 명시한다.
    const [salesRows, adRows, funnelRows, prodRows, prevSales] = await Promise.all([
      fetchAll(salesQ.order("date")),
      fetchAll(adQ.order("date")),
      fetchAll(funnelQ.order("date")),
      fetchAll(prodQ.order("date")),
      fetchAll(prevSalesQ.order("date")),
    ]);

    const insights: { type: "critical" | "warning" | "opportunity" | "info"; text: string; detail?: string; actions?: string[] }[] = [];

    // ===== REVENUE ANALYSIS =====
    // ★ 공구 스코프를 dashboard 와 일치시킨다.
    //   `공구%` 채널은 쿼리에서 제외되지만, 밸런스랩 형식-A 공구는 smartstore 채널로 들어와
    //   그 필터에 걸리지 않는다. 차감하지 않으면 매출이 부풀고 헤드라인 ROAS가 과대해져
    //   ("전체 ROAS 8.07x — 예산 증액 검토") 잘못된 증액 권고가 나갔다(2026-08 리뷰).
    //   추가 쿼리 없이 이미 가져온 prodRows/prevProducts 에서 계산한다.
    const sumFormA = (rows: { brand?: string; channel: string; lineup: string | null; product: string; revenue: number }[]) =>
      rows.reduce((s, r) => (r.brand === "balancelab" && isGongguInDailySales(r) ? s + Number(r.revenue || 0) : s), 0);
    const formA = sumFormA(prodRows);

    // 공구를 제외한 제품 행. 제품 비중의 분자는 이걸 써야 분모(totalRevenue)와 스코프가 맞는다.
    // (분자만 공구 포함이면 '큐모발검사 매출 비중 499% — 히어로 상품' 같은 값이 나온다.)
    const selfProdRows = prodRows.filter(
      (r) => !isGongguAggregate(r) && !(r.brand === "balancelab" && isGonggu(r))
    );

    const totalRevenue = Math.max(0, salesRows.reduce((s, r) => s + Number(r.revenue), 0) - formA);
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
      // ★ 전환값이 아예 0이면 "성과 없음"이 아니라 "측정 불가"다. 이걸 적자 채널로 단정해
      //    "예산 50% 감축"을 권고하면 멀쩡한 채널을 끄게 된다(2026-08 리뷰: 메타가 이 상태였다).
      //    → 데이터 품질 이슈로 분리한다.
      if (d.spend > 100000 && d.convValue <= 0) {
        insights.push({ type: "warning", text: `${chLabel} 전환 추적 미연동 — 성과 판단 불가`, detail: `광고비 ₩${(d.spend/10000).toFixed(0)}만을 집행했으나 전환값이 0으로 수집됩니다. 실제 성과가 0이라는 뜻이 아니라 측정이 안 되는 상태이므로, 이 채널은 예산 판단에서 제외하고 추적부터 붙여야 합니다.`, actions: ["픽셀/전환 API 연동 상태 확인", "판매처(스마트스토어 등) 전환이 플랫폼에 안 잡히는 구조인지 확인", "추적 복구 전까지 ROAS 기준 증감 판단 보류"] });
      } else if (d.spend > 100000 && chRoas < 1.0) {
        insights.push({ type: "critical", text: `${chLabel} ROAS ${chRoas.toFixed(2)}x — 적자 채널`, detail: `광고비 ₩${(d.spend/10000).toFixed(0)}만 투입 대비 전환매출 ₩${(d.convValue/10000).toFixed(0)}만`, actions: [`${chLabel} 일 예산 50% 감축`, "하위 소재 OFF 후 2주 모니터링", "2주간 모니터링 후 중단 여부 결정"] });
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
    // 밸런스랩 매출에서도 형식-A 공구를 빼 헤드라인(totalRevenue)과 스코프를 맞춘다.
    if (formA > 0 && brandSales.has("balancelab")) {
      const bl = brandSales.get("balancelab")!;
      brandSales.set("balancelab", { ...bl, revenue: Math.max(0, bl.revenue - formA) });
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
    // ★ daily_funnel.purchases 는 실제로는 "카페24 회원가입 수"를 담는 수기입력 칸이다
    //   (설정 > 일일 입력의 '회원가입' 필드 → api/settings 가 이 컬럼에 저장).
    //   이걸 구매로 집계해 전환율·이탈률을 계산하던 것을 실제 주문(daily_sales.orders)으로 바꾼다(2026-08 리뷰).
    const totalSessions = funnelRows.reduce((s, r) => s + Number(r.sessions), 0);
    const totalCartAdds = funnelRows.reduce((s, r) => s + Number(r.cart_adds), 0);
    const totalPurchases = salesRows.reduce((s, r) => s + Number(r.orders || 0), 0);

    if (totalSessions > 0 && totalPurchases > 0) {
      const convRate = (totalPurchases / totalSessions) * 100;
      if (convRate < 1.0) {
        insights.push({ type: "warning", text: `전환율 ${convRate.toFixed(2)}% — 업계 평균(2-3%) 미달`, detail: `세션 ${totalSessions} 중 ${totalPurchases}건 구매. 랜딩페이지 및 상품페이지 최적화 필요` });
      }
    }
    // 이탈률은 장바구니가 구매보다 클 때만 성립한다. 장바구니는 일부 채널만 수집되는데
    // 구매는 전 채널 주문이라, 그대로 나누면 음수 이탈률이 나온다 → 성립할 때만 낸다.
    if (totalCartAdds > 0 && totalPurchases <= totalCartAdds) {
      const abandonRate = 100 - (totalPurchases / totalCartAdds) * 100;
      if (abandonRate > 70) {
        insights.push({ type: "critical", text: `장바구니 이탈률 ${abandonRate.toFixed(0)}% — 심각`, detail: `간편결제 추가, 무료배송 기준 조정, 장바구니 리마인더 설정 권장` });
      } else if (abandonRate > 50) {
        insights.push({ type: "warning", text: `장바구니 이탈률 ${abandonRate.toFixed(0)}% — 개선 여지`, detail: `배송비 사전 표시, 결제 단계 간소화 검토` });
      }
    }

    // ===== TOP PRODUCTS =====
    const prodMap = new Map<string, { revenue: number; quantity: number }>();
    for (const r of selfProdRows) {
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
    // 채널별 매출도 헤드라인과 같은 스코프여야 한다. 형식-A 공구는 smartstore 채널로 들어오므로
    // 그만큼 빼주지 않으면 비중이 101% 처럼 100을 넘는다(2026-08 수정).
    const salesChannelMap = new Map<string, number>();
    for (const r of salesRows) {
      salesChannelMap.set(r.channel, (salesChannelMap.get(r.channel) || 0) + Number(r.revenue));
    }
    if (formA > 0) {
      salesChannelMap.set("smartstore", Math.max(0, (salesChannelMap.get("smartstore") || 0) - formA));
    }
    for (const [ch, rev] of Array.from(salesChannelMap.entries())) {
      const share = totalRevenue > 0 ? (rev / totalRevenue) * 100 : 0;
      const chLabel = CHANNEL_LABELS[ch] || ch;
      if (share > 40) {
        insights.push({ type: "warning", text: `${chLabel} 매출 비중 ${share.toFixed(0)}% — 채널 집중 리스크`, detail: `특정 채널 의존도가 높습니다. 자사몰 비중 확대 전략 필요` });
      }
    }

    // ===== AUTO ROOT CAUSE ANALYSIS (Month 9) =====
    // 이전 기간 비교 (prevSales 는 위에서 병렬로 이미 가져옴)
    // ★ 이전 기간에도 현재와 똑같이 형식-A 공구를 빼야 비교가 성립한다.
    //   한쪽만 차감하면 밸런스랩이 항상 "매출 59% 하락"으로 잡혔다(실제로는 +76% 성장, 2026-08 리뷰).
    const prevProdRows = await fetchAll(
      (brand !== "all"
        ? supabase.from("product_sales").select("brand,product,channel,lineup,revenue").gte("date", prevFrom).lte("date", prevTo).in("brand", expandBrands(brand))
        : supabase.from("product_sales").select("brand,product,channel,lineup,revenue").gte("date", prevFrom).lte("date", prevTo)
      ).order("date")
    );
    const prevFormA = sumFormA(prevProdRows);
    const prevRevenue = Math.max(0, (prevSales || []).reduce((s, r) => s + Number(r.revenue), 0) - prevFormA);

    if (prevRevenue > 0 && totalRevenue < prevRevenue * 0.85) {
      // Revenue dropped 15%+ → find root cause
      const revenueDropPct = ((1 - totalRevenue / prevRevenue) * 100).toFixed(0);

      // Brand-level drill (밸런스랩은 이전 기간도 형식-A 공구 차감)
      const prevBrandSales = new Map<string, number>();
      for (const r of prevSales || []) {
        prevBrandSales.set(r.brand, (prevBrandSales.get(r.brand) || 0) + Number(r.revenue));
      }
      if (prevFormA > 0 && prevBrandSales.has("balancelab")) {
        prevBrandSales.set("balancelab", Math.max(0, (prevBrandSales.get("balancelab") || 0) - prevFormA));
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

      // Channel-level drill (smartstore 도 이전 기간 형식-A 공구 차감)
      const prevChannelSales = new Map<string, number>();
      for (const r of prevSales || []) {
        prevChannelSales.set(r.channel, (prevChannelSales.get(r.channel) || 0) + Number(r.revenue));
      }
      if (prevFormA > 0) {
        prevChannelSales.set("smartstore", Math.max(0, (prevChannelSales.get("smartstore") || 0) - prevFormA));
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

      // Product-level drill — 현재(selfProdRows)와 같이 공구를 제외해야 비교가 성립한다.
      // prevProdRows 는 위에서 이미 조회했으므로 추가 왕복 없이 재사용한다.
      const prevProdMap = new Map<string, number>();
      for (const r of prevProdRows) {
        if (isGongguAggregate(r)) continue;
        if (r.brand === "balancelab" && isGonggu(r)) continue;
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
