"use client";

import { Suspense, useMemo } from "react";
import { PageShell } from "@/components/page-shell";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent } from "@/components/ui/card";
import { useFilterParams, useFetch } from "@/hooks/use-dashboard-data";
import { BRAND_LABELS, BRAND_COLORS, type DailySales, type DailyAdSpend } from "@/lib/types";
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
      .map(([brand, revenue]) => ({
        name: BRAND_LABELS[brand] || brand,
        value: revenue,
        color: BRAND_COLORS[brand] || "#6b7280",
      }))
      .sort((a, b) => b.value - a.value);
  }, [sales]);

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
      {/* KPI 8개 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="매출" value={formatCurrency(kpi.revenue)} />
        <KpiCard title="광고비" value={formatCurrency(kpi.adSpend)} />
        <KpiCard title="ROAS" value={`${kpi.roas.toFixed(2)}x`} />
        <KpiCard title="주문 수" value={formatNumber(kpi.orders)} />
        <KpiCard title="통상이익" value={formatCurrency(kpi.grossProfit)} />
        <KpiCard title="이익률" value={formatPercent(kpi.profitRate)} />
        <KpiCard title="CTR" value={formatPercent(kpi.ctr)} />
        <KpiCard title="객단가" value={kpi.aov > 0 ? formatCurrency(Math.round(kpi.aov)) : "—"} />
      </div>

      {/* 차트 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 매출 트렌드 */}
        <Card className="lg:col-span-2">
          <CardContent className="p-4">
            <h3 className="font-semibold mb-4">일별 매출 트렌드</h3>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={dailyRevenue}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                <YAxis
                  tick={{ fontSize: 11 }}
                  stroke="var(--muted-foreground)"
                  tickFormatter={(v) => `${(v / 10000).toFixed(0)}만`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(val) => formatCurrency(Number(val))}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  name="매출"
                  stroke="#2563eb"
                  fill="#2563eb"
                  fillOpacity={0.15}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* 브랜드 비중 */}
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
              <div className="flex items-center justify-center h-[280px] text-muted-foreground">
                데이터 없음
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
