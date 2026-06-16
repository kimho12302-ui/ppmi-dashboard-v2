import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
type Brand = string;

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const brand = (sp.get("brand") || "all") as Brand;
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";

  try {
    // 미래 날짜 데이터 제외 (오늘까지만)
    const today = new Date().toISOString().slice(0, 10);
    const effectiveTo = to && to < today ? to : today;
    let query = supabase.from("content_performance").select("*").gte("date", from).lte("date", effectiveTo).order("date");
    if (brand !== "all") query = query.eq("brand", brand);
    const { data, error } = await query;
    if (error) throw error;
    const rows = data || [];
    // content_type이 '_'로 시작하는 행은 내부 메타(예: _followers 스냅샷) → 유형별/추이 차트에서 제외
    const contentRows = rows.filter((r) => !String(r.content_type || "").startsWith("_"));

    // 주(週) 버킷 = 해당 날짜가 속한 주의 월요일(YYYY-MM-DD).
    // 기존 ceil(일/7)은 매월 29~31일을 가짜 'W5'로 만들고 주 경계가 어긋나 X축을 왜곡했음.
    const weekStart = (dateStr: string): string => {
      const d = new Date(dateStr + "T00:00:00Z");
      if (isNaN(d.getTime())) return dateStr;
      const dow = d.getUTCDay(); // 0=일 .. 6=토
      d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1)); // 그 주 월요일로 정렬
      return d.toISOString().slice(0, 10);
    };

    // By content type — CTR은 노출가중(클릭/노출), 인게이지먼트는 값이 있는 행 평균. 모든 합산 || 0 가드.
    const typeMap = new Map<string, { posts: number; impressions: number; clicks: number; engSum: number; engCount: number }>();
    for (const r of contentRows) {
      const existing = typeMap.get(r.content_type) || { posts: 0, impressions: 0, clicks: 0, engSum: 0, engCount: 0 };
      existing.posts += Number(r.posts) || 0;
      existing.impressions += Number(r.impressions) || 0;
      existing.clicks += Number(r.clicks) || 0;
      const eng = Number(r.engagement) || 0;
      if (eng > 0) { existing.engSum += eng; existing.engCount += 1; }
      typeMap.set(r.content_type, existing);
    }
    const byType = Array.from(typeMap.entries()).map(([content_type, d]) => ({
      content_type, posts: d.posts, impressions: d.impressions, clicks: d.clicks,
      ctr: d.impressions > 0 ? (d.clicks / d.impressions) * 100 : 0,
      engagement: d.engCount > 0 ? d.engSum / d.engCount : 0,
    }));

    // Posts trend by week (월요일 기준 주 버킷)
    const trendMap = new Map<string, Record<string, number>>();
    for (const r of contentRows) {
      const weekKey = weekStart(r.date);
      const existing = trendMap.get(weekKey) || {};
      existing[r.content_type] = (existing[r.content_type] || 0) + (Number(r.posts) || 0);
      trendMap.set(weekKey, existing);
    }
    const postsTrend = Array.from(trendMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({ date, ...d }));

    // Follower trend (주별 최대 스냅샷)
    const followerMap = new Map<string, number>();
    for (const r of rows) {
      const weekKey = weekStart(r.date);
      const current = followerMap.get(weekKey) || 0;
      const f = Number(r.followers) || 0;
      if (f > current) followerMap.set(weekKey, f);
    }
    const followerTrend = Array.from(followerMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, followers]) => ({ date, followers }));

    return NextResponse.json({ byType, postsTrend, followerTrend });
  } catch (error) {
    console.error("Content API error:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
