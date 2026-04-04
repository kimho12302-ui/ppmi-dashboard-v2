"use client";

import { Suspense, useMemo, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { useFetch } from "@/hooks/use-dashboard-data";
import { BRAND_LABELS, type DailySales, type DailyAdSpend } from "@/lib/types";
import { useConfig } from "@/hooks/use-config";
import { formatCurrency, formatNumber, formatPercent, cn } from "@/lib/utils";
import {
  LineChart, Line, ReferenceLine,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, ComposedChart, Bar,
} from "recharts";

type ViewMode = "monthly" | "weekly";

export default function MonthlyPage() {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">로딩 중...</div>}>
      <MonthlyInner />
    </Suspense>
  );
}

function MonthlyInner() {
  const { brandMap } = useConfig();
  const { data, loading } = useFetch<{
    sales: DailySales[];
    ads: DailyAdSpend[];
  }>("/api/dashboard?from=2024-01-01&to=2099-12-31");
  const [mode, setMode] = useState<ViewMode>("monthly");
  const [brandFilter, setBrandFilter] = useState<string>("all");

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sales = useMemo(() => data?.sales || [], [data]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ads = useMemo(() => data?.ads || [], [data]);

  /* 월별/주별 집계 */
  const rows = useMemo(() => {
    const getKey = (date: string) => {
      if (mode === "monthly") return date.slice(0, 7); // YYYY-MM
      // 주별: ISO week
      const d = new Date(date);
      const dayOfWeek = d.getDay() || 7;
      d.setDate(d.getDate() + 4 - dayOfWeek);
      const yearStart = new Date(d.getFullYear(), 0, 1);
      const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
      return `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
    };

    const map: Record<string, { revenue: number; orders: number; adSpend: number; clicks: number; impressions: number; convValue: number }> = {};

    for (const r of sales) {
      if (brandFilter !== "all" && r.brand !== brandFilter) continue;
      const key = getKey(r.date);
      if (!map[key]) map[key] = { revenue: 0, orders: 0, adSpend: 0, clicks: 0, impressions: 0, convValue: 0 };
      map[key].revenue += r.revenue || 0;
      map[key].orders += r.orders || 0;
    }

    for (const r of ads) {
      if (r.channel.startsWith("ga4_")) continue;
      if (brandFilter !== "all" && r.brand !== brandFilter) continue;
      const key = getKey(r.date);
      if (!map[key]) map[key] = { revenue: 0, orders: 0, adSpend: 0, clicks: 0, impressions: 0, convValue: 0 };
      map[key].adSpend += r.spend || 0;
      map[key].clicks += r.clicks || 0;
      map[key].impressions += r.impressions || 0;
      map[key].convValue += r.conversion_value || 0;
    }

    return Object.entries(map)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([period, v]) => ({
        period,
        ...v,
        roas: v.adSpend > 0 ? v.convValue / v.adSpend : 0,
        ctr: v.impressions > 0 ? (v.clicks / v.impressions) * 100 : 0,
        profit: v.revenue - v.adSpend,
        profitRate: v.revenue > 0 ? ((v.revenue - v.adSpend) / v.revenue) * 100 : 0,
      }));
  }, [sales, ads, mode, brandFilter]);

  /* 브랜드 목록 */
  const brands = useMemo(() => {
    const set = new Set(sales.map((r) => r.brand));
    return ["all", ...Array.from(set).sort()];
  }, [sales]);

  if (loading) {
    return (
      <PageShell title="월별 요약" description="월별·주별 성과 요약" hideFilters>
        <div className="h-64 bg-muted rounded-lg animate-pulse" />
      </PageShell>
    );
  }

  return (
    <PageShell title="월별 요약" description="월별·주별 성과 요약" hideFilters>
      {/* 컨트롤 */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-0.5 rounded-lg bg-muted p-1">
          {(["monthly", "weekly"] as ViewMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                mode === m ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {m === "monthly" ? "월별" : "주별"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-0.5 rounded-lg bg-muted p-1">
          {brands.map((b) => (
            <button
              key={b}
              onClick={() => setBrandFilter(b)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap",
                brandFilter === b ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {b === "all" ? "전체" : (brandMap[b]?.label || BRAND_LABELS[b] || b)}
            </button>
          ))}
        </div>
      </div>

      {/* 8.1 차트: 매출 vs 광고비 + ROAS 추이 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4">
            <h3 className="font-semibold text-sm mb-3">매출 vs 광고비</h3>
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={[...rows].reverse()}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="period" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" tickFormatter={(v) => `${(v / 10000).toFixed(0)}만`} />
                <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }} formatter={(val) => formatCurrency(Number(val))} />
                <Legend />
                <Bar dataKey="revenue" name="매출" fill="#2563eb" radius={[4, 4, 0, 0]} />
                <Bar dataKey="adSpend" name="광고비" fill="#dc2626" radius={[4, 4, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <h3 className="font-semibold text-sm mb-3">ROAS 추이</h3>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={[...rows].reverse()}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="period" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" tickFormatter={(v) => `${v.toFixed(1)}x`} />
                <ReferenceLine y={1} stroke="#ef4444" strokeDasharray="4 4" />
                <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }} formatter={(val) => `${Number(val).toFixed(2)}x`} />
                <Line type="monotone" dataKey="roas" name="ROAS" stroke="#10b981" strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* 테이블 */}
      <Card>
        <CardContent className="p-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b text-muted-foreground">
                <th className="pb-2 pr-4">{mode === "monthly" ? "월" : "주"}</th>
                <th className="pb-2 pr-4 text-right">매출</th>
                <th className="pb-2 pr-4 text-right">주문</th>
                <th className="pb-2 pr-4 text-right">광고비</th>
                <th className="pb-2 pr-4 text-right">ROAS</th>
                <th className="pb-2 pr-4 text-right">통상이익</th>
                <th className="pb-2 text-right">이익률</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const prev = rows[i + 1]; // rows is desc sorted
                const momRev = prev && prev.revenue > 0 ? ((r.revenue - prev.revenue) / prev.revenue * 100) : null;
                return (
                <tr key={r.period} className="border-b border-border/50 hover:bg-muted/50">
                  <td className="py-2 pr-4 font-medium">{r.period}</td>
                  <td className="py-2 pr-4 text-right">
                    {formatCurrency(r.revenue)}
                    {momRev !== null && <span className={cn("ml-1 text-[10px]", momRev >= 0 ? "text-emerald-500" : "text-red-500")}>{momRev >= 0 ? "▲" : "▼"}{Math.abs(momRev).toFixed(0)}%</span>}
                  </td>
                  <td className="py-2 pr-4 text-right">{formatNumber(r.orders)}</td>
                  <td className="py-2 pr-4 text-right">{formatCurrency(r.adSpend)}</td>
                  <td className={cn("py-2 pr-4 text-right", r.roas >= 3 ? "text-emerald-600" : r.roas >= 1 ? "text-yellow-600" : "text-red-500")}>{r.roas.toFixed(2)}x</td>
                  <td className={cn("py-2 pr-4 text-right font-medium", r.profit >= 0 ? "text-emerald-600" : "text-red-500")}>
                    {formatCurrency(r.profit)}
                  </td>
                  <td className={cn("py-2 text-right", r.profitRate >= 0 ? "text-emerald-600" : "text-red-500")}>
                    {formatPercent(r.profitRate)}
                  </td>
                </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted-foreground">데이터 없음</td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </PageShell>
  );
}
