import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// 조회 창. 7일이면 그보다 오래된 공백(2026-07 카페24·스마트스토어는 20일)이 화면에서 잘려
// 실제보다 작아 보인다. 한 달치를 본다.
const LOOKBACK_DAYS = 30;

export async function GET() {
  try {
    const now = new Date(Date.now() + 32400000); // KST
    const days: string[] = [];
    for (let i = 0; i < LOOKBACK_DAYS; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().slice(0, 10));
    }

    const from = days[days.length - 1];
    const to = days[0];

    const [salesRes, adsRes, funnelRes] = await Promise.all([
      supabase.from("daily_sales").select("date").gte("date", from).lte("date", to),
      supabase.from("daily_ad_spend").select("date, channel, spend").gte("date", from).lte("date", to),
      supabase
        .from("daily_funnel")
        .select("date, brand, channel, sessions, impressions, cart_adds, purchases, repurchases, subscribers")
        .gte("date", from)
        .lte("date", to),
    ]);

    // ★ '행이 있으면 입력됨'으로 세면 안 된다. 쿠팡 퍼널 업로드가 빈 날짜까지 0으로 채워 행을 만들기 때문에
    //   실제로는 값이 전무한 날짜가 누락 목록에서 빠졌다(2026-07-29 확인). 값의 존재로 판정한다.
    const hasVal = (r: Record<string, unknown>, cols: string[]) => cols.some((c) => Number(r[c] ?? 0) > 0);

    const salesDates = new Set((salesRes.data || []).map((r) => r.date));
    const coupangAdsDates = new Set((adsRes.data || []).filter((r) => r.channel === "coupang_ads" && Number(r.spend ?? 0) > 0).map((r) => r.date));
    const gfaDates = new Set((adsRes.data || []).filter((r) => r.channel === "gfa" && Number(r.spend ?? 0) > 0).map((r) => r.date));
    const metaDates = new Set((adsRes.data || []).filter((r) => r.channel === "meta").map((r) => r.date));
    const googleDates = new Set((adsRes.data || []).filter((r) => r.channel === "google_pmax" || r.channel.startsWith("ga4_")).map((r) => r.date));
    // 카페24 퍼널: GA4 자동수집과 수기입력이 같은 행(cafe24) — 수기 전용 필드에 값이 있어야 입력된 것
    const cafe24Dates = new Set(
      (funnelRes.data || []).filter((r) => r.channel === "cafe24" && hasVal(r, ["cart_adds", "purchases", "repurchases"])).map((r) => r.date)
    );
    // 기획서 2.7: 스마트스토어 일반(너티/아이언펫/사입) → brand="all", 밸런스랩은 별도
    const ssDates = new Set(
      (funnelRes.data || []).filter((r) => r.channel === "smartstore" && r.brand === "all" && hasVal(r, ["sessions", "subscribers", "repurchases"])).map((r) => r.date)
    );
    const coupangFunnelDates = new Set(
      (funnelRes.data || []).filter((r) => r.channel === "coupang" && hasVal(r, ["sessions", "impressions", "cart_adds", "purchases"])).map((r) => r.date)
    );

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
