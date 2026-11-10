export const dynamic = "force-dynamic";

import { expandBrands, PET_BRANDS } from "@/lib/brand-groups";
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/db";
import { formAByDateChannel, subtractFormAGonggu } from "@/lib/gonggu";
import { cachedGET } from "@/lib/api-cache";
import { kstDate, kstMonth } from "@/lib/date";

// 목표 대비 페이싱 (통계시트 "광고 예산안" 재현)
// 현재 월에 대해 엔티티별: 날짜진행률 vs 매출/광고비/ROAS/광고비비중 목표·현황·달성률 + 잔여 + 필요 일런레이트
// brand=all 이면 4개 브랜드 목표 합산 + 실적 합산. 특정 brand면 그 브랜드만.

const BRANDS = ["nutty", "ironpet", "saip", "balancelab"];

/**
 * 이 일수보다 판매가 들어온 날이 적으면 "달성 가능/불가" 판정을 하지 않는다(2026-11-03).
 * 3일치 일평균으로 한 달을 내다보면 하루 공구·주말 하나에 결론이 뒤집힌다.
 */
const PACING_MIN_DAYS = 7;

/** 원장 마지막 날짜(KST 날짜 문자열)가 이 달 안에서 며칠째까지인지. 이 달 이전이면 0, 이후면 말일. */
function coveredDays(lastDate: string | null, monthStart: string, monthEnd: string, daysInMonth: number): number {
  if (!lastDate || lastDate < monthStart) return 0;
  if (lastDate > monthEnd) return daysInMonth;
  return Number(lastDate.slice(8, 10));
}

async function getImpl(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const brand = sp.get("brand") || "all";
  // 현재 월(KST) 기본
  const month = sp.get("month") || kstMonth();

  try {
    const [yy, mm] = month.split("-").map(Number);
    const daysInMonth = new Date(yy, mm, 0).getDate();
    const monthStart = `${month}-01`;
    const monthEnd = `${month}-${String(daysInMonth).padStart(2, "0")}`;
    const todayStr = kstDate();

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
    let salesQ = supabase.from("daily_sales").select("date,revenue,orders,brand,channel").gte("date", monthStart).lte("date", monthEnd).neq("channel", "total").not("channel", "like", "공구%");
    if (brand !== "all") salesQ = salesQ.in("brand", expandBrands(brand));
    else salesQ = salesQ.in("brand", BRANDS);

    let adQ = supabase.from("daily_ad_spend").select("date,spend,conversion_value,channel,brand").gte("date", monthStart).lte("date", monthEnd).not("channel", "like", "ga4_%");
    if (brand !== "all") adQ = adQ.in("brand", expandBrands(brand));
    else adQ = adQ.in("brand", BRANDS);

    // 밸런스랩: daily_sales smartstore 에 형식-A 공구(셀러가 스마트스토어로 판 공구)가 섞여 있어
    // 자체매출이 부풀려진다. product_sales 에서 형식-A 공구를 날짜별로 구해 차감.
    const needGonggu = brand === "balancelab" || brand === "all";
    const psQ = supabase.from("product_sales").select("date,channel,lineup,product,revenue").gte("date", monthStart).lte("date", monthEnd).eq("brand", "balancelab");

    // ★ 원장이 어디까지 들어왔는지(2026-11-03). 판매 동기화는 며칠 늦다. 오늘·어제가 비어 있는 건
    //   "안 팔렸다"가 아니라 "아직 안 들어왔다"라서, 실적 일평균을 달력 경과일로 나누면 과소 계산된다
    //   (11-03 실측: 판매는 11-02까지인데 3일로 나눠 일평균 147만 → 실제 220만).
    //   하루치가 한 번에 써지므로 브랜드 필터와 무관하게 전체 최대 날짜로 본다(/api/funnel-control 과 같은 방식).
    //   오늘은 넣지 않는다. 광고비는 오늘 행이 장중에 일부만 들어와 있어(11-03 실측: 메타·네이버 일부) 하루로 세면 일평균이 깎인다.
    const salesLastQ = supabase.from("daily_sales").select("date").neq("channel", "total").lt("date", todayStr)
      .order("date", { ascending: false }).limit(1);
    const adLastQ = supabase.from("daily_ad_spend").select("date").not("channel", "like", "ga4_%").lt("date", todayStr)
      .order("date", { ascending: false }).limit(1);

    // 1회 병렬 배치
    const [targetsRes, sales, ads, psRows, salesLastRes, adLastRes] = await Promise.all([
      tQ, fetchAll(salesQ), fetchAll(adQ),
      needGonggu ? fetchAll(psQ) : Promise.resolve([] as unknown[]),
      salesLastQ, adLastQ,
    ]);
    const targetsData = targetsRes.data;
    if (salesLastRes.error) throw salesLastRes.error;
    if (adLastRes.error) throw adLastRes.error;
    const salesThrough: string | null = salesLastRes.data?.[0]?.date ?? null;
    const adThrough: string | null = adLastRes.data?.[0]?.date ?? null;
    // 판매·광고비가 들어온 날 수(이 달 1일부터 원장 마지막 날까지). 일평균의 분모.
    const salesDays = coveredDays(salesThrough, monthStart, monthEnd, daysInMonth);
    const adDays = coveredDays(adThrough, monthStart, monthEnd, daysInMonth);

    // 형식-A 공구를 뺀 자체매출 행 (밸런스랩). 공구 행과 날짜·판매처가 같은 매출 행에서만 뺀다
    // (gonggu.ts subtractFormAGonggu, 오버뷰·판매처 성과와 같은 함수). 공구 금액 = 실제로 빠진 금액.
    const ownSales = subtractFormAGonggu(
      sales as { date: string; brand: string; channel: string; revenue: number; orders: number }[],
      formAByDateChannel(psRows as { date: string; channel: string; lineup: string | null; product: string; revenue: number }[]),
    );
    const sumRev = (rows: readonly { revenue: number | string | null }[]) => rows.reduce((s, r) => s + Number(r.revenue || 0), 0);
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
    const grossRevenue = sumRev(sales);
    const actualRevenueOwn = sumRev(ownSales);           // 자체매출 (공구 제외)
    const totalFormA = grossRevenue - actualRevenueOwn;  // 빠진 공구 금액
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
    // 남은 날 = 아직 실적이 안 들어온 날(오늘·동기화 대기일 포함). 실적 일평균 = 들어온 날 수로 나눈 값.
    const salesDaysRemaining = Math.max(0, daysInMonth - salesDays);
    const adDaysRemaining = Math.max(0, daysInMonth - adDays);
    const reqDailyRevenue = salesDaysRemaining > 0 ? remainingRevenue / salesDaysRemaining : 0;
    const reqDailyAd = adDaysRemaining > 0 ? Math.max(0, remainingAd) / adDaysRemaining : 0;
    // 일평균의 분자도 같은 날까지만 더한다(오늘 장중 행 제외).
    const revenueThrough = salesThrough ? sales.filter((r) => r.date <= salesThrough).reduce((s, r) => s + Number(r.revenue || 0), 0) : 0;
    const adThroughSum = adThrough ? ads.filter((r) => r.date <= adThrough).reduce((s, r) => s + Number(r.spend || 0), 0) : 0;
    const dailyAvgRevenue = salesDays > 0 ? revenueThrough / salesDays : 0;
    const dailyAvgAd = adDays > 0 ? adThroughSum / adDays : 0;
    // 기준선(마커)도 들어온 날 기준. 달력 진행률과 비교하면 동기화 지연만큼 늘 뒤처져 보인다.
    const salesProgress = daysInMonth > 0 ? salesDays / daysInMonth : 0;
    const adProgress = daysInMonth > 0 ? adDays / daysInMonth : 0;
    // 판매가 PACING_MIN_DAYS 일 미만 들어온 달은 판정하지 않는다(초반이라 판단 보류).
    const early = salesDays < PACING_MIN_DAYS && salesDays < daysInMonth;

    const revAchievement = targetRevenue > 0 ? actualRevenue / targetRevenue : 0;
    const adConsumption = targetAd > 0 ? actualAd / targetAd : 0;
    const roasAchievement = targetRoas > 0 ? actualRoas / targetRoas : 0;

    // 페이스 판정: 매출 달성률 vs 판매가 들어온 날 기준 진행률
    // ahead = 달성률 > 진행률*1.0, behind = 달성률 < 진행률*0.9. 초반(early)이면 판정하지 않는다.
    let paceStatus: "ahead" | "on_track" | "behind" | "early" | "n/a" = "n/a";
    if (salesDays > 0 && targetRevenue > 0) {
      if (early) paceStatus = "early";
      else if (revAchievement >= salesProgress) paceStatus = "ahead";
      else if (revAchievement >= salesProgress * 0.9) paceStatus = "on_track";
      else paceStatus = "behind";
    }

    // 묶음 보기(전체·펫)일 때 브랜드별 미니 페이싱도 제공.
    // 펫을 고르면 펫 3개 브랜드로 펴야 한다. 전엔 all 에서만 계산해 펫에선 칸이 비었다(2026-10-13).
    let perBrand: unknown[] = [];
    const memberBrands = brand === "all" ? BRANDS : brand === "pet" ? PET_BRANDS : [];
    if (memberBrands.length > 0) {
      const tByBrand = new Map((targetsData || []).map((r) => [r.brand as string, r]));
      const revByBrand = new Map<string, number>();
      const adByBrand = new Map<string, number>();
      for (const r of sales) revByBrand.set(r.brand, (revByBrand.get(r.brand) || 0) + Number(r.revenue || 0));
      for (const r of ads) {
        adByBrand.set(r.brand, (adByBrand.get(r.brand) || 0) + Number(r.spend || 0));
      }
      perBrand = memberBrands.map((b) => {
        const t = tByBrand.get(b);
        const tRev = Number(t?.revenue_target || 0);
        const tAd = Number(t?.ad_budget_target || 0);
        // 목표가 공구 포함 기준이므로 달성률·ROAS는 공구 포함(aRev)으로 비교하고,
        // 자체매출(aRevOwn)은 병기한다.
        const aRev = revByBrand.get(b) || 0;
        const aRevOwn = sumRev(ownSales.filter((r) => r.brand === b));
        const gonggu = aRev - aRevOwn;

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
      const wRev = sumRev(ownSales.filter((r) => inWeek(r.date)));
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
      // daysElapsed·dateProgress 는 달력 기준(예산 현황 화면이 쓴다). 실적 판단은 아래 salesDays·adDays 기준.
      daysInMonth, daysElapsed, daysRemaining, dateProgress,
      salesThrough, adThrough, salesDays, adDays, salesProgress, adProgress,
      salesDaysRemaining, adDaysRemaining, minJudgeDays: PACING_MIN_DAYS,
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

// 5분 캐시·쓰기 후 무효화 (src/lib/api-cache.ts)
export const GET = cachedGET(getImpl, ["daily_ad_spend", "daily_sales", "monthly_targets", "product_sales"], ["brand", "month"]);
