"use client";

import { PageShell } from "@/components/page-shell";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent } from "@/components/ui/card";
import { useFilterParams, useFetch } from "@/hooks/use-dashboard-data";
import { CHANNEL_LABELS, CHANNEL_COLORS, type DailyAdSpend } from "@/lib/types";
import { useConfig } from "@/hooks/use-config";
import { formatCurrency, formatNumber, formatPercent, cn } from "@/lib/utils";
import { Suspense, useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  ScatterChart,
  Scatter,
  ZAxis,
  ReferenceLine,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  CartesianGrid,
} from "recharts";

const GA4_LABEL: Record<string, string> = {
  "ga4_Performance Max": "GA4 P-Max",
  "ga4_Demand Gen": "GA4 Demand Gen",
  "ga4_Search": "GA4 Search",
};

type ViewTab = "overview" | "channels" | "ga4" | "creatives" | "naver";

export default function AdsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">로딩 중...</div>}>
      <AdsPageInner />
    </Suspense>
  );
}

function AdsPageInner() {
  const { brand, from, to } = useFilterParams();
  const { channelMap } = useConfig();
  const params = brand && brand !== "all" ? `from=${from}&to=${to}&brand=${brand}` : `from=${from}&to=${to}`;
  const { data, loading } = useFetch<{ ads: DailyAdSpend[]; prevAds: DailyAdSpend[] }>(`/api/ads?${params}`);
  const [tab, setTab] = useState<ViewTab>("overview");

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ads = useMemo(() => data?.ads || [], [data]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const prevAds = useMemo(() => data?.prevAds || [], [data]);

  /* ── 집계 ── */
  const totals = useMemo(() => {
    // GA4 제외 (광고비 중복 방지)
    const nonGa4 = ads.filter((r) => !r.channel.startsWith("ga4_"));
    const spend = nonGa4.reduce((s, r) => s + (r.spend || 0), 0);
    const clicks = nonGa4.reduce((s, r) => s + (r.clicks || 0), 0);
    const impressions = nonGa4.reduce((s, r) => s + (r.impressions || 0), 0);
    const convValue = nonGa4.reduce((s, r) => s + (r.conversion_value || 0), 0);
    const conversions = nonGa4.reduce((s, r) => s + (r.conversions || 0), 0);
    return {
      spend,
      clicks,
      impressions,
      roas: spend > 0 ? convValue / spend : 0,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      conversions,
      convValue,
      cpa: conversions > 0 ? spend / conversions : 0,
    };
  }, [ads]);

  /* ── 이전 기간 집계 ── */
  const prevTotals = useMemo(() => {
    const nonGa4 = prevAds.filter((r) => !r.channel.startsWith("ga4_"));
    const spend = nonGa4.reduce((s, r) => s + (r.spend || 0), 0);
    const clicks = nonGa4.reduce((s, r) => s + (r.clicks || 0), 0);
    const impressions = nonGa4.reduce((s, r) => s + (r.impressions || 0), 0);
    const convValue = nonGa4.reduce((s, r) => s + (r.conversion_value || 0), 0);
    const conversions = nonGa4.reduce((s, r) => s + (r.conversions || 0), 0);
    return {
      spend, clicks, impressions, conversions, convValue,
      roas: spend > 0 ? convValue / spend : 0,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      cpa: conversions > 0 ? spend / conversions : 0,
    };
  }, [prevAds]);

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
        label: GA4_LABEL[ch] || channelMap[ch]?.label || CHANNEL_LABELS[ch] || ch,
        color: channelMap[ch]?.color || CHANNEL_COLORS[ch] || "#6b7280",
        ...v,
        roas: v.spend > 0 ? v.convValue / v.spend : 0,
        ctr: v.impressions > 0 ? (v.clicks / v.impressions) * 100 : 0,
        cpc: v.clicks > 0 ? v.spend / v.clicks : 0,
      }))
      .sort((a, b) => b.spend - a.spend);
  }, [ads, channelMap]);

  /* ── 일별 트렌드 (채널별) ── */
  const dailyTrend = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    for (const r of ads) {
      if (r.channel.startsWith("ga4_")) continue; // GA4 제외
      if (!map[r.date]) map[r.date] = {};
      map[r.date][r.channel] = (map[r.date][r.channel] || 0) + (r.spend || 0);
    }
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, channels]) => ({ date: date.slice(5), ...channels }));
  }, [ads]);

  /* ── 일별 ROAS 트렌드 (채널별) ── */
  const dailyRoas = useMemo(() => {
    const spendMap: Record<string, Record<string, number>> = {};
    const convMap: Record<string, Record<string, number>> = {};
    for (const r of ads) {
      if (r.channel.startsWith("ga4_")) continue;
      if (!spendMap[r.date]) { spendMap[r.date] = {}; convMap[r.date] = {}; }
      spendMap[r.date][r.channel] = (spendMap[r.date][r.channel] || 0) + (r.spend || 0);
      convMap[r.date][r.channel] = (convMap[r.date][r.channel] || 0) + (r.conversion_value || 0);
    }
    return Object.entries(spendMap).sort(([a], [b]) => a.localeCompare(b)).map(([date, spends]) => {
      const row: Record<string, string | number> = { date: date.slice(5) };
      for (const ch of Object.keys(spends)) {
        row[ch] = spends[ch] > 0 ? Number((convMap[date]?.[ch] || 0) / spends[ch]) : 0;
      }
      // 전체 ROAS
      const totalSpend = Object.values(spends).reduce((s, v) => s + v, 0);
      const totalConv = Object.values(convMap[date] || {}).reduce((s, v) => s + v, 0);
      row["__total"] = totalSpend > 0 ? Number((totalConv / totalSpend).toFixed(2)) : 0;
      return row;
    });
  }, [ads]);

  const activeChannels = useMemo(() => {
    const chs = new Set<string>();
    for (const r of ads) {
      if (!r.channel.startsWith("ga4_") && r.spend > 0) chs.add(r.channel);
    }
    return Array.from(chs).sort();
  }, [ads]);

  if (loading) {
    return (
      <PageShell title="광고 분석" description="채널별 광고 효율 및 ROAS">
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
    <PageShell title="광고 분석" description="채널별 광고 효율 및 ROAS">
      {/* 탭 전환 */}
      <div className="flex items-center gap-0.5 rounded-lg bg-muted p-1 w-fit">
        {([
          { key: "overview", label: "개요" },
          { key: "channels", label: "채널별 상세" },
          { key: "ga4", label: "GA4 UTM" },
          { key: "creatives", label: "Meta 소재" },
          { key: "naver", label: "네이버 캠페인" },
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
        <KpiCard title="총 광고비" value={formatCurrency(totals.spend)} change={pctChange(totals.spend, prevTotals.spend)} />
        <KpiCard title="통합 ROAS" value={`${totals.roas.toFixed(2)}x`} change={pctChange(totals.roas, prevTotals.roas)} />
        <KpiCard title="총 클릭" value={formatNumber(totals.clicks)} change={pctChange(totals.clicks, prevTotals.clicks)} />
        <KpiCard title="평균 CTR" value={formatPercent(totals.ctr)} change={pctChange(totals.ctr, prevTotals.ctr)} />
        <KpiCard title="전환수" value={formatNumber(totals.conversions)} change={pctChange(totals.conversions, prevTotals.conversions)} />
        <KpiCard title="CPA" value={totals.cpa > 0 ? formatCurrency(Math.round(totals.cpa)) : "—"} change={pctChange(totals.cpa, prevTotals.cpa)} />
      </div>

      {/* 탭 내용 */}
      {tab === "overview" && (
        <>
          {/* 채널별 카드 (GA4 제외) */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
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
                    <div className="grid grid-cols-3 lg:grid-cols-6 gap-2 text-xs text-muted-foreground">
                      <div>
                        <p>ROAS</p>
                        <p className={`font-medium ${c.roas >= 3 ? "text-green-600" : c.roas >= 1 ? "text-yellow-600" : "text-red-500"}`}>
                          {c.roas.toFixed(2)}x
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
                          {c.conversions > 0 ? formatCurrency(Math.round(c.spend / c.conversions)) : "—"}
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

          {/* 5.3-2: 채널별 ROAS 트렌드 */}
          <Card>
            <CardContent className="p-4">
              <h3 className="font-semibold mb-4">채널별 ROAS 트렌드</h3>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={dailyRoas}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                  <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" tickFormatter={(v) => `${v}x`} />
                  <ReferenceLine y={1} stroke="#ef4444" strokeDasharray="4 4" label={{ value: "1.0x", position: "right", fontSize: 10, fill: "#ef4444" }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                    formatter={(val) => `${Number(val).toFixed(2)}x`}
                  />
                  <Legend />
                  {activeChannels.map((ch) => (
                    <Line key={ch} type="monotone" dataKey={ch} name={CHANNEL_LABELS[ch] || ch} stroke={CHANNEL_COLORS[ch] || "#6b7280"} strokeWidth={1.5} dot={false} />
                  ))}
                  <Line type="monotone" dataKey="__total" name="전체" stroke="#000" strokeWidth={2} strokeDasharray="4 4" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* 5.3-1: 채널별 광고비 트렌드 */}
          <Card>
            <CardContent className="p-4">
              <h3 className="font-semibold mb-4">채널별 광고비 트렌드</h3>
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
                  <Legend />
                  {activeChannels.map((ch) => (
                    <Area
                      key={ch}
                      type="monotone"
                      dataKey={ch}
                      name={CHANNEL_LABELS[ch] || ch}
                      stackId="1"
                      stroke={CHANNEL_COLORS[ch] || "#6b7280"}
                      fill={CHANNEL_COLORS[ch] || "#6b7280"}
                      fillOpacity={0.3}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* 11.4 채널 효율 사분면 — ROAS vs CPA */}
          {byChannel.filter(c => !c.channel.startsWith("ga4_") && c.spend > 0).length > 1 && (
            <Card>
              <CardContent className="p-4">
                <h3 className="font-semibold mb-1">채널 효율 사분면 — ROAS vs 광고비</h3>
                <p className="text-xs text-muted-foreground mb-4">우상단(고ROAS·저광고비) = 효율 우수. 버블 크기 = 광고비</p>
                <ResponsiveContainer width="100%" height={320}>
                  <ScatterChart margin={{ top: 10, right: 30, bottom: 30, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis
                      type="number" dataKey="spend" name="광고비"
                      tick={{ fontSize: 10 }} stroke="var(--muted-foreground)"
                      tickFormatter={(v) => `${(v / 10000).toFixed(0)}만`}
                      label={{ value: "광고비", position: "insideBottom", offset: -10, fontSize: 11, fill: "var(--muted-foreground)" }}
                    />
                    <YAxis
                      type="number" dataKey="roas" name="ROAS"
                      tick={{ fontSize: 10 }} stroke="var(--muted-foreground)"
                      tickFormatter={(v) => `${v.toFixed(1)}x`}
                      label={{ value: "ROAS", angle: -90, position: "insideLeft", fontSize: 11, fill: "var(--muted-foreground)" }}
                    />
                    <ZAxis type="number" dataKey="spend" range={[60, 600]} name="광고비" />
                    <ReferenceLine y={1} stroke="#ef4444" strokeDasharray="4 4"
                      label={{ value: "ROAS 1.0x", position: "right", fontSize: 10, fill: "#ef4444" }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }}
                      formatter={(val, name) => {
                        if (name === "ROAS") return [`${Number(val).toFixed(2)}x`, name];
                        if (name === "광고비") return [formatCurrency(Number(val)), name];
                        return [val, name];
                      }}
                      labelFormatter={(_, payload) => payload?.[0]?.payload?.label || ""}
                    />
                    <Scatter
                      data={byChannel.filter(c => !c.channel.startsWith("ga4_") && c.spend > 0)
                        .map(c => ({ ...c, label: c.label }))}
                      shape={(props: { cx?: number; cy?: number; fill?: string; payload?: { label: string; spend: number } }) => {
                        const { cx = 0, cy = 0, fill = "#6366f1", payload } = props;
                        if (!payload) return <g />;
                        const r = Math.sqrt(payload.spend / 1000) + 8;
                        return (
                          <g>
                            <circle cx={cx} cy={cy} r={r} fill={fill} fillOpacity={0.7} stroke={fill} strokeWidth={1} />
                            <text x={cx} y={cy - r - 2} textAnchor="middle" fontSize={10} fill="var(--foreground)">{payload.label}</text>
                          </g>
                        );
                      }}
                      fill="#6366f1"
                    />
                  </ScatterChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {tab === "channels" && (
        <Card>
          <CardContent className="p-4 overflow-x-auto">
            <h3 className="font-semibold mb-4">채널별 상세 성과</h3>
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
                      <td className="py-2 pr-4 text-right">{c.cpc > 0 ? formatCurrency(Math.round(c.cpc)) : "—"}</td>
                      <td className="py-2 pr-4 text-right">{formatNumber(c.conversions)}</td>
                      <td className="py-2 pr-4 text-right">{formatCurrency(c.convValue)}</td>
                      <td className="py-2 pr-4 text-right">{c.conversions > 0 ? formatCurrency(Math.round(c.spend / c.conversions)) : "—"}</td>
                      <td className={`py-2 text-right font-medium ${c.roas >= 3 ? "text-green-600" : c.roas >= 1 ? "text-yellow-600" : "text-red-500"}`}>{c.roas.toFixed(2)}x</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {tab === "ga4" && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {byChannel
              .filter((c) => c.channel.startsWith("ga4_"))
              .map((c) => (
                <Card
                  key={c.channel}
                  className="p-4"
                  style={{ borderLeft: "4px solid #f59e0b" }}
                >
                  <CardContent className="p-0 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sm">{c.label}</span>
                      <span className="text-sm font-bold">{formatCurrency(c.spend)}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                      <div>
                        <p>ROAS</p>
                        <p className="font-medium text-foreground">{c.roas.toFixed(2)}x</p>
                      </div>
                      <div>
                        <p>클릭</p>
                        <p className="font-medium text-foreground">{formatNumber(c.clicks)}</p>
                      </div>
                      <div>
                        <p>노출</p>
                        <p className="font-medium text-foreground">{formatNumber(c.impressions)}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
          </div>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">
                💡 GA4 UTM 데이터는 Google Ads의 자동태깅(gclid)을 통해 수집됩니다.
                Google Ads 광고비와 중복되므로 총 광고비 집계에서 제외됩니다.
              </p>
            </CardContent>
          </Card>
        </>
      )}

      {tab === "creatives" && (
        <CreativesSection brand={brand} from={from} to={to} />
      )}

      {tab === "naver" && (
        <NaverCampaignsSection brand={brand} from={from} to={to} />
      )}
    </PageShell>
  );
}

/* ── 네이버 캠페인 섹션 (P10) ── */
interface NaverCampaign {
  campaignId: string; campaignName: string; type: string;
  impressions: number; clicks: number; cost: number; conversions: number;
  ctr: number; cpc: number; days: number;
}
interface NaverSummary {
  totalImpressions: number; totalClicks: number; totalCost: number;
  totalConversions: number; avgCtr: number; avgCpc: number;
}

function NaverCampaignsSection({ brand, from, to }: { brand: string; from: string; to: string }) {
  const { data, loading } = useFetch<{ campaigns: NaverCampaign[]; summary: NaverSummary | null }>(
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

  if (loading) return <Card><CardContent className="p-8 text-center text-muted-foreground">네이버 캠페인 로딩 중...</CardContent></Card>;

  return (
    <>
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard title="총 광고비" value={formatCurrency(summary.totalCost)} />
          <KpiCard title="총 클릭" value={formatNumber(summary.totalClicks)} />
          <KpiCard title="총 노출" value={formatNumber(summary.totalImpressions)} />
          <KpiCard title="평균 CTR" value={formatPercent(summary.avgCtr)} />
        </div>
      )}
      <Card>
        <CardContent className="p-4 overflow-x-auto">
          <div className="flex items-center justify-between mb-4">
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
          {campaigns.length === 0 ? (
            <p className="text-sm text-muted-foreground">데이터가 없습니다. (시트 연동 또는 날짜 범위 확인)</p>
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
                  <th className="pb-2 text-right">전환</th>
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
                    <td className="py-2 text-right">{c.conversions}</td>
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
}

function CreativesSection({ brand, from, to }: { brand: string; from: string; to: string }) {
  const { data, loading } = useFetch<{ creatives: Creative[]; error?: string }>(
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

  if (loading) return <Card><CardContent className="p-8 text-center text-muted-foreground">Meta 소재 로딩 중...</CardContent></Card>;
  if (data?.error) return <Card><CardContent className="p-4 text-sm text-amber-600">{data.error}</CardContent></Card>;
  if (creatives.length === 0) return <Card><CardContent className="p-4 text-sm text-muted-foreground">소재 데이터가 없습니다.</CardContent></Card>;

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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {creatives.slice(0, 30).map(c => (
          <Card key={c.id} className={cn("overflow-hidden", c.roas >= 3 ? "border-green-500/30" : c.roas >= 1 ? "border-yellow-500/30" : c.roas > 0 ? "border-red-500/30" : "")}>
            <CardContent className="p-3">
              <div className="flex gap-3">
                {c.thumbnail_url && (
                  <img src={c.thumbnail_url} alt="" className="w-16 h-16 rounded object-cover flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{c.name}</p>
                  <p className={cn("text-[10px]", c.status === "ACTIVE" ? "text-green-500" : "text-muted-foreground")}>{c.status}</p>
                </div>
              </div>
              <div className="grid grid-cols-5 gap-1 mt-2 text-center">
                <div><p className="text-[10px] text-muted-foreground">광고비</p><p className="text-xs font-medium">₩{c.spend.toLocaleString("ko-KR")}</p></div>
                <div><p className="text-[10px] text-muted-foreground">노출</p><p className="text-xs font-medium">{formatNumber(c.impressions)}</p></div>
                <div><p className="text-[10px] text-muted-foreground">ROAS</p><p className={cn("text-xs font-bold", c.roas >= 3 ? "text-green-500" : c.roas >= 1 ? "text-yellow-500" : "text-red-500")}>{c.roas.toFixed(2)}x</p></div>
                <div><p className="text-[10px] text-muted-foreground">구매</p><p className="text-xs font-medium">{c.purchases}</p></div>
                <div><p className="text-[10px] text-muted-foreground">CTR</p><p className="text-xs font-medium">{c.ctr.toFixed(1)}%</p></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
