import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";

const SA_KEY = process.env.GOOGLE_SA_KEY;
const SHEET_ID = "1ky1rAsa8draGigQixBRSNMOPIEYH0ygsXiF_mYhDwgo";

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";
  const brand = sp.get("brand") || "all";

  try {
    if (!SA_KEY) return NextResponse.json({ campaigns: [] });
    const key = JSON.parse(SA_KEY);
    const auth = new google.auth.GoogleAuth({ credentials: key, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
    const sheets = google.sheets({ version: "v4", auth });

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "캠페인_성과!A:J",
    });
    const rows = res.data.values || [];
    if (rows.length < 2) return NextResponse.json({ campaigns: [] });

    // headers: 수집일시, 캠페인ID, 캠페인명, 날짜, 노출수, 클릭수, CTR, CPC, 총비용, 전환수
    const data = rows.slice(1).filter(r => r.length >= 8);

    // Filter by date range
    const filtered = data.filter(r => {
      const date = r[3];
      if (!date) return false;
      return (!from || date >= from) && (!to || date <= to);
    });

    // Brand filter: campaign name contains brand keyword
    const brandKeywords: Record<string, string[]> = {
      nutty: ["너티"],
      ironpet: ["아이언펫"],
      saip: ["사입", "파미나", "닥터레이"],
    };

    const brandFiltered = brand === "all" ? filtered : filtered.filter(r => {
      const campaignName = r[2] || "";
      const keywords = brandKeywords[brand] || [];
      return keywords.some(k => campaignName.includes(k));
    });

    // Aggregate by campaign
    const agg: Record<string, { campaignId: string; campaignName: string; impressions: number; clicks: number; cost: number; conversions: number; days: Set<string> }> = {};

    for (const r of brandFiltered) {
      const campaignName = r[2] || "";
      const date = r[3] || "";
      const impressions = parseInt(r[4]) || 0;
      const clicks = parseInt(r[5]) || 0;
      const cpc = parseFloat(r[7]) || 0;
      const cost = clicks * cpc;
      const conversions = parseInt(r[9]) || 0;

      if (!agg[campaignName]) {
        agg[campaignName] = { campaignId: r[1], campaignName, impressions: 0, clicks: 0, cost: 0, conversions: 0, days: new Set() };
      }
      agg[campaignName].impressions += impressions;
      agg[campaignName].clicks += clicks;
      agg[campaignName].cost += cost;
      agg[campaignName].conversions += conversions;
      agg[campaignName].days.add(date);
    }

    // Determine type from campaign name
    const getType = (name: string): string => {
      if (name.includes("쇼핑검색") || name.includes("쇼핑")) return "쇼핑검색";
      if (name.includes("파워링크") || name.includes("파워")) return "파워링크";
      if (name.includes("벌크")) return "벌크";
      return "기타";
    };

    const campaigns = Object.values(agg).map(c => ({
      campaignId: c.campaignId,
      campaignName: c.campaignName,
      type: getType(c.campaignName),
      impressions: c.impressions,
      clicks: c.clicks,
      cost: Math.round(c.cost),
      conversions: c.conversions,
      ctr: c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0,
      cpc: c.clicks > 0 ? Math.round(c.cost / c.clicks) : 0,
      days: c.days.size,
    })).sort((a, b) => b.cost - a.cost);

    const summary = {
      totalImpressions: campaigns.reduce((s, c) => s + c.impressions, 0),
      totalClicks: campaigns.reduce((s, c) => s + c.clicks, 0),
      totalCost: campaigns.reduce((s, c) => s + c.cost, 0),
      totalConversions: campaigns.reduce((s, c) => s + c.conversions, 0),
      avgCtr: 0,
      avgCpc: 0,
    };
    summary.avgCtr = summary.totalImpressions > 0 ? (summary.totalClicks / summary.totalImpressions) * 100 : 0;
    summary.avgCpc = summary.totalClicks > 0 ? Math.round(summary.totalCost / summary.totalClicks) : 0;

    return NextResponse.json({ campaigns, summary });
  } catch (error) {
    console.error("Naver campaigns error:", error);
    return NextResponse.json({ campaigns: [], summary: null }, { status: 500 });
  }
}
