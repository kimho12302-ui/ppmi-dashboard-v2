export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { isGonggu, isGongguAggregate, gongguSeller, isGongguInDailySales } from "@/lib/gonggu";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAll(baseQuery: any): Promise<any[]> {
  const PAGE = 1000;
  let from = 0;
  const all: unknown[] = [];
  while (true) {
    const { data, error } = await baseQuery.range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const brand = sp.get("brand") || "all";
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";

  try {
    // ── 이전 기간 날짜 계산 (DB 호출 없음) ──
    const fromDate = new Date(from);
    const toDate = new Date(to);
    // 방어: 잘못된 날짜는 Invalid Date → toISOString 크래시(500) 대신 명확한 400
    if (!from || !to || isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return NextResponse.json({ error: "유효한 from/to 날짜가 필요합니다 (YYYY-MM-DD)" }, { status: 400 });
    }
    const diff = toDate.getTime() - fromDate.getTime();
    const prevFrom = new Date(fromDate.getTime() - diff - 86400000).toISOString().slice(0, 10);
    const prevTo = new Date(fromDate.getTime() - 86400000).toISOString().slice(0, 10);
    const currentMonth = to.slice(0, 7);

    // ── 쿼리 빌드 (모두 독립적 → 아래에서 한 번에 병렬 실행) ──
    // channel="total"은 Total 탭 집계값 — 채널별 합과 중복이므로 제외
    // 자체매출만 집계: daily_sales 의 공구(공동구매) 채널 제외. 공구는 별도 섹션(product_sales 기반)에서만 표시.
    let salesQuery = supabase.from("daily_sales").select("*").gte("date", from).lte("date", to).neq("channel", "total").not("channel", "like", "공구%").order("date");
    if (brand !== "all") salesQuery = salesQuery.eq("brand", brand);
    else salesQuery = salesQuery.neq("brand", "all");

    let adQuery = supabase.from("daily_ad_spend").select("*").gte("date", from).lte("date", to).order("date");
    if (brand !== "all") adQuery = adQuery.eq("brand", brand);
    else adQuery = adQuery.neq("brand", "all");

    let prevSalesQ = supabase.from("daily_sales").select("revenue, orders").gte("date", prevFrom).lte("date", prevTo).neq("channel", "total").not("channel", "like", "공구%");
    if (brand !== "all") prevSalesQ = prevSalesQ.eq("brand", brand);
    else prevSalesQ = prevSalesQ.neq("brand", "all");

    let prevAdQ = supabase.from("daily_ad_spend").select("channel, spend, conversion_value").gte("date", prevFrom).lte("date", prevTo);
    if (brand !== "all") prevAdQ = prevAdQ.eq("brand", brand);
    else prevAdQ = prevAdQ.neq("brand", "all");

    let cogsProdQ = supabase.from("product_sales").select("product,brand,quantity").gte("date", from).lte("date", to);
    if (brand !== "all") cogsProdQ = cogsProdQ.eq("brand", brand);

    let prodQ = supabase.from("product_sales").select("product,revenue,quantity,brand,channel,lineup").gte("date", from).lte("date", to);
    if (brand !== "all") prodQ = prodQ.eq("brand", brand);

    // 공구는 밸런스랩/전체일 때만 (lineup 기반 셀러 감지)
    const gongguPromise = (brand === "balancelab" || brand === "all")
      ? fetchAll(supabase.from("product_sales").select("date,channel,lineup,product,revenue,quantity").gte("date", from).lte("date", to).eq("brand", "balancelab"))
      : Promise.resolve([] as unknown[]);

    // ── 모든 DB 호출을 1회 병렬 배치로 실행 (이전: 순차 12회 왕복) ──
    const [
      sales, adSpend, prevSales, prevAd, cogsProdData, prodData, gongguData,
      productCostsRes, shippingRes, miscRes, funnelRes, targetRes,
    ] = await Promise.all([
      fetchAll(salesQuery),
      fetchAll(adQuery),
      fetchAll(prevSalesQ),
      fetchAll(prevAdQ),
      fetchAll(cogsProdQ),
      fetchAll(prodQ),
      gongguPromise,
      supabase.from("product_costs").select("product,brand,cost_price,manufacturing_cost,shipping_cost"),
      supabase.from("shipping_costs").select("*").gte("month", from.slice(0, 7)).lte("month", to.slice(0, 7)),
      supabase.from("misc_costs").select("*").gte("date", from).lte("date", to),
      supabase.from("daily_funnel").select("*").gte("date", from).lte("date", to),
      supabase.from("monthly_targets").select("*").eq("month", currentMonth),
    ]);
    const productCostsData = productCostsRes.data;
    const shippingData = shippingRes.data;
    const miscData = miscRes.data;
    const funnelData = funnelRes.data;
    const targetData = targetRes.data;

    // ── Product costs (COGS) 맵 ──
    const costMap = new Map<string, { manufacturing_cost: number; shipping_cost: number }>();
    for (const pc of productCostsData || []) {
      costMap.set(`${pc.product}__${pc.brand}`, {
        manufacturing_cost: Number(pc.manufacturing_cost || 0),
        shipping_cost: Number(pc.shipping_cost || 0),
      });
    }

    let totalCOGS = 0;
    let matchedProducts = 0;
    let totalProducts = 0;
    for (const ps of cogsProdData || []) {
      totalProducts++;
      const costs = costMap.get(`${ps.product}__${ps.brand}`);
      if (costs) {
        totalCOGS += costs.manufacturing_cost * Number(ps.quantity || 0);
        matchedProducts++;
      }
    }

    // ── Shipping + Misc costs ──
    let totalShippingCost = 0;
    for (const r of (shippingData || []).filter(r => brand === "all" || r.brand === brand)) {
      totalShippingCost += Number(r.total_cost || 0);
    }

    let totalMiscCost = 0;
    for (const r of (miscData || []).filter(r => brand === "all" || r.brand === brand)) {
      totalMiscCost += Number(r.amount || 0);
    }

    // ── 공구 분석 (밸런스랩) — lineup 기반 셀러 감지 ──
    // "공구 합계" 행은 집계 행이므로 모든 계산에서 제외
    // KPI에 gongguSalesTotal을 더하지 않음: 일부 날짜는 daily_sales에 이미 포함됨
    let gongguSales: { seller: string; revenue: number; orders: number }[] = [];
    let selfSalesTotal = 0;
    let gongguSalesTotal = 0;
    const gongguChannelMap = new Map<string, number>();
    const gongguByDate = new Map<string, number>();
    if (brand === "balancelab" || brand === "all") {
      const sellerMap = new Map<string, { revenue: number; orders: number }>();
      for (const r of gongguData || []) {
        // "공구 합계" 집계 행은 isGonggu 가 false 반환 → 자체판매에도 가산되지 않음
        if (isGongguAggregate(r)) continue;
        if (isGonggu(r)) {
          const seller = gongguSeller(r) || "기타";
          const e = sellerMap.get(seller) || { revenue: 0, orders: 0 };
          e.revenue += Number(r.revenue); e.orders += Number(r.quantity || 0);
          sellerMap.set(seller, e);
          gongguSalesTotal += Number(r.revenue);
          const chKey = `공구_${seller}`;
          gongguChannelMap.set(chKey, (gongguChannelMap.get(chKey) || 0) + Number(r.revenue));
          gongguByDate.set(r.date, (gongguByDate.get(r.date) || 0) + Number(r.revenue));
        } else {
          selfSalesTotal += Number(r.revenue);
        }
      }
      gongguSales = Array.from(sellerMap.entries()).map(([seller, d]) => ({ seller, ...d })).sort((a, b) => b.revenue - a.revenue);
    }

    // ── P2-2: daily_sales 공구 채널(공구_*) — 헤드라인에선 제외되지만 어디에도 안 보이면 숨겨짐 → 공구 섹션에 별도 노출 ──
    let dailyGongguTotal = 0;
    const dailyGongguByCh = new Map<string, number>();
    if (brand === "balancelab" || brand === "all") {
      const dg = await fetchAll(supabase.from("daily_sales").select("channel,revenue").gte("date", from).lte("date", to).eq("brand", "balancelab").like("channel", "공구%"));
      for (const r of dg) {
        const rev = Number(r.revenue || 0);
        dailyGongguTotal += rev;
        dailyGongguByCh.set(r.channel, (dailyGongguByCh.get(r.channel) || 0) + rev);
      }
    }

    // ── 형식-A 공구 차감: 밸런스랩 daily_sales smartstore 에 셀러 공구가 섞여 자체매출 부풀림 ──
    // product_sales(gongguData)의 형식-A(채널이 공구*가 아닌 공구)를 날짜별로 구해 balancelab 매출에서 차감.
    const formAByDate = new Map<string, number>();
    for (const r of gongguData || []) {
      if (isGongguInDailySales(r)) formAByDate.set((r as { date: string }).date, (formAByDate.get((r as { date: string }).date) || 0) + Number((r as { revenue: number }).revenue || 0));
    }
    // 헤드라인/트렌드/브랜드 집계에 쓰는 자체매출 보정본 (raw sales 반환값은 그대로 유지)
    const adjSales = (sales || []).map((r) => {
      if (r.brand === "balancelab") {
        const g = formAByDate.get(r.date) || 0;
        if (g > 0) return { ...r, revenue: Math.max(0, Number(r.revenue) - g) };
      }
      return r;
    });

    // ── KPI 계산 ──
    // gongguSalesTotal은 더하지 않음: lineup 기반 공구 매출은 daily_sales smartstore에 이미 포함
    const totalRevenue = adjSales.reduce((s, r) => s + Number(r.revenue), 0);
    const totalOrders = (sales || []).reduce((s, r) => s + Number(r.orders), 0);
    const nonGa4Ad = (adSpend || []).filter(r => !r.channel.startsWith("ga4_"));
    // 매체비(media)와 잡비(misc) 분리:
    //  - ROAS·KPI 광고비는 매체비 기준 (목표 ad_budget_target가 매체비 기준이라 비교 일치, 전기간 비교도 매체비라 동일 분모)
    //  - 잡비는 별도 비용 → 이익·MER에만 반영 (kpi.miscCost로 별도 노출)
    const totalMediaSpend = nonGa4Ad.reduce((s, r) => s + Number(r.spend), 0);
    const totalMarketingCost = totalMediaSpend + totalMiscCost; // 총 마케팅비 (이익·MER용)
    const totalConvValue = nonGa4Ad.reduce((s, r) => s + Number(r.conversion_value || 0), 0);
    const roas = totalMediaSpend > 0 ? totalConvValue / totalMediaSpend : 0; // 매체 ROAS (목표·페이싱과 동일 분모)
    const profit = totalRevenue - totalMarketingCost - totalCOGS - totalShippingCost;
    const mer = totalMarketingCost > 0 ? totalRevenue / totalMarketingCost : 0; // MER = 매출/총마케팅비(매체+잡비)
    const aov = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    const prevRevenue = (prevSales || []).reduce((s, r) => s + Number(r.revenue), 0);
    const prevOrders = (prevSales || []).reduce((s, r) => s + Number(r.orders), 0);
    const prevNonGa4Ad = (prevAd || []).filter(r => !r.channel.startsWith("ga4_"));
    const prevAdSpendTotal = prevNonGa4Ad.reduce((s, r) => s + Number(r.spend), 0);
    const prevConvValue = prevNonGa4Ad.reduce((s, r) => s + Number(r.conversion_value || 0), 0);
    const prevRoas = prevAdSpendTotal > 0 ? prevConvValue / prevAdSpendTotal : 0;
    const cogsRate = totalRevenue > 0 ? totalCOGS / totalRevenue : 0;
    const prevProfit = prevRevenue - prevAdSpendTotal - (prevRevenue * cogsRate);
    const prevMer = prevAdSpendTotal > 0 ? prevRevenue / prevAdSpendTotal : 0;
    const prevAov = prevOrders > 0 ? prevRevenue / prevOrders : 0;

    // ── Trend (일별) ──
    const trendMap = new Map<string, { revenue: number; adSpend: number; [k: string]: number }>();
    const brandLabels: Record<string, string> = { nutty: "너티", ironpet: "아이언펫", saip: "사입", balancelab: "밸런스랩" };
    for (const r of adjSales) {
      const d = trendMap.get(r.date) || { revenue: 0, adSpend: 0 };
      d.revenue += Number(r.revenue);
      const bl = brandLabels[r.brand] || r.brand;
      d[bl] = (d[bl] || 0) + Number(r.revenue);
      trendMap.set(r.date, d);
    }
    for (const r of nonGa4Ad) {
      const d = trendMap.get(r.date) || { revenue: 0, adSpend: 0 };
      d.adSpend += Number(r.spend);
      trendMap.set(r.date, d);
    }
    // 공구 매출 trend 반영 생략: lineup 기반 공구 매출은 daily_sales에 이미 포함
    // Fill missing dates
    for (let d = new Date(from); d <= new Date(to); d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      if (!trendMap.has(key)) trendMap.set(key, { revenue: 0, adSpend: 0 });
    }
    const trend = Array.from(trendMap.entries()).sort(([a], [b]) => a.localeCompare(b))
      .map(([date, data], i, arr) => {
        // 7일 이동평균
        const window = arr.slice(Math.max(0, i - 6), i + 1);
        const maRevenue = window.reduce((s, [, w]) => s + (w.revenue || 0), 0) / window.length;
        const maAdSpend = window.reduce((s, [, w]) => s + (w.adSpend || 0), 0) / window.length;
        const roas = (data.adSpend || 0) > 0 ? Math.round((data.revenue / data.adSpend) * 100) / 100 : 0; // 매출/광고비 (채널 성과 ROAS와 동일 정의, 차트의 두 선 비율)
        return { date, ...data, maRevenue: Math.round(maRevenue), maAdSpend: Math.round(maAdSpend), roas };
      });

    // ── Channel breakdown ──
    const channelMap = new Map<string, { spend: number; revenue: number }>();
    for (const r of nonGa4Ad) {
      const e = channelMap.get(r.channel) || { spend: 0, revenue: 0 };
      e.spend += Number(r.spend);
      e.revenue += Number(r.conversion_value || 0);
      channelMap.set(r.channel, e);
    }
    const channels = Array.from(channelMap.entries()).map(([channel, d]) => ({
      channel, spend: d.spend, roas: d.spend > 0 ? d.revenue / d.spend : 0,
    }));

    // ── Channel ROAS trend ──
    const chRoasMap = new Map<string, Map<string, { spend: number; cv: number }>>();
    for (const r of nonGa4Ad) {
      if (!chRoasMap.has(r.date)) chRoasMap.set(r.date, new Map());
      const dm = chRoasMap.get(r.date)!;
      const e = dm.get(r.channel) || { spend: 0, cv: 0 };
      e.spend += Number(r.spend); e.cv += Number(r.conversion_value || 0);
      dm.set(r.channel, e);
    }
    const channelRoasTrend = Array.from(chRoasMap.entries()).sort(([a], [b]) => a.localeCompare(b))
      .map(([date, cm]) => {
        const row: Record<string, unknown> = { date };
        cm.forEach((d, ch) => { row[ch] = d.spend > 0 ? Math.round((d.cv / d.spend) * 100) / 100 : 0; });
        return row;
      });

    // ── Brand breakdown ──
    const brandRevMap = new Map<string, { revenue: number; orders: number }>();
    for (const r of adjSales) {
      if (r.brand === "all") continue;
      const e = brandRevMap.get(r.brand) || { revenue: 0, orders: 0 };
      e.revenue += Number(r.revenue); e.orders += Number(r.orders);
      brandRevMap.set(r.brand, e);
    }
    // 공구 매출 brandRev 반영 생략: daily_sales에 이미 포함
    const brandRevenue = Array.from(brandRevMap.entries()).map(([b, d]) => ({ brand: b, ...d }));

    // ── Brand profit ──
    const brandAdMap = new Map<string, number>();
    for (const r of nonGa4Ad) brandAdMap.set(r.brand, (brandAdMap.get(r.brand) || 0) + Number(r.spend));
    const brandCogsMap = new Map<string, number>();
    for (const ps of cogsProdData || []) {
      const costs = costMap.get(`${ps.product}__${ps.brand}`);
      if (costs) brandCogsMap.set(ps.brand, (brandCogsMap.get(ps.brand) || 0) + costs.manufacturing_cost * Number(ps.quantity || 0));
    }
    const brandProfit = ["nutty", "ironpet", "saip", "balancelab"].map(b => {
      const rev = brandRevMap.get(b)?.revenue || 0;
      const orders = brandRevMap.get(b)?.orders || 0;
      const ad = brandAdMap.get(b) || 0;
      const cogs = brandCogsMap.get(b) || 0;
      const p = rev - ad - cogs;
      return { brand: b, revenue: rev, orders, adSpend: ad, cogs, profit: p, margin: rev > 0 ? (p / rev * 100) : 0 };
    });

    // ── Brand revenue trend ──
    const brandTrendMap = new Map<string, Record<string, number>>();
    for (const r of adjSales) {
      if (r.brand === "all") continue;
      const e = brandTrendMap.get(r.date) || {};
      const bl = brandLabels[r.brand] || r.brand;
      e[bl] = (e[bl] || 0) + Number(r.revenue);
      brandTrendMap.set(r.date, e);
    }
    // 공구 매출 brandTrend 반영 생략: daily_sales에 이미 포함
    const brandRevenueTrend = Array.from(brandTrendMap.entries()).sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({ date, ...d }));

    // ── Sales by channel ──
    const salesChMap = new Map<string, number>();
    for (const r of adjSales) salesChMap.set(r.channel, (salesChMap.get(r.channel) || 0) + Number(r.revenue));
    // 공구 채널은 별도 추가하지 않음: daily_sales에 이미 포함
    const salesByChannel = Array.from(salesChMap.entries()).map(([channel, revenue]) => ({ channel, revenue })).sort((a, b) => b.revenue - a.revenue);

    // ── Top 5 products ──
    const prodMap = new Map<string, { revenue: number; quantity: number; brand: string }>();
    for (const r of prodData || []) {
      if (isGongguAggregate(r)) continue; // 집계 행 제외
      const e = prodMap.get(r.product) || { revenue: 0, quantity: 0, brand: r.brand };
      e.revenue += Number(r.revenue); e.quantity += Number(r.quantity);
      prodMap.set(r.product, e);
    }
    const topProducts = Array.from(prodMap.entries()).map(([product, d]) => ({ product, ...d })).sort((a, b) => b.revenue - a.revenue).slice(0, 5);

    // ── Funnel summary ──
    // purchases는 daily_sales의 orders와 동일 소스 사용 (daily_funnel.purchases는 brand="all" 혼합으로 부정확)
    const funnelRows = funnelData || [];
    const funnelSummary = {
      sessions: funnelRows.reduce((s, r) => s + Number(r.sessions || 0), 0),
      cartAdds: funnelRows.reduce((s, r) => s + Number(r.cart_adds || 0), 0),
      purchases: totalOrders, // daily_sales 기준으로 통일 (funnel purchases는 brand="all" 혼재)
      repurchases: funnelRows.reduce((s, r) => s + Number(r.repurchases || 0), 0),
    };
    const convRate = funnelSummary.sessions > 0 ? (funnelSummary.purchases / funnelSummary.sessions) * 100 : 0;

    // ── Targets ──
    const targets = (targetData || []).filter(r => brand === "all" || r.brand === brand);

    // ── Anomaly detection ──
    const anomalies: { brand: string; metric: string; change: number; current: number; previous: number }[] = [];
    const sortedDates = Array.from(new Set((sales || []).map(r => r.date))).sort();
    if (sortedDates.length >= 2) {
      const lastDate = sortedDates[sortedDates.length - 1];
      const prevDate = sortedDates[sortedDates.length - 2];
      const dayRevMap = new Map<string, Map<string, number>>();
      const dayAdMap = new Map<string, Map<string, number>>();
      for (const r of adjSales) {
        if (r.date !== lastDate && r.date !== prevDate) continue;
        if (!dayRevMap.has(r.date)) dayRevMap.set(r.date, new Map());
        dayRevMap.get(r.date)!.set(r.brand, (dayRevMap.get(r.date)!.get(r.brand) || 0) + Number(r.revenue));
      }
      for (const r of nonGa4Ad) {
        if (r.date !== lastDate && r.date !== prevDate) continue;
        if (!dayAdMap.has(r.date)) dayAdMap.set(r.date, new Map());
        dayAdMap.get(r.date)!.set(r.brand, (dayAdMap.get(r.date)!.get(r.brand) || 0) + Number(r.spend));
      }
      for (const b of ["nutty", "ironpet", "saip", "balancelab"]) {
        const label = brandLabels[b] || b;
        const curRev = dayRevMap.get(lastDate)?.get(b) || 0;
        const pRev = dayRevMap.get(prevDate)?.get(b) || 0;
        if (pRev > 0) { const c = ((curRev - pRev) / pRev) * 100; if (Math.abs(c) >= 30) anomalies.push({ brand: label, metric: "매출", change: c, current: curRev, previous: pRev }); }
        const curAd = dayAdMap.get(lastDate)?.get(b) || 0;
        const pAd = dayAdMap.get(prevDate)?.get(b) || 0;
        if (pAd > 0) { const c = ((curAd - pAd) / pAd) * 100; if (Math.abs(c) >= 30) anomalies.push({ brand: label, metric: "광고비", change: c, current: curAd, previous: pAd }); }
      }
    }

    // Raw data for sales/ads pages (backward compat)
    const prevSalesRaw = (prevSales || []).map(r => ({ ...r, date: "", brand: "", channel: "" }));

    return NextResponse.json({
      // Raw data (for sales/ads pages) — sales는 form-A 공구 차감본(adjSales)으로 반환해
      // /sales 페이지가 재집계해도 오버뷰 헤드라인과 동일한 자체매출이 되도록 함.
      sales: adjSales,
      ads: adSpend || [],
      products: (prodData || []),
      prevSales: prevSalesRaw,
      prevAds: (prevAd || []),
      // Computed KPI
      kpi: {
        revenue: totalRevenue, revenuePrev: prevRevenue,
        adSpend: totalMediaSpend, adSpendPrev: prevAdSpendTotal,
        roas, roasPrev: prevRoas,
        orders: totalOrders, ordersPrev: prevOrders,
        profit, profitPrev: prevProfit,
        mer, merPrev: prevMer,
        aov, aovPrev: prevAov,
        cogs: totalCOGS, shippingCost: totalShippingCost, miscCost: totalMiscCost,
        matchedRate: totalProducts > 0 ? matchedProducts / totalProducts : 0,
      },
      trend, channels, channelRoasTrend,
      brandRevenue, brandRevenueTrend, brandProfit,
      salesByChannel, topProducts,
      funnelSummary: { ...funnelSummary, convRate },
      targets,
      gongguSales, gongguSalesTotal, selfSalesTotal,
      dailyGongguTotal, dailyGonggu: Object.fromEntries(dailyGongguByCh),
      anomalies,
    });
  } catch (error) {
    console.error("Dashboard API error:", error);
    return NextResponse.json({ error: "Failed to fetch dashboard data" }, { status: 500 });
  }
}
