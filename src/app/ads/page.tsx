"use client";

import Image from "next/image";
import { PageShell } from "@/components/page-shell";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent } from "@/components/ui/card";
import { useFilterParams, useFetch, usePrefetch } from "@/hooks/use-dashboard-data";
import { AD_ALERTS_URL, dashboardUrl } from "@/lib/api-urls";
import { AdAlerts } from "@/components/ad-alerts";
import { NaverCampaignMultiples } from "@/components/judge/naver-campaign-multiples";
import { CHANNEL_LABELS, CHANNEL_COLORS, BRAND_LABELS, type DailyAdSpend } from "@/lib/types";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { DeferredResponsiveContainer } from "@/components/deferred-chart";
import { isPurchaseConversionMeasured, NAVER_ROAS_UNTRUSTED_ACCOUNTS } from "@/lib/conversion-tracking";
import { AdsUtmSection } from "@/components/ads-utm-section";
import { useConfig } from "@/hooks/use-config";
import { daysBetween } from "@/lib/bucket";
import { formatCurrency, formatNumber, formatPercent, formatRoas, isRoasUntracked, cn } from "@/lib/utils";
import { Suspense, useCallback, useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";

type ViewTab = "overview" | "channels" | "ga4" | "creatives" | "naver";
const VIEW_TABS: { key: ViewTab; label: string }[] = [
  { key: "overview", label: "개요" },
  { key: "channels", label: "매체별 상세" },
  { key: "ga4", label: "GA4 UTM" },
  { key: "creatives", label: "Meta 소재" },
  { key: "naver", label: "네이버 캠페인" },
];
const isViewTab = (v: string | null): v is ViewTab => !!v && VIEW_TABS.some((t) => t.key === v);

// 매체 합산 (GA4 제외). 규칙 설명은 화면 쪽 「집계」 주석.
function aggregateAds(rows: DailyAdSpend[]) {
  const nonGa4 = rows.filter((r) => !r.channel.startsWith("ga4_"));
  const measured = nonGa4.filter((r) => isPurchaseConversionMeasured(r.channel, r.brand));
  const sum = (list: DailyAdSpend[], k: "spend" | "clicks" | "impressions" | "conversion_value" | "conversions") =>
    list.reduce((acc, r) => acc + (Number(r[k]) || 0), 0);
  const spend = sum(nonGa4, "spend");
  const clicks = sum(nonGa4, "clicks");
  const impressions = sum(nonGa4, "impressions");
  const convValue = sum(nonGa4, "conversion_value");
  const conversions = sum(measured, "conversions");
  const measuredSpend = sum(measured, "spend");
  return {
    spend, clicks, impressions, convValue, conversions, measuredSpend,
    reportedRoas: spend > 0 ? convValue / spend : 0,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    cpa: conversions > 0 ? measuredSpend / conversions : 0,
  };
}


export default function AdsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">불러오는 중...</div>}>
      <AdsPageInner />
    </Suspense>
  );
}

function AdsPageInner() {
  const { brand, from, to } = useFilterParams();
  const { channelMap } = useConfig();
  const params = brand && brand !== "all" ? `from=${from}&to=${to}&brand=${brand}` : `from=${from}&to=${to}`;
  const { data, loading } = useFetch<{ ads: DailyAdSpend[]; prevAds: DailyAdSpend[] }>(`/api/ads?${params}`);
  // 탭은 URL(?tab=)에 둔다(2026-11-04). 북마크·뒤로가기·링크 공유로 같은 탭이 열린다. 기본(개요)은 URL 에서 지운다.
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tabParam = searchParams.get("tab");
  const tab: ViewTab = isViewTab(tabParam) ? tabParam : "overview";
  const setTab = useCallback((t: ViewTab) => {
    const params = new URLSearchParams(searchParams.toString());
    if (t === "overview") params.delete("tab");
    else params.set("tab", t);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [searchParams, router, pathname]);
  // 광고 경보 칸은 광고 응답이 올 때까지 마운트되지 않는다. 기다리지 않게 같이 부른다.
  usePrefetch([AD_ALERTS_URL]);
  // ★ 헤드라인 ROAS 는 Overview·월별과 같은 정의(판매 원장 실매출 ÷ 매체비)여야 한다(2026-11-03).
  //   매체가 신고한 전환매출을 더하면 같은 주문을 여러 매체가 자기 몫으로 신고해 실매출을 넘는다
  //   (2026-10 실측: 신고 합산 10.48x vs 실매출 6.17x). Overview 와 같은 주소라 받은 응답을 재사용한다.
  const { data: dash } = useFetch<{ kpi?: { roas: number; roasPrev: number; revenue: number; adSpend: number } }>(
    dashboardUrl(brand || "all", from, to)
  );
  const realKpi = dash?.kpi;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ads = useMemo(() => data?.ads || [], [data]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const prevAds = useMemo(() => data?.prevAds || [], [data]);

  /* ── 집계 ── */
  // 매체 합산. GA4 제외 (광고비 중복 방지).
  //  - roas(신고) = 매체가 신고한 전환매출 합 ÷ 광고비. 같은 주문을 여러 매체가 중복 신고해 실매출보다 크다.
  //  - 전환수·CPA 는 구매 전환이 측정되는 행만 분자·분모에 넣는다(src/lib/conversion-tracking.ts).
  //    전엔 메타(구매 미배선) 광고비가 CPA 분자에만 들어가 CPA 가 부풀려졌다.
  const totals = useMemo(() => aggregateAds(ads), [ads]);
  /* ── 이전 기간 집계 ── 같은 규칙 */
  const prevTotals = useMemo(() => aggregateAds(prevAds), [prevAds]);

  /* ── 전환수·CPA 가 어느 매체로 계산됐는지(라벨용) ── */
  const conversionScope = useMemo(() => {
    const label = (r: DailyAdSpend) => channelMap[r.channel]?.label || CHANNEL_LABELS[r.channel] || r.channel;
    const included = new Set<string>();
    const excluded = new Set<string>();
    for (const r of ads) {
      if (r.channel.startsWith("ga4_") || !(r.spend > 0)) continue;
      if (isPurchaseConversionMeasured(r.channel, r.brand)) included.add(label(r));
      else excluded.add(`${label(r)}(${BRAND_LABELS[r.brand] || r.brand})`);
    }
    return { included: Array.from(included).sort(), excluded: Array.from(excluded).sort() };
  }, [ads, channelMap]);

  const pctChange = (cur: number, prev: number) => {
    if (prev === 0) return cur > 0 ? 100 : undefined;
    return ((cur - prev) / Math.abs(prev)) * 100;
  };

  /* ── 채널별 집계 ── */
  const byChannel = useMemo(() => {
    const map: Record<string, { spend: number; clicks: number; impressions: number; conversions: number; convValue: number; reach: number }> = {};
    for (const r of ads) {
      if (!map[r.channel]) map[r.channel] = { spend: 0, clicks: 0, impressions: 0, conversions: 0, convValue: 0, reach: 0 };
      map[r.channel].spend += r.spend || 0;
      map[r.channel].clicks += r.clicks || 0;
      map[r.channel].impressions += r.impressions || 0;
      map[r.channel].conversions += r.conversions || 0;
      map[r.channel].convValue += r.conversion_value || 0;
      map[r.channel].reach += r.reach || 0;
    }
    return Object.entries(map)
      .map(([ch, v]) => ({
        channel: ch,
        label: channelMap[ch]?.label || CHANNEL_LABELS[ch] || ch,
        color: channelMap[ch]?.color || CHANNEL_COLORS[ch] || "#6b7280",
        ...v,
        roas: v.spend > 0 ? v.convValue / v.spend : 0,
        ctr: v.impressions > 0 ? (v.clicks / v.impressions) * 100 : 0,
        cpc: v.clicks > 0 ? v.spend / v.clicks : 0,
      }))
      .sort((a, b) => b.spend - a.spend);
  }, [ads, channelMap]);

  const activeChannels = useMemo(() => {
    const chs = new Set<string>();
    for (const r of ads) {
      if (!r.channel.startsWith("ga4_") && r.spend > 0) chs.add(r.channel);
    }
    return Array.from(chs).sort();
  }, [ads]);

  // 축 = 선택 기간 전체(오늘까지). 집행이 없는 날도 빠지지 않는다(2026-10-28).
  // 광고 원장에 있는 기간 밖 날짜도 버리지 않고 합친다(합계 보존).
  const adDays = useMemo(() => {
    const set = new Set(daysBetween(from, to));
    for (const r of ads) if (!r.channel.startsWith("ga4_")) set.add(r.date);
    return Array.from(set).sort();
  }, [ads, from, to]);

  /* ── 일별 트렌드 (채널별) ── 집행 없는 날은 0 */
  const dailyTrend = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    for (const d of adDays) map[d] = Object.fromEntries(activeChannels.map((ch) => [ch, 0]));
    for (const r of ads) {
      if (r.channel.startsWith("ga4_")) continue; // GA4 제외
      if (!map[r.date]) map[r.date] = {};
      map[r.date][r.channel] = (map[r.date][r.channel] || 0) + (r.spend || 0);
    }
    return adDays.map((date) => ({ date: date.slice(5), ...map[date] }));
  }, [ads, adDays, activeChannels]);

  /* ── 일별 ROAS 트렌드 (채널별) ── 비율이라 광고비 0 인 날은 0x 가 아니라 빈칸(null) */
  const dailyRoas = useMemo(() => {
    const spendMap: Record<string, Record<string, number>> = {};
    const convMap: Record<string, Record<string, number>> = {};
    for (const r of ads) {
      if (r.channel.startsWith("ga4_")) continue;
      if (!spendMap[r.date]) { spendMap[r.date] = {}; convMap[r.date] = {}; }
      spendMap[r.date][r.channel] = (spendMap[r.date][r.channel] || 0) + (r.spend || 0);
      convMap[r.date][r.channel] = (convMap[r.date][r.channel] || 0) + (r.conversion_value || 0);
    }
    return adDays.map((date) => {
      const spends = spendMap[date] || {};
      const row: Record<string, string | number | null> = { date: date.slice(5) };
      for (const ch of activeChannels) {
        const sp = spends[ch] || 0;
        row[ch] = sp > 0 ? Number((convMap[date]?.[ch] || 0) / sp) : null;
      }
      // ("전체" 점선은 2026-11-04 뺐다. 매체 신고 전환매출을 더한 값이라 같은 주문이 여러 번 들어가 실매출 ROAS 보다 크다.
      //  실매출 ROAS 는 위 「ROAS (실매출)」 카드와 Overview 가 본다.)
      return row;
    });
  }, [ads, adDays, activeChannels]);

  if (loading) {
    return (
      <PageShell title="광고 분석" description="매체별 광고 효율 및 ROAS">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
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
    <PageShell title="광고 분석" description="매체별 광고 효율 및 ROAS">
      <div data-tour="ads-alerts" className="empty:hidden">
        <AdAlerts />
      </div>
      {/* 탭 전환 */}
      {/* 모바일 390px 에서 탭 5개가 409px 라 문서 폭이 425px 로 늘었다. 넘치면 탭 바 안에서만 가로로 민다. */}
      <div data-tour="ads-tabs" className="flex items-center gap-0.5 rounded-lg bg-muted p-1 w-fit max-w-full overflow-x-auto">
        {VIEW_TABS.map((t) => (
          <button
            key={t.key}
            data-tour={`ads-tab-${t.key}`}
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

      {/* KPI
          ROAS 는 Overview 와 같은 실매출 기준. 매체 신고 합산은 보조로만 적는다(2026-11-03).
          전환수·CPA 는 구매 전환이 측정되는 매체만 넣고 그 범위를 카드에 적는다. */}
      <div data-tour="ads-kpi" className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <KpiCard size="hero" title="총 광고비" value={formatCurrency(totals.spend)} change={pctChange(totals.spend, prevTotals.spend)} changeLabel="직전 같은 기간 대비" subtitle="GA4 UTM 제외(구글 광고비와 중복)" />
        <KpiCard
          size="hero"
          title="ROAS (실매출)"
          value={realKpi ? (realKpi.adSpend > 0 ? `${realKpi.roas.toFixed(2)}x` : "-") : "…"}
          change={realKpi && realKpi.adSpend > 0 ? pctChange(realKpi.roas, realKpi.roasPrev) : undefined}
          subtitle={`판매 원장 매출 ÷ 광고비 · 신고 ROAS(매체 합산, 중복 포함) ${totals.spend > 0 ? `${totals.reportedRoas.toFixed(2)}x` : "-"}`}
        />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <KpiCard size="compact" title="총 클릭" value={formatNumber(totals.clicks)} change={pctChange(totals.clicks, prevTotals.clicks)} />
        <KpiCard size="compact" title="평균 CTR" value={formatPercent(totals.ctr)} change={pctChange(totals.ctr, prevTotals.ctr)} />
        <KpiCard
          size="compact"
          title="전환수 (측정 매체)"
          value={conversionScope.included.length ? formatNumber(totals.conversions) : "-"}
          // 직전 기간 전환수가 0 이면 비교하지 않는다. 2026-09 이전 원장은 전환 "수" 칸이 비어 있어(전환매출만 있음)
          // 0 과 비교하면 늘 ▲100% 로 뜬다.
          change={conversionScope.included.length && prevTotals.conversions > 0 ? pctChange(totals.conversions, prevTotals.conversions) : undefined}
          subtitle={scopeNote(conversionScope)}
        />
        <KpiCard
          size="compact"
          title="CPA (측정 매체)"
          value={totals.cpa > 0 ? formatCurrency(Math.round(totals.cpa)) : "-"}
          change={totals.cpa > 0 && prevTotals.cpa > 0 ? pctChange(totals.cpa, prevTotals.cpa) : undefined}
          subtitle={`측정 매체 광고비 ${formatCurrency(totals.measuredSpend)} ÷ 전환수`}
        />
      </div>

      {/* 탭 내용 */}
      {tab === "overview" && (
        <>
          {/* 채널별 카드 (GA4 제외) */}
          <div data-tour="ads-channel-cards" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {byChannel
              .filter((c) => !c.channel.startsWith("ga4_"))
              .map((c) => (
                <Card
                  key={c.channel}
                  className="p-4"
                  style={{ borderLeft: `4px solid ${c.color}` }}
                >
                  <CardContent className="p-0 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sm">{c.label}</span>
                      <span className="text-sm font-bold">{formatCurrency(c.spend)}</span>
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-6 md:grid-cols-3 xl:grid-cols-6 gap-2 text-xs text-muted-foreground">
                      <div>
                        <p>ROAS</p>
                        {/* 전환 미연동 채널을 0.00x 빨강으로 찍으면 "돈만 태우는 매체"로 오독된다.
                            '미연동'으로 구분해야 예산 삭감 판단이 왜곡되지 않는다(2026-08 리뷰). */}
                        <p className={`font-medium ${isRoasUntracked(c.roas, c.spend) ? "text-muted-foreground/70 italic" : c.roas >= 3 ? "text-green-600" : c.roas >= 1 ? "text-yellow-600" : "text-red-500"}`}
                          title={isRoasUntracked(c.roas, c.spend) ? "전환 추적 미연동: 성과 0이 아니라 측정 불가" : undefined}>
                          {formatRoas(c.roas, c.spend)}
                        </p>
                      </div>
                      <div>
                        <p>클릭</p>
                        <p className="font-medium text-foreground">
                          {formatNumber(c.clicks)}
                        </p>
                      </div>
                      <div>
                        <p>전환</p>
                        <p className="font-medium text-foreground">
                          {formatNumber(c.conversions)}
                        </p>
                      </div>
                      <div>
                        <p>전환매출</p>
                        <p className="font-medium text-foreground">
                          {formatCurrency(c.convValue)}
                        </p>
                      </div>
                      <div>
                        <p>CPA</p>
                        <p className="font-medium text-foreground">
                          {c.conversions > 0 ? formatCurrency(Math.round(c.spend / c.conversions)) : "-"}
                        </p>
                      </div>
                      <div>
                        <p>CTR</p>
                        <p className="font-medium text-foreground">
                          {formatPercent(c.ctr)}
                        </p>
                      </div>
                    </div>
                    {/* 비중 바 */}
                    {totals.spend > 0 && (
                      <div className="mt-1">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${Math.min((c.spend / totals.spend) * 100, 100)}%`, backgroundColor: c.color }} />
                          </div>
                          <span className="text-[10px] text-muted-foreground">{((c.spend / totals.spend) * 100).toFixed(0)}%</span>
                        </div>
                      </div>
                    )}
                    {c.reach > 0 && (
                      <div className="text-xs text-muted-foreground">
                        도달: {formatNumber(c.reach)}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
          </div>

          {/* 5.3-2: 매체별 ROAS 트렌드 */}
          <Card data-tour="ads-roas-trend">
            <CardContent className="p-4">
              <h3 className="font-semibold">매체별 ROAS 트렌드</h3>
              <p className="text-xs text-muted-foreground mt-0.5 mb-3">가로 = 날짜, 세로 = 매체가 신고한 전환매출 ÷ 그 매체 광고비(배). 매체끼리 더하면 안 됩니다. 점선 = 1.0x</p>
              <DeferredResponsiveContainer width="100%" height={280}>
                <LineChart data={dailyRoas}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                  <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" tickFormatter={(v) => `${v}x`} />
                  <ReferenceLine y={1} stroke="var(--muted-foreground)" strokeDasharray="4 4" label={{ value: "1.0x", position: "right", fontSize: 10, fill: "var(--muted-foreground)" }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                    formatter={(val) => (val == null ? "-" : `${Number(val).toFixed(2)}x`)}
                  />
                  <Legend />
                  {activeChannels.map((ch) => (
                    <Line key={ch} type="monotone" dataKey={ch} name={channelMap[ch]?.label || CHANNEL_LABELS[ch] || ch} stroke={CHANNEL_COLORS[ch] || "#6b7280"} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  ))}
                </LineChart>
              </DeferredResponsiveContainer>
            </CardContent>
          </Card>

          {/* 5.3-1: 매체별 광고비 트렌드 */}
          <Card data-tour="ads-spend-trend">
            <CardContent className="p-4">
              <h3 className="font-semibold">매체별 광고비 트렌드</h3>
              <p className="text-xs text-muted-foreground mt-0.5 mb-3">가로 = 날짜, 세로 = 원(매체별로 쌓음, GA4 제외)</p>
              <DeferredResponsiveContainer width="100%" height={300}>
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
                  <Legend />
                  {activeChannels.map((ch) => (
                    <Area
                      key={ch}
                      type="monotone"
                      dataKey={ch}
                      name={channelMap[ch]?.label || CHANNEL_LABELS[ch] || ch}
                      stackId="1"
                      isAnimationActive={false}
                      stroke={CHANNEL_COLORS[ch] || "#6b7280"}
                      fill={CHANNEL_COLORS[ch] || "#6b7280"}
                      fillOpacity={0.3}
                    />
                  ))}
                </AreaChart>
              </DeferredResponsiveContainer>
            </CardContent>
          </Card>

        </>
      )}

      {tab === "channels" && (
        <Card data-tour="ads-channel-table">
          <CardContent className="p-4 overflow-x-auto">
            <h3 className="font-semibold mb-4">매체별 상세 성과</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b text-muted-foreground">
                  <th className="pb-2 pr-4">채널</th>
                  <th className="pb-2 pr-4 text-right">광고비</th>
                  <th className="pb-2 pr-4 text-right">노출</th>
                  <th className="pb-2 pr-4 text-right">클릭</th>
                  <th className="pb-2 pr-4 text-right">CTR</th>
                  <th className="pb-2 pr-4 text-right">CPC</th>
                  <th className="pb-2 pr-4 text-right">전환</th>
                  <th className="pb-2 pr-4 text-right">전환매출</th>
                  <th className="pb-2 pr-4 text-right">CPA</th>
                  <th className="pb-2 text-right">ROAS</th>
                </tr>
              </thead>
              <tbody>
                {byChannel
                  .filter((c) => !c.channel.startsWith("ga4_"))
                  .map((c) => (
                    <tr key={c.channel} className="border-b border-border/50 hover:bg-muted/50">
                      <td className="py-2 pr-4">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                          {c.label}
                        </div>
                      </td>
                      <td className="py-2 pr-4 text-right font-medium">{formatCurrency(c.spend)}</td>
                      <td className="py-2 pr-4 text-right">{formatNumber(c.impressions)}</td>
                      <td className="py-2 pr-4 text-right">{formatNumber(c.clicks)}</td>
                      <td className="py-2 pr-4 text-right">{formatPercent(c.ctr)}</td>
                      <td className="py-2 pr-4 text-right">{c.cpc > 0 ? formatCurrency(Math.round(c.cpc)) : "-"}</td>
                      <td className="py-2 pr-4 text-right">{formatNumber(c.conversions)}</td>
                      <td className="py-2 pr-4 text-right">{formatCurrency(c.convValue)}</td>
                      <td className="py-2 pr-4 text-right">{c.conversions > 0 ? formatCurrency(Math.round(c.spend / c.conversions)) : "-"}</td>
                      <td className={`py-2 text-right font-medium ${isRoasUntracked(c.roas, c.spend) ? "text-muted-foreground/70 italic" : c.roas >= 3 ? "text-green-600" : c.roas >= 1 ? "text-yellow-600" : "text-red-500"}`}
                        title={isRoasUntracked(c.roas, c.spend) ? "전환 추적 미연동: 성과 0이 아니라 측정 불가" : undefined}>{formatRoas(c.roas, c.spend)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {tab === "ga4" && <AdsUtmSection from={from} to={to} />}

      {tab === "creatives" && (
        <CreativesSection brand={brand} from={from} to={to} />
      )}

      {tab === "naver" && (
        <NaverCampaignsSection brand={brand} from={from} to={to} />
      )}
    </PageShell>
  );
}

/** 전환수 카드 아래 한 줄: 어느 매체를 넣고 뺐는지. */
function scopeNote(scope: { included: string[]; excluded: string[] }): string {
  const inc = scope.included.length ? `포함 ${scope.included.join("·")}` : "구매 전환이 측정되는 매체 없음";
  const exc = scope.excluded.length ? ` · 제외 ${scope.excluded.join("·")} (구매 전환 미배선·장바구니 전환)` : "";
  return inc + exc;
}

/* ── 네이버 캠페인 섹션 (P10) ── */
interface NaverCampaign {
  campaignId: string; campaignName: string; type: string;
  impressions: number; clicks: number; cost: number; conversions: number;
  ctr: number; cpc: number; days: number; convValue?: number; roas?: number;
  /** 검색광고 계정. 밸런스랩 계정은 장바구니 전환이 매출로 잡혀 ROAS 판단 불가. */
  account?: string;
}
interface NaverSummary {
  totalImpressions: number; totalClicks: number; totalCost: number;
  totalConversions: number; avgCtr: number; avgCpc: number;
}

function NaverCampaignsSection({ brand, from, to }: { brand: string; from: string; to: string }) {
  const { data, loading, error } = useFetch<{ campaigns: NaverCampaign[]; summary: NaverSummary | null; latestCollected?: string | null }>(
    `/api/naver-campaigns?brand=${brand}&from=${from}&to=${to}`
  );
  const [sort, setSort] = useState<"cost" | "clicks" | "ctr" | "conversions">("cost");

  const campaigns = useMemo(() => {
    const list = data?.campaigns || [];
    return [...list].sort((a, b) => {
      if (sort === "clicks") return b.clicks - a.clicks;
      if (sort === "ctr") return b.ctr - a.ctr;
      if (sort === "conversions") return b.conversions - a.conversions;
      return b.cost - a.cost;
    });
  }, [data, sort]);

  const summary = data?.summary;

  if (loading) return <Card><CardContent className="p-8 text-center text-muted-foreground">불러오는 중...</CardContent></Card>;

  return (
    <>
      {/* 판단용: 캠페인별 주간 추이 스몰 멀티플 (2026-11-03). 탭에 들어오면 이것부터 본다(2026-11-04 맨 위로). */}
      <div data-tour="ads-naver-multiples">
        <NaverCampaignMultiples brand={brand} to={to} />
      </div>
      <Card data-tour="ads-naver-table">
        <CardContent className="p-4 overflow-x-auto">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
            <h3 className="font-semibold">캠페인별 성과</h3>
            <div className="flex items-center gap-1">
              {(["cost", "clicks", "ctr", "conversions"] as const).map(s => (
                <button key={s} onClick={() => setSort(s)}
                  className={cn("px-2 py-1 text-xs rounded", sort === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                  {s === "cost" ? "광고비순" : s === "clicks" ? "클릭순" : s === "ctr" ? "CTR순" : "전환순"}
                </button>
              ))}
            </div>
          </div>
          {/* 네이버 검색광고 합계. 예전 KPI 4장(제목 「총 광고비」가 위 전체 매체 카드와 겹쳤다)을 한 줄로 줄였다. */}
          {summary && (
            <p className="text-xs text-muted-foreground mb-3">
              네이버 검색광고 합계: 광고비 {formatCurrency(summary.totalCost)} · 노출 {formatNumber(summary.totalImpressions)} · 클릭 {formatNumber(summary.totalClicks)} · CTR {formatPercent(summary.avgCtr)}
            </p>
          )}
          {campaigns.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {error ? `불러오지 못했습니다 (${error})` : "이 기간에 집행한 네이버 검색광고 캠페인이 없습니다"}
              {data?.latestCollected ? ` · 마지막 수집일 ${data.latestCollected}` : ""}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b text-muted-foreground">
                  <th className="pb-2 pr-4">캠페인명</th>
                  <th className="pb-2 pr-4">유형</th>
                  <th className="pb-2 pr-4 text-right">광고비</th>
                  <th className="pb-2 pr-4 text-right">노출</th>
                  <th className="pb-2 pr-4 text-right">클릭</th>
                  <th className="pb-2 pr-4 text-right">CTR</th>
                  <th className="pb-2 pr-4 text-right">CPC</th>
                  <th className="pb-2 pr-4 text-right">전환</th>
                  <th className="pb-2 pr-4 text-right">전환매출</th>
                  <th className="pb-2 text-right">ROAS <span className="font-normal">(신고)</span></th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="py-2 pr-4 max-w-[200px] truncate">{c.campaignName}</td>
                    <td className="py-2 pr-4"><span className="text-xs px-1.5 py-0.5 rounded bg-muted">{c.type}</span></td>
                    <td className="py-2 pr-4 text-right font-medium">{formatCurrency(c.cost)}</td>
                    <td className="py-2 pr-4 text-right text-muted-foreground">{formatNumber(c.impressions)}</td>
                    <td className="py-2 pr-4 text-right">{formatNumber(c.clicks)}</td>
                    <td className="py-2 pr-4 text-right">{c.ctr.toFixed(2)}%</td>
                    <td className="py-2 pr-4 text-right">{formatCurrency(c.cpc)}</td>
                    <td className="py-2 pr-4 text-right">{formatNumber(c.conversions)}</td>
                    <td className="py-2 pr-4 text-right">{formatCurrency(c.convValue || 0)}</td>
                    {/* 위 스몰 멀티플과 같은 기준(NAVER_ROAS_UNTRUSTED_ACCOUNTS)으로 밸런스랩 계정은 판단 불가. */}
                    <td className="py-2 text-right">
                      {c.account && NAVER_ROAS_UNTRUSTED_ACCOUNTS.has(c.account)
                        ? <span className="text-muted-foreground/70 italic" title="장바구니 전환이 매출로 잡혀 부풀려진 계정이라 ROAS 로 판단하지 않습니다">판단 불가</span>
                        : c.cost > 0 ? `${(c.roas || 0).toFixed(2)}x` : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

/* ── Meta 크리에이티브 섹션 (P9) ── */
interface Creative {
  id: string; name: string; status: string; brand: string;
  thumbnail_url: string; spend: number; impressions: number; clicks: number;
  ctr: number; cpc: number; purchases: number; revenue: number; roas: number;
  cac: number; add_to_cart: number; landing_page_views: number;
  view_content?: number; purchaseTracked?: boolean; campaign?: string;
}

function CreativesSection({ brand, from, to }: { brand: string; from: string; to: string }) {
  const { data, loading } = useFetch<{ creatives: Creative[]; error?: string; notice?: string; latestCollected?: string | null }>(
    `/api/creatives?brand=${brand}&from=${from}&to=${to}`
  );
  const [sort, setSort] = useState<"spend" | "roas" | "purchases">("spend");

  const creatives = useMemo(() => {
    const list = data?.creatives || [];
    return [...list].sort((a, b) => {
      if (sort === "roas") return b.roas - a.roas;
      if (sort === "purchases") return b.purchases - a.purchases;
      return b.spend - a.spend;
    });
  }, [data, sort]);

  if (loading) return <Card><CardContent className="p-8 text-center text-muted-foreground">불러오는 중...</CardContent></Card>;
  if (data?.error) return <Card><CardContent className="p-4 text-sm text-amber-600">{data.error}</CardContent></Card>;
  if (creatives.length === 0) return <Card><CardContent className="p-4 text-sm text-muted-foreground">{data?.notice || "이 기간에 집행한 메타 소재가 없습니다"}{data?.latestCollected ? ` · 마지막 수집일 ${data.latestCollected}` : ""}</CardContent></Card>;
  // 밸런스랩처럼 픽셀 구매가 막힌 계정은 구매·ROAS 가 늘 0 이라 빨간 테두리로 오독된다. 상세조회로 본다.
  const anyUntracked = creatives.some((c) => c.purchaseTracked === false);

  return (
    <>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">정렬:</span>
        {(["spend", "roas", "purchases"] as const).map(s => (
          <button key={s} onClick={() => setSort(s)}
            className={cn("px-2 py-1 text-xs rounded", sort === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
            {s === "spend" ? "광고비순" : s === "roas" ? "ROAS순" : "전환순"}
          </button>
        ))}
        <span className="text-xs text-muted-foreground ml-auto">{creatives.length}개 소재</span>
      </div>
      {anyUntracked && (
        <p className="text-xs text-muted-foreground">밸런스랩 소재는 메타 픽셀의 구매 전환이 막혀 있어 구매·ROAS 대신 <b>상세조회</b>(ViewContent)와 클릭당 상세조회 비율로 표시합니다.</p>
      )}

      <div data-tour="ads-creatives" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {creatives.slice(0, 30).map(c => (
          <Card key={c.id} className={cn("overflow-hidden", c.purchaseTracked === false ? "" : c.roas >= 3 ? "border-green-500/30" : c.roas >= 1 ? "border-yellow-500/30" : c.roas > 0 ? "border-red-500/30" : "")}>
            <CardContent className="p-3">
              <div className="flex gap-3">
                {c.thumbnail_url && (
                  <Image
                    src={c.thumbnail_url}
                    alt=""
                    width={64}
                    height={64}
                    className="w-16 h-16 rounded object-cover flex-shrink-0"
                    unoptimized
                  />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{c.name}</p>
                  <p className={cn("text-[10px]", c.status === "ACTIVE" ? "text-green-500" : "text-muted-foreground")}>{c.status}</p>
                </div>
              </div>
              <div className="grid grid-cols-5 gap-1 mt-2 text-center">
                <div><p className="text-[10px] text-muted-foreground">광고비</p><p className="text-xs font-medium">₩{c.spend.toLocaleString("ko-KR")}</p></div>
                <div><p className="text-[10px] text-muted-foreground">노출</p><p className="text-xs font-medium">{formatNumber(c.impressions)}</p></div>
                {c.purchaseTracked === false ? (<>
                  <div><p className="text-[10px] text-muted-foreground">상세조회</p><p className="text-xs font-bold">{formatNumber(c.view_content || 0)}</p></div>
                  <div><p className="text-[10px] text-muted-foreground">클릭당 조회</p><p className="text-xs font-medium">{c.clicks > 0 ? `${(((c.view_content || 0) / c.clicks) * 100).toFixed(0)}%` : "-"}</p></div>
                </>) : (<>
                  <div><p className="text-[10px] text-muted-foreground">ROAS</p><p className={cn("text-xs font-bold", c.roas >= 3 ? "text-green-500" : c.roas >= 1 ? "text-yellow-500" : "text-red-500")}>{c.roas.toFixed(2)}x</p></div>
                  <div><p className="text-[10px] text-muted-foreground">구매</p><p className="text-xs font-medium">{c.purchases}</p></div>
                </>)}
                <div><p className="text-[10px] text-muted-foreground">CTR</p><p className="text-xs font-medium">{c.ctr.toFixed(1)}%</p></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
