"use client";

import { PageShell } from "@/components/page-shell";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent } from "@/components/ui/card";
import { useFilterParams, useFetch } from "@/hooks/use-dashboard-data";
import { LazyMount } from "@/components/lazy-mount";
import { matchesBrand } from "@/lib/brand-groups";
import { ProductTrendChart } from "@/components/product-trend-chart";
import { CHANNEL_LABELS, SALES_CHANNEL_COLORS, BRAND_LABELS, BRAND_COLORS, type DailySales, type ProductSales } from "@/lib/types";

// 카테고리 분류는 브랜드마다 체계가 달라(너티=라인업, 아이언펫=키트/추가, 사입=유통 브랜드, 밸런스랩=검사/기타)
// 여러 브랜드를 한 막대에 섞으면 읽을 수 없다. 브랜드 하나를 골랐을 때만 그린다(2026-11-04).
const CATEGORY_BRANDS = ["nutty", "ironpet", "saip", "balancelab"];
import { useConfig } from "@/hooks/use-config";
import { lastDataDate } from "@/lib/bucket";
import { periodKey, periodAxis } from "@/lib/sales-period";
import { ChannelMixChart } from "@/components/judge/channel-mix-chart";
import { formatCurrency, formatNumber, cn } from "@/lib/utils";
import { isGonggu as isGongguRow, isGongguAggregate, gongguSeller } from "@/lib/gonggu";
import { Suspense, useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import { DeferredResponsiveContainer } from "@/components/deferred-chart";

/* 브랜드별 카테고리 분류 (기획서 4.1) */
function getCategory(brand: string, product: string, lineup?: string): string {
  if (brand === "nutty") return lineup || "기타";
  if (brand === "ironpet") {
    if (product.includes("키트") || product.includes("검사")) return "검사 키트";
    return "추가 제품";
  }
  if (brand === "saip") {
    if (lineup) return lineup;
    if (product.includes("파미나")) return "파미나";
    if (product.includes("테라카니스")) return "테라카니스";
    if (product.includes("닥터레이")) return "닥터레이";
    return "기타";
  }
  if (brand === "balancelab") {
    if (product.includes("검사")) return "검사";
    return "기타";
  }
  return lineup || "기타";
}

export default function SalesPage() {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">불러오는 중...</div>}>
      <SalesPageInner />
    </Suspense>
  );
}

// 주·월 키(1월 1일 기준 주차)는 src/lib/sales-period.ts 로 옮겼다(채널별 매출 구성 차트와 공유, 2026-11-03).

function SalesPageInner() {
  const { brand, from, to } = useFilterParams();
  const params = `from=${from}&to=${to}&brand=${brand || "all"}`;
  const { data, loading } = useFetch<{
    sales: DailySales[];
    products: ProductSales[];
    prevSales: DailySales[];
    blDaily?: { date: string; self: number; gonggu: number }[];
    gongguSalesTotal?: number;
  }>(`/api/dashboard?${params}&raw=sales,products,prevSales&lean=1`);
  // (채널 효율 사분면은 2026-11-03 뺐다: 신고 전환으로 만든 CAC·ROAS 라 매체 간 비교가 성립하지 않는다.
  //  매체 효율은 /ads 매체별 상세 표와 네이버 캠페인 12주 스몰 멀티플이 본다.)
  const { brandMap, channelMap } = useConfig();

  const sales = useMemo(() => {
    const all = data?.sales || [];
    if (!brand || brand === "all") return all;
    return all.filter((r) => matchesBrand(r.brand, brand));
  }, [data, brand]);

  const products = useMemo(() => {
    const all = data?.products || [];
    if (!brand || brand === "all") return all;
    return all.filter((r) => matchesBrand(r.brand, brand));
  }, [data, brand]);

  // 직전 기간 매출은 서버가 이미 선택 브랜드로 걸러 보낸다(prevSalesQ: 같은 brand 파라미터, expandBrands).
  // 서버는 이 행의 날짜·브랜드·판매처를 빈 값으로 보내므로, 여기서 브랜드로 다시 거르면 전부 빠져
  // 브랜드를 고를 때마다 직전 기간이 0 이 됐다(2026-10-15 수정). 다시 거르지 않는다.
  const prevSales = useMemo(() => data?.prevSales || [], [data]);

  /* KPI */
  const calcSalesKpi = (s: DailySales[]) => {
    const revenue = s.reduce((acc, r) => acc + (r.revenue || 0), 0);
    const orders = s.reduce((acc, r) => acc + (r.orders || 0), 0);
    return { revenue, orders, aov: orders > 0 ? revenue / orders : 0 };
  };
  const totals = useMemo(() => {
    const base = calcSalesKpi(sales);
    return base;
  }, [sales]);
  const prevTotals = useMemo(() => calcSalesKpi(prevSales), [prevSales]);

  const pctChange = (cur: number, prev: number) => {
    if (prev === 0) return cur > 0 ? 100 : undefined;
    return ((cur - prev) / Math.abs(prev)) * 100;
  };

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
        label: channelMap[ch]?.label || CHANNEL_LABELS[ch] || ch,
        color: channelMap[ch]?.color || SALES_CHANNEL_COLORS[ch] || "#6b7280",
        ...v,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [sales, channelMap]);

  /* 카테고리별 (기획서 4.3) */
  const byCategory = useMemo(() => {
    const map: Record<string, { revenue: number; quantity: number }> = {};
    for (const r of products) {
      const cat = getCategory(r.brand, r.product, r.lineup);
      if (!map[cat]) map[cat] = { revenue: 0, quantity: 0 };
      map[cat].revenue += r.revenue || 0;
      map[cat].quantity += r.quantity || 0;
    }
    return Object.entries(map).map(([cat, v]) => ({ category: cat, ...v })).sort((a, b) => b.revenue - a.revenue);
  }, [products]);

  /* 주별/월별 집계는 채널별 매출 구성 차트(ChannelMixChart)가 판매처별로 쌓아 그린다. */

  /* 밸런스랩 자체 vs 공구 시간 추이 */
  const [balanceTrendMode, setBalanceTrendMode] = useState<"daily" | "weekly" | "monthly">("weekly");
  const balanceTrendData = useMemo(() => {
    const map: Record<string, { self: number; gonggu: number }> = {};
    // 날짜별 자체·공구 합계. 서버가 날짜 있는 밸런스랩 상품 행으로 미리 나눠 보낸다(blDaily, 2026-10-15).
    // 예전에는 날짜 칸이 없는 상품 행으로 묶으려다 전부 건너뛰어 차트가 늘 비어 있었다.
    // 공구 판정은 서버도 isGonggu(=isGongguRow) || isGongguAggregate 로 같다.
    const days: { date: string; self: number; gonggu: number }[] = data?.blDaily
      ?? products
        .filter((r) => r && r.brand === "balancelab" && typeof r.date === "string")
        .map((r) => {
          const rev = Number(r.revenue) || 0;
          const isG = isGongguRow(r) || isGongguAggregate(r);
          return { date: r.date, self: isG ? 0 : rev, gonggu: isG ? rev : 0 };
        });
    const valid = days.filter((day) => /^\d{4}-\d{2}-\d{2}/.test(day.date) && !isNaN(new Date(day.date).getTime()));
    if (!valid.length) return [];
    // 기간 전체 일·주·월을 0 으로 깔아 둔다(2026-10-28). 마지막 데이터 이후 구간은 null.
    const axis = periodAxis(from, to, balanceTrendMode);
    for (const key of axis.keys()) map[key] = { self: 0, gonggu: 0 };
    for (const day of valid) {
      const key = periodKey(day.date, balanceTrendMode);
      if (!map[key]) map[key] = { self: 0, gonggu: 0 };
      map[key].gonggu += day.gonggu;
      map[key].self += day.self;
    }
    const last = lastDataDate(valid);
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([period, v]) => {
      const pending = (axis.get(period) || "") > last;
      return { period, self: pending ? null : v.self, gonggu: pending ? null : v.gonggu };
    });
  }, [data?.blDaily, products, balanceTrendMode, from, to]);

  /* 공구별 (밸런스랩) */
  const gongguData = useMemo(() => {
    // 공구 분류: 셀러 row(A/B/D) + "공구 합계" 일별 row(C) 모두 공구로
    const isBalGonggu = (r: { brand: string; channel?: string; lineup?: string; product?: string }) =>
      r.brand === "balancelab" && (isGongguRow(r) || isGongguAggregate(r));
    const gongguProducts = products.filter(isBalGonggu);
    const selfProducts = products.filter((r) => r.brand === "balancelab" && !isBalGonggu(r));
    // 셀러별 breakdown은 "공구 합계" 제외 (셀러 정보 없음) — isGongguRow 만 사용
    const sellerProducts = products.filter((r) => r.brand === "balancelab" && isGongguRow(r));
    const sellerMap: Record<string, { revenue: number; quantity: number }> = {};
    for (const r of sellerProducts) {
      const seller = gongguSeller(r) || "기타";
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
      <PageShell title="매출 분석" description="판매처별·브랜드별 매출 트렌드">
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
    <PageShell title="매출 분석" description="판매처별·브랜드별 매출 트렌드">
      {/* KPI: 매출이 이 화면의 대표 지표라 hero, 주문·객단가는 보조(compact). */}
      <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-3">
        <KpiCard size="hero" title="매출" subtitle="판매 원장 자체매출(공구 제외)" value={formatCurrency(totals.revenue)} change={pctChange(totals.revenue, prevTotals.revenue)} changeLabel="직전 같은 기간 대비" />
        <div className="grid grid-cols-2 sm:grid-cols-1 gap-2.5">
          <KpiCard size="compact" title="주문 수" value={formatNumber(totals.orders)} change={pctChange(totals.orders, prevTotals.orders)} />
          <KpiCard size="compact" title="평균 객단가" value={totals.aov > 0 ? formatCurrency(Math.round(totals.aov)) : "-"} change={pctChange(totals.aov, prevTotals.aov)} />
        </div>
      </div>

      {/* 판단용: 매출 구성 (2026-11-03). 예전 '주별/월별 매출' 합계 막대를 판매처별로 쌓았다.
          2026-11-04 「판매처 / 브랜드」 쌓기 토글을 붙이고 「브랜드별 누적 매출 트렌드」(일별 브랜드 막대)를 뺐다.
          막대 높이(그 주·월 합계)는 예전과 같다. 기간 합계는 아래 판매처 카드가 보여 준다. */}
      <ChannelMixChart sales={sales} channels={byChannel} from={from} to={to} />

      {CATEGORY_BRANDS.includes(brand) && byCategory.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h3 className="font-semibold">카테고리별 매출</h3>
            <p className="text-xs text-muted-foreground mt-0.5 mb-3">가로 = 원(상품 판매 원장), {BRAND_LABELS[brand] || brand} 분류 기준</p>
            <DeferredResponsiveContainer width="100%" height={Math.max(200, byCategory.length * 35)}>
              <BarChart data={byCategory} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis type="number" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" tickFormatter={(v) => `${(v / 10000).toFixed(0)}만`} />
                <YAxis type="category" dataKey="category" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" width={100} />
                <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} formatter={(val) => (val == null ? "-" : formatCurrency(Number(val)))} />
                <Bar isAnimationActive={false} dataKey="revenue" name="매출" fill={BRAND_COLORS[brand] || "#6b7280"} radius={[0, 4, 4, 0]} />
              </BarChart>
            </DeferredResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {(
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
          {/* '판매처별 매출 비교'(기간 합계 가로 막대)는 위 판매처 카드와 같은 숫자라 뺐다. 시간 흐름은 채널별 매출 구성에 있다. */}
        </>
      )}

      {/* 상품 추이는 화면 중간 아래다. 올해 전체면 응답이 커서(묶음 4천여 줄) 위쪽 숫자까지 늦췄다.
          보일 때 부른다(2026-10-14). */}
      <LazyMount minHeight={420}>
        <ProductTrendChart brand={brand || "all"} from={from} to={to} />
      </LazyMount>

      {(
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
                      <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: `${brandMap[p.brand]?.color || BRAND_COLORS[p.brand] || '#6b7280'}20`, color: brandMap[p.brand]?.color || BRAND_COLORS[p.brand] || '#6b7280' }}>
                        {brandMap[p.brand]?.label || BRAND_LABELS[p.brand] || p.brand}
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
      {/* 밸런스랩 전용 구역. 펫·개별 펫 브랜드를 고르면 공구가 없어 빈 카드 3장이 떴다(2026-10-13). */}
      {(!brand || brand === "all" || brand === "balancelab") && (
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
                <p className="text-xs text-muted-foreground">{gongguData.total > 0 ? `${((gongguData.selfTotal / gongguData.total) * 100).toFixed(1)}%` : "-"}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-sm text-muted-foreground">공구매출</p>
                <p className="text-2xl font-bold text-purple-500">{formatCurrency(gongguData.gongguTotal)}</p>
                <p className="text-xs text-muted-foreground">{gongguData.total > 0 ? `${((gongguData.gongguTotal / gongguData.total) * 100).toFixed(1)}%` : "-"}</p>
              </CardContent>
            </Card>
          </div>

          {/* 자체 vs 공구 시간 추이 */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold">밸런스랩 자체 vs 공구 추이</h3>
                <div className="flex gap-1 bg-muted rounded-md p-0.5">
                  {(["daily", "weekly", "monthly"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setBalanceTrendMode(m)}
                      className={cn(
                        "px-2 py-1 text-xs rounded",
                        balanceTrendMode === m ? "bg-card shadow-sm font-medium" : "text-muted-foreground",
                      )}
                    >
                      {m === "daily" ? "일별" : m === "weekly" ? "주별" : "월별"}
                    </button>
                  ))}
                </div>
              </div>
              {balanceTrendData.length > 0 ? (
                <DeferredResponsiveContainer width="100%" height={260}>
                  <BarChart data={balanceTrendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="period" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      stroke="var(--muted-foreground)"
                      tickFormatter={(v) => `${(v / 10000).toFixed(0)}만`}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                      formatter={(val) => (val == null ? "-" : formatCurrency(Number(val)))}
                    />
                    <Legend />
                    <Bar isAnimationActive={false} dataKey="self" name="자체매출" stackId="bal" fill="#3b82f6" radius={[0, 0, 0, 0]} />
                    <Bar isAnimationActive={false} dataKey="gonggu" name="공구매출" stackId="bal" fill="#a855f7" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </DeferredResponsiveContainer>
              ) : (
                <p className="text-muted-foreground text-center py-8">밸런스랩 데이터가 없습니다.</p>
              )}
            </CardContent>
          </Card>

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
                        <td className="py-2 text-right">{gongguData.gongguTotal > 0 ? `${((s.revenue / gongguData.gongguTotal) * 100).toFixed(1)}%` : "-"}</td>
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
