import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";

  try {
    const [funnelRes, metaRes] = await Promise.all([
      supabase
        .from("daily_funnel")
        .select("*")
        .gte("date", from)
        .lte("date", to)
        .order("date"),
      supabase
        .from("daily_ad_spend")
        .select("date,brand,impressions,clicks,conversions,conversion_value,reach,spend")
        .eq("channel", "meta")
        .gte("date", from)
        .lte("date", to)
        .order("date"),
    ]);

    if (funnelRes.error) throw funnelRes.error;

    return NextResponse.json({
      funnel: funnelRes.data || [],
      metaAds: metaRes.data || [],
    });
  } catch (error) {
    console.error("Funnel API error:", error);
    return NextResponse.json({ error: "Failed to fetch data" }, { status: 500 });
  }
}
