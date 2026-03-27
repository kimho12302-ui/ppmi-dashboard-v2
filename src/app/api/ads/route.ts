import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";
  const brand = sp.get("brand") || "";

  try {
    let query = supabase
      .from("daily_ad_spend")
      .select("*")
      .gte("date", from)
      .lte("date", to)
      .order("date");

    if (brand && brand !== "all") {
      query = query.eq("brand", brand);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ ads: data || [] });
  } catch (error) {
    console.error("Ads API error:", error);
    return NextResponse.json({ error: "Failed to fetch data" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { date, brand, channel, spend, impressions, clicks, conversions, conversion_value } = body;

    if (!date || !brand || !channel) {
      return NextResponse.json({ error: "date, brand, channel 필수" }, { status: 400 });
    }

    // UPSERT: date+brand+channel이 같으면 덮어쓰기
    const { data, error } = await supabase
      .from("daily_ad_spend")
      .upsert({
        date,
        brand,
        channel,
        spend: Number(spend) || 0,
        impressions: Number(impressions) || 0,
        clicks: Number(clicks) || 0,
        conversions: Number(conversions) || 0,
        conversion_value: Number(conversion_value) || 0,
        roas: spend > 0 ? (conversion_value || 0) / spend : 0,
        ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
        cpc: clicks > 0 ? spend / clicks : 0,
      }, { onConflict: "date,brand,channel" })
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("Ads POST error:", error);
    return NextResponse.json({ error: "저장 실패" }, { status: 500 });
  }
}
