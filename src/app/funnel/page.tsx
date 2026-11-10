"use client";

import { Suspense, useMemo, useState } from "react";
import { matchesBrand } from "@/lib/brand-groups";
import { PageShell } from "@/components/page-shell";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent } from "@/components/ui/card";
import { useFilterParams, useFetch } from "@/hooks/use-dashboard-data";
import { formatNumber, formatCurrency, cn } from "@/lib/utils";
import { DeferredResponsiveContainer } from "@/components/deferred-chart";
import { daysBetween } from "@/lib/bucket";
import { ConversionControlChart } from "@/components/judge/conversion-control-chart";
import { SourceFunnelSteps, useSourceFunnels } from "@/components/judge/source-funnel-steps";
import { META_PURCHASE_UNTRACKED_BRANDS, UNMEASURED_LABEL } from "@/lib/conversion-tracking";
import { BRAND_LABELS, SALES_CHANNEL_COLORS, IMPRESSION_SOURCE_COLORS } from "@/lib/types";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, Legend,
} from "recharts";

interface FunnelStep { name: string; value: number; rate?: number | null; channels?: Record<string, number>; rateNote?: string | null; rateBase?: number; rateNum?: number; }
interface TrendPoint { date: string; sessions: number; cart_adds: number; purchases: number; impressions: number; [key: string]: string | number; }
interface ChannelFunnel { channel: string; sessions: number; cart_adds: number; purchases: number; repurchases: number; convRate: number; }
interface MetaAdRow { date: string; brand: string; impressions: number; clicks: number; conversions: number; conversion_value: number; reach: number; spend: number; }
interface FunnelData { funnel: FunnelStep[]; trend: TrendPoint[]; channelFunnel: ChannelFunnel[]; repurchase: { value: number; rate: number }; metaAds: MetaAdRow[]; }

// 색은 src/lib/types.ts 한 곳(같은 판매처·매체 = 모든 화면 같은 색).
const IMP_LABELS: Record<string, string> = { meta: "Meta", naver: "네이버", google: "구글", coupang: "쿠팡" };
const CH_LABELS: Record<string, string> = { smartstore: "스마트스토어", cafe24: "카페24", coupang: "쿠팡" };

// 일별 추이 한 장 + 지표 탭(2026-11-04). 예전에는 노출·유입·구매 영역 차트 3장이 세로로 쌓여 관리도가 첫 화면 밖으로 밀렸다.
type TrendMetric = "imp" | "sessions" | "purchases";
const TREND_METRICS: { key: TrendMetric; label: string; axis: string; series: { key: string; label: string; color: string }[] }[] = [
  { key: "imp", label: "노출", axis: "광고 노출 수(매체별로 쌓음)",
    series: ["meta", "naver", "google", "coupang"].map((k) => ({ key: `imp_${k}`, label: IMP_LABELS[k], color: IMPRESSION_SOURCE_COLORS[k] })) },
  { key: "sessions", label: "유입", axis: "유입(세션) 수(판매처별로 쌓음)",
    series: ["smartstore", "cafe24", "coupang"].map((k) => ({ key: `sessions_${k}`, label: CH_LABELS[k], color: SALES_CHANNEL_COLORS[k] })) },
  { key: "purchases", label: "구매", axis: "구매 수(판매처별로 쌓음)",
    series: ["smartstore", "cafe24", "coupang"].map((k) => ({ key: `purchases_${k}`, label: CH_LABELS[k], color: SALES_CHANNEL_COLORS[k] })) },
];

export default function FunnelPage() {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">불러오는 중...</div>}>
      <FunnelInner />
    </Suspense>
  );
}

function FunnelInner() {
  const { from, to, brand } = useFilterParams();
  const { data, loading } = useFetch<FunnelData>(`/api/funnel?from=${from}&to=${to}&brand=${brand || "all"}`);

  const funnel = data?.funnel || [];
  // 축 = 선택 기간 전체(오늘까지, 2026-10-28). 서버는 수집 행이 있는 날만 보낸다.
  // 노출·유입·구매 어느 원천에도 행이 없는 날은 "0 건"이 아니라 수집되지 않은 날이라
  // 0 으로 채우지 않고 빈칸(null)으로 둔다. 날짜 자리는 축에 남는다.
  const trend = useMemo(() => {
    const rows = data?.trend || [];
    if (!rows.length) return [];
    const byDate = new Map(rows.map((t) => [t.date, t]));
    const days = Array.from(new Set([...daysBetween(from, to), ...byDate.keys()])).sort();
    return days.map((d) => byDate.get(d) || ({ date: d } as TrendPoint));
  }, [data, from, to]);
  const channelFunnel = data?.channelFunnel || [];
  const repurchase = data?.repurchase || { value: 0, rate: 0 };
  // 원천별 평균 전환율(관리도 p̄). 단계표·관리도와 같은 주소라 요청은 한 번이다.
  // 판매 원장 마지막 날도 같은 응답에서 받는다(구매 추이에서 그 뒤 날짜를 비우는 데 쓴다).
  const { salesLastDate } = useSourceFunnels(brand || "all", from, to);
  const [trendMetric, setTrendMetric] = useState<TrendMetric>("sessions");
  const metricDef = TREND_METRICS.find((m) => m.key === trendMetric)!;
  // 구매는 판매 원장에서 온다. 마지막 판매일 뒤는 0 이 아니라 동기화 대기라 빈칸(null).
  const trendRows = useMemo(() => trend.map((t) => {
    const row: Record<string, string | number | null> = { date: t.date.slice(5) };
    for (const sr of metricDef.series) {
      const v = t[sr.key];
      row[sr.key] = trendMetric === "purchases" && salesLastDate && t.date > salesLastDate ? null : v == null ? null : Number(v);
    }
    return row;
  }), [trend, metricDef, trendMetric, salesLastDate]);

  // 너티/아이언펫/사입은 cafe24·스마트스토어 퍼널이 시트에서 3개 합산으로만 기록됨 → 브랜드별 분리 불가.
  // 숫자를 쪼개 보여주면 과대귀속(왜곡)이므로, 합산 수치임을 정직하게 라벨한다.
  const SHARED_STOREFRONT_BRANDS = ["pet", "nutty", "ironpet", "saip"];
  const isSharedStorefront = !!brand && SHARED_STOREFRONT_BRANDS.includes(brand);

  const sessionsStep = funnel.find(s => s.name === "유입");
  const purchaseStep = funnel.find(s => s.name === "구매");
  const cartStep = funnel.find(s => s.name === "장바구니");
  // ★ 전체 「구매 전환율」 KPI 는 뺐다(2026-11-03). 전 판매처 구매 ÷ 일부 채널 유입처럼 분모·분자 모집단이 달라
  //   아이언펫 0.02% 같은 숫자가 떴다. 전환율은 원천별로만 낸다(아래 원천별 단계표).
  const cartVal = cartStep?.value || 0;
  const purchaseVal = purchaseStep?.value || 0;
  // ★ 이탈률은 장바구니가 실제로 수집되는 채널로만 계산한다(API가 rateBase/rateNum 으로 내려줌).
  //   전 채널 구매 ÷ 일부 채널 장바구니로 계산하면 이탈률이 음수가 되어 0%로 뭉개졌다(2026-08 리뷰).
  const abCart = purchaseStep?.rateBase ?? cartVal;
  const abPurch = purchaseStep?.rateNum ?? purchaseVal;
  // rate 가 null 이면 API가 "커버리지 불일치로 산출 불가"로 판정한 것 → 화면도 숫자를 만들지 않는다.
  const abandonComputable = purchaseStep?.rate != null && abCart > 0;
  const abandonRate = abandonComputable ? Math.max(0, ((abCart - abPurch) / abCart) * 100) : 0;
  const cartNote = purchaseStep?.rateNote || null;

  /* Meta 광고 퍼널 */
  // 도달(reach)은 수집하지 않아 늘 0 이고, 구매 전환은 픽셀에서 막힌 브랜드가 있다(src/lib/conversion-tracking.ts).
  // 둘을 0·-100% 로 찍으면 "성과 0" 으로 읽히므로, 노출→클릭만 실측으로 보이고 전환은 측정되는 브랜드 행만 쓴다.
  const metaFunnel = useMemo(() => {
    const rows = (data?.metaAds || []).filter(r => !brand || brand === "all" || matchesBrand(r.brand, brand));
    const t = { impressions: 0, clicks: 0, spend: 0, trackedSpend: 0, conversions: 0, convValue: 0 };
    const untracked = new Set<string>();
    for (const r of rows) {
      t.impressions += r.impressions || 0;
      t.clicks += r.clicks || 0;
      t.spend += r.spend || 0;
      if (META_PURCHASE_UNTRACKED_BRANDS.has(r.brand)) {
        if ((r.spend || 0) > 0 || (r.impressions || 0) > 0) untracked.add(r.brand);
        continue;
      }
      t.trackedSpend += r.spend || 0;
      t.conversions += r.conversions || 0;
      t.convValue += r.conversion_value || 0;
    }
    return { ...t, untrackedBrands: Array.from(untracked) };
  }, [data, brand]);

  if (loading) {
    return (
      <PageShell title="퍼널" description="전환 퍼널 분석">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="p-5 animate-pulse"><CardContent className="p-0"><div className="h-4 w-20 bg-muted rounded mb-2" /><div className="h-8 w-28 bg-muted rounded" /></CardContent></Card>
          ))}
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell title="퍼널" description="전환 퍼널 분석">
      {isSharedStorefront && (
        <Card className="border-l-4 border-l-amber-500 bg-amber-500/5" data-tour="funnel-shared-note">
          <CardContent className="p-3 flex items-start gap-2 text-sm">
            <span>ⓘ</span>
            <span>
              cafe24·스마트스토어 퍼널은 <b>너티+아이언펫+사입 통합 수치</b>입니다. 자사몰 유입·장바구니 데이터가 소스(시트)에서 합산으로만 기록돼 브랜드별 분리가 불가능합니다. (쿠팡은 너티 전용). 해당 브랜드 단독 수치가 아닌 점 참고하세요.
            </span>
          </CardContent>
        </Card>
      )}

      {/* KPI: 이 화면의 본문은 아래 원천별 단계표와 관리도라 KPI 는 compact 한 줄로 누른다.
          (원천별 구매 전환율 문장은 2026-11-04 뺐다. 단계표의 「유입 대비 %」와 같은 숫자다.) */}
      <div className="grid grid-cols-3 gap-2.5" data-tour="funnel-kpis">
        <KpiCard size="compact" title="총 세션" value={formatNumber(sessionsStep?.value || 0)} />
        <KpiCard size="compact" title="장바구니 이탈률" value={abandonComputable ? `${abandonRate.toFixed(1)}%` : "산출 불가"} />
        <KpiCard size="compact" title="총 구매" value={formatNumber(purchaseVal)} subtitle={repurchase.value > 0 ? `재구매 ${formatNumber(repurchase.value)}건 · ${repurchase.rate.toFixed(1)}%` : undefined} />
      </div>
      {cartNote && (
        <p className="text-xs text-muted-foreground -mt-2" data-tour="funnel-cart-note">
          ⓘ {abandonComputable ? `장바구니 이탈률은 ${cartNote}` : cartNote}
        </p>
      )}

      {/* 원천별 단계표 (2026-11-03, 옛 「전환 퍼널」 깔때기 대체). 원천 사이를 잇거나 합치지 않는다. */}
      <div data-tour="funnel-steps">
        <SourceFunnelSteps brand={brand || "all"} from={from} to={to} />
      </div>

      {/* 판단용: 일별 전환율 관리도 (2026-11-03). 같은 원천의 유입·구매로만 계산한다. */}
      <div data-tour="funnel-control">
        <ConversionControlChart brand={brand || "all"} from={from} to={to} />
      </div>

      {/* 일별 추이: 노출·유입·구매 중 하나를 골라 본다. 재구매는 퍼널 단계가 아니라 별도 수치라 위 구매 카드에 적는다. */}
      {trend.length > 0 && (
        <Card data-tour="funnel-trend-impressions">
          <CardContent className="p-4">
            <div className="flex items-start justify-between flex-wrap gap-2 mb-3">
              <div>
                <h3 className="font-semibold">일별 {metricDef.label} 추이</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  가로 = 날짜, 세로 = {metricDef.axis}. 수집되지 않은 날은 비웁니다
                  {trendMetric === "purchases" && salesLastDate ? `. 구매는 판매 원장 ${salesLastDate.slice(5)}까지` : ""}
                </p>
              </div>
              <div data-tour="funnel-trend-tabs" className="flex gap-1 bg-muted rounded-md p-0.5">
                {TREND_METRICS.map((m) => (
                  <button key={m.key} onClick={() => setTrendMetric(m.key)}
                    className={cn("px-2 py-1 text-xs rounded", trendMetric === m.key ? "bg-card shadow-sm font-medium" : "text-muted-foreground")}>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <DeferredResponsiveContainer width="100%" height={220}>
              <AreaChart data={trendRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" tickFormatter={(v: number) => formatNumber(v)} />
                <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }}
                  formatter={(v: unknown) => (v == null ? "-" : formatNumber(Number(v)))} />
                <Legend />
                {metricDef.series.map((sr) => (
                  <Area key={sr.key} type="monotone" dataKey={sr.key} name={sr.label} stackId="m" isAnimationActive={false}
                    stroke={sr.color} fill={sr.color} fillOpacity={0.5} connectNulls={false} />
                ))}
              </AreaChart>
            </DeferredResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* 채널별 퍼널 비교 */}
      {channelFunnel.length > 0 && (
        <Card data-tour="funnel-channel-compare">
          <CardContent className="p-4">
            <h3 className="font-semibold mb-4">채널별 퍼널 비교</h3>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                <p className="text-xs text-muted-foreground mb-3">채널별 구매 전환율 (구매 ÷ 유입, %). 판매처마다 유입을 재는 방법이 달라 높낮이로 우열을 가리지 않습니다</p>
                <DeferredResponsiveContainer width="100%" height={180}>
                  <BarChart data={channelFunnel}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="channel" tick={{ fontSize: 12 }} stroke="var(--muted-foreground)" />
                    <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" tickFormatter={(v: number) => `${v.toFixed(1)}%`} />
                    <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }}
                      formatter={(v: unknown) => [`${Number(v).toFixed(2)}%`, "전환율"]} />
                    <Bar dataKey="convRate" name="전환율" radius={[4, 4, 0, 0]} fill="var(--neutral-1)" isAnimationActive={false} />
                  </BarChart>
                </DeferredResponsiveContainer>
              </div>
              <div className="overflow-x-auto">
                <p className="text-xs text-muted-foreground mb-3">채널별 퍼널 상세</p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left border-b text-muted-foreground">
                      <th className="pb-2 pr-4">채널</th>
                      <th className="pb-2 pr-4 text-right">유입</th>
                      <th className="pb-2 pr-4 text-right">장바구니</th>
                      <th className="pb-2 pr-4 text-right">구매</th>
                      <th className="pb-2 pr-4 text-right">재구매</th>
                      <th className="pb-2 text-right">전환율</th>
                    </tr>
                  </thead>
                  <tbody>
                    {channelFunnel.map((ch) => (
                      <tr key={ch.channel} className="border-b border-border/50 hover:bg-muted/50">
                        <td className="py-2 pr-4 font-medium">{ch.channel}</td>
                        <td className="py-2 pr-4 text-right">{formatNumber(ch.sessions)}</td>
                        <td className="py-2 pr-4 text-right">{formatNumber(ch.cart_adds)}</td>
                        <td className="py-2 pr-4 text-right">{formatNumber(ch.purchases)}</td>
                        <td className="py-2 pr-4 text-right">{formatNumber(ch.repurchases)}</td>
                        {/* 색 기준(5%↑ 초록 등)은 뺐다. 원천마다 유입 측정법이 달라 같은 잣대로 칠할 수 없다. */}
                        <td className="py-2 text-right font-medium">
                          {ch.convRate.toFixed(2)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Meta 광고 퍼널: 노출→클릭(CTR)만 실측. 도달은 미수집이라 칸을 두지 않는다. */}
      {metaFunnel.impressions > 0 && (
        <Card className="border-l-4 border-l-blue-500" data-tour="funnel-meta">
          <CardContent className="p-4">
            <h3 className="font-semibold mb-4">Meta 광고 퍼널</h3>
            <div className="flex items-center gap-1">
              <div className="flex-1 text-center">
                <div className="text-xs text-muted-foreground mb-1">노출</div>
                <div className="text-lg font-bold">{formatNumber(metaFunnel.impressions)}</div>
              </div>
              <div className="text-center px-1 text-muted-foreground">
                <div className="text-lg">→</div>
                <div className="text-[10px]">CTR {((metaFunnel.clicks / metaFunnel.impressions) * 100).toFixed(2)}%</div>
              </div>
              <div className="flex-1 text-center">
                <div className="text-xs text-muted-foreground mb-1">클릭</div>
                <div className="text-lg font-bold">{formatNumber(metaFunnel.clicks)}</div>
              </div>
              <div className="text-center px-1 text-muted-foreground"><div className="text-lg">→</div></div>
              <div className="flex-1 text-center">
                <div className="text-xs text-muted-foreground mb-1">구매 전환</div>
                {metaFunnel.trackedSpend > 0
                  ? <div className="text-lg font-bold">{formatNumber(metaFunnel.conversions)}</div>
                  : <div className="text-sm font-medium text-muted-foreground/80 italic">{UNMEASURED_LABEL}</div>}
              </div>
            </div>
            <div className="flex flex-wrap justify-between gap-2 mt-3 text-xs text-muted-foreground border-t pt-2">
              <span>광고비: {formatCurrency(metaFunnel.spend)}</span>
              {metaFunnel.trackedSpend > 0 ? (
                <>
                  <span>전환매출: {formatCurrency(metaFunnel.convValue)}</span>
                  <span>ROAS: {(metaFunnel.convValue / metaFunnel.trackedSpend).toFixed(2)}x</span>
                  <span>CPA: {metaFunnel.conversions > 0 ? formatCurrency(Math.round(metaFunnel.trackedSpend / metaFunnel.conversions)) : "-"}</span>
                </>
              ) : (
                <span>전환매출·ROAS·CPA: {UNMEASURED_LABEL}</span>
              )}
            </div>
            {metaFunnel.untrackedBrands.length > 0 && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                {metaFunnel.untrackedBrands.map((b) => BRAND_LABELS[b] || b).join("·")} 메타 픽셀은 구매 이벤트가 막혀 있어 전환이 0 으로 들어옵니다. 성과 0 이 아니라 측정 불가입니다
                {metaFunnel.trackedSpend > 0 ? " (전환·ROAS·CPA 는 그 브랜드를 뺀 값)" : ""}.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
