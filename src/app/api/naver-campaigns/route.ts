import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/db";
import { expandBrands } from "@/lib/brand-groups";
import { cachedGET } from "@/lib/api-cache";

// 네이버 검색광고 캠페인별 성과. 2026-10-13 원천 교체.
//
// 옛 원천은 구글시트 「캠페인_성과」였는데 2026-09 부터 안 채워졌고 캠페인명 글자도 깨져
// 이 탭이 전 브랜드 0건이었다. 지금은 수집기(sync_naver_sa.py 펫 계정, sync_all.py 밸런스랩 계정)가
// 캠페인×일을 naver_campaign_daily 에 쓰고, 여기서 기간 합산한다.
//
// brand='other' 는 밸런스랩 계정에 얹힌 그룹사 캠페인(와이에스환경 등)이다. 어느 브랜드 화면에도,
// 전체에도 넣지 않는다. 광고비 원장(daily_ad_spend)도 이걸 뺀다.

const TYPE_LABEL: Record<string, string> = {
  SHOPPING: "쇼핑검색", WEB_SITE: "파워링크", POWER_CONTENTS: "파워컨텐츠",
  BRAND_SEARCH: "브랜드검색", PLACE: "플레이스",
};

interface Row {
  date: string; campaign_id: string; campaign: string | null; campaign_type: string | null; brand: string | null;
  impressions: number; clicks: number; cost: number; conversions: number; conversion_value: number;
}

async function getImpl(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";
  const brand = sp.get("brand") || "all";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ campaigns: [], summary: null, error: "from·to 는 YYYY-MM-DD" }, { status: 400 });
  }

  try {
    let q = supabase.from("naver_campaign_daily")
      .select("date,campaign_id,campaign,campaign_type,brand,impressions,clicks,cost,conversions,conversion_value")
      .gte("date", from).lte("date", to).order("date");
    q = brand === "all" ? q.neq("brand", "other") : q.in("brand", expandBrands(brand));
    // 이 테이블엔 id 가 없다. 기본키가 (date, campaign_id) 라 date 다음 campaign_id 로 전순서가 된다.
    const rows = (await fetchAll(q, "campaign_id")) as Row[];

    const agg = new Map<string, {
      campaignId: string; campaignName: string; type: string; brand: string;
      impressions: number; clicks: number; cost: number; conversions: number; convValue: number; days: Set<string>;
    }>();
    for (const r of rows) {
      const e = agg.get(r.campaign_id) || {
        campaignId: r.campaign_id, campaignName: r.campaign || r.campaign_id,
        type: TYPE_LABEL[r.campaign_type || ""] || r.campaign_type || "기타", brand: r.brand || "",
        impressions: 0, clicks: 0, cost: 0, conversions: 0, convValue: 0, days: new Set<string>(),
      };
      e.impressions += Number(r.impressions || 0);
      e.clicks += Number(r.clicks || 0);
      e.cost += Number(r.cost || 0);
      e.conversions += Number(r.conversions || 0);
      e.convValue += Number(r.conversion_value || 0);
      if (Number(r.cost || 0) > 0 || Number(r.impressions || 0) > 0) e.days.add(r.date);
      agg.set(r.campaign_id, e);
    }

    const campaigns = Array.from(agg.values()).map((c) => ({
      campaignId: c.campaignId, campaignName: c.campaignName, type: c.type, brand: c.brand,
      impressions: c.impressions, clicks: c.clicks, cost: Math.round(c.cost),
      conversions: c.conversions, convValue: Math.round(c.convValue),
      roas: c.cost > 0 ? c.convValue / c.cost : 0,
      ctr: c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0,
      cpc: c.clicks > 0 ? Math.round(c.cost / c.clicks) : 0,
      days: c.days.size,
    })).filter((c) => c.cost > 0 || c.impressions > 0).sort((a, b) => b.cost - a.cost);

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
    const latest = rows.reduce((m, r) => (r.date > m ? r.date : m), "");

    return NextResponse.json({ campaigns, summary, latestCollected: latest || null });
  } catch (error) {
    console.error("Naver campaigns error:", error);
    const msg = error instanceof Error ? error.message : (error as { message?: string })?.message || String(error);
    return NextResponse.json({ campaigns: [], summary: null, error: msg }, { status: 500 });
  }
}

// 5분 캐시·쓰기 후 무효화 (src/lib/api-cache.ts)
export const GET = cachedGET(getImpl, ["naver_campaign_daily"], ["brand", "from", "to"]);
