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
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";
  const brand = sp.get("brand") || "";

  try {
    // 이전 기간 계산
    const fromDate = new Date(from);
    const toDate = new Date(to);
    const diffMs = toDate.getTime() - fromDate.getTime();
    const prevTo = new Date(fromDate.getTime() - 86400000);
    const prevFrom = new Date(prevTo.getTime() - diffMs);
    const prevFromStr = prevFrom.toISOString().slice(0, 10);
    const prevToStr = prevTo.toISOString().slice(0, 10);

    // ga4_* 채널은 UTM 추적 전용 (퍼널 데이터) — 광고비 집계에서 제외
    let query = supabase.from("daily_ad_spend").select("*").gte("date", from).lte("date", to).not("channel", "like", "ga4_%").order("date");
    let prevQuery = supabase.from("daily_ad_spend").select("date,brand,channel,spend,clicks,impressions,conversion_value").gte("date", prevFromStr).lte("date", prevToStr).not("channel", "like", "ga4_%");

    if (brand && brand !== "all") {
      query = query.eq("brand", brand);
      prevQuery = prevQuery.eq("brand", brand);
    }

    const [ads, prevAds] = await Promise.all([fetchAll(query), fetchAll(prevQuery)]);

    return NextResponse.json({ ads, prevAds });
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
