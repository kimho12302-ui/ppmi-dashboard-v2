export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { isGongguInDailySales } from "@/lib/gonggu";

// 목표 대비 페이싱 (통계시트 "광고 예산안" 재현)
// 현재 월에 대해 엔티티별: 날짜진행률 vs 매출/광고비/ROAS/광고비비중 목표·현황·달성률 + 잔여 + 필요 일런레이트
// brand=all 이면 4개 브랜드 목표 합산 + 실적 합산. 특정 brand면 그 브랜드만.

const BRANDS = ["nutty", "ironpet", "saip", "balancelab"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAll(q: any): Promise<any[]> {
  const PAGE = 1000;
  let from = 0;
  const all: unknown[] = [];
  while (true) {
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) break;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const brand = sp.get("brand") || "all";
  // 현재 월(KST) 기본
  const nowKst = new Date(Date.now() + 32400000);
  const month = sp.get("month") || nowKst.toISOString().slice(0, 7);

  try {
    const [yy, mm] = month.split("-").map(Number);
    const daysInMonth = new Date(yy, mm, 0).getDate();
    const monthStart = `${month}-01`;
    const monthEnd = `${month}-${String(daysInMonth).padStart(2, "0")}`;
    const todayStr = nowKst.toISOString().slice(0, 10);

    // 경과일: 이번 달이면 오늘까지, 과거 달이면 전체, 미래 달이면 0
    let daysElapsed: number;
    if (todayStr < monthStart) daysElapsed = 0;
    else if (todayStr > monthEnd) daysElapsed = daysInMonth;
    else daysElapsed = Number(todayStr.slice(8, 10));
    const daysRemaining = Math.max(0, daysInMonth - daysElapsed);
    const dateProgress = daysInMonth > 0 ? daysElapsed / daysInMonth : 0;

    // 쿼리 빌드 (목표/매출/광고 — 모두 독립 → 병렬)
    let tQ = supabase.from("monthly_targets").select("brand,revenue_target,ad_budget_target,roas_target").eq("month", month);
    if (brand !== "all") tQ = tQ.eq("brand", brand);
    else tQ = tQ.in("brand", BRANDS);

    // 자체매출만 집계: 공구 채널 제외 (목표 스코프와 일치). 공구는 별도 표시.
    let salesQ = supabase.from("daily_sales").select("date,revenue,orders,brand").gte("date", monthStart).lte("date", monthEnd).neq("channel", "total").not("channel", "like", "공구%");
    if (brand !== "all") salesQ = salesQ.eq("brand", brand);
    else salesQ = salesQ.in("brand", BRANDS);

    let adQ = supabase.from("daily_ad_spend").select("date,spend,conversion_value,channel,brand").gte("date", monthStart).lte("date", monthEnd).not("channel", "like", "ga4_%");
    if (brand !== "all") adQ = adQ.eq("brand", brand);
    else adQ = adQ.in("brand", BRANDS);

    // 밸런스랩: daily_sales smartstore 에 형식-A 공구(셀러가 스마트스토어로 판 공구)가 섞여 있어
    // 자체매출이 부풀려진다. product_sales 에서 형식-A 공구를 날짜별로 구해 차감.
    const needGonggu = brand === "balancelab" || brand === "all";
    const psQ = supabase.from("product_sales").select("date,channel,lineup,product,revenue").gte("date", monthStart).lte("date", monthEnd).eq("brand", "balancelab");

    // 1회 병렬 배치 (이전: 순차 3회)
    const [targetsRes, sales, ads, psRows] = await Promise.all([
      tQ, fetchAll(salesQ), fetchAll(adQ),
      needGonggu ? fetchAll(psQ) : Promise.resolve([] as unknown[]),
    ]);
    const targetsData = targetsRes.data;

    // 형식-A 공구 날짜별 차감액 (밸런스랩)
    const formAByDate = new Map<string, number>();
    for (const r of psRows as { date: string; channel: string; lineup: string | null; product: string; revenue: number }[]) {
      if (isGongguInDailySales(r)) formAByDate.set(r.date, (formAByDate.get(r.date) || 0) + Number(r.revenue || 0));
    }
    const totalFormA = [...formAByDate.values()].reduce((s, v) => s + v, 0);
    const targetRevenue = (targetsData || []).reduce((s, r) => s + Number(r.revenue_target || 0), 0);
    const targetAd = (targetsData || []).reduce((s, r) => s + Number(r.ad_budget_target || 0), 0);
    // ROAS 목표: 가중(목표매출/목표광고비). 광고비비중 목표 = 목표광고비/목표매출.
    const targetRoas = targetAd > 0 ? targetRevenue / targetAd : 0;
    const targetAdRatio = targetRevenue > 0 ? targetAd / targetRevenue : 0;

    const actualRevenue = sales.reduce((s, r) => s + Number(r.revenue || 0), 0) - totalFormA;
    const actualOrders = sales.reduce((s, r) => s + Number(r.orders || 0), 0);
    const actualAd = ads.reduce((s, r) => s + Number(r.spend || 0), 0);
    const actualConvValue = ads.reduce((s, r) => s + Number(r.conversion_value || 0), 0);
    const actualRoas = actualAd > 0 ? actualConvValue / actualAd : 0;
    const actualAdRatio = actualRevenue > 0 ? actualAd / actualRevenue : 0;

    // 잔여 + 필요 일런레이트
    const remainingRevenue = Math.max(0, targetRevenue - actualRevenue);
    const remainingAd = targetAd - actualAd; // 음수면 예산 초과
    const reqDailyRevenue = daysRemaining > 0 ? remainingRevenue / daysRemaining : 0;
    const reqDailyAd = daysRemaining > 0 ? Math.max(0, remainingAd) / daysRemaining : 0;
    const dailyAvgRevenue = daysElapsed > 0 ? actualRevenue / daysElapsed : 0;
    const dailyAvgAd = daysElapsed > 0 ? actualAd / daysElapsed : 0;

    const revAchievement = targetRevenue > 0 ? actualRevenue / targetRevenue : 0;
    const adConsumption = targetAd > 0 ? actualAd / targetAd : 0;
    const roasAchievement = targetRoas > 0 ? actualRoas / targetRoas : 0;

    // 페이스 판정: 매출 달성률 vs 날짜진행률
    // ahead = 달성률 > 진행률*1.0, behind = 달성률 < 진행률*0.9
    let paceStatus: "ahead" | "on_track" | "behind" | "n/a" = "n/a";
    if (daysElapsed > 0 && targetRevenue > 0) {
      if (revAchievement >= dateProgress) paceStatus = "ahead";
      else if (revAchievement >= dateProgress * 0.9) paceStatus = "on_track";
      else paceStatus = "behind";
    }

    // 전체(all)일 때 브랜드별 미니 페이싱도 제공
    let perBrand: unknown[] = [];
    if (brand === "all") {
      const tByBrand = new Map((targetsData || []).map((r) => [r.brand as string, r]));
      const revByBrand = new Map<string, number>();
      const adByBrand = new Map<string, number>();
      const cvByBrand = new Map<string, number>();
      for (const r of sales) revByBrand.set(r.brand, (revByBrand.get(r.brand) || 0) + Number(r.revenue || 0));
      for (const r of ads) {
        adByBrand.set(r.brand, (adByBrand.get(r.brand) || 0) + Number(r.spend || 0));
        cvByBrand.set(r.brand, (cvByBrand.get(r.brand) || 0) + Number(r.conversion_value || 0));
      }
      perBrand = BRANDS.map((b) => {
        const t = tByBrand.get(b);
        const tRev = Number(t?.revenue_target || 0);
        const tAd = Number(t?.ad_budget_target || 0);
        const aRev = (revByBrand.get(b) || 0) - (b === "balancelab" ? totalFormA : 0); // 형식-A 공구 차감

        const aAd = adByBrand.get(b) || 0;
        const aCv = cvByBrand.get(b) || 0;
        return {
          brand: b,
          targetRevenue: tRev, actualRevenue: aRev,
          revAchievement: tRev > 0 ? aRev / tRev : 0,
          targetAd: tAd, actualAd: aAd,
          adConsumption: tAd > 0 ? aAd / tAd : 0,
          actualRoas: aAd > 0 ? aCv / aAd : 0,
          targetRoas: tAd > 0 ? tRev / tAd : 0,
          actualAdRatio: aRev > 0 ? aAd / aRev : 0,
          targetAdRatio: tRev > 0 ? tAd / tRev : 0,
        };
      });
    }

    // 주차별 목표 대비 실적 (광고예산안 주차 재현: w1=1~7, w2=8~14, ... w5=29~말일)
    // 주차 목표 = 월 목표 × (주차 일수 / 월 일수)
    const weekDefs = [
      { w: "w1", s: 1, e: 7 }, { w: "w2", s: 8, e: 14 }, { w: "w3", s: 15, e: 21 },
      { w: "w4", s: 22, e: 28 }, { w: "w5", s: 29, e: daysInMonth },
    ].filter((d) => d.s <= daysInMonth);
    const weekly = weekDefs.map(({ w, s, e }) => {
      const end = Math.min(e, daysInMonth);
      const wDays = end - s + 1;
      const inWeek = (dateStr: string) => { const d = Number(dateStr.slice(8, 10)); return d >= s && d <= end; };
      let wFormA = 0; formAByDate.forEach((v, d) => { if (inWeek(d)) wFormA += v; });
      const wRev = sales.filter((r) => inWeek(r.date)).reduce((acc, r) => acc + Number(r.revenue || 0), 0) - wFormA;
      const wAd = ads.filter((r) => inWeek(r.date)).reduce((acc, r) => acc + Number(r.spend || 0), 0);
      const wTargetRev = targetRevenue * (wDays / daysInMonth);
      const wTargetAd = targetAd * (wDays / daysInMonth);
      const isPast = todayStr.slice(0, 7) > month || (todayStr.slice(0, 7) === month && Number(todayStr.slice(8, 10)) > end);
      const isCurrent = todayStr.slice(0, 7) === month && Number(todayStr.slice(8, 10)) >= s && Number(todayStr.slice(8, 10)) <= end;
      return {
        week: w, days: wDays, startDay: s, endDay: end,
        targetRevenue: Math.round(wTargetRev), actualRevenue: wRev,
        revAchievement: wTargetRev > 0 ? wRev / wTargetRev : 0,
        targetAd: Math.round(wTargetAd), actualAd: wAd,
        adRatio: wRev > 0 ? wAd / wRev : 0,
        state: isPast ? "past" : isCurrent ? "current" : "future",
      };
    });

    return NextResponse.json({
      month, brand,
      daysInMonth, daysElapsed, daysRemaining, dateProgress,
      weekly,
      hasTarget: (targetsData || []).length > 0 && targetRevenue > 0,
      target: { revenue: targetRevenue, ad: targetAd, roas: targetRoas, adRatio: targetAdRatio },
      actual: { revenue: actualRevenue, orders: actualOrders, ad: actualAd, roas: actualRoas, adRatio: actualAdRatio },
      achievement: { revenue: revAchievement, ad: adConsumption, roas: roasAchievement },
      remaining: { revenue: remainingRevenue, ad: remainingAd, reqDailyRevenue, reqDailyAd, dailyAvgRevenue, dailyAvgAd },
      paceStatus,
      perBrand,
    });
  } catch (error) {
    console.error("Pacing API error:", error);
    return NextResponse.json({ error: "Failed to fetch pacing" }, { status: 500 });
  }
}
