import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
  try {
    const now = new Date(Date.now() + 32400000); // KST
    const days: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().slice(0, 10));
    }

    const from = days[days.length - 1];
    const to = days[0];

    const [salesRes, adsRes, funnelRes] = await Promise.all([
      supabase.from("daily_sales").select("date").gte("date", from).lte("date", to),
      supabase.from("daily_ad_spend").select("date, channel").gte("date", from).lte("date", to),
      supabase.from("daily_funnel").select("date, brand").gte("date", from).lte("date", to),
    ]);

    const salesDates = new Set((salesRes.data || []).map((r) => r.date));
    const adsDates = new Set((adsRes.data || []).map((r) => r.date));
    const cafe24Dates = new Set((funnelRes.data || []).filter((r) => r.brand === "cafe24").map((r) => r.date));
    const ssDates = new Set((funnelRes.data || []).filter((r) => r.brand === "smartstore").map((r) => r.date));
    const coupangFunnelDates = new Set((funnelRes.data || []).filter((r) => r.brand === "coupang").map((r) => r.date));

    const gaps: { date: string; missing: string[] }[] = [];
    const missingSales: string[] = [];
    const missingGfa: string[] = [];
    const missingCafe24: string[] = [];
    const missingSmartstore: string[] = [];
    const missingCoupangItem: string[] = [];

    for (const date of days) {
      const missing: string[] = [];
      if (!salesDates.has(date)) { missing.push("판매실적"); missingSales.push(date); }
      if (!adsDates.has(date)) { missing.push("메타광고", "구글광고", "쿠팡광고", "GFA"); missingGfa.push(date); }
      if (!coupangFunnelDates.has(date)) { missing.push("쿠팡퍼널"); missingCoupangItem.push(date); }
      if (!cafe24Dates.has(date)) { missing.push("카페24퍼널"); missingCafe24.push(date); }
      if (!ssDates.has(date)) { missing.push("스마트스토어퍼널"); missingSmartstore.push(date); }
      if (missing.length > 0) gaps.push({ date, missing });
    }

    return NextResponse.json({
      gaps,
      coupang_item: missingCoupangItem,
      gfa: missingGfa,
      sales: missingSales,
      cafe24: missingCafe24,
      smartstore: missingSmartstore,
    });
  } catch (error) {
    console.error("Missing dates error:", error);
    return NextResponse.json({ gaps: [], coupang_item: [], gfa: [], sales: [], cafe24: [], smartstore: [] });
  }
}
