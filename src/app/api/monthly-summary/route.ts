import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const brand = sp.get("brand") || "all";
  const year = sp.get("year") || new Date().getFullYear().toString();

  try {
    // Get all sales data for the year
    const fromDate = `${year}-01-01`;
    const toDate = `${year}-12-31`;

    let salesQ = supabase.from("daily_sales").select("date,revenue,orders").gte("date", fromDate).lte("date", toDate);
    if (brand !== "all") { salesQ = salesQ.eq("brand", brand); }
    else { salesQ = salesQ.neq("brand", "all"); }
    const { data: sales } = await salesQ;

    let adQ = supabase.from("daily_ad_spend").select("date,spend,conversion_value").gte("date", fromDate).lte("date", toDate);
    if (brand !== "all") { adQ = adQ.eq("brand", brand); }
    else { adQ = adQ.neq("brand", "all"); }
    const { data: ads } = await adQ;

    // Fetch misc costs (monthly granularity)
    let miscQ = supabase.from("manual_monthly").select("month,value").eq("category", "misc_cost").gte("month", fromDate).lte("month", toDate);
    if (brand !== "all") miscQ = miscQ.eq("brand", brand);
    const { data: miscData } = await miscQ;

    // Fetch shipping costs (monthly granularity)
    let shipQ = supabase.from("manual_monthly").select("month,value").eq("category", "shipping_cost").gte("month", fromDate).lte("month", toDate);
    if (brand !== "all") shipQ = shipQ.eq("brand", brand);
    const { data: shipData } = await shipQ;

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
    const { data: cogsProdData } = await cogsProdQ;

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
      const m = r.date.slice(0, 7);
      const existing = months.get(m) || { revenue: 0, orders: 0, adSpend: 0, cv: 0, miscCost: 0, shipCost: 0, cogs: 0 };
      existing.adSpend += Number(r.spend);
      existing.cv += Number(r.conversion_value);
      months.set(m, existing);
    }

    // Add misc costs by month
    for (const r of miscData || []) {
      const m = r.month.slice(0, 7);
      const existing = months.get(m);
      if (existing) existing.miscCost += Number(r.value || 0);
    }

    // Add shipping costs by month
    for (const r of shipData || []) {
      const m = r.month.slice(0, 7);
      const existing = months.get(m);
      if (existing) existing.shipCost += Number(r.value || 0);
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
      (curr as any).revGrowth = prev.revenue > 0 ? ((curr.revenue / prev.revenue) - 1) * 100 : 0;
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
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch monthly summary" }, { status: 500 });
  }
}
