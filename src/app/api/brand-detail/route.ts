import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

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

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const brand = sp.get("brand") || "all";
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";

  if (brand === "all") {
    return NextResponse.json({ error: "brand parameter required" }, { status: 400 });
  }

  try {
    // Product sales for this brand
    const products = await fetchAll(
      supabase.from("product_sales").select("date,product,channel,lineup,category,revenue,quantity,buyers")
        .eq("brand", brand).gte("date", from).lte("date", to)
    );

    // ── Lineup/SubBrand breakdown ──
    const lineupMap = new Map<string, { revenue: number; quantity: number; orders: number }>();
    for (const r of products) {
      let key: string;
      if (brand === "nutty") {
        key = r.lineup || "기타";
      } else if (brand === "saip") {
        key = r.lineup || (
          r.product.includes("파미나") ? "파미나" :
          r.product.includes("테라카니스") ? "테라카니스" :
          r.product.includes("닥터레이") ? "닥터레이" :
          r.product.includes("고네이티브") ? "고네이티브" : "기타"
        );
      } else if (brand === "balancelab") {
        key = r.product.includes("검사") ? "큐모발검사" :
              r.product.includes("영양제") ? "맞춤 영양제" : "기타";
      } else if (brand === "ironpet") {
        key = r.product.includes("키트") || r.product.includes("검사") ? "검사 키트" : "기타";
      } else {
        key = r.lineup || "기타";
      }
      const e = lineupMap.get(key) || { revenue: 0, quantity: 0, orders: 0 };
      e.revenue += Number(r.revenue || 0);
      e.quantity += Number(r.quantity || 0);
      e.orders += Number(r.buyers || 0);
      lineupMap.set(key, e);
    }
    const lineupBreakdown = Array.from(lineupMap.entries())
      .map(([lineup, d]) => ({ lineup, ...d }))
      .sort((a, b) => b.revenue - a.revenue);

    // ── Top products ──
    const productMap = new Map<string, { revenue: number; quantity: number }>();
    for (const r of products) {
      const e = productMap.get(r.product) || { revenue: 0, quantity: 0 };
      e.revenue += Number(r.revenue || 0);
      e.quantity += Number(r.quantity || 0);
      productMap.set(r.product, e);
    }
    const topProducts = Array.from(productMap.entries())
      .map(([product, d]) => ({ product, ...d }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 20);

    // ── Channel breakdown ──
    const channelMap = new Map<string, { revenue: number; orders: number }>();
    for (const r of products) {
      const e = channelMap.get(r.channel) || { revenue: 0, orders: 0 };
      e.revenue += Number(r.revenue || 0);
      e.orders += Number(r.buyers || 0);
      channelMap.set(r.channel, e);
    }
    const channelBreakdown = Array.from(channelMap.entries())
      .map(([channel, d]) => ({ channel, ...d }))
      .sort((a, b) => b.revenue - a.revenue);

    // ── Daily trend ──
    const trendMap = new Map<string, number>();
    for (const r of products) {
      trendMap.set(r.date, (trendMap.get(r.date) || 0) + Number(r.revenue || 0));
    }
    const dailyTrend = Array.from(trendMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, revenue]) => ({ date, revenue }));

    // ── Gonggu analysis (balancelab only) — product_sales 단일 소스 ──
    let gongguSales: { seller: string; revenue: number; orders: number }[] = [];
    let selfSalesTotal = 0;
    let gongguSalesTotal = 0;

    if (brand === "balancelab") {
      // product_sales에서 공구/자체 구분 (daily_sales와 단일 소스 통일)
      const sellerMap = new Map<string, { revenue: number; orders: number }>();
      for (const r of products) {
        if (r.channel && r.channel.startsWith("공구_")) {
          const seller = r.channel.replace("공구_", "");
          const e = sellerMap.get(seller) || { revenue: 0, orders: 0 };
          e.revenue += Number(r.revenue);
          e.orders += Number(r.buyers || 0);
          sellerMap.set(seller, e);
          gongguSalesTotal += Number(r.revenue);
        } else {
          selfSalesTotal += Number(r.revenue);
        }
      }
      gongguSales = Array.from(sellerMap.entries())
        .map(([seller, d]) => ({ seller, ...d }))
        .sort((a, b) => b.revenue - a.revenue);

      // Self vs gonggu daily trend (product_sales 기반)
      const selfGongguMap = new Map<string, { self: number; gonggu: number }>();
      for (const r of products) {
        const e = selfGongguMap.get(r.date) || { self: 0, gonggu: 0 };
        if (r.channel && r.channel.startsWith("공구_")) {
          e.gonggu += Number(r.revenue);
        } else {
          e.self += Number(r.revenue);
        }
        selfGongguMap.set(r.date, e);
      }
      const selfGongguTrend = Array.from(selfGongguMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, d]) => ({ date, ...d }));

      return NextResponse.json({
        lineupBreakdown, topProducts, channelBreakdown, dailyTrend,
        gongguSales, gongguSalesTotal, selfSalesTotal, selfGongguTrend,
      });
    }

    return NextResponse.json({
      lineupBreakdown, topProducts, channelBreakdown, dailyTrend,
    });
  } catch (error) {
    console.error("Brand detail API error:", error);
    return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  }
}
