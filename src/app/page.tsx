"use client";

import { Suspense, useMemo, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent } from "@/components/ui/card";
import { useFilterParams, useFetch } from "@/hooks/use-dashboard-data";
import { BRAND_LABELS, BRAND_COLORS, CHANNEL_LABELS, CHANNEL_COLORS, type DailySales, type DailyAdSpend } from "@/lib/types";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

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
  }>(`/api/dashboard?from=${from}&to=${to}`);
  const [selectedKpi, setSelectedKpi] = useState<KpiKey>(null);

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

  /* KPI */
  const kpi = useMemo(() => {
    const revenue = sales.reduce((s, r) => s + (r.revenue || 0), 0);
    const orders = sales.reduce((s, r) => s + (r.orders || 0), 0);
    const nonGa4Ads = ads.filter((r) => !r.channel.startsWith("ga4_"));
    const adSpend = nonGa4Ads.reduce((s, r) => s + (r.spend || 0), 0);
    const clicks = nonGa4Ads.reduce((s, r) => s + (r.clicks || 0), 0);
    const impressions = nonGa4Ads.reduce((s, r) => s + (r.impressions || 0), 0);
    const convValue = nonGa4Ads.reduce((s, r) => s + (r.conversion_value || 0), 0);
    return {
      revenue,
      orders,
      adSpend,
      roas: adSpend > 0 ? convValue / adSpend : 0,
      grossProfit: revenue - adSpend,
      profitRate: revenue > 0 ? ((revenue - adSpend) / revenue) * 100 : 0,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      aov: orders > 0 ? revenue / orders : 0,
    };
  }, [sales, ads]);

  /* 브랜드별 상세 (KPI 드릴다운) */
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
    return Object.entries(map)
      .map(([b, v]) => ({
        brand: b,
        label: BRAND_LABELS[b] || b,
        color: BRAND_COLORS[b] || "#6b7280",
        ...v,
        roas: v.adSpend > 0 ? v.convValue / v.adSpend : 0,
        profit: v.revenue - v.adSpend,
        profitRate: v.revenue > 0 ? ((v.revenue - v.adSpend) / v.revenue) * 100 : 0,
        ctr: v.impressions > 0 ? (v.clicks / v.impressions) * 100 : 0,
        aov: v.orders > 0 ? v.revenue / v.orders : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [sales, ads]);

  /* 채널별 상세 */
  const channelBreakdown = useMemo(() => {
    const map: Record<string, { spend: number; clicks: number; impressions: number; convValue: number }> = {};
    for (const r of ads) {
      if (r.channel.startsWith("ga4_")) continue;
      if (!map[r.channel]) map[r.channel] = { spend: 0, clicks: 0, impressions: 0, convValue: 0 };
      map[r.channel].spend += r.spend || 0;
      map[r.channel].clicks += r.clicks || 0;
      map[r.channel].impressions += r.impressions || 0;
      map[r.channel].convValue += r.conversion_value || 0;
    }
    return Object.entries(map)
      .map(([ch, v]) => ({
        channel: ch,
        label: CHANNEL_LABELS[ch] || ch,
        color: CHANNEL_COLORS[ch] || "#6b7280",
        ...v,
        roas: v.spend > 0 ? v.convValue / v.spend : 0,
        ctr: v.impressions > 0 ? (v.clicks / v.impressions) * 100 : 0,
      }))
      .sort((a, b) => b.spend - a.spend);
  }, [ads]);

  /* 일별 매출 트렌드 */
  const dailyRevenue = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of sales) {
      map[r.date] = (map[r.date] || 0) + (r.revenue || 0);
    }
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, revenue]) => ({ date: date.slice(5), revenue }));
  }, [sales]);

  /* 브랜드 비중 */
  const brandShare = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of sales) {
      map[r.brand] = (map[r.brand] || 0) + (r.revenue || 0);
    }
    return Object.entries(map)
      .map(([b, revenue]) => ({
        name: BRAND_LABELS[b] || b,
        value: revenue,
        color: BRAND_COLORS[b] || "#6b7280",
      }))
      .sort((a, b) => b.value - a.value);
  }, [sales]);

  const toggleKpi = (key: KpiKey) => {
    setSelectedKpi((prev) => (prev === key ? null : key));
  };

  /* 드릴다운 패널 데이터 */
  const drilldownData = useMemo(() => {
    if (!selectedKpi) return null;

    const kpiConfig: Record<string, { title: string; type: "brand" | "channel"; valueKey: string; format: (v: number) => string }> = {
      revenue: { title: "브랜드별 매출", type: "brand", valueKey: "revenue", format: formatCurrency },
      orders: { title: "브랜드별 주문 수", type: "brand", valueKey: "orders", format: formatNumber },
      adSpend: { title: "채널별 광고비", type: "channel", valueKey: "spend", format: formatCurrency },
      roas: { title: "채널별 ROAS", type: "channel", valueKey: "roas", format: (v) => `${v.toFixed(2)}x` },
      profit: { title: "브랜드별 통상이익", type: "brand", valueKey: "profit", format: formatCurrency },
      profitRate: { title: "브랜드별 이익률", type: "brand", valueKey: "profitRate", format: (v) => formatPercent(v) },
      ctr: { title: "채널별 CTR", type: "channel", valueKey: "ctr", format: (v) => formatPercent(v) },
      aov: { title: "브랜드별 객단가", type: "brand", valueKey: "aov", format: (v) => formatCurrency(Math.round(v)) },
    };

    const config = kpiConfig[selectedKpi];
    if (!config) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const source: any[] = config.type === "brand" ? brandBreakdown : channelBreakdown;
    return {
      title: config.title,
      rows: source.map((item) => ({
        label: item.label,
        color: item.color,
        value: item[config.valueKey] as number,
        formatted: config.format(item[config.valueKey] as number),
      })),
    };
  }, [selectedKpi, brandBreakdown, channelBreakdown]);

  if (loading) {
    return (
      <PageShell title="Overview" description="PPMI 마케팅 대시보드 전체 현황">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <Card key={i} className="p-5 animate-pulse">
              <CardContent className="p-0">
                <div className="h-4 w-20 bg-muted rounded mb-2" />
                <div className="h-8 w-28 bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell title="Overview" description="PPMI 마케팅 대시보드 전체 현황">
      {/* KPI 8개 — 클릭 가능 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="매출" value={formatCurrency(kpi.revenue)} onClick={() => toggleKpi("revenue")} active={selectedKpi === "revenue"} />
        <KpiCard title="광고비" value={formatCurrency(kpi.adSpend)} onClick={() => toggleKpi("adSpend")} active={selectedKpi === "adSpend"} />
        <KpiCard title="ROAS" value={`${kpi.roas.toFixed(2)}x`} onClick={() => toggleKpi("roas")} active={selectedKpi === "roas"} />
        <KpiCard title="주문 수" value={formatNumber(kpi.orders)} onClick={() => toggleKpi("orders")} active={selectedKpi === "orders"} />
        <KpiCard title="통상이익" value={formatCurrency(kpi.grossProfit)} onClick={() => toggleKpi("profit")} active={selectedKpi === "profit"} />
        <KpiCard title="이익률" value={formatPercent(kpi.profitRate)} onClick={() => toggleKpi("profitRate")} active={selectedKpi === "profitRate"} />
        <KpiCard title="CTR" value={formatPercent(kpi.ctr)} onClick={() => toggleKpi("ctr")} active={selectedKpi === "ctr"} />
        <KpiCard title="객단가" value={kpi.aov > 0 ? formatCurrency(Math.round(kpi.aov)) : "—"} onClick={() => toggleKpi("aov")} active={selectedKpi === "aov"} />
      </div>

      {/* 드릴다운 패널 */}
      {drilldownData && (
        <Card className="animate-in slide-in-from-top-2 duration-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm">{drilldownData.title}</h3>
              <button
                onClick={() => setSelectedKpi(null)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                닫기 ✕
              </button>
            </div>
            <div className="space-y-2">
              {drilldownData.rows.map((row) => {
                const maxVal = Math.max(...drilldownData.rows.map((r) => Math.abs(r.value)));
                const barWidth = maxVal > 0 ? (Math.abs(row.value) / maxVal) * 100 : 0;
                return (
                  <div key={row.label} className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: row.color }} />
                    <span className="text-sm w-24 flex-shrink-0">{row.label}</span>
                    <div className="flex-1 h-5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${barWidth}%`,
                          backgroundColor: row.value >= 0 ? row.color : "#ef4444",
                        }}
                      />
                    </div>
                    <span className={`text-sm font-medium w-24 text-right flex-shrink-0 ${row.value < 0 ? "text-red-500" : ""}`}>
                      {row.formatted}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 차트 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardContent className="p-4">
            <h3 className="font-semibold mb-4">일별 매출 트렌드</h3>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={dailyRevenue}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" tickFormatter={(v) => `${(v / 10000).toFixed(0)}만`} />
                <Tooltip
                  contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                  formatter={(val) => formatCurrency(Number(val))}
                />
                <Area type="monotone" dataKey="revenue" name="매출" stroke="#2563eb" fill="#2563eb" fillOpacity={0.15} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <h3 className="font-semibold mb-4">브랜드 매출 비중</h3>
            {brandShare.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={brandShare}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={90}
                    dataKey="value"
                    nameKey="name"
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    label={({ name, percent }: any) => `${name || ''} ${((percent || 0) * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {brandShare.map((entry, idx) => (
                      <Cell key={idx} fill={entry.color} />
                    ))}
                  </Pie>
                  <Legend />
                  <Tooltip formatter={(val) => formatCurrency(Number(val))} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[280px] text-muted-foreground">데이터 없음</div>
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
