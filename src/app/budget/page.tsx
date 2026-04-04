"use client";

import { Suspense, useMemo } from "react";
import { PageShell } from "@/components/page-shell";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent } from "@/components/ui/card";
import { useFetch } from "@/hooks/use-dashboard-data";
import { BRAND_LABELS, BRAND_COLORS, CHANNEL_LABELS, type DailyAdSpend } from "@/lib/types";
import { useConfig } from "@/hooks/use-config";
import { formatCurrency, formatPercent } from "@/lib/utils";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

export default function BudgetPage() {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">로딩 중...</div>}>
      <BudgetInner />
    </Suspense>
  );
}

function BudgetInner() {
  const { brandMap, channelMap } = useConfig();
  // 이번 달 데이터
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const today = now.toISOString().split("T")[0];
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysPassed = now.getDate();

  const { data, loading } = useFetch<{ ads: DailyAdSpend[] }>(`/api/ads?from=${monthStart}&to=${today}`);

  const ads = useMemo(() => (data?.ads || []).filter((r) => !r.channel.startsWith("ga4_")), [data]);

  /* 브랜드별 집계 */
  const byBrand = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of ads) {
      map[r.brand] = (map[r.brand] || 0) + (r.spend || 0);
    }
    return Object.entries(map)
      .map(([brand, spent]) => ({
        brand,
        label: brandMap[brand]?.label || BRAND_LABELS[brand] || brand,
        color: brandMap[brand]?.color || BRAND_COLORS[brand] || "#6b7280",
        spent,
        projected: daysInMonth > 0 ? (spent / daysPassed) * daysInMonth : spent,
      }))
      .sort((a, b) => b.spent - a.spent);
  }, [ads, daysPassed, daysInMonth, brandMap]);

  /* 채널별 집계 */
  const byChannel = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of ads) {
      map[r.channel] = (map[r.channel] || 0) + (r.spend || 0);
    }
    return Object.entries(map)
      .map(([ch, spent]) => ({
        channel: ch,
        label: channelMap[ch]?.label || CHANNEL_LABELS[ch] || ch,
        spent,
        share: 0,
      }))
      .sort((a, b) => b.spent - a.spent)
      .map((item) => {
        const total = Object.values(map).reduce((s, v) => s + v, 0);
        return { ...item, share: total > 0 ? (item.spent / total) * 100 : 0 };
      });
  }, [ads, channelMap]);

  const totalSpent = ads.reduce((s, r) => s + (r.spend || 0), 0);
  const totalProjected = daysInMonth > 0 ? (totalSpent / daysPassed) * daysInMonth : totalSpent;

  if (loading) {
    return (
      <PageShell title="예산 현황" description="이번 달 광고비 집행 현황" hideFilters>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="p-5 animate-pulse">
              <CardContent className="p-0"><div className="h-8 w-28 bg-muted rounded" /></CardContent>
            </Card>
          ))}
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell title="예산 현황" description={`${now.getFullYear()}년 ${now.getMonth() + 1}월 광고비 집행 현황 (${daysPassed}/${daysInMonth}일)`} hideFilters>
      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <KpiCard title="이번 달 집행" value={formatCurrency(totalSpent)} />
        <KpiCard title="월말 예상" value={formatCurrency(Math.round(totalProjected))} subtitle={`일 평균 ${formatCurrency(Math.round(totalSpent / Math.max(daysPassed, 1)))}`} />
        <KpiCard title="진행률" value={`${daysPassed}/${daysInMonth}일`} subtitle={formatPercent((daysPassed / daysInMonth) * 100)} />
      </div>

      {/* 브랜드별 */}
      <Card>
        <CardContent className="p-4">
          <h3 className="font-semibold mb-4">브랜드별 광고비</h3>
          <div className="space-y-3">
            {byBrand.map((b) => (
              <div key={b.brand} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{b.label}</span>
                  <span>{formatCurrency(b.spent)} <span className="text-muted-foreground text-xs">(예상 {formatCurrency(Math.round(b.projected))})</span></span>
                </div>
                <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min((b.spent / Math.max(totalSpent, 1)) * 100, 100)}%`,
                      backgroundColor: b.color,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 채널별 분배 */}
      <Card>
        <CardContent className="p-4">
          <h3 className="font-semibold mb-4">매체별 예산 분배</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={byChannel} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis type="number" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" tickFormatter={(v) => `${(v / 10000).toFixed(0)}만`} />
              <YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" width={80} />
              <Tooltip
                contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                formatter={(val) => formatCurrency(Number(val))}
              />
              <Bar dataKey="spent" name="집행" fill="#2563eb" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* 채널 비중 테이블 */}
      <Card>
        <CardContent className="p-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b text-muted-foreground">
                <th className="pb-2 pr-4">매체</th>
                <th className="pb-2 pr-4 text-right">집행</th>
                <th className="pb-2 text-right">비중</th>
              </tr>
            </thead>
            <tbody>
              {byChannel.map((c) => (
                <tr key={c.channel} className="border-b border-border/50">
                  <td className="py-2 pr-4">{c.label}</td>
                  <td className="py-2 pr-4 text-right font-medium">{formatCurrency(c.spent)}</td>
                  <td className="py-2 text-right">{formatPercent(c.share)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </PageShell>
  );
}
