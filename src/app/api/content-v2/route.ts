import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
type Brand = string;

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const brand = (sp.get("brand") || "all") as Brand;
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";

  try {
    let query = supabase.from("content_performance").select("*").gte("date", from).lte("date", to).order("date");
    if (brand !== "all") query = query.eq("brand", brand);
    const { data, error } = await query;
    if (error) throw error;
    const rows = data || [];

    // By content type
    const typeMap = new Map<string, { posts: number; impressions: number; clicks: number; ctrSum: number; engSum: number; count: number }>();
    for (const r of rows) {
      const existing = typeMap.get(r.content_type) || { posts: 0, impressions: 0, clicks: 0, ctrSum: 0, engSum: 0, count: 0 };
      existing.posts += Number(r.posts);
      existing.impressions += Number(r.impressions);
      existing.clicks += Number(r.clicks);
      existing.ctrSum += Number(r.ctr);
      existing.engSum += Number(r.engagement);
      existing.count += 1;
      typeMap.set(r.content_type, existing);
    }
    const byType = Array.from(typeMap.entries()).map(([content_type, d]) => ({
      content_type, posts: d.posts, impressions: d.impressions, clicks: d.clicks,
      ctr: d.count > 0 ? d.ctrSum / d.count : 0,
      engagement: d.count > 0 ? d.engSum / d.count : 0,
    }));

    // Posts trend by week
    const trendMap = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const weekKey = r.date.slice(0, 7) + "-W" + Math.ceil(Number(r.date.slice(8, 10)) / 7);
      const existing = trendMap.get(weekKey) || {};
      existing[r.content_type] = (existing[r.content_type] || 0) + Number(r.posts);
      trendMap.set(weekKey, existing);
    }
    const postsTrend = Array.from(trendMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({ date, ...d }));

    // Follower trend (max per week)
    const followerMap = new Map<string, number>();
    for (const r of rows) {
      const weekKey = r.date.slice(0, 7) + "-W" + Math.ceil(Number(r.date.slice(8, 10)) / 7);
      const current = followerMap.get(weekKey) || 0;
      if (Number(r.followers) > current) followerMap.set(weekKey, Number(r.followers));
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
