"use client";

import { useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ComposedChart, Bar,
} from "recharts";
import { useFetch, useDateRange } from "@/hooks/use-dashboard-data";
import { Filters } from "@/components/filters";
import { ChartWrapper } from "@/components/charts/chart-wrapper";
import { CustomTooltip } from "@/components/charts/custom-tooltip";
import { Loading } from "@/components/ui/loading";
import { KpiCard } from "@/components/ui/kpi-card";
import { CHANNEL_COLORS, CHANNEL_LABELS } from "@/lib/types";
import { formatCurrency, formatNumber } from "@/lib/utils";
import type { DailyAdSpend } from "@/lib/types";

export default function AdsPage() {
  const { from, to, days, setDays } = useDateRange(30);
  const [brand, setBrand] = useState("all");
  const { data, loading } = useFetch<{ ads: DailyAdSpend[] }>(
    `/api/ads?from=${from}&to=${to}&brand=${brand}`
  );

  const channelSummary = useMemo(() => {
    if (!data) return [];
    const byChannel = new Map<string, { spend: number; convValue: number; impressions: number; clicks: number }>();
    data.ads.forEach((r) => {
      const ch = r.channel;
      const existing = byChannel.get(ch) || { spend: 0, convValue: 0, impressions: 0, clicks: 0 };
      existing.spend += r.spend || 0;
      existing.convValue += r.conversion_value || 0;
      existing.impressions += r.impressions || 0;
      existing.clicks += r.clicks || 0;
      byChannel.set(ch, existing);
    });
    return Array.from(byChannel.entries())
      .map(([channel, stats]) => ({
        channel,
        label: CHANNEL_LABELS[channel] || channel,
        spend: stats.spend,
        roas: stats.spend > 0 ? stats.convValue / stats.spend : 0,
        impressions: stats.impressions,
        clicks: stats.clicks,
      }))
      .sort((a, b) => b.spend - a.spend);
  }, [data]);

  const totalKpis = useMemo(() => {
    if (!data) return null;
    const totalSpend = data.ads.reduce((s, r) => s + (r.spend || 0), 0);
    const totalConvValue = data.ads.reduce((s, r) => s + (r.conversion_value || 0), 0);
    const totalClicks = data.ads.reduce((s, r) => s + (r.clicks || 0), 0);
    const totalImpressions = data.ads.reduce((s, r) => s + (r.impressions || 0), 0);
    return {
      spend: totalSpend,
      roas: totalSpend > 0 ? totalConvValue / totalSpend : 0,
      clicks: totalClicks,
      ctr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
    };
  }, [data]);

  const spendTrend = useMemo((): { channels: string[]; data: Record<string, unknown>[] } => {
    if (!data) return { channels: [], data: [] };
    const channels = Array.from(new Set(data.ads.map((r) => r.channel)));
    const byDate = new Map<string, Record<string, number>>();
    data.ads.forEach((r) => {
      const entry = byDate.get(r.date) || {};
      entry[r.channel] = (entry[r.channel] || 0) + r.spend;
      byDate.set(r.date, entry);
    });
    return { channels, data: Array.from(byDate.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([date, vals]) => ({ date: date.slice(5), ...vals })) };
  }, [data]);

  const roasTrend = useMemo(() => {
    if (!data) return { channels: [] as string[], data: [] as Record<string, unknown>[] };
    const channels = Array.from(new Set(data.ads.map((r) => r.channel)));
    const byDate = new Map<string, Record<string, { spend: number; convValue: number }>>();
    data.ads.forEach((r) => {
      const entry = byDate.get(r.date) || {};
      const ch = entry[r.channel] || { spend: 0, convValue: 0 };
      ch.spend += r.spend || 0;
      ch.convValue += r.conversion_value || 0;
      entry[r.channel] = ch;
      byDate.set(r.date, entry);
    });
    return {
      channels,
      data: Array.from(byDate.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, vals]) => {
          const row: Record<string, unknown> = { date: date.slice(5) };
          Object.entries(vals).forEach(([ch, v]) => {
            row[ch] = v.spend > 0 ? +(v.convValue / v.spend).toFixed(2) : 0;
          });
          return row;
        }),
    };
  }, [data]);

  if (loading) return <Loading />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">광고 분석</h1>
        <p className="text-sm text-muted-foreground">채널별 광고비와 ROAS 분석</p>
      </div>

      <Filters brand={brand} onBrandChange={setBrand} days={days} onDaysChange={setDays} />

      {totalKpis && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="총 광고비" value={formatCurrency(totalKpis.spend)} />
          <KpiCard title="통합 ROAS" value={totalKpis.roas.toFixed(2) + "x"} />
          <KpiCard title="총 클릭수" value={formatNumber(totalKpis.clicks)} />
          <KpiCard title="평균 CTR" value={totalKpis.ctr.toFixed(2) + "%"} />
        </div>
      )}

      {/* Channel Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {channelSummary.map((ch) => (
          <div
            key={ch.channel}
            className="rounded-xl border bg-card p-4 space-y-2"
            style={{ borderLeftWidth: 4, borderLeftColor: CHANNEL_COLORS[ch.channel] || "#888" }}
          >
            <p className="text-sm font-semibold">{ch.label}</p>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">광고비</span>
              <span className="font-medium">{formatCurrency(ch.spend)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">ROAS</span>
              <span className="font-medium">{ch.roas.toFixed(2)}x</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">클릭수</span>
              <span className="font-medium">{formatNumber(ch.clicks)}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Spend Trend */}
      <ChartWrapper title="채널별 광고비 트렌드" height={350}>
        <ComposedChart data={spendTrend.data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--chart-tick)" }} />
          <YAxis tick={{ fontSize: 11, fill: "var(--chart-tick)" }} tickFormatter={(v) => (v / 10000).toFixed(0) + "만"} />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {spendTrend.channels.map((ch) => (
            <Bar key={ch} dataKey={ch} stackId="spend" fill={CHANNEL_COLORS[ch] || "#888"} name={CHANNEL_LABELS[ch] || ch} />
          ))}
        </ComposedChart>
      </ChartWrapper>

      {/* ROAS Trend */}
      <ChartWrapper title="채널별 ROAS 트렌드" height={350}>
        <LineChart data={roasTrend.data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--chart-tick)" }} />
          <YAxis tick={{ fontSize: 11, fill: "var(--chart-tick)" }} />
          <Tooltip content={<CustomTooltip formatter={(v) => v.toFixed(2) + "x"} />} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {roasTrend.channels.map((ch) => (
            <Line key={ch} type="monotone" dataKey={ch} stroke={CHANNEL_COLORS[ch] || "#888"} name={CHANNEL_LABELS[ch] || ch} dot={false} strokeWidth={2} />
          ))}
        </LineChart>
      </ChartWrapper>
    </div>
  );
}
