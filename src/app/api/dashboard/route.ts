import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";

  try {
    // 이전 기간 계산 (from~to 기간만큼 앞으로)
    const fromDate = new Date(from);
    const toDate = new Date(to);
    const diffMs = toDate.getTime() - fromDate.getTime();
    const prevTo = new Date(fromDate.getTime() - 86400000); // from - 1일
    const prevFrom = new Date(prevTo.getTime() - diffMs);
    const prevFromStr = prevFrom.toISOString().slice(0, 10);
    const prevToStr = prevTo.toISOString().slice(0, 10);

    const [salesRes, adsRes, productRes, funnelRes, prevSalesRes, prevAdsRes] = await Promise.all([
      supabase.from("daily_sales").select("*").gte("date", from).lte("date", to).order("date"),
      supabase.from("daily_ad_spend").select("*").gte("date", from).lte("date", to).order("date"),
      supabase.from("product_sales").select("*").gte("date", from).lte("date", to).order("revenue", { ascending: false }).limit(100),
      supabase.from("daily_funnel").select("*").eq("brand", "all").gte("date", from).lte("date", to).order("date"),
      // 이전 기간
      supabase.from("daily_sales").select("date,brand,channel,revenue,orders").gte("date", prevFromStr).lte("date", prevToStr),
      supabase.from("daily_ad_spend").select("date,brand,channel,spend,clicks,impressions,conversion_value").gte("date", prevFromStr).lte("date", prevToStr),
    ]);

    return NextResponse.json({
      sales: salesRes.data || [],
      ads: adsRes.data || [],
      products: productRes.data || [],
      funnel: funnelRes.data || [],
      prevSales: prevSalesRes.data || [],
      prevAds: prevAdsRes.data || [],
    });
  } catch (error) {
    console.error("Dashboard API error:", error);
    return NextResponse.json({ error: "Failed to fetch data" }, { status: 500 });
  }
}
