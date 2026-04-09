export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

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
    // ── 1. Sales ──
    let salesQuery = supabase.from("daily_sales").select("*").gte("date", from).lte("date", to).order("date");
    if (brand !== "all") salesQuery = salesQuery.eq("brand", brand);
    else salesQuery = salesQuery.neq("brand", "all");
    const sales = await fetchAll(salesQuery);

    // ── 2. Ad Spend ──
    let adQuery = supabase.from("daily_ad_spend").select("*").gte("date", from).lte("date", to).order("date");
    if (brand !== "all") adQuery = adQuery.eq("brand", brand);
    else adQuery = adQuery.neq("brand", "all");
    const adSpend = await fetchAll(adQuery);

    // ── 3. Previous period ──
    const fromDate = new Date(from);
    const toDate = new Date(to);
    const diff = toDate.getTime() - fromDate.getTime();
    const prevFrom = new Date(fromDate.getTime() - diff - 86400000).toISOString().slice(0, 10);
    const prevTo = new Date(fromDate.getTime() - 86400000).toISOString().slice(0, 10);

    let prevSalesQ = supabase.from("daily_sales").select("revenue, orders").gte("date", prevFrom).lte("date", prevTo);
    if (brand !== "all") prevSalesQ = prevSalesQ.eq("brand", brand);
    else prevSalesQ = prevSalesQ.neq("brand", "all");
    const prevSales = await fetchAll(prevSalesQ);

    let prevAdQ = supabase.from("daily_ad_spend").select("channel, spend, conversion_value").gte("date", prevFrom).lte("date", prevTo);
    if (brand !== "all") prevAdQ = prevAdQ.eq("brand", brand);
    else prevAdQ = prevAdQ.neq("brand", "all");
    const prevAd = await fetchAll(prevAdQ);

    // ── 4. Product costs (COGS) ──
    const { data: productCostsData } = await supabase.from("product_costs").select("product,brand,cost_price,manufacturing_cost,shipping_cost");
    const costMap = new Map<string, { manufacturing_cost: number; shipping_cost: number }>();
    for (const pc of productCostsData || []) {
      costMap.set(`${pc.product}__${pc.brand}`, {
        manufacturing_cost: Number(pc.manufacturing_cost || 0),
        shipping_cost: Number(pc.shipping_cost || 0),
      });
    }

    let cogsProdQ = supabase.from("product_sales").select("product,brand,quantity").gte("date", from).lte("date", to);
    if (brand !== "all") cogsProdQ = cogsProdQ.eq("brand", brand);
    const cogsProdData = await fetchAll(cogsProdQ);

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

    // ── 5. Shipping + Misc costs ──
    const { data: shippingData } = await supabase.from("shipping_costs").select("*")
      .gte("month", from.slice(0, 7)).lte("month", to.slice(0, 7));
    let totalShippingCost = 0;
    for (const r of (shippingData || []).filter(r => brand === "all" || r.brand === brand)) {
      totalShippingCost += Number(r.total_cost || 0);
    }

    const { data: miscData } = await supabase.from("misc_costs").select("*")
      .gte("date", from).lte("date", to);
    let totalMiscCost = 0;
    for (const r of (miscData || []).filter(r => brand === "all" || r.brand === brand)) {
      totalMiscCost += Number(r.amount || 0);
    }

    // ── 공구 분석 (밸런스랩) — product_sales 기준 (공구채널이 daily_sales에 없고 product_sales에만 있음) ──
    // KPI 계산 전에 먼저 집계해야 totalRevenue에 포함 가능
    let gongguSales: { seller: string; revenue: number; orders: number }[] = [];
    let selfSalesTotal = 0;
    let gongguSalesTotal = 0;
    const gongguChannelMap = new Map<string, number>(); // channel → revenue (for salesByChannel)
    // gongguByDate: date → revenue (밸런스랩 공구 일별 집계, trend에 반영)
    const gongguByDate = new Map<string, number>();
    if (brand === "balancelab" || brand === "all") {
      const gongguData = await fetchAll(supabase.from("product_sales").select("date,channel,lineup,revenue,quantity")
        .gte("date", from).lte("date", to).eq("brand", "balancelab"));
      const sellerMap = new Map<string, { revenue: number; orders: number }>();
      for (const r of gongguData || []) {
        const isGonggu = (r.channel && r.channel.startsWith("공구_")) || (r.lineup && r.lineup.trim() !== "");
        if (isGonggu) {
          const seller = r.channel?.startsWith("공구_") ? r.channel.replace("공구_", "") : (r.lineup || "기타");
          const e = sellerMap.get(seller) || { revenue: 0, orders: 0 };
          e.revenue += Number(r.revenue); e.orders += Number(r.quantity || 0);
          sellerMap.set(seller, e);
          gongguSalesTotal += Number(r.revenue);
          const chKey = r.channel?.startsWith("공구_") ? r.channel : `공구_${seller}`;
          gongguChannelMap.set(chKey, (gongguChannelMap.get(chKey) || 0) + Number(r.revenue));
          // 일별 집계
          gongguByDate.set(r.date, (gongguByDate.get(r.date) || 0) + Number(r.revenue));
        } else {
          selfSalesTotal += Number(r.revenue);
        }
      }
      gongguSales = Array.from(sellerMap.entries()).map(([seller, d]) => ({ seller, ...d })).sort((a, b) => b.revenue - a.revenue);
    }

    // ── KPI 계산 ──
    const totalRevenue = (sales || []).reduce((s, r) => s + Number(r.revenue), 0) + gongguSalesTotal;
    const totalOrders = (sales || []).reduce((s, r) => s + Number(r.orders), 0);
    const nonGa4Ad = (adSpend || []).filter(r => !r.channel.startsWith("ga4_"));
    const totalAdSpend = nonGa4Ad.reduce((s, r) => s + Number(r.spend), 0) + totalMiscCost;
    const totalConvValue = nonGa4Ad.reduce((s, r) => s + Number(r.conversion_value || 0), 0);
    const roas = totalAdSpend > 0 ? totalConvValue / totalAdSpend : 0;
    const profit = totalRevenue - totalAdSpend - totalCOGS - totalShippingCost;
    const mer = totalAdSpend > 0 ? totalRevenue / totalAdSpend : 0;
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
    for (const r of sales || []) {
      const d = trendMap.get(r.date) || { revenue: 0, adSpend: 0 };
      d.revenue += Number(r.revenue);
      const bl = brandLabels[r.brand] || r.brand;
      d[bl] = (d[bl] || 0) + Number(r.revenue);
      trendMap.set(r.date, d);
    }
    for (const r of adSpend || []) {
      const d = trendMap.get(r.date) || { revenue: 0, adSpend: 0 };
      d.adSpend += Number(r.spend);
      trendMap.set(r.date, d);
    }
    // 공구 매출 일별 trend 반영
    for (const [date, rev] of gongguByDate.entries()) {
      const d = trendMap.get(date) || { revenue: 0, adSpend: 0 };
      d.revenue += rev;
      d["밸런스랩"] = (d["밸런스랩"] || 0) + rev;
      trendMap.set(date, d);
    }
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
        return { date, ...data, maRevenue: Math.round(maRevenue), maAdSpend: Math.round(maAdSpend) };
      });

    // ── Channel breakdown ──
    const channelMap = new Map<string, { spend: number; revenue: number }>();
    for (const r of adSpend || []) {
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
    for (const r of adSpend || []) {
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
    for (const r of sales || []) {
      if (r.brand === "all") continue;
      const e = brandRevMap.get(r.brand) || { revenue: 0, orders: 0 };
      e.revenue += Number(r.revenue); e.orders += Number(r.orders);
      brandRevMap.set(r.brand, e);
    }
    // 밸런스랩 공구 매출 추가 (product_sales → daily_sales에 없는 채널)
    if (gongguSalesTotal > 0) {
      const e = brandRevMap.get("balancelab") || { revenue: 0, orders: 0 };
      e.revenue += gongguSalesTotal;
      brandRevMap.set("balancelab", e);
    }
    const brandRevenue = Array.from(brandRevMap.entries()).map(([b, d]) => ({ brand: b, ...d }));

    // ── Brand profit ──
    const brandAdMap = new Map<string, number>();
    for (const r of adSpend || []) brandAdMap.set(r.brand, (brandAdMap.get(r.brand) || 0) + Number(r.spend));
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
    for (const r of sales || []) {
      if (r.brand === "all") continue;
      const e = brandTrendMap.get(r.date) || {};
      const bl = brandLabels[r.brand] || r.brand;
      e[bl] = (e[bl] || 0) + Number(r.revenue);
      brandTrendMap.set(r.date, e);
    }
    // 공구 매출 일별 brandTrend에 반영
    for (const [date, rev] of gongguByDate.entries()) {
      const e = brandTrendMap.get(date) || {};
      e["밸런스랩"] = (e["밸런스랩"] || 0) + rev;
      brandTrendMap.set(date, e);
    }
    const brandRevenueTrend = Array.from(brandTrendMap.entries()).sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({ date, ...d }));

    // ── Sales by channel ──
    const salesChMap = new Map<string, number>();
    for (const r of sales || []) salesChMap.set(r.channel, (salesChMap.get(r.channel) || 0) + Number(r.revenue));
    // 공구 채널 추가 (product_sales에만 있음)
    for (const [ch, rev] of gongguChannelMap.entries()) {
      salesChMap.set(ch, (salesChMap.get(ch) || 0) + rev);
    }
    const salesByChannel = Array.from(salesChMap.entries()).map(([channel, revenue]) => ({ channel, revenue })).sort((a, b) => b.revenue - a.revenue);

    // ── Top 5 products ──
    let prodQ = supabase.from("product_sales").select("product,revenue,quantity,brand,channel,lineup").gte("date", from).lte("date", to);
    if (brand !== "all") prodQ = prodQ.eq("brand", brand);
    const prodData = await fetchAll(prodQ);
    const prodMap = new Map<string, { revenue: number; quantity: number; brand: string }>();
    for (const r of prodData || []) {
      const e = prodMap.get(r.product) || { revenue: 0, quantity: 0, brand: r.brand };
      e.revenue += Number(r.revenue); e.quantity += Number(r.quantity);
      prodMap.set(r.product, e);
    }
    const topProducts = Array.from(prodMap.entries()).map(([product, d]) => ({ product, ...d })).sort((a, b) => b.revenue - a.revenue).slice(0, 5);

    // ── Funnel summary ──
    // purchases는 daily_sales의 orders와 동일 소스 사용 (daily_funnel.purchases는 brand="all" 혼합으로 부정확)
    const { data: funnelData } = await supabase.from("daily_funnel").select("*").gte("date", from).lte("date", to);
    const funnelRows = funnelData || [];
    const funnelSummary = {
      sessions: funnelRows.reduce((s, r) => s + Number(r.sessions || 0), 0),
      cartAdds: funnelRows.reduce((s, r) => s + Number(r.cart_adds || 0), 0),
      purchases: totalOrders, // daily_sales 기준으로 통일 (funnel purchases는 brand="all" 혼재)
      repurchases: funnelRows.reduce((s, r) => s + Number(r.repurchases || 0), 0),
    };
    const convRate = funnelSummary.sessions > 0 ? (funnelSummary.purchases / funnelSummary.sessions) * 100 : 0;

    // ── Targets ──
    const currentMonth = to.slice(0, 7);
    const { data: targetData } = await supabase.from("monthly_targets").select("*").eq("month", currentMonth);
    const targets = (targetData || []).filter(r => brand === "all" || r.brand === brand);

    // ── Anomaly detection ──
    const anomalies: { brand: string; metric: string; change: number; current: number; previous: number }[] = [];
    const sortedDates = Array.from(new Set((sales || []).map(r => r.date))).sort();
    if (sortedDates.length >= 2) {
      const lastDate = sortedDates[sortedDates.length - 1];
      const prevDate = sortedDates[sortedDates.length - 2];
      const dayRevMap = new Map<string, Map<string, number>>();
      const dayAdMap = new Map<string, Map<string, number>>();
      for (const r of sales || []) {
        if (r.date !== lastDate && r.date !== prevDate) continue;
        if (!dayRevMap.has(r.date)) dayRevMap.set(r.date, new Map());
        dayRevMap.get(r.date)!.set(r.brand, (dayRevMap.get(r.date)!.get(r.brand) || 0) + Number(r.revenue));
      }
      for (const r of adSpend || []) {
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
      // Raw data (for sales/ads pages)
      sales: sales || [],
      ads: adSpend || [],
      products: (prodData || []),
      prevSales: prevSalesRaw,
      prevAds: (prevAd || []),
      // Computed KPI
      kpi: {
        revenue: totalRevenue, revenuePrev: prevRevenue,
        adSpend: totalAdSpend, adSpendPrev: prevAdSpendTotal,
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
      anomalies,
    });
  } catch (error) {
    console.error("Dashboard API error:", error);
    return NextResponse.json({ error: "Failed to fetch dashboard data" }, { status: 500 });
  }
}
