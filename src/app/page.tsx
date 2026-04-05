"use client";

import { Suspense, useMemo, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent } from "@/components/ui/card";
import { useFilterParams, useFetch } from "@/hooks/use-dashboard-data";
import { useConfig } from "@/hooks/use-config";
import {
  BRAND_LABELS, BRAND_COLORS, CHANNEL_LABELS, CHANNEL_COLORS,
  SALES_CHANNEL_COLORS,
  type DailySales, type DailyAdSpend, type DailyFunnel, type ProductSales,
} from "@/lib/types";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";
import {
  AreaChart, Area, LineChart, Line, ReferenceLine, BarChart, Bar,
  XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend,
} from "recharts";
import Link from "next/link";

type KpiKey = "revenue" | "adSpend" | "roas" | "orders" | "profit" | "profitRate" | "ctr" | "aov" | null;

export default function OverviewPage() {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">로딩 중...</div>}>
      <OverviewInner />
    </Suspense>
  );
}

function OverviewInner() {
  const { brand, from, to } = useFilterParams();
  const { brandMap, channelMap } = useConfig();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, loading } = useFetch<any>(`/api/dashboard?from=${from}&to=${to}&brand=${brand || "all"}`);
  const [selectedKpi, setSelectedKpi] = useState<KpiKey>(null);

  // 목표 fetch
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: targetsData } = useFetch<any>("/api/targets");

  // API가 서버에서 계산한 KPI 직접 사용
  const kpi = useMemo(() => data?.kpi || {
    revenue: 0, revenuePrev: 0, adSpend: 0, adSpendPrev: 0,
    roas: 0, roasPrev: 0, orders: 0, ordersPrev: 0,
    profit: 0, profitPrev: 0, mer: 0, merPrev: 0, aov: 0, aovPrev: 0,
    cogs: 0, shippingCost: 0, miscCost: 0, matchedRate: 0,
  }, [data]);

  // 서버에서 보낸 집계 데이터 직접 사용
  const sales = useMemo(() => [] as DailySales[], []);  // raw 데이터 더 이상 안 씀
  const ads = useMemo(() => [] as DailyAdSpend[], []);
  const products = useMemo(() => {
    const top = data?.topProducts || [];
    return top.map((p: { product: string; revenue: number; quantity: number; brand: string }) => ({
      ...p, channel: "", lineup: "", category: "", buyers: 0, avg_price: 0, date: "",
    })) as ProductSales[];
  }, [data]);

  const funnel = useMemo(() => [] as DailyFunnel[], []);

  // 이상치 감지
  const anomalies = useMemo(() => data?.anomalies || [], [data]);

  /* 변화율 계산 */
  const pctChange = (cur: number, prev: number) => {
    if (prev === 0) return cur > 0 ? 100 : undefined;
    return ((cur - prev) / Math.abs(prev)) * 100;
  };

  // 서버에서 가져온 트렌드/채널 데이터
  const dailyTrendFromApi = useMemo(() => (data?.trend || []).map((t: { date: string; revenue: number; adSpend: number; maRevenue: number; maAdSpend: number }) => ({
    date: t.date.slice(5), revenue: t.revenue, adSpend: t.adSpend, maRevenue: t.maRevenue, maAdSpend: t.maAdSpend,
  })), [data]);

  const funnelSummary = useMemo(() => data?.funnelSummary || { sessions: 0, cartAdds: 0, purchases: 0, repurchases: 0, convRate: 0 }, [data]);

  const gongguSales = useMemo(() => data?.gongguSales || [], [data]);
  const gongguSalesTotal = data?.gongguSalesTotal || 0;
  const selfSalesTotal = data?.selfSalesTotal || 0;

  /* ── 브랜드별 ── */
  const brandBreakdown = useMemo(() => {
    const map: Record<string, { revenue: number; orders: number; adSpend: number; clicks: number; impressions: number; convValue: number }> = {};
    for (const r of sales) {
      if (!map[r.brand]) map[r.brand] = { revenue: 0, orders: 0, adSpend: 0, clicks: 0, impressions: 0, convValue: 0 };
      map[r.brand].revenue += r.revenue || 0;
      map[r.brand].orders += r.orders || 0;
    }
    for (const r of ads) {
      if (r.channel.startsWith("ga4_")) continue;
      if (!map[r.brand]) map[r.brand] = { revenue: 0, orders: 0, adSpend: 0, clicks: 0, impressions: 0, convValue: 0 };
      map[r.brand].adSpend += r.spend || 0;
      map[r.brand].clicks += r.clicks || 0;
      map[r.brand].impressions += r.impressions || 0;
      map[r.brand].convValue += r.conversion_value || 0;
    }
    return Object.entries(map).map(([b, v]) => ({
      brand: b, label: brandMap[b]?.label || BRAND_LABELS[b] || b, color: brandMap[b]?.color || BRAND_COLORS[b] || "#6b7280",
      ...v,
      roas: v.adSpend > 0 ? v.convValue / v.adSpend : 0,
      profit: v.revenue - v.adSpend,
      profitRate: v.revenue > 0 ? ((v.revenue - v.adSpend) / v.revenue) * 100 : 0,
      ctr: v.impressions > 0 ? (v.clicks / v.impressions) * 100 : 0,
      aov: v.orders > 0 ? v.revenue / v.orders : 0,
    })).sort((a, b) => b.revenue - a.revenue);
  }, [sales, ads, brandMap]);

  /* ── 채널별 광고 ── */
  const channelAds = useMemo(() => {
    const map: Record<string, { spend: number; clicks: number; impressions: number; convValue: number }> = {};
    for (const r of ads) {
      if (r.channel.startsWith("ga4_")) continue;
      if (!map[r.channel]) map[r.channel] = { spend: 0, clicks: 0, impressions: 0, convValue: 0 };
      map[r.channel].spend += r.spend || 0;
      map[r.channel].clicks += r.clicks || 0;
      map[r.channel].impressions += r.impressions || 0;
      map[r.channel].convValue += r.conversion_value || 0;
    }
    return Object.entries(map).map(([ch, v]) => ({
      channel: ch, label: channelMap[ch]?.label || CHANNEL_LABELS[ch] || ch, color: channelMap[ch]?.color || CHANNEL_COLORS[ch] || "#6b7280",
      ...v,
      roas: v.spend > 0 ? v.convValue / v.spend : 0,
      ctr: v.impressions > 0 ? (v.clicks / v.impressions) * 100 : 0,
    })).sort((a, b) => b.spend - a.spend);
  }, [ads, channelMap]);

  /* ── 채널별 매출 ── */
  const channelSales = useMemo(() => {
    const map: Record<string, { revenue: number; orders: number }> = {};
    for (const r of sales) {
      const ch = r.channel || "other";
      if (!map[ch]) map[ch] = { revenue: 0, orders: 0 };
      map[ch].revenue += r.revenue || 0;
      map[ch].orders += r.orders || 0;
    }
    return Object.entries(map).map(([ch, v]) => ({
      channel: ch, label: channelMap[ch]?.label || CHANNEL_LABELS[ch] || ch, color: channelMap[ch]?.color || SALES_CHANNEL_COLORS[ch] || "#6b7280", ...v,
    })).sort((a, b) => b.revenue - a.revenue);
  }, [sales, channelMap]);

  /* ── 일별 매출+광고비 트렌드 (API에서 가져옴) ── */
  const dailyTrend = dailyTrendFromApi;

  /* ── 브랜드/제품 비중 (파이) — 단일 브랜드 선택 시 제품 비중으로 전환 ── */
  const shareData = useMemo(() => {
    if (brand && brand !== "all") {
      // 단일 브랜드 → 제품별 매출 비중
      const map: Record<string, number> = {};
      for (const r of products) map[r.product] = (map[r.product] || 0) + (r.revenue || 0);
      const PRODUCT_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#14b8a6", "#f97316", "#ec4899", "#06b6d4", "#84cc16"];
      return { title: "제품 매출 비중", data: Object.entries(map).map(([p, revenue], i) => ({
        name: p.length > 15 ? p.slice(0, 15) + "…" : p, value: revenue, color: PRODUCT_COLORS[i % PRODUCT_COLORS.length],
      })).sort((a, b) => b.value - a.value).slice(0, 10) };
    }
    // 전체 → 브랜드별 매출 비중
    const map: Record<string, number> = {};
    for (const r of sales) map[r.brand] = (map[r.brand] || 0) + (r.revenue || 0);
    return { title: "브랜드 매출 비중", data: Object.entries(map).map(([b, revenue]) => ({
      name: brandMap[b]?.label || BRAND_LABELS[b] || b, value: revenue, color: brandMap[b]?.color || BRAND_COLORS[b] || "#6b7280",
    })).sort((a, b) => b.value - a.value) };
  }, [sales, products, brand, brandMap]);

  /* ── 퍼널 요약 (API에서 가져옴) ── */
  // funnelSummary는 상단에서 data?.funnelSummary로 가져옴

  /* ── 밸런스랩 공구 요약 ── */
  const gongguSummary = useMemo(() => {
    const gonggu = products.filter((r) => r.brand === "balancelab" && r.channel?.startsWith("공구_"));
    const self = products.filter((r) => r.brand === "balancelab" && !r.channel?.startsWith("공구_"));
    const sellerMap: Record<string, number> = {};
    for (const r of gonggu) {
      const seller = r.channel?.replace("공구_", "") || "기타";
      sellerMap[seller] = (sellerMap[seller] || 0) + (r.revenue || 0);
    }
    const sellers = Object.entries(sellerMap).map(([s, v]) => ({ seller: s, revenue: v })).sort((a, b) => b.revenue - a.revenue);
    return {
      gongguTotal: gonggu.reduce((s, r) => s + (r.revenue || 0), 0),
      selfTotal: self.reduce((s, r) => s + (r.revenue || 0), 0),
      sellers,
    };
  }, [products]);

  /* ── TOP 5 제품 ── */
  const topProducts = useMemo(() => {
    const map: Record<string, { product: string; brand: string; revenue: number; quantity: number }> = {};
    for (const r of products) {
      const key = `${r.brand}-${r.product}`;
      if (!map[key]) map[key] = { product: r.product, brand: r.brand, revenue: 0, quantity: 0 };
      map[key].revenue += r.revenue || 0;
      map[key].quantity += r.quantity || 0;
    }
    return Object.values(map).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  }, [products]);

  /* ── 인사이트 ── */
  const warnings = useMemo(() => {
    const results: string[] = [];
    for (const b of brandBreakdown) {
      if (b.roas > 0 && b.roas < 1) results.push(`${b.label} ROAS ${b.roas.toFixed(2)}x — 광고비 대비 전환 부족`);
    }
    const salesDates = new Set(sales.map((r) => r.date));
    const adsDates = new Set(ads.filter((r) => !r.channel.startsWith("ga4_")).map((r) => r.date));
    const missing = Array.from(adsDates).filter((d) => !salesDates.has(d));
    if (missing.length > 0 && missing.length <= 5) {
      results.push(`매출 누락 ${missing.length}일 — 엑셀 업로드 필요`);
    }
    return results;
  }, [brandBreakdown, sales, ads]);

  /* ── 7.2 누적 매출 그래프 ── */
  const cumulativeData = useMemo(() => {
    const dailyMap: Record<string, { revenue: number; adSpend: number }> = {};
    for (const r of sales) {
      if (!dailyMap[r.date]) dailyMap[r.date] = { revenue: 0, adSpend: 0 };
      dailyMap[r.date].revenue += r.revenue || 0;
    }
    for (const r of ads.filter((a) => !a.channel.startsWith("ga4_"))) {
      if (!dailyMap[r.date]) dailyMap[r.date] = { revenue: 0, adSpend: 0 };
      dailyMap[r.date].adSpend += r.spend || 0;
    }
    const sorted = Object.entries(dailyMap).sort(([a], [b]) => a.localeCompare(b));
    let cumRev = 0, cumAd = 0;
    return sorted.map(([date, v]) => {
      cumRev += v.revenue;
      cumAd += v.adSpend;
      return { date: date.slice(5), cumRevenue: cumRev, cumAdSpend: cumAd };
    });
  }, [sales, ads]);

  /* ── 목표 달성률 ── */
  const targets = useMemo(() => {
    const t = targetsData?.targets || {};
    const curMonth = new Date().toISOString().slice(0, 7);
    const b = brand && brand !== "all" ? brand : "all";
    const key = `${curMonth}_${b}`;
    const fallback = `${curMonth}_all`;
    return t[key] || t[fallback] || null;
  }, [targetsData, brand]);

  const targetProp = (current: number, targetVal: number | undefined, label: string) => {
    if (!targetVal || targetVal <= 0) return undefined;
    return { label, percent: (current / targetVal) * 100 };
  };

  const toggleKpi = (key: KpiKey) => setSelectedKpi((prev) => (prev === key ? null : key));

  /* ── 드릴다운 ── */
  const drilldownData = useMemo(() => {
    if (!selectedKpi) return null;
    const configs: Record<string, { title: string; type: "brand" | "channel"; valueKey: string; format: (v: number) => string }> = {
      revenue: { title: "브랜드별 매출", type: "brand", valueKey: "revenue", format: formatCurrency },
      orders: { title: "브랜드별 주문 수", type: "brand", valueKey: "orders", format: formatNumber },
      adSpend: { title: "채널별 광고비", type: "channel", valueKey: "spend", format: formatCurrency },
      roas: { title: "채널별 ROAS", type: "channel", valueKey: "roas", format: (v) => `${v.toFixed(2)}x` },
      profit: { title: "브랜드별 통상이익", type: "brand", valueKey: "profit", format: formatCurrency },
      profitRate: { title: "브랜드별 이익률", type: "brand", valueKey: "profitRate", format: (v) => formatPercent(v) },
      ctr: { title: "채널별 CTR", type: "channel", valueKey: "ctr", format: (v) => formatPercent(v) },
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

  return (
    <PageShell title="Overview" description="PPMI 마케팅 대시보드 전체 현황">
      {/* KPI 8개 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="매출" value={formatCurrency(kpi.revenue)} change={pctChange(kpi.revenue, kpi.revenuePrev)} target={targetProp(kpi.revenue, targets?.revenue_target, "목표")} onClick={() => toggleKpi("revenue")} active={selectedKpi === "revenue"} />
        <KpiCard title="광고비" value={formatCurrency(kpi.adSpend)} change={pctChange(kpi.adSpend, kpi.adSpendPrev)} target={targetProp(kpi.adSpend, targets?.ad_budget_target, "예산")} onClick={() => toggleKpi("adSpend")} active={selectedKpi === "adSpend"} />
        <KpiCard title="ROAS" value={`${(kpi.roas || 0).toFixed(2)}x`} change={pctChange(kpi.roas, kpi.roasPrev)} target={targetProp(kpi.roas, targets?.roas_target, "목표")} onClick={() => toggleKpi("roas")} active={selectedKpi === "roas"} />
        <KpiCard title="주문 수" value={formatNumber(kpi.orders)} change={pctChange(kpi.orders, kpi.ordersPrev)} onClick={() => toggleKpi("orders")} active={selectedKpi === "orders"} />
        <KpiCard title="이익" value={formatCurrency(kpi.profit)} change={pctChange(kpi.profit, kpi.profitPrev)} onClick={() => toggleKpi("profit")} active={selectedKpi === "profit"} />
        <KpiCard title="이익률" value={kpi.revenue > 0 ? formatPercent((kpi.profit / kpi.revenue) * 100) : "—"} onClick={() => toggleKpi("profitRate")} active={selectedKpi === "profitRate"} />
        <KpiCard title="MER" value={`${(kpi.mer || 0).toFixed(2)}x`} change={pctChange(kpi.mer, kpi.merPrev)} onClick={() => toggleKpi("ctr")} active={selectedKpi === "ctr"} />
        <KpiCard title="객단가" value={kpi.aov > 0 ? formatCurrency(Math.round(kpi.aov)) : "—"} change={pctChange(kpi.aov, kpi.aovPrev)} onClick={() => toggleKpi("aov")} active={selectedKpi === "aov"} />
      </div>

      {/* 드릴다운 */}
      {drilldownData && (
        <Card>
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
                      <div className="h-full rounded-full transition-all" style={{ width: `${barW}%`, backgroundColor: row.value >= 0 ? row.color : "#ef4444" }} />
                    </div>
                    <span className={`text-sm font-medium w-24 text-right flex-shrink-0 ${row.value < 0 ? "text-red-500" : ""}`}>{row.formatted}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 경고/인사이트 */}
      {warnings.length > 0 && (
        <div className="space-y-2">
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

      {/* ROW 1: 매출+광고비 트렌드 + 브랜드 비중 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardContent className="p-4">
            <h3 className="font-semibold mb-4">일별 매출 · 광고비 트렌드</h3>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={dailyTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" tickFormatter={(v) => `${(v / 10000).toFixed(0)}만`} />
                <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} formatter={(val) => formatCurrency(Number(val))} />
                <Legend />
                <Area type="monotone" dataKey="revenue" name="매출" stroke="#2563eb" fill="#2563eb" fillOpacity={0.1} strokeWidth={2} />
                <Area type="monotone" dataKey="adSpend" name="광고비" stroke="#dc2626" fill="#dc2626" fillOpacity={0.1} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <h3 className="font-semibold mb-4">{shareData.title}</h3>
            {shareData.data.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={shareData.data} cx="50%" cy="50%" innerRadius={45} outerRadius={85} dataKey="value" nameKey="name"
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    label={({ name, percent }: any) => `${name || ''} ${((percent || 0) * 100).toFixed(0)}%`} labelLine={false}
                  >
                    {shareData.data.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                  <Tooltip formatter={(val) => formatCurrency(Number(val))} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[260px] text-muted-foreground">데이터 없음</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ROW 2: 채널별 광고비 + 채널별 매출 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">채널별 광고비</h3>
              <Link href="/ads" className="text-xs text-primary hover:underline">상세 →</Link>
            </div>
            <div className="space-y-2">
              {channelAds.slice(0, 6).map((c) => (
                <div key={c.channel} className="flex items-center gap-2 text-sm">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                  <span className="flex-1">{c.label}</span>
                  <span className="font-medium">{formatCurrency(c.spend)}</span>
                  <span className="text-muted-foreground w-16 text-right">{c.roas.toFixed(2)}x</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">채널별 매출</h3>
              <Link href="/sales" className="text-xs text-primary hover:underline">상세 →</Link>
            </div>
            <div className="space-y-2">
              {channelSales.slice(0, 6).map((c) => (
                <div key={c.channel} className="flex items-center gap-2 text-sm">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                  <span className="flex-1">{c.label}</span>
                  <span className="font-medium">{formatCurrency(c.revenue)}</span>
                  <span className="text-muted-foreground w-16 text-right">{formatNumber(c.orders)}건</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 7.2 누적 매출 그래프 */}
      {cumulativeData.length > 1 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">누적 매출 · 광고비</h3>
              {targets?.revenue_target && (
                <span className="text-xs text-muted-foreground">목표: {formatCurrency(targets.revenue_target)}</span>
              )}
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={cumulativeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" tickFormatter={(v) => `${(v / 10000).toFixed(0)}만`} />
                <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} formatter={(val) => formatCurrency(Number(val))} />
                <Legend />
                <Line type="monotone" dataKey="cumRevenue" name="누적 매출" stroke="#2563eb" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="cumAdSpend" name="누적 광고비" stroke="#dc2626" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
                {targets?.revenue_target && (
                  <ReferenceLine y={targets.revenue_target} stroke="#10b981" strokeDasharray="6 3" label={{ value: "목표", position: "right", fontSize: 10, fill: "#10b981" }} />
                )}
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* ROW 3: 퍼널 요약 + TOP 5 제품 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">퍼널 전환 요약</h3>
              <Link href="/funnel" className="text-xs text-primary hover:underline">상세 →</Link>
            </div>
            <div className="flex items-center gap-2 text-sm">
              {[
                { label: "세션", value: funnelSummary.sessions, color: "#3b82f6" },
                { label: "장바구니", value: funnelSummary.cartAdds, color: "#f59e0b", rate: funnelSummary.cartRate },
                { label: "구매", value: funnelSummary.purchases, color: "#10b981", rate: funnelSummary.purchaseRate },
                { label: "재구매", value: funnelSummary.repurchases, color: "#8b5cf6" },
              ].map((step, i) => (
                <div key={step.label} className="flex-1 text-center">
                  <div className="text-xs text-muted-foreground mb-1">{step.label}</div>
                  <div className="text-lg font-bold" style={{ color: step.color }}>{formatNumber(step.value)}</div>
                  {step.rate !== undefined && (
                    <div className="text-xs text-muted-foreground">{step.rate.toFixed(1)}%</div>
                  )}
                  {i < 3 && <div className="text-muted-foreground mt-1">→</div>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">TOP 5 제품</h3>
              <Link href="/sales?tab=product" className="text-xs text-primary hover:underline">상세 →</Link>
            </div>
            <div className="space-y-2">
              {topProducts.map((p, i) => (
                <div key={`${p.brand}-${p.product}`} className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground w-4">{i + 1}</span>
                  <span className="text-xs px-1 py-0.5 rounded" style={{ backgroundColor: `${BRAND_COLORS[p.brand] || '#6b7280'}20`, color: BRAND_COLORS[p.brand] || '#6b7280' }}>
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
      {/* 7.3 채널별 ROAS 비교 */}
      {channelAds.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">채널별 ROAS</h3>
              <Link href="/ads" className="text-xs text-primary hover:underline">상세 →</Link>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={channelAds.slice(0, 8).map(c => ({
                label: c.label,
                roas: c.spend > 0 ? c.convValue / c.spend : 0,
                color: c.color,
              }))} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis type="number" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" tickFormatter={(v) => `${v.toFixed(1)}x`} />
                <YAxis type="category" dataKey="label" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" width={80} />
                <ReferenceLine x={1} stroke="#ef4444" strokeDasharray="4 4" />
                <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }} formatter={(val) => `${Number(val).toFixed(2)}x`} />
                <Bar dataKey="roas" fill="#10b981" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* ROW 4: 밸런스랩 공구 매출 */}
      {(gongguSummary.gongguTotal > 0 || gongguSummary.selfTotal > 0) && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">밸런스랩 공구 매출</h3>
              <Link href="/sales?tab=gonggu" className="text-xs text-primary hover:underline">상세 →</Link>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="text-center">
                <p className="text-xs text-muted-foreground">자체매출</p>
                <p className="text-lg font-bold text-blue-500">{formatCurrency(gongguSummary.selfTotal)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">공구매출</p>
                <p className="text-lg font-bold text-purple-500">{formatCurrency(gongguSummary.gongguTotal)}</p>
              </div>
              {gongguSummary.sellers.slice(0, 2).map((s) => (
                <div key={s.seller} className="text-center">
                  <p className="text-xs text-muted-foreground">공구_{s.seller}</p>
                  <p className="text-lg font-bold">{formatCurrency(s.revenue)}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
