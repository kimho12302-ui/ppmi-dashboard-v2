import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { INACTIVE_SOURCE_IDS } from "@/lib/data-sources";

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
    // GFA 는 0원 행도 '입력됨'으로 센다. 자동 수집 경로 네 곳이 전부 0을 건너뛰므로
    // 0원 행 = 사람이 "그날은 집행 0이었다"고 넣은 기록이다. (data-sources.ts 의 countZeroRows 주석 참고)
    const gfaDates = new Set((adsRes.data || []).filter((r) => r.channel === "gfa").map((r) => r.date));
    const metaDates = new Set((adsRes.data || []).filter((r) => r.channel === "meta").map((r) => r.date));
    const googleDates = new Set((adsRes.data || []).filter((r) => r.channel === "google_pmax" || r.channel.startsWith("ga4_")).map((r) => r.date));
    // 카페24 퍼널.
    // ★ 값이 0이어도 brand='all' 행이 있으면 '수집됨'으로 센다.
    //   자사몰은 트래픽이 적어 장바구니·구매가 0인 날이 흔하다. 2026-09 실측: 결측으로
    //   찍힌 12일 전부 행은 있고 값이 0이었는데, **같은 날 카페24 주문도 0** 이었다.
    //   즉 수집은 됐고 그날이 진짜 0이었다. 값>0 으로 재면 한가한 날마다 '미입력'이 뜨고,
    //   그 소음이 진짜 결측을 묻는다(GFA 에서 먼저 겪은 것과 같은 문제).
    //   ※ 쿠팡 퍼널에는 같은 완화를 하지 않았다. 거기 0 은 주문이 있는데도 0이라 틀린 값이었다.
    //     0 을 인정할지는 '같은 날 주문이 있었나'로 갈린다. 원천마다 따로 판단한다.
    const cafe24Dates = new Set(
      (funnelRes.data || []).filter((r) => r.channel === "cafe24" && r.brand === "all").map((r) => r.date)
    );
    // 기획서 2.7: 스마트스토어 일반(너티/아이언펫/사입) → brand="all", 밸런스랩은 별도
    const ssDates = new Set(
      (funnelRes.data || []).filter((r) => r.channel === "smartstore" && r.brand === "all" && hasVal(r, ["sessions", "subscribers", "repurchases"])).map((r) => r.date)
    );
    const coupangFunnelDates = new Set(
      (funnelRes.data || []).filter((r) => r.channel === "coupang" && hasVal(r, ["sessions", "impressions", "cart_adds", "purchases"])).map((r) => r.date)
    );

    // ★ 운영을 멈춘 소스는 결측으로 세지 않는다.
    //   data-status 는 INACTIVE_SOURCES 를 보고 '미운영'으로 표시하는데 이 라우트는 몰라서,
    //   2026-05-14 에 끈 구글 광고가 30일 내내 "구글광고 미입력"으로 찍혔다(2026-09-15 확인).
    //   같은 원장을 두 화면이 따로 해석하던 문제다. 이제 한쪽만 고치면 양쪽이 같이 움직인다.
    const off = (sourceId: string) => INACTIVE_SOURCE_IDS.has(sourceId);
    // GFA 는 이 라우트가 브랜드를 구분하지 않는다(channel=gfa 통합). 세 브랜드가 전부
    // 미운영일 때만 건너뛴다. 하나라도 집행 중이면 결측 판정은 살아 있어야 한다.
    const gfaAllOff = off("gfa_nutty") && off("gfa_saip") && off("gfa_balancelab");

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
      if (!off("meta_ads") && !metaDates.has(date)) missing.push("메타광고");
      if (!off("google_ads") && !googleDates.has(date)) missing.push("구글광고");
      if (!gfaAllOff && !gfaDates.has(date)) { missing.push("GFA"); missingGfa.push(date); }
      if (!off("coupang_ads") && !coupangAdsDates.has(date)) { missing.push("쿠팡광고보고서"); missingCoupangAds.push(date); }
      if (!off("coupang_funnel") && !coupangFunnelDates.has(date)) { missing.push("쿠팡퍼널"); missingCoupangFunnel.push(date); }
      if (!off("cafe24_funnel") && !cafe24Dates.has(date)) { missing.push("카페24퍼널"); missingCafe24.push(date); }
      if (!off("smartstore_ironpet") && !ssDates.has(date)) { missing.push("스마트스토어퍼널"); missingSmartstore.push(date); }
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
    // fail-closed: 빈 gap 배열을 200으로 주면 "결측 없음"으로 읽힌다(2026-08 수정).
    return NextResponse.json({ error: "미입력 날짜를 불러오지 못했습니다" }, { status: 500 });
  }
}
