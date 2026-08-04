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
    // ★ fail-open 차단(2026-08 리뷰): GSC 속성이 ironpet.store 하나뿐이라, 매핑이 없는 브랜드
    //   (밸런스랩/사입/펫)를 고르면 필터가 통째로 건너뛰어 아이언펫 쿼리 전체가 그 브랜드의
    //   검색 성과인 것처럼 표시됐다. 매핑이 없으면 빈 결과 + 사유를 돌려준다.
    const PET_GROUP = ["pet", "nutty", "ironpet", "saip"];
    let filtered = rows;
    let unsupportedBrand: string | null = null;
    if (brand !== "all") {
      if (BRAND_KEYWORDS[brand]) {
        const keywords = BRAND_KEYWORDS[brand];
        filtered = rows.filter(r => {
          const q = (r.keys?.[0] || "").toLowerCase();
          return keywords.some(kw => q.includes(kw.toLowerCase()));
        });
      } else if (!PET_GROUP.includes(brand)) {
        // 펫 계열이 아닌 브랜드(밸런스랩 등)는 이 속성에 데이터가 없다.
        filtered = [];
        unsupportedBrand = brand;
      }
      // 사입/펫 통합은 별도 키워드 세트가 없어 속성 전체를 그대로 본다(같은 자사몰).
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
      siteUrl: SITE_URL,
      // UI가 "데이터 없음"과 "이 브랜드는 이 속성에 없음"을 구분할 수 있게 사유를 내려준다.
      notice: unsupportedBrand
        ? `${SITE_URL} 속성에는 이 브랜드(${unsupportedBrand})의 검색 데이터가 없습니다. 해당 도메인 GSC 속성 연동이 필요합니다.`
        : null,
    });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("GSC API error:", errMsg);
    return NextResponse.json({ error: "GSC API failed", detail: errMsg }, { status: 500 });
  }
}
