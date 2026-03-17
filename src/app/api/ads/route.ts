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
