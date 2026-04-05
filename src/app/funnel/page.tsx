"use client";

import { Suspense, useMemo } from "react";
import { PageShell } from "@/components/page-shell";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent } from "@/components/ui/card";
import { useFilterParams, useFetch } from "@/hooks/use-dashboard-data";
import { formatNumber, formatCurrency, cn } from "@/lib/utils";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  BarChart, Bar, Cell, Legend,
} from "recharts";

interface FunnelStep { name: string; value: number; rate?: number; channels?: Record<string, number>; }
interface TrendPoint { date: string; sessions: number; cart_adds: number; purchases: number; impressions: number; [key: string]: string | number; }
interface ChannelFunnel { channel: string; sessions: number; cart_adds: number; purchases: number; repurchases: number; convRate: number; }
interface MetaAdRow { date: string; brand: string; impressions: number; clicks: number; conversions: number; conversion_value: number; reach: number; spend: number; }
interface FunnelData { funnel: FunnelStep[]; trend: TrendPoint[]; channelFunnel: ChannelFunnel[]; repurchase: { value: number; rate: number }; metaAds: MetaAdRow[]; }

const FUNNEL_COLORS = ["#6366f1", "#818cf8", "#a78bfa", "#22c55e", "#14b8a6"];
const CHANNEL_COLORS: Record<string, string> = { 스마트스토어: "#16a34a", 카페24: "#2563eb", 쿠팡: "#dc2626" };
const IMP_COLORS: Record<string, string> = { meta: "#8b5cf6", naver: "#22c55e", google: "#eab308", coupang: "#ef4444" };
const IMP_LABELS: Record<string, string> = { meta: "Meta", naver: "네이버", google: "구글", coupang: "쿠팡" };
const CH_LABELS: Record<string, string> = { smartstore: "스마트스토어", cafe24: "카페24", coupang: "쿠팡" };

export default function FunnelPage() {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">로딩 중...</div>}>
      <FunnelInner />
    </Suspense>
  );
}

function FunnelInner() {
  const { from, to, brand } = useFilterParams();
  const { data, loading } = useFetch<FunnelData>(`/api/funnel?from=${from}&to=${to}&brand=${brand || "all"}`);

  const funnel = data?.funnel || [];
  const trend = data?.trend || [];
  const channelFunnel = data?.channelFunnel || [];
  const repurchase = data?.repurchase || { value: 0, rate: 0 };

  const sessionsStep = funnel.find(s => s.name === "유입");
  const purchaseStep = funnel.find(s => s.name === "구매");
  const cartStep = funnel.find(s => s.name === "장바구니");
  const overallConvRate = sessionsStep && sessionsStep.value > 0 && purchaseStep
    ? ((purchaseStep.value / sessionsStep.value) * 100) : 0;
  const cartVal = cartStep?.value || 0;
  const purchaseVal = purchaseStep?.value || 0;
  const abandonRate = cartVal > 0 && cartVal >= purchaseVal ? ((cartVal - purchaseVal) / cartVal) * 100 : 0;

  /* Meta 광고 퍼널 */
  const metaFunnel = useMemo(() => {
    const rows = data?.metaAds || [];
    if (brand && brand !== "all") {
      const filtered = rows.filter(r => r.brand === brand);
      const t = { impressions: 0, reach: 0, clicks: 0, conversions: 0, convValue: 0, spend: 0 };
      for (const r of filtered) {
        t.impressions += r.impressions || 0; t.reach += r.reach || 0;
        t.clicks += r.clicks || 0; t.conversions += r.conversions || 0;
        t.convValue += r.conversion_value || 0; t.spend += r.spend || 0;
      }
      return t;
    }
    const t = { impressions: 0, reach: 0, clicks: 0, conversions: 0, convValue: 0, spend: 0 };
    for (const r of rows) {
      t.impressions += r.impressions || 0; t.reach += r.reach || 0;
      t.clicks += r.clicks || 0; t.conversions += r.conversions || 0;
      t.convValue += r.conversion_value || 0; t.spend += r.spend || 0;
    }
    return t;
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
      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="총 세션" value={formatNumber(sessionsStep?.value || 0)} />
        <KpiCard title="구매 전환율" value={`${overallConvRate.toFixed(2)}%`} />
        <KpiCard title="장바구니 이탈률" value={cartVal > 0 ? `${abandonRate.toFixed(1)}%` : "—"} />
        <KpiCard title="총 구매" value={formatNumber(purchaseVal)} />
      </div>

      {/* 전환 퍼널 (깔때기) */}
      <Card>
        <CardContent className="p-4">
          <h3 className="font-semibold mb-4">전환 퍼널</h3>
          <div className="space-y-0">
            {(() => {
              const impressionStep = funnel.find(s => s.name === "노출");
              const funnelSteps = funnel.filter(s => s.name !== "노출");
              const maxVal = funnelSteps[0]?.value || 1;

              return (
                <div className="space-y-4">
                  {impressionStep && (
                    <div className="flex items-center gap-3 bg-indigo-50 dark:bg-indigo-900/10 rounded-lg px-4 py-3">
                      <span className="text-sm font-medium text-indigo-600 dark:text-indigo-400">노출</span>
                      <span className="text-2xl font-bold text-indigo-500">{formatNumber(impressionStep.value)}</span>
                      {funnelSteps[0] && (
                        <span className="text-xs text-muted-foreground ml-auto">
                          유입률 {impressionStep.value > 0 ? ((funnelSteps[0].value / impressionStep.value) * 100).toFixed(2) : 0}%
                        </span>
                      )}
                    </div>
                  )}

                  <div className="space-y-0">
                    {funnelSteps.map((step, i) => {
                      const pct = maxVal > 0 ? (step.value / maxVal) * 100 : 0;
                      const width = Math.max(pct, 12);
                      const prevStep = i > 0 ? funnelSteps[i - 1] : null;
                      const rawConvRate = prevStep && prevStep.value > 0 ? (step.value / prevStep.value * 100) : 100;
                      const stepConvRate = rawConvRate > 100 ? 100 : rawConvRate;
                      const dropRate = rawConvRate > 100 ? 0 : 100 - stepConvRate;
                      const channels = step.channels as Record<string, number> | undefined;
                      const hasChannels = channels && Object.values(channels).some((v: number) => v > 0);
                      const totalCh = hasChannels ? Object.values(channels!).reduce((s: number, v: number) => s + v, 0) : 0;

                      return (
                        <div key={step.name}>
                          {i > 0 && (
                            <div className="flex items-center justify-center py-1">
                              <span className="text-[10px] text-red-400">▼ 이탈 {dropRate.toFixed(1)}% ({formatNumber((prevStep?.value || 0) - step.value)}명)</span>
                            </div>
                          )}
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-muted-foreground w-16 text-right shrink-0">{step.name}</span>
                            <div className="flex-1 flex justify-center">
                              {hasChannels && totalCh > 0 ? (
                                <div className="h-12 rounded-lg flex overflow-hidden transition-all shadow-sm" style={{ width: `${width}%` }}>
                                  {Object.entries(channels!).filter(([, v]) => v > 0).map(([ch, v]) => {
                                    const chPct = totalCh > 0 ? (v / totalCh) * 100 : 0;
                                    const chColor = CHANNEL_COLORS[ch] || "#6b7280";
                                    return (
                                      <div key={ch} className="h-full flex items-center justify-center relative group"
                                        style={{ backgroundColor: chColor, width: `${chPct}%`, minWidth: chPct > 5 ? "auto" : "8px" }}>
                                        {chPct > 15 && <span className="text-[9px] text-white/90 font-medium truncate px-1">{ch}</span>}
                                        <div className="absolute bottom-full mb-1 hidden group-hover:block bg-black/80 text-white text-[10px] rounded px-2 py-1 whitespace-nowrap z-10">
                                          {ch}: {formatNumber(v)} ({chPct.toFixed(0)}%)
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className="h-12 rounded-lg flex items-center justify-between px-4 transition-all shadow-sm"
                                  style={{ backgroundColor: FUNNEL_COLORS[i + 1] || FUNNEL_COLORS[i], opacity: 0.9, width: `${width}%` }}>
                                  <span className="text-sm font-bold text-white">{formatNumber(step.value)}</span>
                                  <span className="text-[11px] text-white/80 font-medium">{pct.toFixed(1)}%</span>
                                </div>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground w-20 shrink-0">
                              {hasChannels ? formatNumber(step.value) : ""} {i > 0 ? `전환 ${stepConvRate.toFixed(1)}%` : "기준"}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {repurchase.value >= 0 && (
                    <div className="flex items-center gap-3 bg-teal-50 dark:bg-teal-900/10 rounded-lg px-4 py-3 mt-3">
                      <span className="text-sm font-medium text-teal-600 dark:text-teal-400">재구매</span>
                      <span className="text-2xl font-bold text-teal-500">{formatNumber(repurchase.value)}</span>
                      <span className="text-xs text-muted-foreground ml-auto">
                        재구매율 {repurchase.rate.toFixed(1)}%
                      </span>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </CardContent>
      </Card>

      {/* 노출 일별 트렌드 (소스별) */}
      {trend.length > 0 && (
        <>
          <Card>
            <CardContent className="p-4">
              <h4 className="text-sm font-semibold mb-2">노출 일별 트렌드 (소스별)</h4>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={trend.map(t => ({ ...t, date: t.date.slice(5) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                  <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                  <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }} />
                  <Legend />
                  {["meta", "naver", "google", "coupang"].map((src) => (
                    <Area key={src} type="monotone" dataKey={`imp_${src}`} name={IMP_LABELS[src]} stackId="imp"
                      stroke={IMP_COLORS[src]} fill={IMP_COLORS[src]} fillOpacity={0.6} />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <h4 className="text-sm font-semibold mb-2">유입 일별 트렌드 (채널별)</h4>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={trend.map(t => ({ ...t, date: t.date.slice(5) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                  <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                  <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }} />
                  <Legend />
                  {["smartstore", "cafe24", "coupang"].map((ch) => (
                    <Area key={ch} type="monotone" dataKey={`sessions_${ch}`} name={CH_LABELS[ch]} stackId="sessions"
                      stroke={CHANNEL_COLORS[CH_LABELS[ch]] || "#6b7280"} fill={CHANNEL_COLORS[CH_LABELS[ch]] || "#6b7280"} fillOpacity={0.6} />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <h4 className="text-sm font-semibold mb-2">구매 일별 트렌드 (채널별)</h4>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={trend.map(t => ({ ...t, date: t.date.slice(5) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                  <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                  <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }} />
                  <Legend />
                  {["smartstore", "cafe24", "coupang"].map((ch) => (
                    <Area key={ch} type="monotone" dataKey={`purchases_${ch}`} name={CH_LABELS[ch]} stackId="purchases"
                      stroke={CHANNEL_COLORS[CH_LABELS[ch]] || "#6b7280"} fill={CHANNEL_COLORS[CH_LABELS[ch]] || "#6b7280"} fillOpacity={0.6} />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </>
      )}

      {/* 채널별 퍼널 비교 */}
      {channelFunnel.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h3 className="font-semibold mb-4">채널별 퍼널 비교</h3>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                <p className="text-xs text-muted-foreground mb-3">채널별 구매 전환율</p>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={channelFunnel}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="channel" tick={{ fontSize: 12 }} stroke="var(--muted-foreground)" />
                    <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" tickFormatter={(v: number) => `${v.toFixed(1)}%`} />
                    <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }}
                      formatter={(v: unknown) => [`${Number(v).toFixed(2)}%`, "전환율"]} />
                    <Bar dataKey="convRate" name="전환율" radius={[4, 4, 0, 0]}>
                      {channelFunnel.map((_, i) => (
                        <Cell key={i} fill={["#8b5cf6", "#14b8a6", "#f97316"][i % 3]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
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
                        <td className="py-2 pr-4 text-right text-green-500">{formatNumber(ch.purchases)}</td>
                        <td className="py-2 pr-4 text-right">{formatNumber(ch.repurchases)}</td>
                        <td className={cn("py-2 text-right font-medium", ch.convRate >= 5 ? "text-green-500" : ch.convRate >= 2 ? "text-yellow-500" : "text-red-500")}>
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

      {/* Meta 광고 퍼널 */}
      {metaFunnel.impressions > 0 && (
        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="p-4">
            <h3 className="font-semibold mb-4">Meta 광고 퍼널</h3>
            <div className="flex items-center justify-between gap-1">
              {[
                { label: "노출", value: metaFunnel.impressions, color: "#94a3b8" },
                { label: "도달", value: metaFunnel.reach, color: "#64748b" },
                { label: "클릭", value: metaFunnel.clicks, color: "#3b82f6" },
                { label: "전환", value: metaFunnel.conversions, color: "#10b981" },
              ].map((step, i, arr) => {
                const pct = metaFunnel.impressions > 0 ? (step.value / metaFunnel.impressions * 100) : 0;
                const dropRate = i > 0 && arr[i - 1].value > 0
                  ? ((arr[i - 1].value - step.value) / arr[i - 1].value * 100) : 0;
                return (
                  <div key={step.label} className="flex items-center flex-1">
                    <div className="flex-1 text-center">
                      <div className="text-xs text-muted-foreground mb-1">{step.label}</div>
                      <div className="text-lg font-bold" style={{ color: step.color }}>{formatNumber(step.value)}</div>
                      <div className="text-[10px] text-muted-foreground">{pct.toFixed(2)}%</div>
                    </div>
                    {i < arr.length - 1 && (
                      <div className="text-center px-1 text-muted-foreground">
                        <div className="text-lg">→</div>
                        {dropRate > 0 && <div className="text-[10px]">-{dropRate.toFixed(0)}%</div>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between mt-3 text-xs text-muted-foreground border-t pt-2">
              <span>광고비: {formatCurrency(metaFunnel.spend)}</span>
              <span>전환매출: {formatCurrency(metaFunnel.convValue)}</span>
              <span>ROAS: {metaFunnel.spend > 0 ? `${(metaFunnel.convValue / metaFunnel.spend).toFixed(2)}x` : "—"}</span>
              <span>CPA: {metaFunnel.conversions > 0 ? formatCurrency(Math.round(metaFunnel.spend / metaFunnel.conversions)) : "—"}</span>
            </div>
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
