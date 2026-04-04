"use client";

import { PageShell } from "@/components/page-shell";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent } from "@/components/ui/card";
import { useFilterParams, useFetch } from "@/hooks/use-dashboard-data";
import { CHANNEL_LABELS, SALES_CHANNEL_COLORS, BRAND_LABELS, BRAND_COLORS, type DailySales, type ProductSales } from "@/lib/types";
import { formatCurrency, formatNumber, cn } from "@/lib/utils";
import { Suspense, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

type ViewTab = "trend" | "channel" | "product" | "gonggu";

export default function SalesPage() {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">로딩 중...</div>}>
      <SalesPageInner />
    </Suspense>
  );
}

function SalesPageInner() {
  const { brand, from, to } = useFilterParams();
  const params = `from=${from}&to=${to}`;
  const { data, loading } = useFetch<{
    sales: DailySales[];
    products: ProductSales[];
    prevSales: DailySales[];
  }>(`/api/dashboard?${params}`);
  const [tab, setTab] = useState<ViewTab>("trend");

  const sales = useMemo(() => {
    const all = data?.sales || [];
    if (!brand || brand === "all") return all;
    return all.filter((r) => r.brand === brand);
  }, [data, brand]);

  const products = useMemo(() => {
    const all = data?.products || [];
    if (!brand || brand === "all") return all;
    return all.filter((r) => r.brand === brand);
  }, [data, brand]);

  const prevSales = useMemo(() => {
    const all = data?.prevSales || [];
    if (!brand || brand === "all") return all;
    return all.filter((r) => r.brand === brand);
  }, [data, brand]);

  /* KPI */
  const calcSalesKpi = (s: DailySales[]) => {
    const revenue = s.reduce((acc, r) => acc + (r.revenue || 0), 0);
    const orders = s.reduce((acc, r) => acc + (r.orders || 0), 0);
    return { revenue, orders, aov: orders > 0 ? revenue / orders : 0 };
  };
  const totals = useMemo(() => calcSalesKpi(sales), [sales]);
  const prevTotals = useMemo(() => calcSalesKpi(prevSales), [prevSales]);

  const pctChange = (cur: number, prev: number) => {
    if (prev === 0) return cur > 0 ? 100 : undefined;
    return ((cur - prev) / Math.abs(prev)) * 100;
  };

  /* 일별 트렌드 */
  const dailyTrend = useMemo(() => {
    const map: Record<string, { revenue: number; orders: number }> = {};
    for (const r of sales) {
      if (!map[r.date]) map[r.date] = { revenue: 0, orders: 0 };
      map[r.date].revenue += r.revenue || 0;
      map[r.date].orders += r.orders || 0;
    }
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date: date.slice(5), ...v }));
  }, [sales]);

  /* 채널별 */
  const byChannel = useMemo(() => {
    const map: Record<string, { revenue: number; orders: number }> = {};
    for (const r of sales) {
      const ch = r.channel || "other";
      if (!map[ch]) map[ch] = { revenue: 0, orders: 0 };
      map[ch].revenue += r.revenue || 0;
      map[ch].orders += r.orders || 0;
    }
    return Object.entries(map)
      .map(([ch, v]) => ({
        channel: ch,
        label: CHANNEL_LABELS[ch] || ch,
        color: SALES_CHANNEL_COLORS[ch] || "#6b7280",
        ...v,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [sales]);

  /* 공구별 (밸런스랩) */
  const gongguData = useMemo(() => {
    const gongguProducts = products.filter((r) => r.brand === "balancelab" && r.channel?.startsWith("공구_"));
    const selfProducts = products.filter((r) => r.brand === "balancelab" && !r.channel?.startsWith("공구_"));
    const sellerMap: Record<string, { revenue: number; quantity: number }> = {};
    for (const r of gongguProducts) {
      const seller = r.channel?.replace("공구_", "") || "기타";
      if (!sellerMap[seller]) sellerMap[seller] = { revenue: 0, quantity: 0 };
      sellerMap[seller].revenue += r.revenue || 0;
      sellerMap[seller].quantity += r.quantity || 0;
    }
    const sellers = Object.entries(sellerMap).map(([s, v]) => ({ seller: s, ...v })).sort((a, b) => b.revenue - a.revenue);
    const gongguTotal = gongguProducts.reduce((s, r) => s + (r.revenue || 0), 0);
    const selfTotal = selfProducts.reduce((s, r) => s + (r.revenue || 0), 0);
    return { sellers, gongguTotal, selfTotal, total: gongguTotal + selfTotal };
  }, [products]);

  /* TOP 제품 */
  const topProducts = useMemo(() => {
    const map: Record<string, { revenue: number; quantity: number; product: string; brand: string }> = {};
    for (const r of products) {
      const key = `${r.brand}-${r.product}`;
      if (!map[key]) map[key] = { revenue: 0, quantity: 0, product: r.product, brand: r.brand };
      map[key].revenue += r.revenue || 0;
      map[key].quantity += r.quantity || 0;
    }
    return Object.values(map)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);
  }, [products]);

  if (loading) {
    return (
      <PageShell title="매출 분석" description="채널별·브랜드별 매출 트렌드">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
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
    <PageShell title="매출 분석" description="채널별·브랜드별 매출 트렌드">
      {/* 탭 */}
      <div className="flex items-center gap-0.5 rounded-lg bg-muted p-1 w-fit">
        {([
          { key: "trend", label: "매출 트렌드" },
          { key: "channel", label: "채널별" },
          { key: "product", label: "제품별" },
          { key: "gonggu", label: "공구별" },
        ] as { key: ViewTab; label: string }[]).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap",
              tab === t.key
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <KpiCard title="매출" value={formatCurrency(totals.revenue)} change={pctChange(totals.revenue, prevTotals.revenue)} />
        <KpiCard title="주문 수" value={formatNumber(totals.orders)} change={pctChange(totals.orders, prevTotals.orders)} />
        <KpiCard title="평균 객단가" value={totals.aov > 0 ? formatCurrency(Math.round(totals.aov)) : "—"} change={pctChange(totals.aov, prevTotals.aov)} />
      </div>

      {tab === "trend" && (
        <Card>
          <CardContent className="p-4">
            <h3 className="font-semibold mb-4">일별 매출 트렌드</h3>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={dailyTrend}>
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
      )}

      {tab === "channel" && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {byChannel.map((c) => (
              <Card key={c.channel} className="p-4" style={{ borderLeft: `4px solid ${c.color}` }}>
                <CardContent className="p-0 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm">{c.label}</span>
                    <span className="text-sm font-bold">{formatCurrency(c.revenue)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    주문 {formatNumber(c.orders)}건 · 비중 {totals.revenue > 0 ? ((c.revenue / totals.revenue) * 100).toFixed(1) : 0}%
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <Card>
            <CardContent className="p-4">
              <h3 className="font-semibold mb-4">채널별 매출 비교</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={byChannel} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11 }}
                    stroke="var(--muted-foreground)"
                    tickFormatter={(v) => `${(v / 10000).toFixed(0)}만`}
                  />
                  <YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" width={80} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(val) => formatCurrency(Number(val))}
                  />
                  <Bar dataKey="revenue" name="매출" fill="#2563eb" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </>
      )}

      {tab === "product" && (
        <Card>
          <CardContent className="p-4 overflow-x-auto">
            <h3 className="font-semibold mb-4">TOP 10 제품</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b text-muted-foreground">
                  <th className="pb-2 pr-4">#</th>
                  <th className="pb-2 pr-4">브랜드</th>
                  <th className="pb-2 pr-4">제품</th>
                  <th className="pb-2 pr-4 text-right">매출</th>
                  <th className="pb-2 text-right">수량</th>
                </tr>
              </thead>
              <tbody>
                {topProducts.map((p, i) => (
                  <tr key={`${p.brand}-${p.product}`} className="border-b border-border/50 hover:bg-muted/50">
                    <td className="py-2 pr-4 text-muted-foreground">{i + 1}</td>
                    <td className="py-2 pr-4">
                      <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: `${BRAND_COLORS[p.brand] || '#6b7280'}20`, color: BRAND_COLORS[p.brand] || '#6b7280' }}>
                        {BRAND_LABELS[p.brand] || p.brand}
                      </span>
                    </td>
                    <td className="py-2 pr-4">{p.product}</td>
                    <td className="py-2 pr-4 text-right font-medium">{formatCurrency(p.revenue)}</td>
                    <td className="py-2 text-right">{formatNumber(p.quantity)}</td>
                  </tr>
                ))}
                {topProducts.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-muted-foreground">
                      제품 데이터가 없습니다
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
      {tab === "gonggu" && (
        <div className="space-y-4">
          {/* 자체 vs 공구 비교 */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-sm text-muted-foreground">밸런스랩 전체</p>
                <p className="text-2xl font-bold">{formatCurrency(gongguData.total)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-sm text-muted-foreground">자체매출</p>
                <p className="text-2xl font-bold text-blue-500">{formatCurrency(gongguData.selfTotal)}</p>
                <p className="text-xs text-muted-foreground">{gongguData.total > 0 ? `${((gongguData.selfTotal / gongguData.total) * 100).toFixed(1)}%` : "—"}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-sm text-muted-foreground">공구매출</p>
                <p className="text-2xl font-bold text-purple-500">{formatCurrency(gongguData.gongguTotal)}</p>
                <p className="text-xs text-muted-foreground">{gongguData.total > 0 ? `${((gongguData.gongguTotal / gongguData.total) * 100).toFixed(1)}%` : "—"}</p>
              </CardContent>
            </Card>
          </div>

          {/* 셀러별 테이블 */}
          <Card>
            <CardContent className="p-4">
              <h3 className="font-semibold mb-3">공구 셀러별 매출</h3>
              {gongguData.sellers.length > 0 ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-2 pr-4">#</th>
                      <th className="pb-2 pr-4">셀러</th>
                      <th className="pb-2 pr-4 text-right">매출</th>
                      <th className="pb-2 pr-4 text-right">수량</th>
                      <th className="pb-2 text-right">비중</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gongguData.sellers.map((s, i) => (
                      <tr key={s.seller} className="border-b border-border/50 hover:bg-muted/50">
                        <td className="py-2 pr-4 text-muted-foreground">{i + 1}</td>
                        <td className="py-2 pr-4 font-medium">{s.seller}</td>
                        <td className="py-2 pr-4 text-right">{formatCurrency(s.revenue)}</td>
                        <td className="py-2 pr-4 text-right">{formatNumber(s.quantity)}</td>
                        <td className="py-2 text-right">{gongguData.gongguTotal > 0 ? `${((s.revenue / gongguData.gongguTotal) * 100).toFixed(1)}%` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-muted-foreground text-center py-8">공구 매출 데이터가 없습니다. 판매 엑셀을 업로드해주세요.</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </PageShell>
  );
}
