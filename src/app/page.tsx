"use client";

import { Suspense, useMemo, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { KpiCard, type KpiConfidence } from "@/components/ui/kpi-card";
import { SectionHeading } from "@/components/ui/section";
import { AttributionGap } from "@/components/attribution-gap";
import { Card, CardContent } from "@/components/ui/card";
import { useFilterParams, useFetch, usePrefetch } from "@/hooks/use-dashboard-data";
import { dashboardUrl, brandDetailUrl } from "@/lib/api-urls";
import { useDataStatus } from "@/hooks/use-data-status";
import { useConfig } from "@/hooks/use-config";
import {
  BRAND_LABELS, BRAND_COLORS, CHANNEL_LABELS, CHANNEL_COLORS, SALES_CHANNEL_COLORS, brandColor,
} from "@/lib/types";
import { formatCurrency, formatNumber, formatPercent, formatRoas, isRoasUntracked } from "@/lib/utils";
import {
  Area, ComposedChart, ReferenceLine, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import { DeferredResponsiveContainer } from "@/components/deferred-chart";
import Link from "next/link";
import { kstDate } from "@/lib/date";

// 2026-11-04 정리: 같은 숫자를 두 번 보여 주거나 다른 화면이 맡는 카드를 뺐다.
//  - 누적 매출·광고비 → 목표 페이싱은 인사이트, 일별 흐름은 아래 트렌드
//  - 매체별 ROAS 가로막대·드릴다운 → 신고 ROAS 라 합산 불가. 아래 「광고 신고 vs 실제」 표와 /ads 가 맡는다
//  - 브랜드 매출 비중 파이 → 사업 그룹 카드와 같은 숫자
//  - 판매처 상세(StoreDetailChart) → 브랜드 화면과 /channel 판매처 성과
//  - 밸런스랩 공구 매출 카드 → /sales 밸런스랩 구역
//  - 퍼널 전환 요약 → 원천마다 재는 법이 달라 /funnel 원천별 단계표로 링크만
type KpiKey = "revenue" | "adSpend" | "orders" | "profit" | "aov" | null;

interface DashboardData {
  kpi: {
    revenue: number; revenuePrev: number; adSpend: number; adSpendPrev: number;
    roas: number; roasPrev: number; orders: number; ordersPrev: number;
    profit: number; profitPrev: number; mer: number; merPrev: number;
    aov: number; aovPrev: number; cogs: number; shippingCost: number;
    miscCost: number; matchedRate: number; profitPrevEstimated?: boolean;
  };
  trend: { date: string; revenue: number; adSpend: number; maRevenue: number; maAdSpend: number; roas: number; [k: string]: string | number }[];
  channels: { channel: string; spend: number; roas: number; reportedRevenue?: number }[];
  salesLastDate?: string | null;
  brandRevenue: { brand: string; revenue: number; orders: number }[];
  brandProfit: { brand: string; revenue: number; orders: number; adSpend: number; adSpendToSalesDate?: number; cogs: number; profit: number; margin: number }[];
  salesByChannel: { channel: string; revenue: number }[];
  topProducts: { product: string; revenue: number; quantity: number; brand: string }[];
  groupRevenue?: { group: string; label: string; revenue: number; orders: number }[];
  blTestLines?: { key: string; label: string; preLaunch: boolean; revenue: number; quantity: number }[];
  petBrands?: { brand: string; label: string; revenue: number; orders: number }[];
  saipBrands?: { label: string; revenue: number; quantity: number }[];
  gongguSalesTotal: number;
}

const TOOLTIP_STYLE = { backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 };

export default function OverviewPage() {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">불러오는 중...</div>}>
      <OverviewInner />
    </Suspense>
  );
}

function OverviewInner() {
  const { brand, from, to } = useFilterParams();
  const { brandMap, channelMap } = useConfig();
  const { data, loading } = useFetch<DashboardData>(dashboardUrl(brand || "all", from, to));
  // 브랜드 상세는 로딩 화면 동안 마운트되지 않는다. 대시보드 응답을 기다리지 않게 같이 부른다.
  usePrefetch([brand && brand !== "all" ? brandDetailUrl(brand, from, to) : null]);
  const { data: status } = useDataStatus();
  const [selectedKpi, setSelectedKpi] = useState<KpiKey>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: targetsData } = useFetch<any>("/api/targets");
  const { data: eventsData } = useFetch<{ events: { id: number; date: string; title: string; color: string }[] }>(
    `/api/events?from=${from}&to=${to}${brand && brand !== "all" ? `&brand=${brand}` : ""}`
  );
  const events = eventsData?.events || [];

  const kpi = data?.kpi || {
    revenue: 0, revenuePrev: 0, adSpend: 0, adSpendPrev: 0,
    roas: 0, roasPrev: 0, orders: 0, ordersPrev: 0,
    profit: 0, profitPrev: 0, mer: 0, merPrev: 0, aov: 0, aovPrev: 0,
    cogs: 0, shippingCost: 0, miscCost: 0, matchedRate: 0, profitPrevEstimated: true,
  };

  // 판매 원장이 들어온 마지막 날. 판매 동기화는 며칠 늦게 들어와 그 뒤 날짜의 매출 0 은 "판매 0" 이 아니다.
  // ★ 서버가 고른 브랜드 범위로 정한 값 하나만 쓴다(src/lib/sales-through.ts, QA2 M3 2026-11-10).
  //   예전엔 차트는 전사 기준(data-status), ROAS 경고는 서버의 브랜드 범위 값을 써서 같은 화면의 기준일이 갈렸다.
  const salesLastDate = data?.salesLastDate || null;

  const brandBreakdown = useMemo(() => {
    return (data?.brandProfit || []).map((b) => ({
      brand: b.brand,
      label: brandMap[b.brand]?.label || BRAND_LABELS[b.brand] || b.brand,
      color: brandMap[b.brand]?.color || brandColor(b.brand),
      revenue: b.revenue,
      orders: b.orders,
      adSpend: b.adSpend,
      adSpendToSalesDate: b.adSpendToSalesDate ?? b.adSpend,
      profit: b.profit,
      aov: b.orders > 0 ? b.revenue / b.orders : 0,
    })).filter(b => b.revenue > 0 || b.adSpend > 0).sort((a, b) => b.revenue - a.revenue);
  }, [data, brandMap]);

  const channelAds = useMemo(() => {
    return (data?.channels || []).map((c) => ({
      channel: c.channel,
      label: channelMap[c.channel]?.label || CHANNEL_LABELS[c.channel] || c.channel,
      color: channelMap[c.channel]?.color || CHANNEL_COLORS[c.channel] || "#6b7280",
      spend: c.spend,
      roas: c.roas,
    })).sort((a, b) => b.spend - a.spend);
  }, [data, channelMap]);

  const channelSales = useMemo(() => {
    return (data?.salesByChannel || []).map((c) => ({
      channel: c.channel,
      label: channelMap[c.channel]?.label || CHANNEL_LABELS[c.channel] || c.channel,
      color: channelMap[c.channel]?.color || SALES_CHANNEL_COLORS[c.channel] || CHANNEL_COLORS[c.channel] || "#6b7280",
      revenue: c.revenue,
    })).sort((a, b) => b.revenue - a.revenue);
  }, [data, channelMap]);

  // 서버가 기간 전체 날짜를 0 으로 채워 보낸다. 오늘(KST) 이후 날짜만 축에서 뺀다.
  // 판매 원장 마지막 날 이후의 매출은 0 이 아니라 아직 안 들어온 값이라 null(선이 0 으로 꺾이지 않게).
  // 광고비는 매체 API 가 따로 들어오므로 그대로 둔다. ROAS 우측축은 뺐다(이중축은 두 선의 교차를 의미 있어 보이게 만든다).
  const dailyTrend = useMemo(() => {
    const today = kstDate();
    return (data?.trend || []).filter((t) => t.date <= today).map((t) => ({
      date: t.date.slice(5),
      revenue: salesLastDate && t.date > salesLastDate ? null : t.revenue,
      adSpend: t.adSpend,
    }));
  }, [data, salesLastDate]);
  const pendingTrendDays = useMemo(
    () => (salesLastDate ? (data?.trend || []).filter((t) => t.date > salesLastDate && t.date <= kstDate()).length : 0),
    [data, salesLastDate]
  );

  const topProducts = useMemo(() => data?.topProducts || [], [data]);
  const gongguSalesTotal = data?.gongguSalesTotal || 0;

  // 경고. 판매 원장 마지막 날 이후는 매출이 비어 있어 넣으면 가짜 하락·가짜 ROAS 미달이 뜬다.
  const warnings = useMemo(() => {
    const results: string[] = [];
    for (const b of brandBreakdown) {
      const ad = b.adSpendToSalesDate;
      const roas = ad > 0 ? b.revenue / ad : 0;
      if (roas > 0 && roas < 1) results.push(`${b.label} ROAS ${roas.toFixed(2)}x, 광고비 대비 매출 부족`);
    }
    // 추세 조기경보: 매출 7일 이동평균 모멘텀 (마지막 MA vs 7일 전 MA). 서버 MA 는 그날까지의 7일 평균이라
    // 판매 원장 마지막 날까지로 자르면 그 앞 값은 동기화 지연에 오염되지 않는다.
    const trend = (data?.trend || []).filter((t) => !salesLastDate || t.date <= salesLastDate);
    if (trend.length >= 14) {
      const last = trend[trend.length - 1]?.maRevenue || 0;
      const prev = trend[trend.length - 8]?.maRevenue || 0;
      if (prev > 0) {
        const chg = (last - prev) / prev;
        if (chg <= -0.15) results.push(`매출 7일 추세 ${(chg * 100).toFixed(0)}% 하락: 이동평균 ${formatCurrency(Math.round(prev))} → ${formatCurrency(Math.round(last))} (판매 원장 ${trend[trend.length - 1].date.slice(5)}까지)`);
      }
    }
    return results;
  }, [brandBreakdown, data, salesLastDate]);

  const pctChange = (cur: number, prev: number) => {
    if (prev === 0) return cur > 0 ? 100 : undefined;
    return ((cur - prev) / Math.abs(prev)) * 100;
  };

  /* ── 측정 신뢰도 ──
     "0원"과 "측정이 안 됨"은 다른 사건이다. 메타 토큰이 만료된 동안 광고비가 0으로 표시돼
     "메타 집행을 안 했나 보다"로 읽혔다. 그래서 숫자 옆에 등급을 붙인다. */

  // 비교 구간 길이. "전기간"은 캘린더 전월이 아니라 직전 같은 길이의 구간이다.
  const periodDays = useMemo(() => {
    if (!from || !to) return 0;
    const d = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
    return d > 0 ? d : 0;
  }, [from, to]);
  const changeLabel = periodDays > 0 ? `직전 ${periodDays}일 대비` : undefined;

  // 고장난 자동 수집이 오염시키는 지표 (미운영은 여기 안 들어온다. 0이 사실이므로)
  const impacted = status?.impactedMetrics || {};
  const brokenAd = impacted.adSpend || [];
  const brokenAdNames = brokenAd.map((x) => x.label).join(", ");
  const inactiveAdSources = (status?.sources || []).filter(
    (s) => s.status === "inactive" && s.metrics.includes("adSpend")
  );

  // 판매실적은 수기 업로드다. 선택 기간의 끝보다 업로드가 뒤처지면 매출·주문·이익이 과소 집계된다.
  // 기준일은 차트·경고와 같은 salesLastDate(고른 브랜드 범위)다.
  const salesGapDays = useMemo(() => {
    const latest = salesLastDate;
    if (!latest || !to || latest >= to) return 0;
    return Math.round((Date.parse(to) - Date.parse(latest)) / 86400000);
  }, [salesLastDate, to]);
  const salesGapNote = salesGapDays > 0
    ? `판매 업로드가 ${salesLastDate}까지입니다. 선택 기간 마지막 ${salesGapDays}일이 비어 매출이 실제보다 낮습니다`
    : null;

  const revenueConfidence: KpiConfidence | undefined = salesGapNote
    ? { level: "partial", note: salesGapNote }
    : undefined;
  // 같은 사유를 두 번 인쇄하지 않는다. 보조 카드는 레일·배지만 남기고 각주는 위 카드가 맡는다.
  const quiet = (c: KpiConfidence | undefined): KpiConfidence | undefined => (c ? { ...c, note: "" } : undefined);

  const adSpendConfidence: KpiConfidence | undefined = brokenAd.length > 0
    ? {
        level: kpi.adSpend > 0 ? "partial" : "unmeasurable",
        note: `${brokenAdNames} 수집 중단. 이 채널 집행액이 빠져 있어 실제 광고비는 이보다 큽니다`,
      }
    : undefined;

  // ROAS 는 분자(매출)와 분모(광고비)가 각각 다른 이유로 틀어질 수 있다. 둘 다 밝힌다.
  const roasConfidence: KpiConfidence | undefined = useMemo(() => {
    const notes: string[] = [];
    if (brokenAd.length > 0) notes.push(`분모에 ${brokenAdNames} 광고비가 빠져 ROAS가 과대 계상됩니다`);
    if (salesGapDays > 0) notes.push(`분자 매출이 ${salesLastDate}까지만 반영됐습니다`);
    if (notes.length === 0) return undefined;
    return { level: "partial", note: notes.join(" · ") };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brokenAdNames, brokenAd.length, salesGapDays, salesLastDate]);

  // 이익: 원가 매칭이 안 된 품목은 원가 0으로 계산된다 → 이익이 과대.
  const matchedPct = Math.round((kpi.matchedRate || 0) * 100);
  const profitConfidence: KpiConfidence | undefined = useMemo(() => {
    const notes: string[] = [];
    if (kpi.matchedRate > 0 && kpi.matchedRate < 0.95) {
      notes.push(`원가 매칭 ${matchedPct}%. 미매칭 품목은 원가 0으로 계산돼 이익이 과대 표시됩니다`);
    }
    if (salesGapDays > 0) notes.push(`매출이 ${salesLastDate}까지만 반영됐습니다`);
    if (notes.length === 0) return undefined;
    return { level: "partial", note: notes.join(" · ") };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kpi.matchedRate, matchedPct, salesGapDays, salesLastDate]);

  // 목표는 "달" 단위로 등록된다.
  //  (a) 선택 기간의 from 이 속한 달의 목표를 쓴다
  //  (b) 기간이 두 달 이상 걸치면 비교 자체가 성립하지 않으므로 막대를 숨긴다(기본 30일은 대개 두 달에 걸친다.
  //      이번 달 목표 진척은 인사이트 「목표 대비 페이싱」이 기간과 상관없이 보여 준다)
  //  (c) 브랜드 목표가 없어 전사로 폴백하면 라벨에 그 사실을 표시한다
  const { targets, targetIsCompanyWide } = useMemo(() => {
    const t = targetsData?.targets || {};
    if (!from || !to || from.slice(0, 7) !== to.slice(0, 7)) {
      return { targets: null, targetIsCompanyWide: false };
    }
    const month = from.slice(0, 7);
    const b = brand && brand !== "all" ? brand : "all";
    const own = t[`${month}_${b}`];
    if (own) return { targets: own, targetIsCompanyWide: false };
    const fallback = t[`${month}_all`];
    return { targets: fallback || null, targetIsCompanyWide: !!fallback && b !== "all" };
  }, [targetsData, brand, from, to]);

  // 목표는 달 전체 기준인데 실적은 선택 기간이다. 경과율을 같은 막대에 세운다(합계 지표인 매출·광고비만).
  // ROAS 같은 비율 지표에는 경과율이 의미가 없어 목표 막대를 달지 않는다.
  const targetElapsedPercent = useMemo(() => {
    if (!from || !to || from.slice(0, 7) !== to.slice(0, 7)) return undefined;
    const [y, m] = from.slice(0, 7).split("-").map(Number);
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const coveredDays = Math.round((Date.parse(to) - Date.parse(`${from.slice(0, 7)}-01`)) / 86400000) + 1;
    if (!(daysInMonth > 0) || !(coveredDays > 0)) return undefined;
    return Math.min(100, (coveredDays / daysInMonth) * 100);
  }, [from, to]);

  const targetProp = (current: number, targetVal: number | undefined, label: string) => {
    if (!targetVal || targetVal <= 0) return undefined;
    return {
      label: targetIsCompanyWide ? `${label}(전사)` : label,
      percent: (current / targetVal) * 100,
      elapsedPercent: targetElapsedPercent,
    };
  };

  const toggleKpi = (key: KpiKey) => setSelectedKpi((prev) => (prev === key ? null : key));

  /* CSV 내보내기 */
  const exportCSV = () => {
    const rows: string[] = [];
    rows.push("=== KPI 요약 ===");
    rows.push("항목,값,전기간");
    rows.push(`매출,${kpi.revenue},${kpi.revenuePrev}`);
    rows.push(`광고비,${kpi.adSpend},${kpi.adSpendPrev}`);
    rows.push(`ROAS,${kpi.roas.toFixed(2)},${kpi.roasPrev.toFixed(2)}`);
    rows.push(`주문수,${kpi.orders},${kpi.ordersPrev}`);
    rows.push(`이익,${kpi.profit},${kpi.profitPrev}${kpi.profitPrevEstimated ? " (전기간은 원가율 가정 추정)" : ""}`);
    rows.push(`MER,${kpi.mer.toFixed(2)},${kpi.merPrev.toFixed(2)}`);
    rows.push("");
    rows.push("=== 일별 트렌드 ===");
    rows.push("날짜,매출,광고비,이동평균매출,이동평균광고비");
    for (const t of data?.trend || []) {
      rows.push(`${t.date},${t.revenue},${t.adSpend},${t.maRevenue},${t.maAdSpend}`);
    }
    rows.push("");
    rows.push("=== 브랜드별 매출 ===");
    rows.push("브랜드,매출,주문수");
    for (const b of data?.brandRevenue || []) {
      rows.push(`${b.brand},${b.revenue},${b.orders}`);
    }
    rows.push("");
    rows.push("=== 매체별 광고비 ===");
    rows.push("매체,광고비,ROAS(신고)");
    for (const c of data?.channels || []) {
      rows.push(`${c.channel},${c.spend},${c.roas.toFixed(2)}`);
    }
    const csv = "﻿" + rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ppmi_report_${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 카드를 누르면 그 숫자의 분해. ROAS·MER 는 매체 신고값으로 쪼개면 합이 실매출 ROAS 와 맞지 않아 분해하지 않는다.
  const drilldownData = useMemo(() => {
    if (!selectedKpi) return null;
    const configs: Record<string, { title: string; type: "brand" | "channel"; valueKey: string; format: (v: number) => string }> = {
      revenue: { title: "브랜드별 매출", type: "brand", valueKey: "revenue", format: formatCurrency },
      orders: { title: "브랜드별 주문 수", type: "brand", valueKey: "orders", format: formatNumber },
      adSpend: { title: "매체별 광고비", type: "channel", valueKey: "spend", format: formatCurrency },
      profit: { title: "브랜드별 통상이익", type: "brand", valueKey: "profit", format: formatCurrency },
      aov: { title: "브랜드별 객단가", type: "brand", valueKey: "aov", format: (v) => formatCurrency(Math.round(v)) },
    };
    const c = configs[selectedKpi];
    if (!c) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const src: any[] = c.type === "brand" ? brandBreakdown : channelAds;
    return {
      title: c.title,
      rows: src.map((item) => ({ label: item.label, color: item.color, value: item[c.valueKey] as number, formatted: c.format(item[c.valueKey] as number) })),
    };
  }, [selectedKpi, brandBreakdown, channelAds]);

  if (loading) {
    return (
      <PageShell title="Overview" description="PPMI 마케팅 대시보드 전체 현황">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <Card key={i} className="p-5 animate-pulse"><CardContent className="p-0"><div className="h-4 w-20 bg-muted rounded mb-2" /><div className="h-8 w-28 bg-muted rounded" /></CardContent></Card>
          ))}
        </div>
      </PageShell>
    );
  }

  const profitRateText = kpi.revenue > 0 ? `이익률 ${formatPercent((kpi.profit / kpi.revenue) * 100)}` : undefined;

  return (
    <PageShell title="Overview" description="PPMI 마케팅 대시보드 전체 현황">
      {/* ── 선택 기간 실적 ── 매출·광고비·ROAS 를 hero 로, 나머지는 compact 로 눌러 스캔만 되게 한다. */}
      <SectionHeading
        eyebrow="Performance"
        title="선택 기간 실적"
        note={`${from} ~ ${to}${gongguSalesTotal > 0 ? ` · 매출은 자체매출 기준 (공구 ${formatCurrency(gongguSalesTotal)} 별도)` : ""}`}
        action={
          <button onClick={exportCSV} data-tour="overview-export"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-muted hover:bg-muted/80 rounded-md text-muted-foreground transition-colors">
            ⬇ CSV 내보내기
          </button>
        }
      />
      {/* 모바일에서 hero 3장을 세로로 쌓으면 603px 를 먹는다. 매출만 전폭으로 두고 광고비·ROAS 를 2열로 붙인다. */}
      <div data-tour="overview-kpi" className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <KpiCard size="hero" className="col-span-2 sm:col-span-1" title="매출" value={formatCurrency(kpi.revenue)} change={pctChange(kpi.revenue, kpi.revenuePrev)} changeLabel={changeLabel} confidence={revenueConfidence} target={targetProp(kpi.revenue, targets?.revenue_target, "목표")} onClick={() => toggleKpi("revenue")} active={selectedKpi === "revenue"} />
        <KpiCard size="hero" title="광고비" value={formatCurrency(kpi.adSpend)} change={pctChange(kpi.adSpend, kpi.adSpendPrev)} changeLabel={changeLabel} confidence={adSpendConfidence} target={targetProp(kpi.adSpend, targets?.ad_budget_target, "예산")} onClick={() => toggleKpi("adSpend")} active={selectedKpi === "adSpend"} />
        <KpiCard size="hero" title="ROAS" subtitle="판매 원장 매출 ÷ 매체비" value={`${(kpi.roas || 0).toFixed(2)}x`} change={pctChange(kpi.roas, kpi.roasPrev)} changeLabel={changeLabel} confidence={roasConfidence} />
      </div>
      {/* MER 은 잡비가 있을 때만 나온다. 열 수를 고정하면 없는 날 오른쪽에 빈 칸이 남는다. */}
      <div data-tour="overview-kpi-sub" className={`grid grid-cols-2 gap-2.5 ${(kpi.miscCost || 0) > 0 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
        <KpiCard size="compact" title="주문 수" value={formatNumber(kpi.orders)} change={pctChange(kpi.orders, kpi.ordersPrev)} changeLabel={changeLabel} confidence={quiet(revenueConfidence)} onClick={() => toggleKpi("orders")} active={selectedKpi === "orders"} />
        {/* 이익률은 이익 카드 안에 적는다(같은 각주를 두 카드가 반복하던 것을 하나로).
            직전 기간 이익은 원가율 가정 추정치라 증감률을 내지 않는다. */}
        <KpiCard size="compact" title="이익" value={formatCurrency(kpi.profit)} subtitle={profitRateText}
          change={kpi.profitPrevEstimated ? undefined : pctChange(kpi.profit, kpi.profitPrev)} changeLabel={kpi.profitPrevEstimated ? undefined : changeLabel}
          confidence={profitConfidence} onClick={() => toggleKpi("profit")} active={selectedKpi === "profit"} />
        {/* MER은 매출/(매체비+잡비). 잡비가 0인 달에는 ROAS 와 같은 숫자라 잡비가 있을 때만 낸다. */}
        {(kpi.miscCost || 0) > 0 && (
          <KpiCard size="compact" title="MER" value={`${(kpi.mer || 0).toFixed(2)}x`} change={pctChange(kpi.mer, kpi.merPrev)} changeLabel={changeLabel} confidence={quiet(roasConfidence)} />
        )}
        <KpiCard size="compact" title="객단가" value={kpi.aov > 0 ? formatCurrency(Math.round(kpi.aov)) : "-"} change={pctChange(kpi.aov, kpi.aovPrev)} changeLabel={changeLabel} onClick={() => toggleKpi("aov")} active={selectedKpi === "aov"} />
      </div>

      {/* 드릴다운 */}
      {drilldownData && (
        <Card data-tour="overview-drilldown">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm">{drilldownData.title}</h3>
              <button onClick={() => setSelectedKpi(null)} className="text-xs text-muted-foreground hover:text-foreground">닫기 ✕</button>
            </div>
            <div className="space-y-2">
              {drilldownData.rows.map((row) => {
                const maxVal = Math.max(...drilldownData.rows.map((r) => Math.abs(r.value)));
                const barW = maxVal > 0 ? (Math.abs(row.value) / maxVal) * 100 : 0;
                return (
                  <div key={row.label} className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: row.color }} />
                    <span className="text-sm w-24 flex-shrink-0">{row.label}</span>
                    <div className="flex-1 h-5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${barW}%`, backgroundColor: row.value >= 0 ? row.color : "var(--sig-danger)" }} />
                    </div>
                    <span className={`text-sm font-medium w-24 text-right flex-shrink-0 ${row.value < 0 ? "text-red-500" : ""}`}>{row.formatted}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 경고 */}
      {warnings.length > 0 && (
        <div data-tour="overview-warnings" className="space-y-2">
          {warnings.map((w, i) => (
            <Card key={i} className="border-l-4 border-l-amber-500 bg-amber-500/5">
              <CardContent className="p-3 flex items-center gap-2">
                <span>⚠️</span>
                <span className="text-sm">{w}</span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 사업 그룹 뷰: 펫(너티+아이언펫+사입) vs 밸런스랩 */}
      {(brand === "all" || !brand) && (data?.groupRevenue || []).length > 0 && (
        <SectionHeading eyebrow="Business Mix" title="사업 그룹" note="펫(너티·아이언펫·사입) vs 밸런스랩" />
      )}
      {(brand === "all" || !brand) && (data?.groupRevenue || []).length > 0 && (
        <div data-tour="overview-business-mix" className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(data?.groupRevenue || []).map(g => {
            const total = (data?.groupRevenue || []).reduce((s, x) => s + x.revenue, 0);
            const share = total > 0 ? (g.revenue / total) * 100 : 0;
            return (
              <Card key={g.group}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-sm">{g.group === "pet" ? "🐾 " : "🧬 "}{g.label}</h3>
                    <span className="text-xs text-muted-foreground">비중 {share.toFixed(0)}%</span>
                  </div>
                  <div className="flex items-baseline gap-3">
                    <span className="text-xl font-bold">{formatCurrency(g.revenue)}</span>
                    <span className="text-xs text-muted-foreground">주문 {formatNumber(g.orders)}</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${share}%`, backgroundColor: brandColor(g.group) }} />
                  </div>
                  {/* 펫은 브랜드별 분해. 사입은 우리 브랜드가 아니라 유통이므로 그 아래 유통 브랜드까지 편다. */}
                  {g.group === "pet" && (data?.petBrands || []).length > 0 && (
                    <div className="pt-1 space-y-1">
                      {(data?.petBrands || []).map(b => (
                        <div key={b.brand}>
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">{b.label}</span>
                            <span className={b.revenue > 0 ? "font-medium" : "text-muted-foreground"}>
                              {formatCurrency(b.revenue)}{b.orders > 0 ? ` · ${formatNumber(b.orders)}건` : ""}
                            </span>
                          </div>
                          {/* 사입 하위: 유통 브랜드. 합은 사입 매출과 정확히 맞는다(같은 product_sales). */}
                          {b.brand === "saip" && (data?.saipBrands || []).length > 0 && (
                            <div className="mt-0.5 ml-3 pl-2 border-l space-y-0.5">
                              {(data?.saipBrands || []).map(s => (
                                <div key={s.label} className="flex items-center justify-between text-[11px]">
                                  <span className="text-muted-foreground">{s.label}</span>
                                  <span className="text-muted-foreground">{formatCurrency(s.revenue)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {/* 밸런스랩은 검사 라인별 분해 (타액·음식물과민증은 런칭 전이라 0이어도 항상 표시) */}
                  {g.group === "balancelab" && (data?.blTestLines || []).length > 0 && (
                    <div className="pt-1 space-y-1">
                      {(data?.blTestLines || []).map(l => (
                        <div key={l.key} className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">
                            {l.label}
                            {l.preLaunch && l.revenue === 0 && <span className="ml-1 px-1 py-0.5 rounded bg-muted text-[10px]">런칭 전</span>}
                          </span>
                          <span className={l.revenue > 0 ? "font-medium" : "text-muted-foreground"}>{formatCurrency(l.revenue)}{l.quantity > 0 ? ` · ${formatNumber(l.quantity)}건` : ""}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* 밸런스랩 단독 선택 시 검사 라인별 카드 */}
      {brand === "balancelab" && (data?.blTestLines || []).length > 0 && (
        <Card data-tour="overview-bl-lines">
          <CardContent className="p-4 space-y-2">
            <h3 className="font-semibold text-sm">🧬 검사 라인별 매출 <span className="text-xs text-muted-foreground font-normal">(자체매출 기준, 공구 제외)</span></h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {(data?.blTestLines || []).map(l => (
                <div key={l.key} className="p-3 rounded-lg border">
                  <p className="text-xs text-muted-foreground">{l.label}{l.preLaunch && l.revenue === 0 && <span className="ml-1 px-1 py-0.5 rounded bg-muted text-[10px]">런칭 전</span>}</p>
                  <p className={`text-lg font-bold mt-0.5 ${l.revenue === 0 ? "text-muted-foreground" : ""}`}>{formatCurrency(l.revenue)}</p>
                  <p className="text-xs text-muted-foreground">{formatNumber(l.quantity)}건</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 일별 트렌드 */}
      <SectionHeading eyebrow="Trend" title="일별 흐름" note="선택 기간 일별" />
      <Card data-tour="overview-trend">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2 flex-wrap mb-3">
            <div>
              <h3 className="font-semibold">일별 매출 · 광고비</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                가로 = 날짜, 세로 = 원. 매출은 판매 원장(자체매출), 광고비는 매체비 합계
                {pendingTrendDays > 0 && salesLastDate ? `. 매출은 ${salesLastDate.slice(5)}까지 들어와 그 뒤 ${pendingTrendDays}일은 비워 둡니다(판매 동기화 대기)` : ""}
              </p>
            </div>
            {events.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {events.map(e => (
                  <span key={e.id} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border" style={{ borderColor: e.color, color: e.color }} title={e.title}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: e.color }} />{e.date.slice(5)} {e.title}
                  </span>
                ))}
              </div>
            )}
          </div>
          <DeferredResponsiveContainer width="100%" height={260}>
            <ComposedChart data={dailyTrend} margin={{ top: 24, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" tickFormatter={(v) => `${(v / 10000).toFixed(0)}만`} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(val) => (val == null ? "-" : formatCurrency(Number(val)))} />
              <Legend />
              <Area isAnimationActive={false} type="monotone" dataKey="revenue" name="매출" stroke="#2563eb" fill="#2563eb" fillOpacity={0.1} strokeWidth={2} connectNulls={false} />
              <Area isAnimationActive={false} type="monotone" dataKey="adSpend" name="광고비" stroke="#dc2626" fill="#dc2626" fillOpacity={0.1} strokeWidth={2} />
              {events.map(e => (
                <ReferenceLine key={e.id} x={e.date.slice(5)} stroke={e.color} strokeDasharray="4 4" strokeWidth={2}
                  label={(props: { viewBox?: { x: number; y: number; width: number; height: number } }) => {
                    const vb = props.viewBox;
                    if (!vb) return <g />;
                    const title = e.title.length > 10 ? e.title.slice(0, 10) + "…" : e.title;
                    const w = title.length * 6 + 8;
                    return (
                      <g style={{ pointerEvents: "none" }}>
                        <rect x={vb.x + 2} y={vb.y} width={w} height={15} rx={3} fill={e.color} fillOpacity={0.9} />
                        <text x={vb.x + 6} y={vb.y + 10.5} fill="#fff" fontSize={9} fontWeight={700}>{title}</text>
                      </g>
                    );
                  }} />
              ))}
            </ComposedChart>
          </DeferredResponsiveContainer>
        </CardContent>
      </Card>

      {/* 광고 신고 vs 실제: 매체별 신고 ROAS 는 이 표에서만 본다(합산 불가) */}
      <SectionHeading eyebrow="Attribution" title="광고 신고 vs 실제" note="채널 ROAS 를 더하면 실매출을 넘습니다" />
      <div data-tour="overview-attribution" className="empty:hidden">
        <AttributionGap channels={data?.channels || []} actualRevenue={kpi.revenue} adSpend={kpi.adSpend} />
      </div>

      {/* 매체별 광고비 + 판매처별 매출 + TOP 5 제품. 두 축(매체·판매처)은 조인되지 않는다. */}
      <SectionHeading eyebrow="Channels & Products" title="매체 · 판매처 · 제품" note="매체=집행, 판매처=주문. 두 축은 조인되지 않습니다" />
      <div data-tour="overview-channels" className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">매체별 광고비 <span className="text-xs text-muted-foreground font-normal">ROAS 는 매체 신고값</span></h3>
              <Link href="/ads" className="text-xs text-primary hover:underline">상세 →</Link>
            </div>
            <div className="space-y-2">
              {channelAds.slice(0, 6).map((c) => (
                <div key={c.channel} className="flex items-center gap-2 text-sm">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                  <span className="flex-1 truncate">{c.label}</span>
                  <span className="font-medium">{formatCurrency(c.spend)}</span>
                  <span className={`w-14 text-right ${isRoasUntracked(c.roas, c.spend) ? "text-muted-foreground/60 italic" : "text-muted-foreground"}`}>
                    {formatRoas(c.roas, c.spend)}
                  </span>
                </div>
              ))}
              {channelAds.length === 0 && <div className="text-sm text-muted-foreground">데이터 없음</div>}
            </div>
            {/* 목록에 없는 채널의 이유를 밝힌다. 안 보이는 것과 0원인 것은 다르다. */}
            {(brokenAd.length > 0 || inactiveAdSources.length > 0) && (
              <div className="mt-3 pt-2 border-t border-border/60 space-y-1">
                {brokenAd.length > 0 && (
                  <p className="stamp" style={{ color: "var(--sig-danger)" }}>
                    측정 불가 {brokenAdNames} · 수집 중단으로 집행액이 이 목록에 없습니다
                  </p>
                )}
                {inactiveAdSources.length > 0 && (
                  <p className="stamp text-muted-foreground">
                    미운영 {inactiveAdSources.map((s) => s.label).join(", ")} · 집행하지 않는 채널입니다
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">판매처별 매출 <span className="text-xs text-muted-foreground font-normal">주문 기준</span></h3>
              <Link href="/channel" className="text-xs text-primary hover:underline">상세 →</Link>
            </div>
            <div className="space-y-2">
              {channelSales.slice(0, 6).map((c) => (
                <div key={c.channel} className="flex items-center gap-2 text-sm">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                  <span className="flex-1 truncate">{c.label}</span>
                  <span className="font-medium">{formatCurrency(c.revenue)}</span>
                </div>
              ))}
              {channelSales.length === 0 && <div className="text-sm text-muted-foreground">데이터 없음</div>}
            </div>
          </CardContent>
        </Card>

        <Card data-tour="overview-top5">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">TOP 5 제품</h3>
              <Link href="/sales" className="text-xs text-primary hover:underline">상세 →</Link>
            </div>
            <div className="space-y-2">
              {topProducts.slice(0, 5).map((p, i) => (
                <div key={`${p.brand}-${p.product}`} className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground w-4">{i + 1}</span>
                  <span className="text-xs px-1 py-0.5 rounded shrink-0" style={{ backgroundColor: `${BRAND_COLORS[p.brand] || "#6b7280"}20`, color: BRAND_COLORS[p.brand] || "#6b7280" }}>
                    {BRAND_LABELS[p.brand] || p.brand}
                  </span>
                  <span className="flex-1 truncate">{p.product}</span>
                  <span className="font-medium">{formatCurrency(p.revenue)}</span>
                </div>
              ))}
              {topProducts.length === 0 && <div className="text-sm text-muted-foreground">제품 데이터 없음</div>}
            </div>
          </CardContent>
        </Card>
      </div>
      {/* 퍼널: 단계별 모집단(세션은 일부 채널, 구매는 전 판매처)이 달라 합산 숫자를 여기 두지 않는다. */}
      <p data-tour="overview-funnel-link" className="text-xs text-muted-foreground">
        유입 → 장바구니 → 구매 전환은 판매처마다 유입을 재는 방법이 달라 합치지 않습니다.{" "}
        <Link href="/funnel" className="text-primary hover:underline">퍼널 화면에서 판매처별 단계와 전환율 보기 →</Link>
      </p>

      {brand && brand !== "all" && <BrandDetailSection brand={brand} from={from} to={to} />}
    </PageShell>
  );
}

// 브랜드를 하나 고르면 라인업과 공구 셀러를 더 편다.
// (판매처별 매출·제품 TOP 10 은 위 「판매처별 매출」·「TOP 5 제품」과 같은 숫자라 2026-11-04 뺐다. 전체 제품은 /sales.)
function BrandDetailSection({ brand, from, to }: { brand: string; from: string; to: string }) {
  const { data } = useFetch<{
    lineupBreakdown: { lineup: string; revenue: number; quantity: number }[];
    gongguSales: { seller: string; revenue: number; orders: number }[];
    gongguSalesTotal: number;
    selfSalesTotal: number;
  }>(brandDetailUrl(brand, from, to));

  const lineups = data?.lineupBreakdown || [];
  const gongguSales = data?.gongguSales || [];
  const gongguTotal = data?.gongguSalesTotal || 0;
  const selfTotal = data?.selfSalesTotal || 0;
  const barColor = brandColor(brand);

  if (lineups.length === 0 && gongguSales.length === 0) return null;

  return (
    <div data-tour="overview-brand-detail" className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {lineups.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h3 className="font-semibold mb-3">라인업별 매출</h3>
            <div className="space-y-2">
              {lineups.map((l) => {
                const maxRev = lineups[0]?.revenue || 1;
                return (
                  <div key={l.lineup} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 truncate">{l.lineup}</span>
                    <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${(l.revenue / maxRev) * 100}%`, backgroundColor: barColor }} />
                    </div>
                    <span className="font-medium w-24 text-right">{formatCurrency(l.revenue)}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
      {gongguSales.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h3 className="font-semibold mb-1">공구 셀러별 매출 <span className="text-xs font-normal text-muted-foreground">헤드라인 매출엔 미포함</span></h3>
            <div className="flex gap-4 text-xs text-muted-foreground mb-3">
              <span>자체판매 <span className="font-medium text-foreground">{formatCurrency(selfTotal)}</span></span>
              <span>공구 <span className="font-medium text-foreground">{formatCurrency(gongguTotal)}</span></span>
            </div>
            <div className="space-y-2">
              {gongguSales.map((s) => {
                const maxRev = gongguSales[0]?.revenue || 1;
                return (
                  <div key={s.seller} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 truncate">{s.seller}</span>
                    <span className="text-muted-foreground text-xs w-12 text-right">{formatNumber(s.orders)}건</span>
                    <div className="w-20 h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${(s.revenue / maxRev) * 100}%`, backgroundColor: barColor }} />
                    </div>
                    <span className="font-medium w-24 text-right">{formatCurrency(s.revenue)}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
