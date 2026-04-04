"use client";

import { PageShell } from "@/components/page-shell";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent } from "@/components/ui/card";
import { useFilterParams, useFetch } from "@/hooks/use-dashboard-data";
import { CHANNEL_LABELS, CHANNEL_COLORS, type DailyAdSpend } from "@/lib/types";
import { formatCurrency, formatNumber, formatPercent, cn } from "@/lib/utils";
import { Suspense, useMemo, useState } from "react";
import {
  AreaChart,
  Area,
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

type ViewTab = "overview" | "channels" | "ga4";

export default function AdsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">로딩 중...</div>}>
      <AdsPageInner />
    </Suspense>
  );
}

function AdsPageInner() {
  const { brand, from, to } = useFilterParams();
  const params = brand && brand !== "all" ? `from=${from}&to=${to}&brand=${brand}` : `from=${from}&to=${to}`;
  const { data, loading } = useFetch<{ ads: DailyAdSpend[] }>(`/api/ads?${params}`);
  const [tab, setTab] = useState<ViewTab>("overview");

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ads = useMemo(() => data?.ads || [], [data]);

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
        label: GA4_LABEL[ch] || CHANNEL_LABELS[ch] || ch,
        color: CHANNEL_COLORS[ch] || "#6b7280",
        ...v,
        roas: v.spend > 0 ? v.convValue / v.spend : 0,
        ctr: v.impressions > 0 ? (v.clicks / v.impressions) * 100 : 0,
        cpc: v.clicks > 0 ? v.spend / v.clicks : 0,
      }))
      .sort((a, b) => b.spend - a.spend);
  }, [ads]);

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
        <KpiCard title="총 광고비" value={formatCurrency(totals.spend)} />
        <KpiCard title="통합 ROAS" value={`${totals.roas.toFixed(2)}x`} />
        <KpiCard title="총 클릭" value={formatNumber(totals.clicks)} />
        <KpiCard title="평균 CTR" value={formatPercent(totals.ctr)} />
        <KpiCard title="전환수" value={formatNumber(totals.conversions)} />
        <KpiCard title="CPA" value={totals.cpa > 0 ? formatCurrency(Math.round(totals.cpa)) : "—"} />
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
                    <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                      <div>
                        <p>ROAS</p>
                        <p className="font-medium text-foreground">
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
                    </div>
                    {c.reach > 0 && (
                      <div className="text-xs text-muted-foreground">
                        도달: {formatNumber(c.reach)}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
          </div>

          {/* 광고비 트렌드 */}
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
                      <td className="py-2 text-right font-medium">{c.roas.toFixed(2)}x</td>
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
    </PageShell>
  );
}
