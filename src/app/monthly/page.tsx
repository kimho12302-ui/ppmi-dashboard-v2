"use client";

import { Suspense, useState, useEffect } from "react";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { useFetch, useFilterParams } from "@/hooks/use-dashboard-data";
import { BRAND_LABELS } from "@/lib/types";
import { useConfig } from "@/hooks/use-config";
import { formatCurrency, formatNumber, formatPercent, cn } from "@/lib/utils";
import {
  LineChart, Line, ReferenceLine,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, ComposedChart, Bar,
} from "recharts";

interface MonthlySummary {
  month: string;
  revenue: number;
  orders: number;
  adSpend: number;
  cogs: number;
  shippingCost: number;
  profit: number;
  profitRate: number;
  roas: number;
  mer: number;
  cv: number;
  aov: number;
  adRatio: number;
  cac: number;
  channelCosts: Record<string, number>;
  revGrowth?: number;
  orderGrowth?: number;
}

interface YTD {
  revenue: number;
  orders: number;
  adSpend: number;
  cogs: number;
  shippingCost: number;
  profit: number;
  profitRate: number;
  roas: number;
  aov: number;
}

interface MonthlyData {
  summary: MonthlySummary[];
  ytd: YTD;
  year: string;
}

export default function MonthlyPage() {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">Loading...</div>}>
      <MonthlyInner />
    </Suspense>
  );
}

function MonthlyInner() {
  const { brand } = useFilterParams();
  const { brandMap } = useConfig();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [brandFilter, setBrandFilter] = useState(brand);
  // 글로벌 브랜드 필터 변경 시 동기화 (마운트 시 brand가 늦게 로드돼 '전체'로 리셋되던 버그)
  useEffect(() => { setBrandFilter(brand || "all"); }, [brand]);

  const { data, loading } = useFetch<MonthlyData>(
    `/api/monthly-summary?year=${year}&brand=${brandFilter}`
  );

  const summary = data?.summary || [];
  const ytd = data?.ytd;
  const reversed = [...summary].reverse(); // desc for table

  // 채널별 광고비 ((M)Dash Board 재현)
  const CH_LABEL: Record<string, string> = { meta: "메타", naver_search: "네이버검색", naver_shopping: "네이버쇼핑", google_pmax: "구글P-Max", google_search: "구글검색", google_ads: "구글", coupang_ads: "쿠팡", gfa: "GFA", gdn: "GDN", influencer: "인플루언서" };
  const CH_COLOR: Record<string, string> = { meta: "#1877f2", naver_search: "#03c75a", naver_shopping: "#22c55e", google_pmax: "#eab308", google_search: "#f59e0b", google_ads: "#fbbf24", coupang_ads: "#ef4444", gfa: "#8b5cf6", gdn: "#a78bfa", influencer: "#ec4899" };
  const channelKeys = Array.from(new Set(summary.flatMap((m) => Object.keys(m.channelCosts || {})))).filter(Boolean);
  const channelData = summary.map((m) => ({ month: m.month, ...m.channelCosts }));

  // Brand list (hard-coded since we know brands)
  const brands = ["all", "nutty", "ironpet", "saip", "balancelab"];

  if (loading) {
    return (
      <PageShell title="월별 요약" description="월별 성과 요약 · 원가/배송비/이익 분석" hideFilters>
        <div className="h-64 bg-muted rounded-lg animate-pulse" />
      </PageShell>
    );
  }

  return (
    <PageShell title="월별 요약" description="월별 성과 요약 · 원가/배송비/이익 분석" hideFilters>
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4">
        {/* Year selector */}
        <div className="flex items-center gap-0.5 rounded-lg bg-muted p-1">
          {[currentYear - 1, currentYear].map((y) => (
            <button
              key={y}
              onClick={() => setYear(y)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                year === y ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {y}년
            </button>
          ))}
        </div>

        {/* Brand filter */}
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

      {/* YTD Summary */}
      {ytd && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">YTD 매출</p>
              <p className="text-xl font-bold">{formatCurrency(ytd.revenue)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">YTD 광고비</p>
              <p className="text-xl font-bold">{formatCurrency(ytd.adSpend)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">YTD 원가</p>
              <p className="text-xl font-bold">{formatCurrency(ytd.cogs)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">YTD 이익</p>
              <p className={cn("text-xl font-bold", ytd.profit >= 0 ? "text-emerald-600" : "text-red-500")}>
                {formatCurrency(ytd.profit)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">YTD 이익률</p>
              <p className={cn("text-xl font-bold", ytd.profitRate >= 0 ? "text-emerald-600" : "text-red-500")}>
                {formatPercent(ytd.profitRate)}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4">
            <h3 className="font-semibold text-sm mb-3">매출 vs 총비용 (광고비+원가+배송)</h3>
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={summary}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" tickFormatter={(v) => `${(v / 10000).toFixed(0)}만`} />
                <Tooltip
                  contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }}
                  formatter={(val) => formatCurrency(Number(val))}
                />
                <Legend />
                <Bar dataKey="revenue" name="매출" fill="#2563eb" radius={[4, 4, 0, 0]} />
                <Bar dataKey="adSpend" name="광고비" fill="#dc2626" radius={[4, 4, 0, 0]} />
                <Bar dataKey="cogs" name="원가" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                <Bar dataKey="shippingCost" name="배송비" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <h3 className="font-semibold text-sm mb-3">이익률 & ROAS 추이</h3>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={summary}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                <YAxis yAxisId="left" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" tickFormatter={(v) => `${v.toFixed(0)}%`} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" tickFormatter={(v) => `${v.toFixed(1)}x`} />
                <ReferenceLine yAxisId="left" y={0} stroke="#ef4444" strokeDasharray="4 4" />
                <Tooltip
                  contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }}
                />
                <Legend />
                <Line yAxisId="left" type="monotone" dataKey="profitRate" name="이익률(%)" stroke="#10b981" strokeWidth={2} dot />
                <Line yAxisId="right" type="monotone" dataKey="roas" name="ROAS" stroke="#3b82f6" strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* 채널별 광고비 (월별 스택) */}
      {channelKeys.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h3 className="font-semibold text-sm mb-3">채널별 광고비 추이</h3>
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={channelData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" tickFormatter={(v) => `${(v / 10000).toFixed(0)}만`} />
                <Tooltip
                  contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }}
                  formatter={(val, name) => [formatCurrency(Number(val)), CH_LABEL[name as string] || name]}
                />
                <Legend formatter={(v) => CH_LABEL[v] || v} />
                {channelKeys.map((ch) => (
                  <Bar key={ch} dataKey={ch} name={ch} stackId="ch" fill={CH_COLOR[ch] || "#9ca3af"} />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b text-muted-foreground">
                <th className="pb-2 pr-3">월</th>
                <th className="pb-2 pr-3 text-right">매출</th>
                <th className="pb-2 pr-3 text-right">전월비</th>
                <th className="pb-2 pr-3 text-right">주문</th>
                <th className="pb-2 pr-3 text-right">AOV</th>
                <th className="pb-2 pr-3 text-right">광고비</th>
                <th className="pb-2 pr-3 text-right">광고비중</th>
                <th className="pb-2 pr-3 text-right">CAC</th>
                <th className="pb-2 pr-3 text-right">원가</th>
                <th className="pb-2 pr-3 text-right">배송비</th>
                <th className="pb-2 pr-3 text-right">ROAS</th>
                <th className="pb-2 pr-3 text-right">MER</th>
                <th className="pb-2 pr-3 text-right">이익</th>
                <th className="pb-2 text-right">이익률</th>
              </tr>
            </thead>
            <tbody>
              {reversed.map((r) => (
                <tr key={r.month} className="border-b border-border/50 hover:bg-muted/50">
                  <td className="py-2 pr-3 font-medium">{r.month}</td>
                  <td className="py-2 pr-3 text-right">{formatCurrency(r.revenue)}</td>
                  <td className="py-2 pr-3 text-right">
                    {r.revGrowth !== undefined ? (
                      <span className={cn("text-xs", r.revGrowth >= 0 ? "text-emerald-500" : "text-red-500")}>
                        {r.revGrowth >= 0 ? "▲" : "▼"}{Math.abs(r.revGrowth).toFixed(0)}%
                      </span>
                    ) : <span className="text-xs text-muted-foreground">-</span>}
                  </td>
                  <td className="py-2 pr-3 text-right">{formatNumber(r.orders)}</td>
                  <td className="py-2 pr-3 text-right">{formatCurrency(r.aov)}</td>
                  <td className="py-2 pr-3 text-right">{formatCurrency(r.adSpend)}</td>
                  <td className={cn("py-2 pr-3 text-right", r.adRatio > 35 ? "text-red-500" : r.adRatio > 25 ? "text-yellow-600" : "text-foreground")}>
                    {r.adRatio.toFixed(1)}%
                  </td>
                  <td className="py-2 pr-3 text-right">{r.cac > 0 ? formatCurrency(Math.round(r.cac)) : "-"}</td>
                  <td className="py-2 pr-3 text-right">{formatCurrency(r.cogs)}</td>
                  <td className="py-2 pr-3 text-right">{formatCurrency(r.shippingCost)}</td>
                  <td className={cn("py-2 pr-3 text-right", r.roas >= 3 ? "text-emerald-600" : r.roas >= 1 ? "text-yellow-600" : "text-red-500")}>
                    {r.roas.toFixed(2)}x
                  </td>
                  <td className="py-2 pr-3 text-right text-muted-foreground">{(r.mer || 0).toFixed(2)}x</td>
                  <td className={cn("py-2 pr-3 text-right font-medium", r.profit >= 0 ? "text-emerald-600" : "text-red-500")}>
                    {formatCurrency(r.profit)}
                  </td>
                  <td className={cn("py-2 text-right", r.profitRate >= 0 ? "text-emerald-600" : "text-red-500")}>
                    {formatPercent(r.profitRate)}
                  </td>
                </tr>
              ))}
              {reversed.length === 0 && (
                <tr>
                  <td colSpan={14} className="py-8 text-center text-muted-foreground">데이터 없음</td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </PageShell>
  );
}
