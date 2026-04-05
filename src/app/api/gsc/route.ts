import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";

const SA_KEY_PATH = process.env.GOOGLE_SA_KEY_PATH || "";
const SITE_URL = "https://ironpet.store/";

async function getAuth() {
  // Try service account key from env or file
  const auth = new google.auth.GoogleAuth({
    keyFile: SA_KEY_PATH || undefined,
    credentials: SA_KEY_PATH ? undefined : JSON.parse(process.env.GOOGLE_SA_KEY || "{}"),
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
  });
  return auth;
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";
  const brand = sp.get("brand") || "all";

  try {
    const auth = await getAuth();
    const searchconsole = google.searchconsole({ version: "v1", auth });

    const resp = await searchconsole.searchanalytics.query({
      siteUrl: SITE_URL,
      requestBody: {
        startDate: from,
        endDate: to,
        dimensions: ["query", "device"],
        rowLimit: 500,
        dataState: "all",
      },
    });

    const rows = resp.data.rows || [];

    // Brand keyword filters
    const BRAND_KEYWORDS: Record<string, string[]> = {
      nutty: ["너티", "스트레스제로껌", "바삭 닭가슴살", "냠 단호박", "에너젯바", "굿모닝퓨레", "하루루틴", "사운드시리즈", "nutty"],
      ironpet: ["아이언펫", "ironpet", "영양분석 키트", "반려견 검사", "반려견 영양"],
    };

    // Filter by brand if not "all"
    let filtered = rows;
    if (brand !== "all" && brand !== "saip" && BRAND_KEYWORDS[brand]) {
      const keywords = BRAND_KEYWORDS[brand];
      filtered = rows.filter(r => {
        const q = (r.keys?.[0] || "").toLowerCase();
        return keywords.some(kw => q.includes(kw.toLowerCase()));
      });
    }

    // Aggregate by query + device
    const queries = filtered.map(r => ({
      query: r.keys?.[0] || "",
      device: r.keys?.[1] || "UNKNOWN",
      clicks: r.clicks || 0,
      impressions: r.impressions || 0,
      ctr: r.ctr || 0,
      position: r.position || 0,
    }));

    // Summary stats
    const totalClicks = queries.reduce((s, q) => s + q.clicks, 0);
    const totalImpressions = queries.reduce((s, q) => s + q.impressions, 0);
    const avgCtr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;
    const avgPosition = queries.length > 0 ? queries.reduce((s, q) => s + q.position, 0) / queries.length : 0;

    return NextResponse.json({
      queries,
      summary: { totalClicks, totalImpressions, avgCtr, avgPosition },
    });
  } catch (error: any) {
    console.error("GSC API error:", error?.message || error);
    return NextResponse.json({ error: "GSC API failed", detail: error?.message }, { status: 500 });
  }
}
