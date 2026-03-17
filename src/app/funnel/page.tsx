"use client";

import { useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  AreaChart, Area,
} from "recharts";
import { useFetch, useDateRange } from "@/hooks/use-dashboard-data";
import { DateRangeSelector } from "@/components/ui/date-range-selector";
import { ChartWrapper } from "@/components/charts/chart-wrapper";
import { CustomTooltip } from "@/components/charts/custom-tooltip";
import { Loading } from "@/components/ui/loading";
import { Card } from "@/components/ui/card";
import { formatNumber } from "@/lib/utils";
import type { DailyFunnel } from "@/lib/types";

const FUNNEL_STEPS = [
  { key: "impressions", label: "노출", color: "#6366f1" },
  { key: "sessions", label: "유입", color: "#3b82f6" },
  { key: "cart_adds", label: "장바구니", color: "#f97316" },
  { key: "purchases", label: "구매", color: "#22c55e" },
  { key: "repurchases", label: "재구매", color: "#ec4899" },
] as const;

const CHANNEL_BRANDS = [
  { key: "cafe24", label: "카페24", color: "#3b82f6" },
  { key: "smartstore", label: "스마트스토어", color: "#22c55e" },
  { key: "coupang", label: "쿠팡", color: "#ef4444" },
];

export default function FunnelPage() {
  const { from, to, days, setDays } = useDateRange(30);
  const { data, loading } = useFetch<{ funnel: DailyFunnel[] }>(
    `/api/funnel?from=${from}&to=${to}`
  );

  const totalFunnel = useMemo(() => {
    if (!data) return null;
    const allData = data.funnel.filter((r) => r.brand === "all");
    const totals = {
      impressions: 0, sessions: 0, cart_adds: 0, purchases: 0, repurchases: 0,
    };
    allData.forEach((r) => {
      totals.impressions += r.impressions || 0;
      totals.sessions += r.sessions || 0;
      totals.cart_adds += r.cart_adds || 0;
      totals.purchases += r.purchases || 0;
      totals.repurchases += r.repurchases || 0;
    });
    return totals;
  }, [data]);

  const funnelBars = useMemo(() => {
    if (!totalFunnel) return [];
    return FUNNEL_STEPS.map((step) => ({
      name: step.label,
      value: totalFunnel[step.key],
      color: step.color,
      rate: totalFunnel.impressions > 0
        ? ((totalFunnel[step.key] / totalFunnel.impressions) * 100).toFixed(1)
        : "0",
    }));
  }, [totalFunnel]);

  const channelComparison = useMemo(() => {
    if (!data) return [];
    return FUNNEL_STEPS.map((step) => {
      const row: Record<string, unknown> = { name: step.label };
      CHANNEL_BRANDS.forEach((ch) => {
        const channelData = data.funnel.filter((r) => r.brand === ch.key);
        row[ch.label] = channelData.reduce((s, r) => s + ((r as unknown as Record<string, number>)[step.key] || 0), 0);
      });
      return row;
    });
  }, [data]);

  const dailyTrend = useMemo(() => {
    if (!data) return [];
    const allData = data.funnel.filter((r) => r.brand === "all");
    return allData
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => ({
        date: r.date.slice(5),
        노출: r.impressions,
        유입: r.sessions,
        장바구니: r.cart_adds,
        구매: r.purchases,
        재구매: r.repurchases,
      }));
  }, [data]);

  if (loading) return <Loading />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">퍼널 분석</h1>
          <p className="text-sm text-muted-foreground">노출 → 유입 → 장바구니 → 구매 → 재구매</p>
        </div>
        <DateRangeSelector days={days} onChange={setDays} />
      </div>

      {/* Funnel Visualization */}
      <Card className="p-6">
        <h3 className="text-sm font-semibold text-muted-foreground mb-4">전체 퍼널</h3>
        <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-0">
          {funnelBars.map((step, i) => (
            <div key={step.name} className="flex items-center gap-2 sm:gap-0 flex-1 w-full">
              <div
                className="flex-1 rounded-lg py-4 px-3 text-center text-white font-medium"
                style={{
                  backgroundColor: step.color,
                  opacity: 0.7 + (0.3 * (1 - i / FUNNEL_STEPS.length)),
                }}
              >
                <p className="text-xs opacity-80">{step.name}</p>
                <p className="text-lg font-bold">{formatNumber(step.value)}</p>
                <p className="text-xs opacity-80">{step.rate}%</p>
              </div>
              {i < funnelBars.length - 1 && (
                <div className="hidden sm:block text-muted-foreground text-lg px-1">→</div>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* Channel Funnel Comparison */}
      <ChartWrapper title="채널별 퍼널 비교" height={350}>
        <BarChart data={channelComparison}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--chart-tick)" }} />
          <YAxis tick={{ fontSize: 11, fill: "var(--chart-tick)" }} tickFormatter={(v) => formatNumber(v)} />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {CHANNEL_BRANDS.map((ch) => (
            <Bar key={ch.key} dataKey={ch.label} fill={ch.color} radius={[4, 4, 0, 0]} />
          ))}
        </BarChart>
      </ChartWrapper>

      {/* Daily Funnel Trend */}
      <ChartWrapper title="일별 퍼널 트렌드" height={350}>
        <AreaChart data={dailyTrend}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--chart-tick)" }} />
          <YAxis tick={{ fontSize: 11, fill: "var(--chart-tick)" }} tickFormatter={(v) => formatNumber(v)} />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {FUNNEL_STEPS.map((step) => (
            <Area
              key={step.key}
              type="monotone"
              dataKey={step.label}
              stroke={step.color}
              fill={step.color}
              fillOpacity={0.1}
              strokeWidth={2}
            />
          ))}
        </AreaChart>
      </ChartWrapper>

      {/* Channel Stats Table */}
      <Card>
        <div className="px-6 py-4 border-b">
          <h3 className="text-sm font-semibold text-muted-foreground">채널별 퍼널 수치</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="px-6 py-3 font-medium text-muted-foreground">채널</th>
                {FUNNEL_STEPS.map((s) => (
                  <th key={s.key} className="px-6 py-3 font-medium text-muted-foreground text-right">{s.label}</th>
                ))}
                <th className="px-6 py-3 font-medium text-muted-foreground text-right">전환율</th>
              </tr>
            </thead>
            <tbody>
              {CHANNEL_BRANDS.map((ch) => {
                const chData = data?.funnel.filter((r) => r.brand === ch.key) || [];
                const totals = {
                  impressions: chData.reduce((s, r) => s + (r.impressions || 0), 0),
                  sessions: chData.reduce((s, r) => s + (r.sessions || 0), 0),
                  cart_adds: chData.reduce((s, r) => s + (r.cart_adds || 0), 0),
                  purchases: chData.reduce((s, r) => s + (r.purchases || 0), 0),
                  repurchases: chData.reduce((s, r) => s + (r.repurchases || 0), 0),
                };
                const convRate = totals.sessions > 0 ? ((totals.purchases / totals.sessions) * 100).toFixed(2) : "0";
                return (
                  <tr key={ch.key} className="border-b last:border-b-0 hover:bg-muted/50 transition-colors">
                    <td className="px-6 py-3 font-medium">
                      <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ backgroundColor: ch.color }} />
                      {ch.label}
                    </td>
                    {FUNNEL_STEPS.map((s) => (
                      <td key={s.key} className="px-6 py-3 text-right">{formatNumber(totals[s.key])}</td>
                    ))}
                    <td className="px-6 py-3 text-right font-medium">{convRate}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
