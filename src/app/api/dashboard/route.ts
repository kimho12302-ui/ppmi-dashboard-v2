import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";

  try {
    // Parallel fetches
    const [salesRes, adsRes, productRes, funnelRes] = await Promise.all([
      supabase
        .from("daily_sales")
        .select("*")
        .gte("date", from)
        .lte("date", to)
        .order("date"),
      supabase
        .from("daily_ad_spend")
        .select("*")
        .gte("date", from)
        .lte("date", to)
        .order("date"),
      supabase
        .from("product_sales")
        .select("*")
        .gte("date", from)
        .lte("date", to)
        .order("revenue", { ascending: false })
        .limit(100),
      supabase
        .from("daily_funnel")
        .select("*")
        .eq("brand", "all")
        .gte("date", from)
        .lte("date", to)
        .order("date"),
    ]);

    return NextResponse.json({
      sales: salesRes.data || [],
      ads: adsRes.data || [],
      products: productRes.data || [],
      funnel: funnelRes.data || [],
    });
  } catch (error) {
    console.error("Dashboard API error:", error);
    return NextResponse.json({ error: "Failed to fetch data" }, { status: 500 });
  }
}
