export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/db";
import { expandBrands } from "@/lib/brand-groups";
import { cachedGET } from "@/lib/api-cache";
import { axisEnd, bucketKey } from "@/lib/bucket";
import { MULTIPLE_WEEKS } from "@/lib/judge-charts";

// 네이버 검색광고 캠페인별 주간 추이 (스몰 멀티플용, 2026-11-03).
//
// 선택 기간의 끝(to, 오늘 이후는 오늘) 기준으로 **다 끝난 주**만 MULTIPLE_WEEKS 개 돌려준다.
// 진행 중인 주는 하루이틀치라 "마지막 주 하락" 규칙에 넣으면 모든 캠페인이 하락으로 걸린다. 그래서 뺀다.
// 계정마다 수집이 끝난 날이 다르므로(펫 계정이 하루 늦을 때가 있다) 두 계정 중 늦은 쪽에 맞춘다.
//
// 브랜드 규칙은 /api/naver-campaigns 와 같다. brand='other'(밸런스랩 계정에 얹힌 그룹사 캠페인)는
// 어느 화면에도 넣지 않는다.

const TYPE_LABEL: Record<string, string> = {
  SHOPPING: "쇼핑검색", WEB_SITE: "파워링크", POWER_CONTENTS: "파워컨텐츠",
  BRAND_SEARCH: "브랜드검색", PLACE: "플레이스",
};

interface Row {
  date: string; campaign_id: string; campaign: string | null; campaign_type: string | null;
  brand: string | null; account: string | null; cost: number | null; conversion_value: number | null;
}

const DAY_MS = 86400000;
const shift = (d: string, days: number) => new Date(new Date(d + "T00:00:00Z").getTime() + days * DAY_MS).toISOString().slice(0, 10);

async function getImpl(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const brand = sp.get("brand") || "all";
  const to = sp.get("to") || "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: "to 는 YYYY-MM-DD" }, { status: 400 });
  }

  try {
    const end = axisEnd(to);
    // 넉넉히 13주 + 며칠 앞부터 읽는다. 수집 마감일을 본 뒤 정확한 12주 창으로 자른다.
    const readFrom = shift(bucketKey(end, "week"), -7 * (MULTIPLE_WEEKS + 1));
    let q = supabase.from("naver_campaign_daily")
      .select("date,campaign_id,campaign,campaign_type,brand,account,cost,conversion_value")
      .gte("date", readFrom).lte("date", end).order("date");
    q = brand === "all" ? q.neq("brand", "other") : q.in("brand", expandBrands(brand));
    // 이 테이블엔 id 가 없다. 기본키 (date, campaign_id) 라 date 다음 campaign_id 로 전순서가 된다.
    const rows = (await fetchAll(q, "campaign_id")) as Row[];

    // 계정별 마지막 수집일 → 그중 이른 날까지만 "다 들어온 날"로 본다.
    const lastByAccount = new Map<string, string>();
    for (const r of rows) {
      const a = r.account || "";
      if ((lastByAccount.get(a) || "") < r.date) lastByAccount.set(a, r.date);
    }
    const collectedThrough = Array.from(lastByAccount.values()).sort()[0] || null;
    if (!collectedThrough) {
      return NextResponse.json({ weeks: [], campaigns: [], collectedThrough: null, lastByAccount: {} });
    }
    // 마지막 완료 주 = 일요일이 수집 마감일 이하인 가장 늦은 주.
    const thisWeek = bucketKey(collectedThrough, "week");
    const lastComplete = shift(thisWeek, 6) <= collectedThrough ? thisWeek : shift(thisWeek, -7);
    const weeks = Array.from({ length: MULTIPLE_WEEKS }, (_, i) => shift(lastComplete, -7 * (MULTIPLE_WEEKS - 1 - i)));
    const weekIdx = new Map(weeks.map((w, i) => [w, i]));

    const agg = new Map<string, {
      campaignId: string; campaignName: string; type: string; brand: string; account: string;
      cells: { week: string; cost: number; convValue: number }[];
    }>();
    for (const r of rows) {
      const i = weekIdx.get(bucketKey(r.date, "week"));
      if (i == null) continue;
      let e = agg.get(r.campaign_id);
      if (!e) {
        e = {
          campaignId: r.campaign_id, campaignName: r.campaign || r.campaign_id,
          type: TYPE_LABEL[r.campaign_type || ""] || r.campaign_type || "기타",
          brand: r.brand || "", account: r.account || "",
          // 빈 주는 0 으로 둔다(축 유지). ROAS 는 화면에서 비용 0 인 주를 빈칸으로 바꾼다.
          cells: weeks.map((week) => ({ week, cost: 0, convValue: 0 })),
        };
        agg.set(r.campaign_id, e);
      }
      e.cells[i].cost += Number(r.cost || 0);
      e.cells[i].convValue += Number(r.conversion_value || 0);
      // 이름이 바뀐 캠페인은 최신 이름으로.
      if (r.campaign) e.campaignName = r.campaign;
    }

    const campaigns = Array.from(agg.values())
      .map((c) => ({
        ...c,
        cells: c.cells.map((x) => ({ ...x, cost: Math.round(x.cost), convValue: Math.round(x.convValue) })),
        totalCost: Math.round(c.cells.reduce((s, x) => s + x.cost, 0)),
      }))
      .filter((c) => c.totalCost > 0)
      .sort((a, b) => b.totalCost - a.totalCost);

    return NextResponse.json({ weeks, campaigns, collectedThrough, lastByAccount: Object.fromEntries(lastByAccount) });
  } catch (error) {
    console.error("naver-campaign-weekly error:", error);
    const msg = error instanceof Error ? error.message : (error as { message?: string })?.message || String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// 5분 캐시·쓰기 후 무효화 (src/lib/api-cache.ts)
export const GET = cachedGET(getImpl, ["naver_campaign_daily"], ["brand", "to"]);
