"use client";

import { Suspense, useMemo, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent } from "@/components/ui/card";
import { useFilterParams, useFetch } from "@/hooks/use-dashboard-data";
import { formatNumber, cn } from "@/lib/utils";
import type { DailyFunnel } from "@/lib/types";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

const SOURCE_COLORS: Record<string, string> = {
  nutty: "#2563eb", cafe24: "#2563eb", smartstore: "#16a34a",
  coupang: "#dc2626", balancelab_smartstore: "#7c3aed", all: "#6b7280",
};
const SOURCE_LABELS: Record<string, string> = {
  nutty: "GA4 (너티)", cafe24: "카페24", smartstore: "스마트스토어",
  coupang: "쿠팡", balancelab_smartstore: "밸런스랩 스마트스토어", all: "전체",
};

export default function FunnelPage() {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">로딩 중...</div>}>
      <FunnelInner />
    </Suspense>
  );
}

function FunnelInner() {
  const { from, to } = useFilterParams();
  const { data, loading } = useFetch<{ funnel: DailyFunnel[] }>(`/api/funnel?from=${from}&to=${to}`);
  const [selectedSource, setSelectedSource] = useState<string>("all");

  const funnel = useMemo(() => (data?.funnel || []).filter((r) => r.brand !== "all"), [data]);

  /* 소스별 집계 */
  const bySource = useMemo(() => {
    const map: Record<string, { sessions: number; cart_adds: number; purchases: number; repurchases: number; signups: number; subscribers: number }> = {};
    for (const r of funnel) {
      const key = r.brand;
      if (!map[key]) map[key] = { sessions: 0, cart_adds: 0, purchases: 0, repurchases: 0, signups: 0, subscribers: 0 };
      map[key].sessions += r.sessions || 0;
      map[key].cart_adds += r.cart_adds || 0;
      map[key].purchases += r.purchases || 0;
      map[key].repurchases += r.repurchases || 0;
      map[key].signups += r.signups || 0;
      map[key].subscribers += r.subscribers || 0;
    }
    return map;
  }, [funnel]);

  /* 전체 합산 */
  const totals = useMemo(() => {
    const vals = Object.values(bySource);
    return {
      sessions: vals.reduce((s, v) => s + v.sessions, 0),
      cart_adds: vals.reduce((s, v) => s + v.cart_adds, 0),
      purchases: vals.reduce((s, v) => s + v.purchases, 0),
      repurchases: vals.reduce((s, v) => s + v.repurchases, 0),
    };
  }, [bySource]);

  /* 일별 퍼널 트렌드 */
  const dailyTrend = useMemo(() => {
    const map: Record<string, { sessions: number; cart_adds: number; purchases: number; repurchases: number }> = {};
    for (const r of funnel) {
      if (selectedSource !== "all" && r.brand !== selectedSource) continue;
      if (!map[r.date]) map[r.date] = { sessions: 0, cart_adds: 0, purchases: 0, repurchases: 0 };
      map[r.date].sessions += r.sessions || 0;
      map[r.date].cart_adds += r.cart_adds || 0;
      map[r.date].purchases += r.purchases || 0;
      map[r.date].repurchases += r.repurchases || 0;
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date: date.slice(5), ...v }));
  }, [funnel, selectedSource]);

  /* 소스별 비교 */
  const sourceRows = useMemo(() => {
    return Object.entries(bySource).map(([key, v]) => ({
      source: key, label: SOURCE_LABELS[key] || key, color: SOURCE_COLORS[key] || "#6b7280",
      ...v,
      cartRate: v.sessions > 0 ? (v.cart_adds / v.sessions * 100) : 0,
      purchaseRate: v.cart_adds > 0 ? (v.purchases / v.cart_adds * 100) : 0,
      totalConvRate: v.sessions > 0 ? (v.purchases / v.sessions * 100) : 0,
    })).sort((a, b) => b.sessions - a.sessions);
  }, [bySource]);

  if (loading) {
    return (
      <PageShell title="퍼널" description="채널별 전환 퍼널 분석">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="p-5 animate-pulse"><CardContent className="p-0"><div className="h-4 w-20 bg-muted rounded mb-2" /><div className="h-8 w-28 bg-muted rounded" /></CardContent></Card>
          ))}
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell title="퍼널" description="채널별 전환 퍼널 분석">
      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="총 세션" value={formatNumber(totals.sessions)} />
        <KpiCard title="장바구니" value={formatNumber(totals.cart_adds)} subtitle={totals.sessions > 0 ? `전환 ${(totals.cart_adds / totals.sessions * 100).toFixed(1)}%` : ""} />
        <KpiCard title="구매" value={formatNumber(totals.purchases)} subtitle={totals.cart_adds > 0 ? `전환 ${(totals.purchases / totals.cart_adds * 100).toFixed(1)}%` : ""} />
        <KpiCard title="재구매" value={formatNumber(totals.repurchases)} />
      </div>

      {/* 6.1 전체 퍼널 가로 플로우 */}
      <Card>
        <CardContent className="p-4">
          <h3 className="font-semibold mb-4">전체 퍼널 플로우</h3>
          <div className="flex items-center justify-between gap-1">
            {[
              { label: "세션", value: totals.sessions, color: "#3b82f6" },
              { label: "장바구니", value: totals.cart_adds, color: "#f59e0b" },
              { label: "구매", value: totals.purchases, color: "#10b981" },
              { label: "재구매", value: totals.repurchases, color: "#8b5cf6" },
            ].map((step, i, arr) => {
              const pct = totals.sessions > 0 ? (step.value / totals.sessions * 100) : 0;
              const dropRate = i > 0 && arr[i - 1].value > 0
                ? ((arr[i - 1].value - step.value) / arr[i - 1].value * 100) : 0;
              const isWorstDrop = i > 0 && dropRate === Math.max(
                ...arr.slice(1).map((s, j) => arr[j].value > 0 ? ((arr[j].value - s.value) / arr[j].value * 100) : 0)
              );
              return (
                <div key={step.label} className="flex items-center flex-1">
                  <div className="flex-1 text-center">
                    <div className="text-xs text-muted-foreground mb-1">{step.label}</div>
                    <div className="text-xl font-bold" style={{ color: step.color }}>{formatNumber(step.value)}</div>
                    <div className="text-xs text-muted-foreground">{pct.toFixed(1)}%</div>
                  </div>
                  {i < arr.length - 1 && (
                    <div className={`text-center px-1 ${isWorstDrop ? "text-red-500 font-bold" : "text-muted-foreground"}`}>
                      <div className="text-lg">→</div>
                      {dropRate > 0 && <div className="text-[10px]">-{dropRate.toFixed(0)}%</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* 소스 필터 */}
      <div className="flex items-center gap-0.5 rounded-lg bg-muted p-1 w-fit flex-wrap">
        <button onClick={() => setSelectedSource("all")}
          className={cn("px-3 py-1.5 text-xs font-medium rounded-md transition-colors", selectedSource === "all" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
          전체
        </button>
        {Object.keys(bySource).map((src) => (
          <button key={src} onClick={() => setSelectedSource(src)}
            className={cn("px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap", selectedSource === src ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            {SOURCE_LABELS[src] || src}
          </button>
        ))}
      </div>

      {/* 6.2 채널별 독립 퍼널 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {sourceRows.map((r) => (
          <Card key={r.source} className="border-l-4" style={{ borderLeftColor: r.color }}>
            <CardContent className="p-4">
              <h4 className="font-semibold text-sm mb-2" style={{ color: r.color }}>{r.label}</h4>
              <div className="flex items-center gap-2 text-sm">
                {[
                  { label: r.source === "coupang" ? "노출" : "유입", value: r.sessions },
                  { label: r.source === "smartstore" || r.source === "balancelab_smartstore" ? "알림" : "장바구니", value: r.source === "smartstore" || r.source === "balancelab_smartstore" ? r.subscribers : r.cart_adds },
                  { label: "구매", value: r.purchases },
                  { label: "재구매", value: r.repurchases },
                ].map((step, i, arr) => {
                  const rate = i > 0 && arr[i - 1].value > 0 ? (step.value / arr[i - 1].value * 100).toFixed(1) : null;
                  return (
                    <div key={step.label} className="flex items-center flex-1">
                      <div className="flex-1 text-center">
                        <div className="text-[10px] text-muted-foreground">{step.label}</div>
                        <div className="font-bold">{formatNumber(step.value)}</div>
                        {rate && <div className="text-[10px] text-muted-foreground">{rate}%</div>}
                      </div>
                      {i < arr.length - 1 && <span className="text-muted-foreground text-xs">→</span>}
                    </div>
                  );
                })}
              </div>
              <div className="text-xs text-muted-foreground mt-2">총 전환율: {r.totalConvRate.toFixed(2)}%</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 6.3 일별 퍼널 트렌드 — 각 지표 독립 차트 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[
          { key: "sessions", label: "세션", color: "#3b82f6" },
          { key: "cart_adds", label: "장바구니", color: "#f59e0b" },
          { key: "purchases", label: "구매", color: "#10b981" },
          { key: "repurchases", label: "재구매", color: "#8b5cf6" },
        ].map((metric) => (
          <Card key={metric.key}>
            <CardContent className="p-4">
              <h4 className="text-sm font-semibold mb-2">{metric.label} 일별 트렌드</h4>
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={dailyTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                  <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                  <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }} />
                  <Area type="monotone" dataKey={metric.key} name={metric.label} stroke={metric.color} fill={metric.color} fillOpacity={0.1} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 채널별 비교 테이블 */}
      <Card>
        <CardContent className="p-4 overflow-x-auto">
          <h3 className="font-semibold mb-4">채널별 퍼널 비교</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b text-muted-foreground">
                <th className="pb-2 pr-4">채널</th>
                <th className="pb-2 pr-4 text-right">세션</th>
                <th className="pb-2 pr-4 text-right">장바구니</th>
                <th className="pb-2 pr-4 text-right">장바구니율</th>
                <th className="pb-2 pr-4 text-right">구매</th>
                <th className="pb-2 pr-4 text-right">구매전환율</th>
                <th className="pb-2 pr-4 text-right">총전환율</th>
                <th className="pb-2 text-right">재구매</th>
              </tr>
            </thead>
            <tbody>
              {sourceRows.map((r) => (
                <tr key={r.source} className="border-b border-border/50 hover:bg-muted/50">
                  <td className="py-2 pr-4"><div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full" style={{ backgroundColor: r.color }} />{r.label}</div></td>
                  <td className="py-2 pr-4 text-right">{formatNumber(r.sessions)}</td>
                  <td className="py-2 pr-4 text-right">{formatNumber(r.cart_adds)}</td>
                  <td className="py-2 pr-4 text-right">{r.cartRate.toFixed(1)}%</td>
                  <td className="py-2 pr-4 text-right">{formatNumber(r.purchases)}</td>
                  <td className="py-2 pr-4 text-right">{r.purchaseRate.toFixed(1)}%</td>
                  <td className="py-2 pr-4 text-right font-medium">{r.totalConvRate.toFixed(2)}%</td>
                  <td className="py-2 text-right">{formatNumber(r.repurchases)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </PageShell>
  );
}
