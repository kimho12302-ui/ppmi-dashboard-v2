"use client";

import { useMemo } from "react";
import {
  BarChart, Bar, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ComposedChart,
} from "recharts";
import { useFetch, useDateRange } from "@/hooks/use-dashboard-data";
import { KpiCard } from "@/components/ui/kpi-card";
import { ChartWrapper } from "@/components/charts/chart-wrapper";
import { CustomTooltip } from "@/components/charts/custom-tooltip";
import { DateRangeSelector } from "@/components/ui/date-range-selector";
import { Loading } from "@/components/ui/loading";
import { BRAND_COLORS, BRAND_LABELS } from "@/lib/types";
import { formatCurrency, formatNumber } from "@/lib/utils";
import type { DailySales, DailyAdSpend, ProductSales } from "@/lib/types";

interface DashboardData {
  sales: DailySales[];
  ads: DailyAdSpend[];
  products: ProductSales[];
}

export default function OverviewPage() {
  const { from, to, days, setDays } = useDateRange(30);
  const { data, loading } = useFetch<DashboardData>(
    `/api/dashboard?from=${from}&to=${to}`
  );

  const kpis = useMemo(() => {
    if (!data) return null;
    const totalRevenue = data.sales.reduce((s, r) => s + (r.revenue || 0), 0);
    const totalAdSpend = data.ads.reduce((s, r) => s + (r.spend || 0), 0);
    const totalOrders = data.sales.reduce((s, r) => s + (r.orders || 0), 0);
    const totalConvValue = data.ads.reduce((s, r) => s + (r.conversion_value || 0), 0);
    const roas = totalAdSpend > 0 ? totalConvValue / totalAdSpend : 0;
    return { totalRevenue, totalAdSpend, totalOrders, roas };
  }, [data]);

  const revenueTrend = useMemo(() => {
    if (!data) return [];
    const byDate = new Map<string, Record<string, number>>();
    const adByDate = new Map<string, number>();
    data.sales.forEach((r) => {
      const entry = byDate.get(r.date) || {};
      entry[r.brand] = (entry[r.brand] || 0) + r.revenue;
      byDate.set(r.date, entry);
    });
    data.ads.forEach((r) => {
      adByDate.set(r.date, (adByDate.get(r.date) || 0) + r.spend);
    });
    return Array.from(byDate.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, brands]) => ({
        date: date.slice(5),
        ...brands,
        광고비: adByDate.get(date) || 0,
      }));
  }, [data]);

  const brandRevenue = useMemo(() => {
    if (!data) return [];
    const byBrand = new Map<string, number>();
    data.sales.forEach((r) => {
      byBrand.set(r.brand, (byBrand.get(r.brand) || 0) + r.revenue);
    });
    return Array.from(byBrand.entries())
      .map(([brand, revenue]) => ({
        name: BRAND_LABELS[brand] || brand,
        value: revenue,
        brand,
      }))
      .sort((a, b) => b.value - a.value);
  }, [data]);

  const top5Products = useMemo(() => {
    if (!data) return [];
    const byProduct = new Map<string, { revenue: number; brand: string }>();
    data.products.forEach((p) => {
      const existing = byProduct.get(p.product);
      if (existing) {
        existing.revenue += p.revenue;
      } else {
        byProduct.set(p.product, { revenue: p.revenue, brand: p.brand });
      }
    });
    return Array.from(byProduct.entries())
      .map(([name, info]) => ({ name: name.length > 15 ? name.slice(0, 15) + "…" : name, revenue: info.revenue, brand: info.brand }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
  }, [data]);

  if (loading) return <Loading />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Overview</h1>
          <p className="text-sm text-muted-foreground">PPMI 대시보드 전체 현황</p>
        </div>
        <DateRangeSelector days={days} onChange={setDays} />
      </div>

      {/* KPI Cards */}
      {kpis && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="총 매출" value={formatCurrency(kpis.totalRevenue)} />
          <KpiCard title="광고비" value={formatCurrency(kpis.totalAdSpend)} />
          <KpiCard title="ROAS" value={kpis.roas.toFixed(2) + "x"} />
          <KpiCard title="주문 수" value={formatNumber(kpis.totalOrders)} />
        </div>
      )}

      {/* Revenue Trend + Ad Spend */}
      <ChartWrapper title="매출 트렌드 (브랜드별) + 광고비" height={350}>
        <ComposedChart data={revenueTrend}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--chart-tick)" }} />
          <YAxis tick={{ fontSize: 11, fill: "var(--chart-tick)" }} tickFormatter={(v) => (v / 10000).toFixed(0) + "만"} />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {Object.entries(BRAND_COLORS).map(([brand, color]) => (
            <Bar key={brand} dataKey={brand} stackId="revenue" fill={color} name={BRAND_LABELS[brand] || brand} radius={[0, 0, 0, 0]} />
          ))}
          <Line type="monotone" dataKey="광고비" stroke="#ef4444" strokeWidth={2} dot={false} name="광고비" />
        </ComposedChart>
      </ChartWrapper>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Brand Revenue Pie */}
        <ChartWrapper title="브랜드별 매출 비중" height={300}>
          <PieChart>
            <Pie
              data={brandRevenue}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={100}
              dataKey="value"
              nameKey="name"
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              label={((props: any) => `${props.name || ""} ${((props.percent || 0) * 100).toFixed(0)}%`) as any}
              labelLine={false}
            >
              {brandRevenue.map((entry, i) => (
                <Cell key={i} fill={BRAND_COLORS[entry.brand] || "#888"} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ChartWrapper>

        {/* Top 5 Products */}
        <ChartWrapper title="TOP 5 제품" height={300}>
          <BarChart data={top5Products} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
            <XAxis type="number" tick={{ fontSize: 11, fill: "var(--chart-tick)" }} tickFormatter={(v) => (v / 10000).toFixed(0) + "만"} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "var(--chart-tick)" }} width={120} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="revenue" name="매출" radius={[0, 4, 4, 0]}>
              {top5Products.map((entry, i) => (
                <Cell key={i} fill={BRAND_COLORS[entry.brand] || "#888"} />
              ))}
            </Bar>
          </BarChart>
        </ChartWrapper>
      </div>
    </div>
  );
}
