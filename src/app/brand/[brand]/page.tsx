"use client";

import { Suspense, useMemo } from "react";
import { PageShell } from "@/components/page-shell";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent } from "@/components/ui/card";
import { DateRangeSelector } from "@/components/ui/date-range-selector";
import { useFilterParams, useFetch } from "@/hooks/use-dashboard-data";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";
import { BRAND_LABELS, AD_CHANNEL_COLORS } from "@/lib/types";
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

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
}
interface BrandDetailResp {
  lineupBreakdown: { lineup: string; revenue: number; quantity: number; orders: number }[];
  topProducts: { product: string; revenue: number; quantity: number }[];
  gongguSales?: { seller: string; revenue: number; orders: number }[];
  gongguSalesTotal?: number;
  selfSalesTotal?: number;
}

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

  const { data: dash, loading } = useFetch<DashboardResp>(`/api/dashboard?brand=${brand}&from=${from}&to=${to}`);
  const { data: cg } = useFetch<ChannelGroupsResp>(`/api/channel-groups?brand=${brand}&from=${from}&to=${to}`);
  const { data: detail } = useFetch<BrandDetailResp>(`/api/brand-detail?brand=${brand}&from=${from}&to=${to}`);

  const kpi = dash?.kpi;
  const pct = (cur?: number, prev?: number) => (prev && prev > 0 ? (((cur || 0) - prev) / prev) * 100 : undefined);
  const trendData = useMemo(() => (dash?.trend || []).map(t => ({ ...t, d: t.date.slice(5) })), [dash]);
  const adChannels = (dash?.channels || []).filter(c => c.spend > 0).sort((a, b) => b.spend - a.spend);
  const maxAd = Math.max(0, ...adChannels.map(c => c.spend));
  const lineups = detail?.lineupBreakdown || [];
  const maxLineup = Math.max(0, ...lineups.map(l => l.revenue));

  if (!VALID_BRANDS.includes(brand)) {
    return <PageShell title="브랜드 없음" description=""><p className="text-muted-foreground">알 수 없는 브랜드: {brand}</p></PageShell>;
  }

  return (
    <PageShell title={label} description={`${label} 종합 성과 — 채널·라인업·제품·광고비`}>
      {/* 기간 선택만 — 브랜드는 경로 고정 (개요의 브랜드 탭과 혼동 방지) */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-sm text-muted-foreground">{from} ~ {to}</span>
        <DateRangeSelector preset={preset} onChange={setPreset} onCustomRange={setCustomRange} from={from} to={to} isCustom={isCustom} />
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard title="매출" value={formatCurrency(kpi?.revenue || 0)} change={pct(kpi?.revenue, kpi?.revenuePrev)} />
        <KpiCard title="광고비" value={formatCurrency(kpi?.adSpend || 0)} change={pct(kpi?.adSpend, kpi?.adSpendPrev)} />
        <KpiCard title="ROAS" value={`${(kpi?.roas || 0).toFixed(2)}x`} change={pct(kpi?.roas, kpi?.roasPrev)} />
        <KpiCard title="주문 수" value={formatNumber(kpi?.orders || 0)} change={pct(kpi?.orders, kpi?.ordersPrev)} />
        <KpiCard title="이익" value={formatCurrency(kpi?.profit || 0)} change={pct(kpi?.profit, kpi?.profitPrev)} />
      </div>

      {/* 일별 매출·광고비 추이 */}
      <Card>
        <CardContent className="p-4">
          <h3 className="font-semibold text-sm mb-3">일별 매출 · 광고비</h3>
          {trendData.length > 0 ? (
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trendData}>
                  <XAxis dataKey="d" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `${Math.round(v / 10000)}만`} />
                  <Tooltip formatter={(v, name) => [formatCurrency(Number(v)), name === "revenue" ? "매출" : "광고비"]} labelFormatter={(l) => `날짜: ${l}`} />
                  <Bar dataKey="revenue" fill="#2563eb" radius={[3, 3, 0, 0]} name="revenue" />
                  <Line dataKey="adSpend" stroke="#ef4444" strokeWidth={2} dot={false} name="adSpend" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : <p className="text-sm text-muted-foreground py-8 text-center">{loading ? "로딩 중..." : "기간 내 데이터 없음"}</p>}
        </CardContent>
      </Card>

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
        {/* 광고 채널별 비용 */}
        <Card>
          <CardContent className="p-4">
            <h3 className="font-semibold text-sm mb-3">광고 채널별 비용 <span className="text-xs text-muted-foreground font-normal">ROAS는 플랫폼 신고 기준</span></h3>
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
