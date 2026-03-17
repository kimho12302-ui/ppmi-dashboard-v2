"use client";

import { useMemo, useState } from "react";
import {
  PieChart, Pie, Cell, Tooltip,
} from "recharts";
import { useFetch, useDateRange } from "@/hooks/use-dashboard-data";
import { Filters } from "@/components/filters";
import { ChartWrapper } from "@/components/charts/chart-wrapper";
import { CustomTooltip } from "@/components/charts/custom-tooltip";
import { Loading } from "@/components/ui/loading";
import { Card } from "@/components/ui/card";
import { BRAND_COLORS, BRAND_LABELS, CHANNEL_COLORS, CHANNEL_LABELS } from "@/lib/types";
import { formatCurrency, formatNumber } from "@/lib/utils";
import type { ProductSales } from "@/lib/types";

const PIE_COLORS = ["#6366f1", "#22c55e", "#f97316", "#ec4899", "#3b82f6", "#ef4444", "#8b5cf6", "#06b6d4"];

export default function SalesPage() {
  const { from, to, days, setDays } = useDateRange(30);
  const [brand, setBrand] = useState("all");
  const { data, loading } = useFetch<{ products: ProductSales[] }>(
    `/api/product-sales?from=${from}&to=${to}&brand=${brand}`
  );

  const channelPie = useMemo(() => {
    if (!data) return [];
    const byChannel = new Map<string, number>();
    data.products.forEach((p) => {
      const ch = p.channel;
      byChannel.set(ch, (byChannel.get(ch) || 0) + p.revenue);
    });
    return Array.from(byChannel.entries())
      .map(([channel, revenue]) => ({
        name: CHANNEL_LABELS[channel] || channel,
        value: revenue,
        channel,
      }))
      .sort((a, b) => b.value - a.value);
  }, [data]);

  const categoryPie = useMemo(() => {
    if (!data) return [];
    const categories = new Set(data.products.map((p) => p.category));
    if (categories.size <= 1) {
      // Show by product instead
      const byProduct = new Map<string, number>();
      data.products.forEach((p) => {
        byProduct.set(p.product, (byProduct.get(p.product) || 0) + p.revenue);
      });
      return Array.from(byProduct.entries())
        .map(([name, value]) => ({ name: name.length > 12 ? name.slice(0, 12) + "…" : name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 8);
    }
    const byCat = new Map<string, number>();
    data.products.forEach((p) => {
      byCat.set(p.category, (byCat.get(p.category) || 0) + p.revenue);
    });
    return Array.from(byCat.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [data]);

  const productTable = useMemo(() => {
    if (!data) return [];
    const byProduct = new Map<string, { revenue: number; quantity: number; brand: string; channel: string }>();
    data.products.forEach((p) => {
      const existing = byProduct.get(p.product);
      if (existing) {
        existing.revenue += p.revenue;
        existing.quantity += p.quantity;
      } else {
        byProduct.set(p.product, { revenue: p.revenue, quantity: p.quantity, brand: p.brand, channel: p.channel });
      }
    });
    return Array.from(byProduct.entries())
      .map(([product, info]) => ({ product, ...info }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 30);
  }, [data]);

  if (loading) return <Loading />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">매출 분석</h1>
          <p className="text-sm text-muted-foreground">제품별/채널별 매출 상세</p>
        </div>
      </div>

      <Filters brand={brand} onBrandChange={setBrand} days={days} onDaysChange={setDays} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Channel Pie */}
        <ChartWrapper title="채널별 매출" height={300}>
          <PieChart>
            <Pie
              data={channelPie}
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
              {channelPie.map((entry, i) => (
                <Cell key={i} fill={CHANNEL_COLORS[entry.channel] || PIE_COLORS[i % PIE_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ChartWrapper>

        {/* Category / Product Pie */}
        <ChartWrapper title="카테고리별 매출" height={300}>
          <PieChart>
            <Pie
              data={categoryPie}
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
              {categoryPie.map((_, i) => (
                <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ChartWrapper>
      </div>

      {/* Product Table */}
      <Card>
        <div className="px-6 py-4 border-b">
          <h3 className="text-sm font-semibold text-muted-foreground">제품 매출 테이블</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="px-6 py-3 font-medium text-muted-foreground">제품</th>
                <th className="px-6 py-3 font-medium text-muted-foreground">브랜드</th>
                <th className="px-6 py-3 font-medium text-muted-foreground text-right">매출</th>
                <th className="px-6 py-3 font-medium text-muted-foreground text-right">수량</th>
              </tr>
            </thead>
            <tbody>
              {productTable.map((row, i) => (
                <tr key={i} className="border-b last:border-b-0 hover:bg-muted/50 transition-colors">
                  <td className="px-6 py-3">{row.product}</td>
                  <td className="px-6 py-3">
                    <span
                      className="inline-block w-2 h-2 rounded-full mr-2"
                      style={{ backgroundColor: BRAND_COLORS[row.brand] || "#888" }}
                    />
                    {BRAND_LABELS[row.brand] || row.brand}
                  </td>
                  <td className="px-6 py-3 text-right font-medium">{formatCurrency(row.revenue)}</td>
                  <td className="px-6 py-3 text-right">{formatNumber(row.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
