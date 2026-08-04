export const dynamic = "force-dynamic";

import { expandBrands } from "@/lib/brand-groups";
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/db";
import { isGongguInDailySales } from "@/lib/gonggu";

// 목표 대비 페이싱 (통계시트 "광고 예산안" 재현)
// 현재 월에 대해 엔티티별: 날짜진행률 vs 매출/광고비/ROAS/광고비비중 목표·현황·달성률 + 잔여 + 필요 일런레이트
// brand=all 이면 4개 브랜드 목표 합산 + 실적 합산. 특정 brand면 그 브랜드만.

const BRANDS = ["nutty", "ironpet", "saip", "balancelab"];

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
    if (brand !== "all") tQ = tQ.in("brand", expandBrands(brand));
    else tQ = tQ.in("brand", BRANDS);

    // 자체매출만 집계: 공구 채널 제외 (목표 스코프와 일치). 공구는 별도 표시.
    let salesQ = supabase.from("daily_sales").select("date,revenue,orders,brand").gte("date", monthStart).lte("date", monthEnd).neq("channel", "total").not("channel", "like", "공구%");
    if (brand !== "all") salesQ = salesQ.in("brand", expandBrands(brand));
    else salesQ = salesQ.in("brand", BRANDS);

    let adQ = supabase.from("daily_ad_spend").select("date,spend,conversion_value,channel,brand").gte("date", monthStart).lte("date", monthEnd).not("channel", "like", "ga4_%");
    if (brand !== "all") adQ = adQ.in("brand", expandBrands(brand));
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

    // ★ 목표(monthly_targets)는 공구 포함 기준으로 세워져 있다.
    //   근거: 공구가 0이던 2026-02는 목표 6,327,000 = 실적 6,327,000 으로 1원까지 일치.
    //   3월부터 공구가 매출의 66~97%를 차지하는데 실적에서만 공구를 빼서 비교하는 바람에
    //   밸런스랩 달성률이 6월 3%, 7월 7%로 표시됐다(공구 포함 시 13%, 51%).
    //   → 달성률은 공구 포함(Gross) 기준으로 계산하고, 자체매출은 함께 병기한다.
    const grossRevenue = sales.reduce((s, r) => s + Number(r.revenue || 0), 0);
    const actualRevenueOwn = grossRevenue - totalFormA;  // 자체매출 (공구 제외)
    const actualRevenue = grossRevenue;                   // 목표 비교용 = 공구 포함
    const actualOrders = sales.reduce((s, r) => s + Number(r.orders || 0), 0);
    const actualAd = ads.reduce((s, r) => s + Number(r.spend || 0), 0);
    // ROAS는 실매출 ÷ 광고비 기준. 목표(targetRoas = 목표매출/목표광고비)와 같은 정의여야 비교가 성립한다.
    // 채널 conversion_value 합계는 플랫폼마다 같은 주문을 자기 기여로 신고해 실매출을 넘기 때문에
    // 통합 지표로 쓰면 과대 표시된다(2026-07 실측: 합계 5,705만 vs 실매출 4,464만).
    const actualRoas = actualAd > 0 ? actualRevenue / actualAd : 0;
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
      for (const r of sales) revByBrand.set(r.brand, (revByBrand.get(r.brand) || 0) + Number(r.revenue || 0));
      for (const r of ads) {
        adByBrand.set(r.brand, (adByBrand.get(r.brand) || 0) + Number(r.spend || 0));
      }
      perBrand = BRANDS.map((b) => {
        const t = tByBrand.get(b);
        const tRev = Number(t?.revenue_target || 0);
        const tAd = Number(t?.ad_budget_target || 0);
        // 목표가 공구 포함 기준이므로 달성률·ROAS는 공구 포함(aRev)으로 비교하고,
        // 자체매출(aRevOwn)은 병기한다.
        const aRev = revByBrand.get(b) || 0;
        const gonggu = b === "balancelab" ? totalFormA : 0;
        const aRevOwn = aRev - gonggu;

        const aAd = adByBrand.get(b) || 0;
        return {
          brand: b,
          targetRevenue: tRev, actualRevenue: aRev, actualRevenueOwn: aRevOwn, gonggu,
          revAchievement: tRev > 0 ? aRev / tRev : 0,
          targetAd: tAd, actualAd: aAd,
          adConsumption: tAd > 0 ? aAd / tAd : 0,
          actualRoas: aAd > 0 ? aRev / aAd : 0,   // 실매출 기준 (targetRoas와 동일 정의)
          // ★ 광고 성과 판단용: 공구는 광고와 무관하므로 자체매출 기준 ROAS를 병기한다.
          //   밸런스랩 2026-07 실측 — 공구 포함 9.62x(목표 초과)이지만 자체 기준은 1.82x(목표 미달)로
          //   예산 증감 판단이 정반대로 갈린다(2026-08 리뷰).
          actualRoasOwn: aAd > 0 ? aRevOwn / aAd : 0,
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
      actual: { revenue: actualRevenue, revenueOwn: actualRevenueOwn, gonggu: totalFormA, orders: actualOrders, ad: actualAd, roas: actualRoas, adRatio: actualAdRatio },
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
