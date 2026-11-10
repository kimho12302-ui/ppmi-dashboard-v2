export const dynamic = "force-dynamic";

import { expandBrands } from "@/lib/brand-groups";
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/db";
import { tryRpc } from "@/lib/summary-rpc";

/** monthly_summary_parts 응답. 각 행은 묶인 원본의 합계이고 n 은 묶인 원본 행 수. */
interface MonthlyParts {
  sales: { month: string; revenue: number; orders: number; n: number }[];
  ads: { month: string; channel: string; spend: number; conversion_value: number; n: number }[];
  gonggu: { month: string; channel: string; lineup: string | null; product: string; revenue: number; n: number }[];
  cogs: { month: string; product: string; brand: string; channel: string; lineup: string | null; quantity: number; n: number }[];
}
import { isGongguInDailySales, formAByDateChannel } from "@/lib/gonggu";
import { kstDate, kstNow } from "@/lib/date";
import { cachedGET, NO_CACHE_HEADER } from "@/lib/api-cache";
import { fetchSalesThrough } from "@/lib/sales-through";

// Supabase anon key has max-rows=1000 per request. Use pagination to fetch all rows.
async function getImpl(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const brand = sp.get("brand") || "all";
  const year = sp.get("year") || kstNow().getUTCFullYear().toString();

  try {
    // Get all sales data for the year (미래 날짜는 제외: 미래 시드/플레이스홀더가 YTD·월별 왜곡)
    const fromDate = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;
    // ★ KST 기준. UTC 로 계산하면 KST 00:00~09:00 사이에 "오늘"이 전날이 되어
    //   오늘 데이터가 잘리고, 같은 시간대 pacing(KST 적용)과 이번 달 매출이 어긋났다.
    const todayStr = kstDate();
    const toDate = yearEnd < todayStr ? yearEnd : todayStr;

    // ★ 아래 조회 6개는 서로 기다릴 이유가 없어 한 번에 동시에 보낸다(2026-10-14 속도 개선).
    //   예전엔 7번을 차례로 기다려 다시 열어도 0.76~1.06초가 걸렸다. 조건·컬럼은 그대로다.

    // 자체매출만 집계: 공구(공동구매) 채널 제외. 공구는 별도 섹션에서만 표시.
    let salesQ = supabase.from("daily_sales").select("date,revenue,orders").gte("date", fromDate).lte("date", toDate).neq("channel", "total").not("channel", "like", "공구%");
    if (brand !== "all") { salesQ = salesQ.in("brand", expandBrands(brand)); }
    else { salesQ = salesQ.neq("brand", "all"); }

    let adQ = supabase.from("daily_ad_spend").select("date,channel,spend,conversion_value").gte("date", fromDate).lte("date", toDate).not("channel", "like", "ga4_%");
    if (brand !== "all") { adQ = adQ.in("brand", expandBrands(brand)); }
    else { adQ = adQ.neq("brand", "all"); }

    // Fetch misc costs (dashboard API와 동일 테이블 사용: misc_costs)
    let miscQ = supabase.from("misc_costs").select("date,brand,amount").gte("date", fromDate).lte("date", toDate);
    if (brand !== "all") miscQ = miscQ.in("brand", expandBrands(brand));

    // Fetch shipping costs (dashboard API와 동일 테이블 사용: shipping_costs)
    let shipQ = supabase.from("shipping_costs").select("month,brand,total_cost").gte("month", fromDate.slice(0, 7)).lte("month", toDate.slice(0, 7));
    if (brand !== "all") shipQ = shipQ.in("brand", expandBrands(brand));

    // 공구 매출은 자체매출 집계에서 제외 (사용자 결정 2026-06-10: 자체만 합산, 공구 별도 표시).
    // 형식-A 공구(셀러가 smartstore로 판 공구)는 daily_sales에 smartstore로 섞여 channel 필터로 못 걸러짐
    // → product_sales(lineup 보유)에서 월별로 구해 차감.
    const needGonggu = brand === "balancelab" || brand === "all";

    // Fetch product_sales for COGS matching
    let cogsProdQ = supabase.from("product_sales").select("date,product,brand,quantity,channel,lineup").gte("date", fromDate).lte("date", toDate);
    if (brand !== "all") cogsProdQ = cogsProdQ.in("brand", expandBrands(brand));

    // ★ DB 합산 함수가 있으면 원본 행 네 묶음(매출·광고비·공구·원가)을 월 단위 합계로 한 번에 받는다
    //   (2026-10-14). 필터·묶는 칸은 아래 옛 경로와 같고 날짜는 그 달 1일로 바꿔 아래 계산을 그대로 탄다.
    //   함수가 없으면(SQL 실행 전) 옛 경로. 대조: scripts/verify-summary-rpc.mjs
    const brandsParam = brand !== "all" ? expandBrands(brand) : null;

    // ★ 비율(ROAS·MER·광고비중·CAC)용 꼬리 광고비(QA 3회차, 2026-11-10).
    //   판매 원장은 며칠 늦게 들어오는데 광고비는 그날그날 들어온다. 판매 원장 마지막 날 뒤의 광고비까지
    //   그 달 광고비로 나누면 진행 중인 달 ROAS 가 낮게 나온다(페이싱·판매처 카드와 같은 종류).
    //   DB 합산 함수 경로는 광고비가 달 합계라 날짜로 못 자르므로, 최근 날짜의 광고비만 일 단위로 따로 받아
    //   판매 원장 마지막 날 뒤의 금액(꼬리)을 그 달 비율의 분모에서 뺀다. 조건은 위 adQ 와 같다(GA4 제외·브랜드 범위).
    //   받는 범위 = 지난달 1일부터. 월초에 동기화가 지난달 말에 멈춰 있어도 지난달 꼬리까지 잡는다.
    //   금액 칸(광고비·이익)은 실제로 쓴 돈이라 그대로 둔다.
    const prevMonthStart = (() => { const [y, m] = todayStr.slice(0, 7).split("-").map(Number); const pm = m === 1 ? 12 : m - 1; return `${m === 1 ? y - 1 : y}-${String(pm).padStart(2, "0")}-01`; })();
    const tailFrom = prevMonthStart > fromDate ? prevMonthStart : fromDate;
    let tailAdQ = supabase.from("daily_ad_spend").select("date,spend").gte("date", tailFrom).lte("date", toDate).not("channel", "like", "ga4_%");
    tailAdQ = brand !== "all" ? tailAdQ.in("brand", expandBrands(brand)) : tailAdQ.neq("brand", "all");
    const tailAdPromise = tailFrom <= toDate ? fetchAll(tailAdQ) : Promise.resolve([] as { date: string; spend: number }[]);

    const [parts, miscRes, shipRes, productCostsRes, salesLastRes, tailAdRows] = await Promise.all([
      tryRpc<MonthlyParts>("monthly_summary_parts", { p_from: fromDate, p_to: toDate, p_brands: brandsParam }),
      miscQ,
      shipQ,
      // Fetch product costs for COGS
      supabase.from("product_costs").select("product,brand,cost_price,manufacturing_cost,shipping_cost"),
      // 판매 원장이 어디까지 들어왔는지(진행 중인 달 「(N일)」 표시용, 2026-11-03). 오늘 장중 행은 세지 않는다.
      // 정의는 src/lib/sales-through.ts 하나(고른 브랜드 범위, QA2 M3). 실패는 0일로 덮지 않고 따로 알린다(L5).
      fetchSalesThrough(brand, todayStr).then(
        (date) => ({ date, error: null as string | null }),
        (e: unknown) => ({ date: null as string | null, error: e instanceof Error ? e.message : String(e) }),
      ),
      tailAdPromise,
    ]);
    if (salesLastRes.error) console.error("monthly-summary:", salesLastRes.error);
    const salesThrough: string | null = salesLastRes.date;
    const salesThroughError = salesLastRes.error;
    const asRows = <T extends { month: string }>(rows: T[]) => rows.map((r) => ({ ...r, date: `${r.month}-01` }));
    const [sales, ads, ps, cogsProdData] = parts
      ? [asRows(parts.sales), asRows(parts.ads), needGonggu ? asRows(parts.gonggu) : [], asRows(parts.cogs)]
      : await Promise.all([
          fetchAll(salesQ),
          fetchAll(adQ),
          needGonggu
            ? fetchAll(supabase.from("product_sales").select("date,channel,lineup,product,revenue").gte("date", fromDate).lte("date", toDate).eq("brand", "balancelab"))
            : Promise.resolve([] as unknown[]),
          fetchAll(cogsProdQ),
        ]);
    const miscData = miscRes.data;
    const shipData = shipRes.data;
    const productCostsData = productCostsRes.data;

    // 공구 판정·금액은 다른 화면과 같은 함수(gonggu.ts formAByDateChannel)로 구한다.
    // 이 화면은 매출을 달 합계로만 받아(DB 합산 함수 sales 묶음에 판매처·브랜드 칸이 없다)
    // 날짜·판매처까지 맞춰 뺄 수 없어 달 단위로 뺀다. 지금 원장에선 결과가 같다
    // (형식-A 공구는 전부 스마트스토어, 밸런스랩 매출 행은 하루 한 줄, 2026-11-09 실측).
    const formAByMonth = new Map<string, number>();
    formAByDateChannel(ps as { date: string; channel: string; lineup: string | null; product: string; revenue: number }[])
      .forEach((v, k) => { const m = k.slice(0, 7); formAByMonth.set(m, (formAByMonth.get(m) || 0) + v); });

    const costMap = new Map<string, number>();
    for (const pc of productCostsData || []) {
      // manufacturing_cost = 실제 원가 (cost_price는 판매가)
      costMap.set(`${pc.product}__${pc.brand}`, Number(pc.manufacturing_cost || 0));
    }

    // Group by month
    const months = new Map<string, { revenue: number; orders: number; adSpend: number; cv: number; miscCost: number; shipCost: number; cogs: number }>();
    // 월별 채널별 광고비 ((M)Dash Board 재현)
    const monthChannels = new Map<string, Map<string, number>>();

    for (const r of sales || []) {
      const m = r.date.slice(0, 7);
      const existing = months.get(m) || { revenue: 0, orders: 0, adSpend: 0, cv: 0, miscCost: 0, shipCost: 0, cogs: 0 };
      existing.revenue += Number(r.revenue);
      existing.orders += Number(r.orders);
      months.set(m, existing);
    }

    // 형식-A 공구 차감 (밸런스랩 자체매출 정정)
    for (const [m, amt] of formAByMonth.entries()) {
      const ex = months.get(m);
      if (ex) ex.revenue = Math.max(0, ex.revenue - amt);
    }

    for (const r of ads || []) {
      if (r.channel && r.channel.startsWith("ga4_")) continue; // GA4 중복 제외
      const m = r.date.slice(0, 7);
      const existing = months.get(m) || { revenue: 0, orders: 0, adSpend: 0, cv: 0, miscCost: 0, shipCost: 0, cogs: 0 };
      existing.adSpend += Number(r.spend);
      existing.cv += Number(r.conversion_value);
      months.set(m, existing);
      // 채널별 비용
      if (!monthChannels.has(m)) monthChannels.set(m, new Map());
      const cm = monthChannels.get(m)!;
      cm.set(r.channel, (cm.get(r.channel) || 0) + Number(r.spend));
    }

    // Add misc costs by month (misc_costs: date + amount)
    for (const r of miscData || []) {
      const m = (r.date || "").slice(0, 7);
      const existing = months.get(m);
      if (existing) existing.miscCost += Number(r.amount || 0);
    }

    // Add shipping costs by month (shipping_costs: month + total_cost)
    for (const r of shipData || []) {
      const m = (r.month || "").slice(0, 7);
      const existing = months.get(m);
      if (existing) existing.shipCost += Number(r.total_cost || 0);
    }

    // Add COGS by month
    //
    // ★ 매출과 **같은 기준**으로 센다. 2026-09-22 까지는 매출에서만 형식-A 공구를 빼고
    //   원가는 공구까지 다 더해서, 공구가 큰 달은 원가율이 100% 를 넘었다.
    //   2026-04: 매출 32,806,368 · 원가 43,643,260 → 133%. 그 달 공구 차감액이 43,956,367 원이었다.
    //   판 것을 매출에서 뺐으면 그 물건 값도 빼야 이익률이 뜻을 갖는다.
    //   공구를 따로 보는 것 자체는 김호 결정(2026-06-10). 여기서는 그 결정을 원가에도 똑같이 적용한다.
    // 원가 매칭률: Overview(api/dashboard)와 같은 방식. 제품 판매 행 중 원가표에 (제품, 브랜드)가 있는 행의 비율.
    //   DB 합산 함수 경로는 행이 묶여 오므로 묶인 원본 행 수(n)로 센다. 그래야 Overview 의 행 단위 비율과 같다.
    //   미매칭 행은 원가 0 으로 계산돼 이익이 과대 표시된다(2026-11-04 월별 화면 각주용).
    let cogsRows = 0;
    let cogsMatchedRows = 0;
    for (const ps of cogsProdData || []) {
      const m = ps.date.slice(0, 7);
      const existing = months.get(m);
      if (!existing) continue;
      // 위에서 매출을 뺀 그 행이다. 원가도 같이 뺀다. (밸런스랩 전용 규칙. gonggu.ts 주석 참조)
      if (ps.brand === "balancelab" && isGongguInDailySales(ps)) continue;
      const key = `${ps.product}__${ps.brand}`;
      const rowCount = Number((ps as { n?: number }).n ?? 1) || 1;
      cogsRows += rowCount;
      if (costMap.has(key)) cogsMatchedRows += rowCount;
      const unitCost = costMap.get(key) || 0;
      existing.cogs += unitCost * Number(ps.quantity || 0);
    }

    // 판매 원장 마지막 날 뒤의 광고비·잡비(달별). 판매 원장 조회가 실패하면 자르지 않고 그 달 비율을 「모름」으로 둔다(아래).
    const adTailByMonth = new Map<string, number>();
    const miscTailByMonth = new Map<string, number>();
    if (!salesThroughError) {
      const after = (d: string) => d >= tailFrom && (!salesThrough || d > salesThrough);
      for (const r of tailAdRows as { date: string; spend: number }[]) {
        if (!after(r.date)) continue;
        const m = r.date.slice(0, 7);
        adTailByMonth.set(m, (adTailByMonth.get(m) || 0) + Number(r.spend || 0));
      }
      for (const r of miscData || []) {
        const d = String(r.date || "");
        if (!after(d)) continue;
        const m = d.slice(0, 7);
        if (!months.has(m)) continue; // 위 잡비 합산도 매출·광고비가 있는 달에만 더한다
        miscTailByMonth.set(m, (miscTailByMonth.get(m) || 0) + Number(r.amount || 0));
      }
    }
    const currentMonthKey = todayStr.slice(0, 7);
    // 그 달 비율이 판매 원장 마지막 날에서 잘렸는지: 그 달 마지막 날이 원장 마지막 날보다 뒤이고, 꼬리를 받은 범위 안의 달.
    const monthEndOf = (m: string) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); };
    const isCutMonth = (m: string) => !salesThroughError && `${m}-01` >= tailFrom.slice(0, 8) + "01" && (!salesThrough || monthEndOf(m) > salesThrough);

    const summary = Array.from(months.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, d]) => {
        const totalCost = d.adSpend + d.miscCost + d.shipCost + d.cogs;
        // 비율의 분모(판매 원장 마지막 날까지). 잘리지 않는 달은 금액 칸과 같다.
        const adToSales = Math.max(0, d.adSpend - (adTailByMonth.get(month) || 0));
        const miscToSales = Math.max(0, d.miscCost - (miscTailByMonth.get(month) || 0));
        const cut = isCutMonth(month);
        // 판매 원장 조회가 실패했고 이번 달이면 어디까지 나눌지 모른다 → 비율을 내지 않는다(화면 "-").
        const ratioUnknown = !!salesThroughError && month === currentMonthKey;
        const profit = d.revenue - totalCost;
        // (MER 분모 = 판매 집계일까지 매체비+잡비, 아래 mer. 이익은 위 totalCost 로 그 달 전체 금액)
        const channelCosts = Object.fromEntries(monthChannels.get(month) || []);
        return {
          month,
          revenue: d.revenue,
          orders: d.orders,
          // 매체비/잡비 분리: 광고비·ROAS·광고비비중·CAC는 매체비 기준(목표가 매체비라 일치). 잡비는 별도.
          adSpend: d.adSpend, // 매체비 (오버뷰·페이싱과 동일 분모)
          miscCost: d.miscCost, // 잡비 (별도 노출, 이익·MER에만 반영)
          cv: d.cv, // 플랫폼 신고 전환매출 합 (채널별 중복 포함 — ROAS 분자로 쓰지 말 것)
          cogs: d.cogs,
          shippingCost: d.shipCost,
          profit,
          profitRate: d.revenue > 0 ? (profit / d.revenue) * 100 : 0,
          // ★ROAS = **실매출** / 매체비. 오버뷰(api/dashboard)·페이싱과 같은 정의다.
          //   예전엔 d.cv(플랫폼 신고 전환매출 합)를 분자로 썼는데, 주석엔 "오버뷰와 동일"이라고
          //   적혀 있었지만 실제로는 달랐고 값이 부풀었다. 매체마다 같은 주문을 자기 기여로
          //   신고하기 때문이다. 2026-09 실측(사입 9/3~9/14):
          //     쇼핑광고 19,215,820 + GFA 15,992,700 + 검색광고 3,691,300 = 38,899,820
          //     실제 판매 매출 18,417,880  → 211% 신고
          //   그래서 2026-09 월별 ROAS 가 10.31x 로 찍혔다(실제 4.98x, 2.1배).
          //   더 나쁜 건 방향이 일정하지 않다는 것이다 — 2월·5월은 오히려 낮게 나와서
          //   추세 판단에도 못 쓴다. 신고값은 reportedRoas 로 따로 둔다.
          //   ★ 분모는 판매 원장 마지막 날까지의 매체비(adSpendToSales). 끝난 달은 adSpend 와 같다(QA 3회차).
          roas: adToSales > 0 ? d.revenue / adToSales : 0,
          reportedRevenue: d.cv,
          reportedRoas: d.adSpend > 0 ? d.cv / d.adSpend : 0,
          mer: adToSales + miscToSales > 0 ? d.revenue / (adToSales + miscToSales) : 0,
          aov: d.orders > 0 ? d.revenue / d.orders : 0,
          adRatio: d.revenue > 0 ? (adToSales / d.revenue) * 100 : 0, // 광고비 비중% (판매 집계일까지 매체비/매출)
          cac: d.orders > 0 ? adToSales / d.orders : 0, // 고객획득비용(주문당 매체비, 판매 집계일까지)
          adSpendToSales: adToSales,
          // 비율을 판매 원장 마지막 날에서 잘랐으면 그 날(화면 「~M/D」). 안 잘랐으면 null.
          ratioThrough: cut ? salesThrough : null,
          ratioUnknown,
          channelCosts, // 채널별 광고비 분해
        };
      });

    // ★ 진행 중인 달(오늘이 속한 달)은 며칠치만 들어 있어 전월(한 달 전체)과 비교하면 늘 크게 떨어져 보인다
    //   (11-03 실측: 2026-11 행 전월비 ▼92%). 그 달은 전월비를 비우고 판매가 들어온 날 수만 알린다.
    const currentMonth = todayStr.slice(0, 7);
    // 조회가 실패하면 null(모름). 0 이면 이 달에 판매가 아직 하나도 안 들어왔다는 뜻이라 섞지 않는다.
    const inProgressDays: number | null = salesThroughError
      ? null
      : salesThrough && salesThrough.slice(0, 7) === currentMonth ? Number(salesThrough.slice(8, 10)) : 0;

    // Add MoM growth
    for (let i = 1; i < summary.length; i++) {
      const prev = summary[i - 1];
      const curr = summary[i];
      if (curr.month === currentMonth) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (curr as any).revGrowth = prev.revenue > 0 ? ((curr.revenue / prev.revenue) - 1) * 100 : 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (curr as any).orderGrowth = prev.orders > 0 ? ((curr.orders / prev.orders) - 1) * 100 : 0;
    }

    // YTD totals
    const ytd = {
      revenue: summary.reduce((s, m) => s + m.revenue, 0),
      orders: summary.reduce((s, m) => s + m.orders, 0),
      adSpend: summary.reduce((s, m) => s + m.adSpend, 0), // 매체비 합
      miscCost: summary.reduce((s, m) => s + (m.miscCost || 0), 0), // 잡비 합
      cogs: summary.reduce((s, m) => s + m.cogs, 0),
      shippingCost: summary.reduce((s, m) => s + m.shippingCost, 0),
      profit: summary.reduce((s, m) => s + m.profit, 0),
      cv: summary.reduce((s, m) => s + (m.cv || 0), 0),
      adSpendToSales: summary.reduce((s, m) => s + m.adSpendToSales, 0), // 비율용(판매 집계일까지)
      roas: 0 as number,
      reportedRoas: 0 as number,
      mer: 0 as number,
      aov: 0 as number,
      profitRate: 0 as number,
    };
    // 월별과 같은 정의(실매출/매체비). 신고값은 reportedRoas 로 분리.
    // 비율은 판매 원장 마지막 날까지의 매체비로(월별과 같은 규칙, QA 3회차). 금액(adSpend)은 그대로.
    ytd.roas = ytd.adSpendToSales > 0 ? ytd.revenue / ytd.adSpendToSales : 0;
    ytd.reportedRoas = ytd.adSpend > 0 ? ytd.cv / ytd.adSpend : 0;
    const ytdMiscToSales = ytd.miscCost - Array.from(miscTailByMonth.values()).reduce((a, b) => a + b, 0);
    ytd.mer = (ytd.adSpendToSales + ytdMiscToSales) > 0 ? ytd.revenue / (ytd.adSpendToSales + ytdMiscToSales) : 0; // MER = 매출/총마케팅비
    ytd.aov = ytd.orders > 0 ? ytd.revenue / ytd.orders : 0;
    ytd.profitRate = ytd.revenue > 0 ? (ytd.profit / ytd.revenue) * 100 : 0;

    const res = NextResponse.json({
      summary, ytd, year,
      // 원가 매칭률(0~1, 행 단위). 판매 행이 없으면 null
      cogsMatchRate: cogsRows > 0 ? cogsMatchedRows / cogsRows : null,
      // 진행 중인 달과 그 달에 판매가 들어온 날 수(0 = 아직 없음). 지난해를 보면 null.
      // salesDays 가 null 이면 판매 원장 마지막 날 조회가 실패한 것(salesThroughError). 화면은 「(N일)」을 지운다.
      inProgress: summary.some((m) => m.month === currentMonth) ? { month: currentMonth, salesDays: inProgressDays, salesThrough } : null,
      salesThroughError,
      // 비율(ROAS·MER·광고비중·CAC)이 잘린 끝 날. ratioThrough 가 있는 달만 해당(월 행에도 같은 값).
      ratioThrough: salesThroughError ? null : salesThrough,
    });
    // 일부 조회가 실패한 응답은 5분 캐시에 넣지 않는다(다음 조회에서 다시 읽게).
    if (salesThroughError) res.headers.set(NO_CACHE_HEADER, "1");
    return res;
  } catch {
    return NextResponse.json({ error: "Failed to fetch monthly summary" }, { status: 500 });
  }
}

// 5분 캐시·쓰기 후 무효화 (src/lib/api-cache.ts)
export const GET = cachedGET(getImpl, ["daily_ad_spend", "daily_sales", "misc_costs", "product_costs", "product_sales", "shipping_costs"], ["brand", "year"]);
