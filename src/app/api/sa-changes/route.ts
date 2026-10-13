import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/db";

// 밸런스랩 검색광고 직접 조정 이력 + 조정 전·후 성과. 2026-10-13 신설.
//
// 밸런스랩 계정(800812)은 2026-10-12 부터 Claude 가 직접 조정한다. 조정할 때
// settings/search-ads/sa_changes.py 가 sa_change_log 에 남긴다. 여기서는 키워드별로
// 조정 직전 7일과 조정 이후(최대 14일)를 keyword_performance 로 비교해 붙인다.
//
// ★ keyword_performance 에는 기기(PC/MO) 구분이 없다. 같은 키워드의 PC·MO 를 합친 값이다.
//   그래서 전·후 성과는 "키워드" 단위로 한 번만 계산하고 기기별 조정 행이 그걸 공유한다.
// ★ 같은 키워드를 여러 번 조정했으면 기준은 그 키워드의 첫 조정일이다.

const BEFORE_DAYS = 7;
const AFTER_MAX_DAYS = 14;

interface Change {
  id: number; applied_at: string; account: string; campaign: string | null; adgroup: string | null;
  keyword_id: string | null; keyword: string; device: string | null; action: string;
  bid_before: number | null; bid_after: number | null; lock_before: boolean | null; lock_after: boolean | null;
  reason: string | null; review_on: string | null; source_doc: string | null; actor: string | null;
}
interface Perf { impressions: number; clicks: number; cost: number; conversions: number; days: number }

const kstDate = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => {
  const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10);
};

export async function GET(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get("brand") || "balancelab";
  if (brand !== "balancelab" && brand !== "all") {
    return NextResponse.json({ changes: [], note: "직접 조정은 밸런스랩 계정만 한다. 펫 계정은 대행사 집행" });
  }
  try {
    const changes = (await fetchAll(
      supabase.from("sa_change_log").select("*").eq("account", "balancelab").order("applied_at", { ascending: false }),
    )) as Change[];
    if (changes.length === 0) return NextResponse.json({ changes: [], perf: {} });

    // 키워드별 첫 조정일
    const firstDay = new Map<string, string>();
    for (const c of changes) {
      const d = kstDate(c.applied_at);
      const cur = firstDay.get(c.keyword);
      if (!cur || d < cur) firstDay.set(c.keyword, d);
    }
    const today = kstDate(new Date().toISOString());
    const minDay = addDays([...firstDay.values()].sort()[0], -BEFORE_DAYS);

    const kw = (await fetchAll(
      supabase.from("keyword_performance").select("id,date,keyword,impressions,clicks,cost,conversions")
        .eq("brand", "balancelab").gte("date", minDay).in("keyword", [...firstDay.keys()]).order("date"),
    )) as { date: string; keyword: string; impressions: number; clicks: number; cost: number; conversions: number }[];
    const latestData = kw.reduce((m, r) => (r.date > m ? r.date : m), "");

    const perf: Record<string, { before: Perf; after: Perf; changedOn: string; afterUntil: string }> = {};
    for (const [k, d0] of firstDay) {
      const bFrom = addDays(d0, -BEFORE_DAYS), bTo = addDays(d0, -1);
      const aTo = [addDays(d0, AFTER_MAX_DAYS - 1), addDays(today, -1), latestData || d0].sort()[0];
      const z = (): Perf => ({ impressions: 0, clicks: 0, cost: 0, conversions: 0, days: 0 });
      const before = z(), after = z();
      const bDays = new Set<string>(), aDays = new Set<string>();
      for (const r of kw) {
        if (r.keyword !== k) continue;
        const t = r.date >= bFrom && r.date <= bTo ? before : r.date >= d0 && r.date <= aTo ? after : null;
        if (!t) continue;
        t.impressions += Number(r.impressions || 0); t.clicks += Number(r.clicks || 0);
        t.cost += Number(r.cost || 0); t.conversions += Number(r.conversions || 0);
      }
      // 일수는 달력 기준(실적 0 인 날도 그 기간에 포함된다)
      for (let d = bFrom; d <= bTo; d = addDays(d, 1)) bDays.add(d);
      for (let d = d0; d <= aTo; d = addDays(d, 1)) aDays.add(d);
      before.days = bDays.size; after.days = aTo >= d0 ? aDays.size : 0;
      perf[k] = { before, after, changedOn: d0, afterUntil: aTo };
    }

    return NextResponse.json({ changes, perf, today, latestData: latestData || null, beforeDays: BEFORE_DAYS });
  } catch (error) {
    const msg = error instanceof Error ? error.message : (error as { message?: string })?.message || String(error);
    return NextResponse.json({ changes: [], error: msg }, { status: 500 });
  }
}
