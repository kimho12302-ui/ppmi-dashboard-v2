"use client";

import { Suspense, useMemo, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent } from "@/components/ui/card";
import { useFilterParams, useFetch } from "@/hooks/use-dashboard-data";
import {
  BRAND_LABELS, BRAND_COLORS, CHANNEL_LABELS, CHANNEL_COLORS,
  SALES_CHANNEL_COLORS,
  type DailySales, type DailyAdSpend, type DailyFunnel, type ProductSales,
} from "@/lib/types";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
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
  const { data, loading } = useFetch<{
    sales: DailySales[];
    ads: DailyAdSpend[];
    products: ProductSales[];
    funnel: DailyFunnel[];
    prevSales: DailySales[];
    prevAds: DailyAdSpend[];
  }>(`/api/dashboard?from=${from}&to=${to}`);
  const [selectedKpi, setSelectedKpi] = useState<KpiKey>(null);

  // 퍼널 별도 fetch
  const { data: funnelData } = useFetch<{ funnel: DailyFunnel[] }>(`/api/funnel?from=${from}&to=${to}`);
  // 목표 fetch
  const { data: targetsData } = useFetch<{ targets: Record<string, { revenue_target: number; ad_budget_target: number; roas_target: number }> }>("/api/targets");

  const sales = useMemo(() => {
    const all = data?.sales || [];
    if (!brand || brand === "all") return all;
    return all.filter((r) => r.brand === brand);
  }, [data, brand]);

  const ads = useMemo(() => {
    const all = data?.ads || [];
    if (!brand || brand === "all") return all;
    return all.filter((r) => r.brand === brand);
  }, [data, brand]);

  const products = useMemo(() => {
    const all = data?.products || [];
    if (!brand || brand === "all") return all;
    return all.filter((r) => r.brand === brand);
  }, [data, brand]);

  const funnel = useMemo(() => {
    const all = funnelData?.funnel || [];
    return all.filter((r) => r.brand !== "all");
  }, [funnelData]);

  /* ── 이전 기간 (전기간 대비) ── */
  const prevSales = useMemo(() => {
    const all = data?.prevSales || [];
    if (!brand || brand === "all") return all;
    return all.filter((r) => r.brand === brand);
  }, [data, brand]);

  const prevAds = useMemo(() => {
    const all = data?.prevAds || [];
    if (!brand || brand === "all") return all;
    return all.filter((r) => r.brand === brand);
  }, [data, brand]);

  /* ── KPI ── */
  const calcKpi = (s: DailySales[], a: DailyAdSpend[]) => {
    const revenue = s.reduce((acc, r) => acc + (r.revenue || 0), 0);
    const orders = s.reduce((acc, r) => acc + (r.orders || 0), 0);
    const nonGa4 = a.filter((r) => !r.channel.startsWith("ga4_"));
    const adSpend = nonGa4.reduce((acc, r) => acc + (r.spend || 0), 0);
    const clicks = nonGa4.reduce((acc, r) => acc + (r.clicks || 0), 0);
    const impressions = nonGa4.reduce((acc, r) => acc + (r.impressions || 0), 0);
    const convValue = nonGa4.reduce((acc, r) => acc + (r.conversion_value || 0), 0);
    return {
      revenue, orders, adSpend,
      roas: adSpend > 0 ? convValue / adSpend : 0,
      grossProfit: revenue - adSpend,
      profitRate: revenue > 0 ? ((revenue - adSpend) / revenue) * 100 : 0,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      aov: orders > 0 ? revenue / orders : 0,
    };
  };

  const kpi = useMemo(() => calcKpi(sales, ads), [sales, ads]);
  const prevKpi = useMemo(() => calcKpi(prevSales, prevAds), [prevSales, prevAds]);

  /* 변화율 계산 */
  const pctChange = (cur: number, prev: number) => {
    if (prev === 0) return cur > 0 ? 100 : undefined;
    return ((cur - prev) / Math.abs(prev)) * 100;
  };

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
      brand: b, label: BRAND_LABELS[b] || b, color: BRAND_COLORS[b] || "#6b7280",
      ...v,
      roas: v.adSpend > 0 ? v.convValue / v.adSpend : 0,
      profit: v.revenue - v.adSpend,
      profitRate: v.revenue > 0 ? ((v.revenue - v.adSpend) / v.revenue) * 100 : 0,
      ctr: v.impressions > 0 ? (v.clicks / v.impressions) * 100 : 0,
      aov: v.orders > 0 ? v.revenue / v.orders : 0,
    })).sort((a, b) => b.revenue - a.revenue);
  }, [sales, ads]);

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
      channel: ch, label: CHANNEL_LABELS[ch] || ch, color: CHANNEL_COLORS[ch] || "#6b7280",
      ...v,
      roas: v.spend > 0 ? v.convValue / v.spend : 0,
      ctr: v.impressions > 0 ? (v.clicks / v.impressions) * 100 : 0,
    })).sort((a, b) => b.spend - a.spend);
  }, [ads]);

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
      channel: ch, label: CHANNEL_LABELS[ch] || ch, color: SALES_CHANNEL_COLORS[ch] || "#6b7280", ...v,
    })).sort((a, b) => b.revenue - a.revenue);
  }, [sales]);

  /* ── 일별 매출+광고비 트렌드 ── */
  const dailyTrend = useMemo(() => {
    const map: Record<string, { revenue: number; adSpend: number }> = {};
    for (const r of sales) {
      if (!map[r.date]) map[r.date] = { revenue: 0, adSpend: 0 };
      map[r.date].revenue += r.revenue || 0;
    }
    for (const r of ads) {
      if (r.channel.startsWith("ga4_")) continue;
      if (!map[r.date]) map[r.date] = { revenue: 0, adSpend: 0 };
      map[r.date].adSpend += r.spend || 0;
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date: date.slice(5), ...v }));
  }, [sales, ads]);

  /* ── 브랜드 비중 (파이) ── */
  const brandShare = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of sales) map[r.brand] = (map[r.brand] || 0) + (r.revenue || 0);
    return Object.entries(map).map(([b, revenue]) => ({
      name: BRAND_LABELS[b] || b, value: revenue, color: BRAND_COLORS[b] || "#6b7280",
    })).sort((a, b) => b.value - a.value);
  }, [sales]);

  /* ── 퍼널 요약 ── */
  const funnelSummary = useMemo(() => {
    const sessions = funnel.reduce((s, r) => s + (r.sessions || 0), 0);
    const cartAdds = funnel.reduce((s, r) => s + (r.cart_adds || 0), 0);
    const purchases = funnel.reduce((s, r) => s + (r.purchases || 0), 0);
    const repurchases = funnel.reduce((s, r) => s + (r.repurchases || 0), 0);
    return {
      sessions, cartAdds, purchases, repurchases,
      cartRate: sessions > 0 ? (cartAdds / sessions) * 100 : 0,
      purchaseRate: cartAdds > 0 ? (purchases / cartAdds) * 100 : 0,
    };
  }, [funnel]);

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
        <KpiCard title="매출" value={formatCurrency(kpi.revenue)} change={pctChange(kpi.revenue, prevKpi.revenue)} target={targetProp(kpi.revenue, targets?.revenue_target, "목표")} onClick={() => toggleKpi("revenue")} active={selectedKpi === "revenue"} />
        <KpiCard title="광고비" value={formatCurrency(kpi.adSpend)} change={pctChange(kpi.adSpend, prevKpi.adSpend)} target={targetProp(kpi.adSpend, targets?.ad_budget_target, "예산")} onClick={() => toggleKpi("adSpend")} active={selectedKpi === "adSpend"} />
        <KpiCard title="ROAS" value={`${kpi.roas.toFixed(2)}x`} change={pctChange(kpi.roas, prevKpi.roas)} target={targetProp(kpi.roas, targets?.roas_target, "목표")} onClick={() => toggleKpi("roas")} active={selectedKpi === "roas"} />
        <KpiCard title="주문 수" value={formatNumber(kpi.orders)} change={pctChange(kpi.orders, prevKpi.orders)} onClick={() => toggleKpi("orders")} active={selectedKpi === "orders"} />
        <KpiCard title="통상이익" value={formatCurrency(kpi.grossProfit)} change={pctChange(kpi.grossProfit, prevKpi.grossProfit)} onClick={() => toggleKpi("profit")} active={selectedKpi === "profit"} />
        <KpiCard title="이익률" value={formatPercent(kpi.profitRate)} change={pctChange(kpi.profitRate, prevKpi.profitRate)} onClick={() => toggleKpi("profitRate")} active={selectedKpi === "profitRate"} />
        <KpiCard title="CTR" value={formatPercent(kpi.ctr)} change={pctChange(kpi.ctr, prevKpi.ctr)} onClick={() => toggleKpi("ctr")} active={selectedKpi === "ctr"} />
        <KpiCard title="객단가" value={kpi.aov > 0 ? formatCurrency(Math.round(kpi.aov)) : "—"} change={pctChange(kpi.aov, prevKpi.aov)} onClick={() => toggleKpi("aov")} active={selectedKpi === "aov"} />
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
            <h3 className="font-semibold mb-4">브랜드 매출 비중</h3>
            {brandShare.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={brandShare} cx="50%" cy="50%" innerRadius={45} outerRadius={85} dataKey="value" nameKey="name"
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    label={({ name, percent }: any) => `${name || ''} ${((percent || 0) * 100).toFixed(0)}%`} labelLine={false}
                  >
                    {brandShare.map((e, i) => <Cell key={i} fill={e.color} />)}
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
