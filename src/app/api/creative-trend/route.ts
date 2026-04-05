import { NextRequest, NextResponse } from "next/server";

const META_TOKEN = process.env.META_ADS_TOKEN || "";

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const adId = sp.get("ad_id") || "";
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";

  if (!META_TOKEN || !adId) {
    return NextResponse.json({ trend: [], error: "ad_id and META_ADS_TOKEN required" });
  }

  try {
    const params: Record<string, string> = {
      access_token: META_TOKEN,
      fields: "date_start,impressions,clicks,spend,ctr,cpc,actions,action_values",
      time_increment: "1",
    };
    if (from && to) {
      params.time_range = JSON.stringify({ since: from, until: to });
    } else {
      params.date_preset = "last_30d";
    }

    const url = `https://graph.facebook.com/v19.0/${adId}/insights?${new URLSearchParams(params)}`;
    const res = await globalThis.fetch(url);
    const data = await res.json();

    const trend = (data.data || []).map((row: any) => {
      let purchases = 0, revenue = 0;
      for (const a of row.actions || []) {
        if (a.action_type === "purchase") purchases = Number(a.value || 0);
      }
      for (const a of row.action_values || []) {
        if (a.action_type === "purchase") revenue = Number(a.value || 0);
      }
      const spend = Number(row.spend || 0);
      return {
        date: row.date_start,
        spend,
        impressions: Number(row.impressions || 0),
        clicks: Number(row.clicks || 0),
        ctr: Number(row.ctr || 0),
        cpc: Number(row.cpc || 0),
        purchases,
        revenue,
        roas: spend > 0 ? revenue / spend : 0,
      };
    });

    return NextResponse.json({ trend });
  } catch (error) {
    return NextResponse.json({ trend: [], error: "Failed to fetch trend" });
  }
}
