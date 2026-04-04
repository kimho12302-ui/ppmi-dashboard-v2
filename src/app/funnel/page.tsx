"use client";

import { Suspense, useMemo, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent } from "@/components/ui/card";
import { useFilterParams, useFetch } from "@/hooks/use-dashboard-data";
import { formatNumber, cn } from "@/lib/utils";
import type { DailyFunnel } from "@/lib/types";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

/* 퍼널 소스별 색상 */
const SOURCE_COLORS: Record<string, string> = {
  nutty: "#2563eb",
  cafe24: "#2563eb",
  smartstore: "#16a34a",
  coupang: "#dc2626",
  balancelab_smartstore: "#7c3aed",
  all: "#6b7280",
};

const SOURCE_LABELS: Record<string, string> = {
  nutty: "GA4 (너티)",
  cafe24: "카페24",
  smartstore: "스마트스토어",
  coupang: "쿠팡",
  balancelab_smartstore: "밸런스랩 스마트스토어",
  all: "전체",
};

export default function FunnelPage() {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">로딩 중...</div>}>
      <FunnelPageInner />
    </Suspense>
  );
}

function FunnelPageInner() {
  const { from, to } = useFilterParams();
  const { data, loading } = useFetch<{ funnel: DailyFunnel[] }>(`/api/funnel?from=${from}&to=${to}`);
  const [selectedSource, setSelectedSource] = useState<string>("all");

  const funnel = useMemo(() => data?.funnel || [], [data]);

  /* 소스별 집계 */
  const bySource = useMemo(() => {
    const map: Record<string, { sessions: number; cart_adds: number; purchases: number; repurchases: number; signups: number; subscribers: number }> = {};
    for (const r of funnel) {
      if (r.brand === "all") continue; // 'all' 레코드 제외
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
      signups: vals.reduce((s, v) => s + v.signups, 0),
    };
  }, [bySource]);

  /* 퍼널 바 차트 데이터 */
  const funnelBars = useMemo(() => {
    const src = selectedSource === "all" ? totals : bySource[selectedSource];
    if (!src) return [];
    return [
      { step: "세션", value: src.sessions, color: "#3b82f6" },
      { step: "장바구니", value: src.cart_adds, color: "#f59e0b" },
      { step: "구매", value: src.purchases, color: "#10b981" },
      { step: "재구매", value: src.repurchases, color: "#8b5cf6" },
    ];
  }, [selectedSource, totals, bySource]);

  /* 소스별 비교 테이블 */
  const sourceRows = useMemo(() => {
    return Object.entries(bySource)
      .map(([key, v]) => ({
        source: key,
        label: SOURCE_LABELS[key] || key,
        color: SOURCE_COLORS[key] || "#6b7280",
        ...v,
        cartRate: v.sessions > 0 ? (v.cart_adds / v.sessions * 100) : 0,
        purchaseRate: v.cart_adds > 0 ? (v.purchases / v.cart_adds * 100) : 0,
      }))
      .sort((a, b) => b.sessions - a.sessions);
  }, [bySource]);

  if (loading) {
    return (
      <PageShell title="퍼널" description="채널별 전환 퍼널 분석">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
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
    <PageShell title="퍼널" description="채널별 전환 퍼널 분석">
      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="총 세션" value={formatNumber(totals.sessions)} />
        <KpiCard title="장바구니" value={formatNumber(totals.cart_adds)} subtitle={totals.sessions > 0 ? `${(totals.cart_adds / totals.sessions * 100).toFixed(1)}%` : ""} />
        <KpiCard title="구매" value={formatNumber(totals.purchases)} subtitle={totals.cart_adds > 0 ? `${(totals.purchases / totals.cart_adds * 100).toFixed(1)}%` : ""} />
        <KpiCard title="재구매" value={formatNumber(totals.repurchases)} />
      </div>

      {/* 소스 필터 */}
      <div className="flex items-center gap-0.5 rounded-lg bg-muted p-1 w-fit flex-wrap">
        <button
          onClick={() => setSelectedSource("all")}
          className={cn(
            "px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap",
            selectedSource === "all" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
        >
          전체
        </button>
        {Object.keys(bySource).map((src) => (
          <button
            key={src}
            onClick={() => setSelectedSource(src)}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap",
              selectedSource === src ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {SOURCE_LABELS[src] || src}
          </button>
        ))}
      </div>

      {/* 퍼널 바 차트 */}
      <Card>
        <CardContent className="p-4">
          <h3 className="font-semibold mb-4">
            퍼널 단계별 전환 — {selectedSource === "all" ? "전체" : (SOURCE_LABELS[selectedSource] || selectedSource)}
          </h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={funnelBars}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="step" tick={{ fontSize: 12 }} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(val) => formatNumber(Number(val))}
              />
              <Bar dataKey="value" name="건수" fill="#3b82f6" radius={[4, 4, 0, 0]}>
                {funnelBars.map((entry, idx) => (
                  <rect key={idx} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* 소스별 비교 테이블 */}
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
                <th className="pb-2 text-right">재구매</th>
              </tr>
            </thead>
            <tbody>
              {sourceRows.map((r) => (
                <tr key={r.source} className="border-b border-border/50 hover:bg-muted/50">
                  <td className="py-2 pr-4">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: r.color }} />
                      {r.label}
                    </div>
                  </td>
                  <td className="py-2 pr-4 text-right">{formatNumber(r.sessions)}</td>
                  <td className="py-2 pr-4 text-right">{formatNumber(r.cart_adds)}</td>
                  <td className="py-2 pr-4 text-right">{r.cartRate.toFixed(1)}%</td>
                  <td className="py-2 pr-4 text-right">{formatNumber(r.purchases)}</td>
                  <td className="py-2 pr-4 text-right">{r.purchaseRate.toFixed(1)}%</td>
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
