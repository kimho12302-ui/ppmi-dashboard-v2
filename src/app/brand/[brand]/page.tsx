"use client";

import { Suspense, useMemo, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent } from "@/components/ui/card";
import { DateRangeSelector } from "@/components/ui/date-range-selector";
import { useFilterParams, useFetch } from "@/hooks/use-dashboard-data";
import { formatCurrency, formatNumber, formatPercent, cn } from "@/lib/utils";
import { BRAND_LABELS, AD_CHANNEL_COLORS } from "@/lib/types";
import { bucketize, GRAN_LABELS, type Gran } from "@/lib/bucket";
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";

// 브랜드 종합 페이지 (2026-08): 사이드바 브랜드 클릭 시 진입.
// 개요와 달리 브랜드 탭(전체/펫/밸런스랩)을 두지 않는다 — 브랜드는 경로로 고정, 기간만 선택.

const VALID_BRANDS = ["pet", "nutty", "ironpet", "saip", "balancelab"];
const AD_CH_KOR: Record<string, string> = {
  meta: "메타", naver_search: "네이버 검색", naver_shopping: "네이버 쇼핑",
  google_pmax: "구글 P-Max", google_search: "구글 검색", gfa: "GFA", coupang_ads: "쿠팡 광고",
};

interface DashboardResp {
  kpi: { revenue: number; revenuePrev: number; adSpend: number; adSpendPrev: number; roas: number; roasPrev: number; orders: number; ordersPrev: number; profit: number; profitPrev: number; aov: number };
  trend: { date: string; revenue: number; adSpend: number }[];
  channels: { channel: string; spend: number; roas: number }[];
}
interface ChannelGroupsResp {
  groups: { key: string; label: string; revenue: number; adSpend: number; roas: number; adRatio: number; revDelta: number | null }[];
  /** 날짜 × 판매처별 매출·광고비. 판매처 개별 추이 차트가 쓴다. */
  series?: ({ date: string } & Record<string, { revenue: number; adSpend: number } | string>)[];
}
interface BrandDetailResp {
  lineupBreakdown: { lineup: string; revenue: number; quantity: number; orders: number }[];
  topProducts: { product: string; revenue: number; quantity: number }[];
  stackSeries?: { date: string; byChannel: Record<string, number>; byProduct: Record<string, number>; byLineup: Record<string, number> }[];
  stackKeys?: { channels: string[]; products: string[]; lineups: string[] };
  gongguSales?: { seller: string; revenue: number; orders: number }[];
  gongguSalesTotal?: number;
  selfSalesTotal?: number;
  selfGongguTrend?: { date: string; self: number; gonggu: number }[];
}

// 누적 막대 계열 색 (범례 순서대로). 판매처·라인업·제품 공통 사용.
const STACK_COLORS = ["#2563eb", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#06b6d4", "#94a3b8"];
type StackDim = "channel" | "lineup" | "product" | "gonggu";
const STACK_DIMS: { key: StackDim; label: string }[] = [
  { key: "channel", label: "판매처별" },
  { key: "lineup", label: "라인업별" },
  { key: "product", label: "제품별" },
];
// 밸런스랩은 매출의 대부분이 공구라 자체/공구 구성을 따로 볼 수 있어야 한다.
const GONGGU_DIM: { key: StackDim; label: string } = { key: "gonggu", label: "자체/공구" };

export default function BrandPage({ params }: { params: { brand: string } }) {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">로딩 중...</div>}>
      <BrandInner brand={params.brand} />
    </Suspense>
  );
}

function BarRow({ label, value, max, sub, color = "#2563eb" }: { label: string; value: number; max: number; sub?: string; color?: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm w-28 flex-shrink-0 truncate" title={label}>{label}</span>
      <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${max > 0 ? (value / max) * 100 : 0}%`, backgroundColor: color }} />
      </div>
      <span className="text-sm font-medium w-28 text-right flex-shrink-0">{formatCurrency(value)}</span>
      {sub !== undefined && <span className="text-xs text-muted-foreground w-20 text-right flex-shrink-0">{sub}</span>}
    </div>
  );
}

function BrandInner({ brand }: { brand: string }) {
  const { preset, from, to, isCustom, setPreset, setCustomRange } = useFilterParams();
  const label = BRAND_LABELS[brand] || brand;
  const [gran, setGran] = useState<Gran>("day");
  const [dim, setDim] = useState<StackDim>("channel");
  const [store, setStore] = useState<string | null>(null); // 선택한 판매처 (null=첫 번째)

  const { data: dash, loading } = useFetch<DashboardResp>(`/api/dashboard?brand=${brand}&from=${from}&to=${to}`);
  const { data: cg } = useFetch<ChannelGroupsResp>(`/api/channel-groups?brand=${brand}&from=${from}&to=${to}`);
  const { data: detail } = useFetch<BrandDetailResp>(`/api/brand-detail?brand=${brand}&from=${from}&to=${to}`);

  const kpi = dash?.kpi;
  const pct = (cur?: number, prev?: number) => (prev && prev > 0 ? (((cur || 0) - prev) / prev) * 100 : undefined);
  const adChannels = (dash?.channels || []).filter(c => c.spend > 0).sort((a, b) => b.spend - a.spend);
  const maxAd = Math.max(0, ...adChannels.map(c => c.spend));
  const lineups = detail?.lineupBreakdown || [];
  const maxLineup = Math.max(0, ...lineups.map(l => l.revenue));

  // ── 누적 막대: 선택한 차원(판매처/라인업/제품) × 선택한 단위(일/주/월) ──
  const CH_KOR: Record<string, string> = { smartstore: "스마트스토어", cafe24: "자사몰(카페24)", coupang: "쿠팡", other: "기타", pp: "피피", ably: "에이블리", petfriends: "펫프렌즈" };
  // 밸런스랩만 자체/공구 차원 추가
  const hasGonggu = (detail?.gongguSalesTotal || 0) > 0;
  const dims = useMemo(() => (hasGonggu ? [...STACK_DIMS, GONGGU_DIM] : STACK_DIMS), [hasGonggu]);

  const stackKeys = useMemo(() => {
    if (dim === "gonggu") return ["자체", "공구"];
    const k = detail?.stackKeys;
    if (!k) return [] as string[];
    return dim === "channel" ? k.channels : dim === "lineup" ? k.lineups : k.products;
  }, [detail, dim]);

  const stackData = useMemo(() => {
    if (dim === "gonggu") {
      const rows = detail?.selfGongguTrend || [];
      if (!rows.length) return [];
      return bucketize(rows, gran, (r) => ({ 자체: r.self || 0, 공구: r.gonggu || 0 }))
        .map((b) => ({ label: b.label, ...b.values }));
    }
    const rows = detail?.stackSeries || [];
    if (!rows.length) return [];
    const field = dim === "channel" ? "byChannel" : dim === "lineup" ? "byLineup" : "byProduct";
    return bucketize(rows, gran, (r) => (r as unknown as Record<string, Record<string, number>>)[field] || {})
      .map((b) => ({ label: b.label, ...b.values }));
  }, [detail, dim, gran]);

  // 매출 구성 차트에 겹쳐 그릴 광고비. 같은 버킷 단위로 접는다.
  // (별도 "일별 매출·광고비" 차트가 이 차트와 사실상 같은 그림이라 광고비 선만 여기로 합쳤다)
  const adByBucket = useMemo(() => {
    const rows = dash?.trend || [];
    if (!rows.length) return new Map<string, number>();
    const m = new Map<string, number>();
    for (const b of bucketize(rows, gran, (r) => ({ ad: r.adSpend || 0 }))) m.set(b.label, b.values.ad || 0);
    return m;
  }, [dash, gran]);

  const chartData = useMemo(
    () => stackData.map((row) => ({ ...row, __ad: adByBucket.get(String(row.label)) || 0 })),
    [stackData, adByBucket]
  );

  // ── 판매처 개별 성과: channel-groups 의 series(날짜 × 판매처 {revenue, adSpend}) 사용 ──
  const storeOptions = useMemo(
    () => (cg?.groups || []).filter(g => g.revenue > 0 || g.adSpend > 0),
    [cg]
  );
  const activeStore = store && storeOptions.some(g => g.key === store) ? store : storeOptions[0]?.key || null;
  const storeSeries = useMemo(() => {
    const rows = (cg?.series || []) as unknown as { date: string; [k: string]: { revenue: number; adSpend: number } | string }[];
    if (!rows.length || !activeStore) return [];
    return bucketize(
      rows.map(r => ({ date: String(r.date), cell: r[activeStore] as { revenue: number; adSpend: number } | undefined })),
      gran,
      (r) => ({ 매출: r.cell?.revenue || 0, 광고비: r.cell?.adSpend || 0 })
    ).map(b => ({
      label: b.label,
      매출: b.values["매출"] || 0,
      광고비: b.values["광고비"] || 0,
      ROAS: (b.values["광고비"] || 0) > 0 ? +((b.values["매출"] || 0) / (b.values["광고비"] || 1)).toFixed(2) : 0,
    }));
  }, [cg, activeStore, gran]);
  const activeStoreLabel = storeOptions.find(g => g.key === activeStore)?.label || "";

  const dimLabel = [...STACK_DIMS, GONGGU_DIM].find(d => d.key === dim)?.label || "";
  const keyLabel = (k: string) => (dim === "channel" ? CH_KOR[k] || k : k);

  if (!VALID_BRANDS.includes(brand)) {
    return <PageShell title="브랜드 없음" description=""><p className="text-muted-foreground">알 수 없는 브랜드: {brand}</p></PageShell>;
  }

  return (
    <PageShell title={label} description={`${label} 종합 성과 — 판매처·라인업·제품·광고비`} hideFilters>
      {/* 기간 선택만 — 브랜드는 경로 고정, 전역 필터(전체/펫/밸런스랩 탭) 숨김 (혼동 방지) */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-sm text-muted-foreground">{from} ~ {to}</span>
        <DateRangeSelector preset={preset} onChange={setPreset} onCustomRange={setCustomRange} from={from} to={to} isCustom={isCustom} />
      </div>

      {/* KPI. 공구가 있는 브랜드(밸런스랩)는 매출의 대부분이 공구라 자체매출만 보면
          브랜드 규모가 크게 과소 표시된다 → '총매출(공구 포함)'을 맨 앞에 병기한다.
          단 ROAS·이익은 광고/원가와 대응하는 자체매출 기준을 유지한다(공구는 광고와 무관). */}
      <div className={cn("grid grid-cols-2 gap-4", hasGonggu ? "lg:grid-cols-6" : "lg:grid-cols-5")}>
        {hasGonggu && (
          <KpiCard
            title="총매출 (공구 포함)"
            value={formatCurrency((detail?.selfSalesTotal || 0) + (detail?.gongguSalesTotal || 0))}
          />
        )}
        <KpiCard title={hasGonggu ? "자체매출" : "매출"} value={formatCurrency(kpi?.revenue || 0)} change={pct(kpi?.revenue, kpi?.revenuePrev)} />
        <KpiCard title="광고비" value={formatCurrency(kpi?.adSpend || 0)} change={pct(kpi?.adSpend, kpi?.adSpendPrev)} />
        <KpiCard title="ROAS" value={`${(kpi?.roas || 0).toFixed(2)}x`} change={pct(kpi?.roas, kpi?.roasPrev)} />
        <KpiCard title="주문 수" value={formatNumber(kpi?.orders || 0)} change={pct(kpi?.orders, kpi?.ordersPrev)} />
        <KpiCard title="이익" value={formatCurrency(kpi?.profit || 0)} change={pct(kpi?.profit, kpi?.profitPrev)} />
      </div>
      {hasGonggu && (
        <p className="text-xs text-muted-foreground -mt-2">
          총매출 = 자체 {formatCurrency(detail?.selfSalesTotal || 0)} + 공구 {formatCurrency(detail?.gongguSalesTotal || 0)}
          {" · "}ROAS·이익은 광고·원가와 대응하는 <b>자체매출</b> 기준입니다 (공구는 광고와 무관).
        </p>
      )}

      {/* 매출 구성 누적 막대 — 판매처/라인업/제품 × 일/주/월 */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <h3 className="font-semibold text-sm">
              매출 구성 · {dimLabel}
              <span className="text-xs text-muted-foreground font-normal ml-2">
                {dim === "gonggu" ? "자체매출 + 공구 (전체)" : "자체매출 기준 (공구 제외)"}
              </span>
            </h3>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-0.5 rounded-lg bg-muted p-1">
                {dims.map(d => (
                  <button key={d.key} onClick={() => setDim(d.key)}
                    className={cn("px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
                      dim === d.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                    {d.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-0.5 rounded-lg bg-muted p-1">
                {GRAN_LABELS.map(g => (
                  <button key={g.key} onClick={() => setGran(g.key)}
                    className={cn("px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
                      gran === g.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                    {g.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {stackData.length > 0 && stackKeys.length > 0 ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData}>
                  <XAxis dataKey="label" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `${Math.round(v / 10000)}만`} />
                  <Tooltip
                    formatter={(v, name) => [formatCurrency(Number(v)), name === "__ad" ? "광고비" : keyLabel(String(name))]}
                    labelFormatter={(l) => `${l}`}
                    itemSorter={(i) => -(Number(i.value) || 0)} />
                  <Legend formatter={(v) => (v === "__ad" ? "광고비" : keyLabel(String(v)))} wrapperStyle={{ fontSize: 11 }} />
                  {stackKeys.map((k, i) => (
                    <Bar key={k} dataKey={k} stackId="rev" fill={STACK_COLORS[i % STACK_COLORS.length]}
                      radius={i === stackKeys.length - 1 ? [3, 3, 0, 0] : undefined} />
                  ))}
                  {/* 광고비는 누적 막대 위에 선으로. 매출 구성과 투입을 한 그림에서 본다. */}
                  <Line dataKey="__ad" stroke="#ef4444" strokeWidth={2} dot={false} name="__ad" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : <p className="text-sm text-muted-foreground py-10 text-center">{loading ? "로딩 중..." : "기간 내 판매 없음"}</p>}
        </CardContent>
      </Card>

      {/* 판매처 개별 추이 — 하나 골라서 매출·광고비·ROAS 를 같이 본다 */}
      {storeOptions.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <h3 className="font-semibold text-sm">
                판매처 상세 · {activeStoreLabel}
                <span className="text-xs text-muted-foreground font-normal ml-2">매출 막대 · 광고비 선 · ROAS 선</span>
              </h3>
              <div className="flex items-center gap-0.5 rounded-lg bg-muted p-1 flex-wrap">
                {storeOptions.map(g => (
                  <button key={g.key} onClick={() => setStore(g.key)}
                    className={cn("px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap",
                      activeStore === g.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                    {g.label.split(" (")[0]}
                  </button>
                ))}
              </div>
            </div>
            {storeSeries.length > 0 ? (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={storeSeries}>
                    <XAxis dataKey="label" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis yAxisId="won" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `${Math.round(v / 10000)}만`} />
                    <YAxis yAxisId="roas" orientation="right" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}x`} />
                    <Tooltip formatter={(v, name) => [name === "ROAS" ? `${v}x` : formatCurrency(Number(v)), String(name)]} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar yAxisId="won" dataKey="매출" fill="#2563eb" radius={[3, 3, 0, 0]} />
                    <Line yAxisId="won" dataKey="광고비" stroke="#ef4444" strokeWidth={2} dot={false} />
                    <Line yAxisId="roas" dataKey="ROAS" stroke="#10b981" strokeWidth={2} dot={false} strokeDasharray="4 3" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : <p className="text-sm text-muted-foreground py-10 text-center">이 판매처의 기간 내 데이터가 없습니다</p>}
          </CardContent>
        </Card>
      )}

      {/* 판매처(채널)별 성과 */}
      <Card>
        <CardContent className="p-4">
          <h3 className="font-semibold text-sm mb-3">판매처별 성과 <span className="text-xs text-muted-foreground font-normal">매출 vs 그 판매처를 끌어온 광고비</span></h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b">
                  <th className="text-left py-2 font-medium">판매처</th>
                  <th className="text-right py-2 font-medium">매출</th>
                  <th className="text-right py-2 font-medium">광고비</th>
                  <th className="text-right py-2 font-medium">ROAS</th>
                  <th className="text-right py-2 font-medium">광고비중</th>
                </tr>
              </thead>
              <tbody>
                {(cg?.groups || []).filter(g => g.revenue > 0 || g.adSpend > 0).map(g => (
                  <tr key={g.key} className="border-b last:border-0">
                    <td className="py-2">{g.label}</td>
                    <td className="py-2 text-right font-medium">{formatCurrency(g.revenue)}</td>
                    <td className="py-2 text-right">{formatCurrency(g.adSpend)}</td>
                    <td className="py-2 text-right">{g.adSpend > 0 ? `${g.roas.toFixed(2)}x` : "—"}</td>
                    <td className="py-2 text-right">{g.revenue > 0 ? formatPercent(g.adRatio) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 매체별 광고비 */}
        <Card>
          <CardContent className="p-4">
            <h3 className="font-semibold text-sm mb-3">매체별 광고비 <span className="text-xs text-muted-foreground font-normal">ROAS는 플랫폼 신고 기준</span></h3>
            {adChannels.length > 0 ? (
              <div className="space-y-2">
                {adChannels.map(c => (
                  <BarRow key={c.channel} label={AD_CH_KOR[c.channel] || c.channel} value={c.spend} max={maxAd}
                    sub={c.roas > 0 ? `${c.roas.toFixed(1)}x` : "—"} color={AD_CHANNEL_COLORS[c.channel] || "#6b7280"} />
                ))}
              </div>
            ) : <p className="text-sm text-muted-foreground py-6 text-center">광고 집행 없음</p>}
          </CardContent>
        </Card>

        {/* 라인업별 성과 */}
        <Card>
          <CardContent className="p-4">
            <h3 className="font-semibold text-sm mb-3">라인업별 매출</h3>
            {lineups.length > 0 ? (
              <div className="space-y-2">
                {lineups.slice(0, 10).map(l => (
                  <BarRow key={l.lineup} label={l.lineup} value={l.revenue} max={maxLineup} sub={`${formatNumber(l.quantity)}개`} />
                ))}
              </div>
            ) : <p className="text-sm text-muted-foreground py-6 text-center">데이터 없음</p>}
          </CardContent>
        </Card>
      </div>

      {/* 제품별 성과 */}
      <Card>
        <CardContent className="p-4">
          <h3 className="font-semibold text-sm mb-3">제품별 성과 (TOP 15)</h3>
          {(detail?.topProducts || []).length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground border-b">
                    <th className="text-left py-2 font-medium">제품</th>
                    <th className="text-right py-2 font-medium">매출</th>
                    <th className="text-right py-2 font-medium">판매량</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail?.topProducts || []).slice(0, 15).map(p => (
                    <tr key={p.product} className="border-b last:border-0">
                      <td className="py-2 truncate max-w-[300px]" title={p.product}>{p.product}</td>
                      <td className="py-2 text-right font-medium">{formatCurrency(p.revenue)}</td>
                      <td className="py-2 text-right">{formatNumber(p.quantity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-sm text-muted-foreground py-6 text-center">데이터 없음</p>}
        </CardContent>
      </Card>

      {/* 밸런스랩: 공구 셀러별 (자체매출과 분리) */}
      {brand === "balancelab" && (detail?.gongguSales || []).length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h3 className="font-semibold text-sm mb-3">
              공구 셀러별 매출 <span className="text-xs text-muted-foreground font-normal">
                자체 {formatCurrency(detail?.selfSalesTotal || 0)} · 공구 {formatCurrency(detail?.gongguSalesTotal || 0)} (헤드라인 매출은 자체 기준)
              </span>
            </h3>
            <div className="space-y-2">
              {(detail?.gongguSales || []).slice(0, 10).map(s => (
                <BarRow key={s.seller} label={s.seller} value={s.revenue}
                  max={Math.max(0, ...(detail?.gongguSales || []).map(x => x.revenue))} sub={`${formatNumber(s.orders)}건`} color="#7c3aed" />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
