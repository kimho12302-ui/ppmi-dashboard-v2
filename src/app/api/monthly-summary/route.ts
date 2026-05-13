export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { isGongguOutOfDailySales } from "@/lib/gonggu";

// Supabase anon key has max-rows=1000 per request. Use pagination to fetch all rows.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAll(baseQuery: any): Promise<any[]> {
  const PAGE = 1000;
  let from = 0;
  const all: unknown[] = [];
  while (true) {
    const { data, error } = await baseQuery.range(from, from + PAGE - 1);
    if (error) break;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const brand = sp.get("brand") || "all";
  const year = sp.get("year") || new Date().getFullYear().toString();

  try {
    // Get all sales data for the year
    const fromDate = `${year}-01-01`;
    const toDate = `${year}-12-31`;

    let salesQ = supabase.from("daily_sales").select("date,revenue,orders").gte("date", fromDate).lte("date", toDate).neq("channel", "total");
    if (brand !== "all") { salesQ = salesQ.eq("brand", brand); }
    else { salesQ = salesQ.neq("brand", "all"); }
    const sales = await fetchAll(salesQ);

    let adQ = supabase.from("daily_ad_spend").select("date,channel,spend,conversion_value").gte("date", fromDate).lte("date", toDate).not("channel", "like", "ga4_%");
    if (brand !== "all") { adQ = adQ.eq("brand", brand); }
    else { adQ = adQ.neq("brand", "all"); }
    const ads = await fetchAll(adQ);

    // Fetch misc costs (dashboard API와 동일 테이블 사용: misc_costs)
    let miscQ = supabase.from("misc_costs").select("date,brand,amount").gte("date", fromDate).lte("date", toDate);
    if (brand !== "all") miscQ = miscQ.eq("brand", brand);
    const { data: miscData } = await miscQ;

    // Fetch shipping costs (dashboard API와 동일 테이블 사용: shipping_costs)
    let shipQ = supabase.from("shipping_costs").select("month,brand,total_cost").gte("month", fromDate.slice(0, 7)).lte("month", toDate.slice(0, 7));
    if (brand !== "all") shipQ = shipQ.eq("brand", brand);
    const { data: shipData } = await shipQ;

    // Fetch balancelab gonggu revenue from product_sales.
    // 가산 대상: daily_sales 에 미포함된 공구 row (channel="공구_*" 또는 channel="공구").
    // channel="smartstore" + lineup="셀러" row 는 이미 daily_sales smartstore 합계에 포함되어 있어 가산하면 이중집계.
    const gongguMonthMap = new Map<string, number>(); // month → gonggu revenue
    if (brand === "balancelab" || brand === "all") {
      const gongguData = await fetchAll(supabase.from("product_sales").select("date,channel,product,lineup,revenue")
        .gte("date", fromDate).lte("date", toDate).eq("brand", "balancelab"));
      for (const r of gongguData || []) {
        if (isGongguOutOfDailySales(r)) {
          const m = r.date.slice(0, 7);
          gongguMonthMap.set(m, (gongguMonthMap.get(m) || 0) + Number(r.revenue));
        }
      }
    }

    // Fetch product costs for COGS
    const { data: productCostsData } = await supabase.from("product_costs").select("product,brand,cost_price,manufacturing_cost,shipping_cost");
    const costMap = new Map<string, number>();
    for (const pc of productCostsData || []) {
      // manufacturing_cost = 실제 원가 (cost_price는 판매가)
      costMap.set(`${pc.product}__${pc.brand}`, Number(pc.manufacturing_cost || 0));
    }

    // Fetch product_sales for COGS matching
    let cogsProdQ = supabase.from("product_sales").select("date,product,brand,quantity").gte("date", fromDate).lte("date", toDate);
    if (brand !== "all") cogsProdQ = cogsProdQ.eq("brand", brand);
    const cogsProdData = await fetchAll(cogsProdQ);

    // Group by month
    const months = new Map<string, { revenue: number; orders: number; adSpend: number; cv: number; miscCost: number; shipCost: number; cogs: number }>();

    for (const r of sales || []) {
      const m = r.date.slice(0, 7);
      const existing = months.get(m) || { revenue: 0, orders: 0, adSpend: 0, cv: 0, miscCost: 0, shipCost: 0, cogs: 0 };
      existing.revenue += Number(r.revenue);
      existing.orders += Number(r.orders);
      months.set(m, existing);
    }

    for (const r of ads || []) {
      if (r.channel && r.channel.startsWith("ga4_")) continue; // GA4 중복 제외
      const m = r.date.slice(0, 7);
      const existing = months.get(m) || { revenue: 0, orders: 0, adSpend: 0, cv: 0, miscCost: 0, shipCost: 0, cogs: 0 };
      existing.adSpend += Number(r.spend);
      existing.cv += Number(r.conversion_value);
      months.set(m, existing);
    }

    // Add misc costs by month (misc_costs: date + amount)
    for (const r of miscData || []) {
      const m = (r.date || "").slice(0, 7);
      const existing = months.get(m);
      if (existing) existing.miscCost += Number(r.amount || 0);
    }

    // Add shipping costs by month (shipping_costs: month + total_cost)
    for (const r of shipData || []) {
      const m = (r.month || "").slice(0, 7);
      const existing = months.get(m);
      if (existing) existing.shipCost += Number(r.total_cost || 0);
    }

    // Add gonggu revenue by month (balancelab 공구 채널)
    for (const [m, rev] of gongguMonthMap.entries()) {
      const existing = months.get(m) || { revenue: 0, orders: 0, adSpend: 0, cv: 0, miscCost: 0, shipCost: 0, cogs: 0 };
      existing.revenue += rev;
      months.set(m, existing);
    }

    // Add COGS by month
    for (const ps of cogsProdData || []) {
      const m = ps.date.slice(0, 7);
      const existing = months.get(m);
      if (!existing) continue;
      const key = `${ps.product}__${ps.brand}`;
      const unitCost = costMap.get(key) || 0;
      existing.cogs += unitCost * Number(ps.quantity || 0);
    }

    const summary = Array.from(months.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, d]) => {
        const totalCost = d.adSpend + d.miscCost + d.shipCost + d.cogs;
        const profit = d.revenue - totalCost;
        return {
          month,
          revenue: d.revenue,
          orders: d.orders,
          adSpend: d.adSpend + d.miscCost,
          cogs: d.cogs,
          shippingCost: d.shipCost,
          profit,
          profitRate: d.revenue > 0 ? (profit / d.revenue) * 100 : 0,
          roas: (d.adSpend + d.miscCost) > 0 ? d.revenue / (d.adSpend + d.miscCost) : 0,
          aov: d.orders > 0 ? d.revenue / d.orders : 0,
        };
      });

    // Add MoM growth
    for (let i = 1; i < summary.length; i++) {
      const prev = summary[i - 1];
      const curr = summary[i];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (curr as any).revGrowth = prev.revenue > 0 ? ((curr.revenue / prev.revenue) - 1) * 100 : 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (curr as any).orderGrowth = prev.orders > 0 ? ((curr.orders / prev.orders) - 1) * 100 : 0;
    }

    // YTD totals
    const ytd = {
      revenue: summary.reduce((s, m) => s + m.revenue, 0),
      orders: summary.reduce((s, m) => s + m.orders, 0),
      adSpend: summary.reduce((s, m) => s + m.adSpend, 0),
      cogs: summary.reduce((s, m) => s + m.cogs, 0),
      shippingCost: summary.reduce((s, m) => s + m.shippingCost, 0),
      profit: summary.reduce((s, m) => s + m.profit, 0),
      roas: 0 as number,
      aov: 0 as number,
      profitRate: 0 as number,
    };
    ytd.roas = ytd.adSpend > 0 ? ytd.revenue / ytd.adSpend : 0;
    ytd.aov = ytd.orders > 0 ? ytd.revenue / ytd.orders : 0;
    ytd.profitRate = ytd.revenue > 0 ? (ytd.profit / ytd.revenue) * 100 : 0;

    return NextResponse.json({ summary, ytd, year });
  } catch {
    return NextResponse.json({ error: "Failed to fetch monthly summary" }, { status: 500 });
  }
}
