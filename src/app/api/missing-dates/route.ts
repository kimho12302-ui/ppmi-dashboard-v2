import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

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
      supabase.from("daily_funnel").select("date, brand, channel").gte("date", from).lte("date", to),
    ]);

    const salesDates = new Set((salesRes.data || []).map((r) => r.date));
    const coupangAdsDates = new Set((adsRes.data || []).filter((r) => r.channel === "coupang_ads").map((r) => r.date));
    const gfaDates = new Set((adsRes.data || []).filter((r) => r.channel === "gfa").map((r) => r.date));
    const metaDates = new Set((adsRes.data || []).filter((r) => r.channel === "meta").map((r) => r.date));
    const googleDates = new Set((adsRes.data || []).filter((r) => r.channel === "google_pmax" || r.channel.startsWith("ga4_")).map((r) => r.date));
    const cafe24Dates = new Set((funnelRes.data || []).filter((r) => r.channel === "cafe24").map((r) => r.date));
    // 기획서 2.7: 스마트스토어 일반(너티/아이언펫/사입) → brand="all", 밸런스랩은 별도
    const ssDates = new Set((funnelRes.data || []).filter((r) => r.channel === "smartstore" && r.brand === "all").map((r) => r.date));
    const coupangFunnelDates = new Set((funnelRes.data || []).filter((r) => r.channel === "coupang").map((r) => r.date));

    const gaps: { date: string; missing: string[] }[] = [];
    const missingSales: string[] = [];
    const missingGfa: string[] = [];
    const missingCafe24: string[] = [];
    const missingSmartstore: string[] = [];
    const missingCoupangFunnel: string[] = [];
    const missingCoupangAds: string[] = [];

    for (const date of days) {
      const missing: string[] = [];
      if (!salesDates.has(date)) { missing.push("판매실적"); missingSales.push(date); }
      if (!metaDates.has(date)) missing.push("메타광고");
      if (!googleDates.has(date)) missing.push("구글광고");
      if (!gfaDates.has(date)) { missing.push("GFA"); missingGfa.push(date); }
      if (!coupangAdsDates.has(date)) { missing.push("쿠팡광고보고서"); missingCoupangAds.push(date); }
      if (!coupangFunnelDates.has(date)) { missing.push("쿠팡퍼널"); missingCoupangFunnel.push(date); }
      if (!cafe24Dates.has(date)) { missing.push("카페24퍼널"); missingCafe24.push(date); }
      if (!ssDates.has(date)) { missing.push("스마트스토어퍼널"); missingSmartstore.push(date); }
      if (missing.length > 0) gaps.push({ date, missing });
    }

    return NextResponse.json({
      gaps,
      coupang_funnel: missingCoupangFunnel,
      coupang_ads: missingCoupangAds,
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
