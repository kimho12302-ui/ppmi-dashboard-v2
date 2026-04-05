import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";

  try {
    const { data, error } = await supabase
      .from("utm_analytics")
      .select("source, medium, sessions, users, new_users")
      .gte("date", from)
      .lte("date", to)
      .order("sessions", { ascending: false });
    if (error) throw error;

    // Aggregate by source/medium
    const agg = new Map<string, { source: string; medium: string; sessions: number; users: number; new_users: number }>();
    for (const r of (data || [])) {
      const key = `${r.source}/${r.medium}`;
      const existing = agg.get(key) || { source: r.source, medium: r.medium, sessions: 0, users: 0, new_users: 0 };
      existing.sessions += r.sessions || 0;
      existing.users += r.users || 0;
      existing.new_users += r.new_users || 0;
      agg.set(key, existing);
    }

    const result = Array.from(agg.values()).sort((a, b) => b.sessions - a.sessions);

    // Campaign-level data
    const { data: campData } = await supabase
      .from("utm_analytics")
      .select("source, medium, campaign, sessions, users, new_users, conversions, revenue, bounce_rate, avg_session_duration")
      .gte("date", from)
      .lte("date", to)
      .order("sessions", { ascending: false });

    const campAgg = new Map<string, { source: string; medium: string; campaign: string; sessions: number; users: number; new_users: number; conversions: number; revenue: number; bounce_rate_sum: number; count: number; avg_duration_sum: number }>();
    for (const r of (campData || [])) {
      const camp = r.campaign || "(직접)";
      const key = `${r.source}/${r.medium}/${camp}`;
      const ex = campAgg.get(key) || { source: r.source, medium: r.medium, campaign: camp, sessions: 0, users: 0, new_users: 0, conversions: 0, revenue: 0, bounce_rate_sum: 0, count: 0, avg_duration_sum: 0 };
      ex.sessions += r.sessions || 0;
      ex.users += r.users || 0;
      ex.new_users += r.new_users || 0;
      ex.conversions += r.conversions || 0;
      ex.revenue += r.revenue || 0;
      ex.bounce_rate_sum += (r.bounce_rate || 0) * (r.sessions || 0);
      ex.avg_duration_sum += (r.avg_session_duration || 0) * (r.sessions || 0);
      ex.count += r.sessions || 0;
      campAgg.set(key, ex);
    }

    const campaigns = Array.from(campAgg.values())
      .map(c => ({
        source: c.source, medium: c.medium, campaign: c.campaign,
        sessions: c.sessions, users: c.users, new_users: c.new_users,
        conversions: c.conversions, revenue: c.revenue,
        bounce_rate: c.count > 0 ? Math.round(c.bounce_rate_sum / c.count * 10) / 10 : 0,
        avg_duration: c.count > 0 ? Math.round(c.avg_duration_sum / c.count) : 0,
      }))
      .filter(c => c.campaign !== "(직접)")
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, 30);

    return NextResponse.json({ data: result, campaigns });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed" }, { status: 500 });
  }
}
