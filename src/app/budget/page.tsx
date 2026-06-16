"use client";

import { Suspense, useMemo } from "react";
import { PageShell } from "@/components/page-shell";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent } from "@/components/ui/card";
import { useFetch } from "@/hooks/use-dashboard-data";
import { BRAND_LABELS, BRAND_COLORS, CHANNEL_LABELS, type DailyAdSpend } from "@/lib/types";
import { useConfig } from "@/hooks/use-config";
import { formatCurrency, formatPercent } from "@/lib/utils";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

interface PacingData {
  daysInMonth: number; daysElapsed: number; daysRemaining: number; dateProgress: number;
  hasTarget: boolean;
  target: { ad: number };
  actual: { ad: number };
  achievement: { ad: number };
  remaining: { ad: number; reqDailyAd: number; dailyAvgAd: number };
  perBrand: { brand: string; targetAd: number; actualAd: number; adConsumption: number }[];
}

function pct(v: number) { return `${(v * 100).toFixed(0)}%`; }

export default function BudgetPage() {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">로딩 중...</div>}>
      <BudgetInner />
    </Suspense>
  );
}

function BudgetInner() {
  const { brandMap, channelMap } = useConfig();
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const today = now.toISOString().split("T")[0];

  const { data: pacing, loading: pacingLoading } = useFetch<PacingData>(`/api/pacing?brand=all`);
  const { data: adsData, loading: adsLoading } = useFetch<{ ads: DailyAdSpend[] }>(`/api/ads?from=${monthStart}&to=${today}`);
  const loading = pacingLoading || adsLoading;

  const ads = useMemo(() => (adsData?.ads || []).filter((r) => !r.channel.startsWith("ga4_")), [adsData]);

  // 채널별 집행 (매체비, 목표 비교는 채널 단위 목표가 없어 집행/비중만)
  const byChannel = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of ads) map[r.channel] = (map[r.channel] || 0) + (r.spend || 0);
    const total = Object.values(map).reduce((s, v) => s + v, 0);
    return Object.entries(map)
      .map(([ch, spent]) => ({
        channel: ch,
        label: channelMap[ch]?.label || CHANNEL_LABELS[ch] || ch,
        spent,
        share: total > 0 ? (spent / total) * 100 : 0,
      }))
      .sort((a, b) => b.spent - a.spent);
  }, [ads, channelMap]);

  const t = pacing;
  const targetAd = t?.target.ad || 0;
  const actualAd = t?.actual.ad || 0;
  const consumption = t?.achievement.ad || 0;        // 집행/목표
  const dateProgress = t?.dateProgress || 0;
  const projected = t ? Math.round(t.remaining.dailyAvgAd * t.daysInMonth) : 0; // 월말 예상 집행
  const remaining = t?.remaining.ad ?? 0;            // 목표-집행 (음수=초과)
  const hasTarget = !!t?.hasTarget && targetAd > 0;

  // 페이스 판정: 소진율 vs 날짜진행률
  const overPace = hasTarget && consumption > dateProgress + 0.05;
  const projOver = hasTarget && projected > targetAd;

  if (loading) {
    return (
      <PageShell title="예산 현황" description="이번 달 광고 예산 집행 현황" hideFilters>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="p-5 animate-pulse"><CardContent className="p-0"><div className="h-8 w-28 bg-muted rounded" /></CardContent></Card>
          ))}
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell title="예산 현황" description={`${now.getFullYear()}년 ${now.getMonth() + 1}월 광고 예산 집행 (${t?.daysElapsed ?? 0}/${t?.daysInMonth ?? 0}일, 매체비 기준)`} hideFilters>
      {!hasTarget && (
        <Card><CardContent className="p-4 text-sm text-muted-foreground">
          이번 달 광고예산 목표가 없습니다. <a href="/settings" className="text-primary hover:underline">설정 &gt; 목표설정</a>에서 등록하면 목표 대비 소진율이 표시됩니다.
        </CardContent></Card>
      )}

      {/* 예산 초과 경고 */}
      {hasTarget && remaining < 0 && (
        <Card className="border-l-4 border-l-red-500 bg-red-500/5">
          <CardContent className="p-3 text-sm font-medium text-red-600">
            ⚠ 광고예산 초과: {formatCurrency(Math.abs(remaining))} (목표 {formatCurrency(targetAd)} 대비 {pct(consumption)} 소진)
          </CardContent>
        </Card>
      )}

      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="목표 광고예산" value={hasTarget ? formatCurrency(targetAd) : "—"} subtitle="이번 달 매체비 목표" />
        <KpiCard title="집행" value={formatCurrency(actualAd)} subtitle={hasTarget ? `소진율 ${pct(consumption)} · 날짜 ${pct(dateProgress)}` : `일 평균 ${formatCurrency(Math.round(actualAd / Math.max(t?.daysElapsed || 1, 1)))}`} />
        <KpiCard title="월말 예상" value={formatCurrency(projected)} subtitle={hasTarget ? (projOver ? `목표 ${formatCurrency(targetAd)} 초과 예상` : `목표 대비 ${pct(targetAd > 0 ? projected / targetAd : 0)}`) : undefined} />
        <KpiCard title="잔여 예산" value={hasTarget ? formatCurrency(remaining) : "—"} subtitle={hasTarget ? `가용 일 ${formatCurrency(Math.round(t!.remaining.reqDailyAd))} (잔여 ${t!.daysRemaining}일)` : undefined} />
      </div>

      {/* 소진 페이스 바 */}
      {hasTarget && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <h3 className="font-semibold">예산 소진 페이스</h3>
              <span className={`text-xs px-2 py-0.5 rounded-full border ${overPace ? "bg-red-500/10 text-red-600 border-red-500/30" : "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"}`}>
                {overPace ? "예산보다 빠르게 소진" : "예산 내 정상 페이스"}
              </span>
            </div>
            <div className="relative h-3 bg-muted rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, consumption * 100)}%`, backgroundColor: consumption > 1 ? "#ef4444" : overPace ? "#f59e0b" : "#10b981" }} />
              <div className="absolute top-0 h-full w-0.5 bg-foreground/60" style={{ left: `${Math.min(100, dateProgress * 100)}%` }} title="날짜 진행률" />
            </div>
            <p className="text-xs text-muted-foreground">소진 {pct(consumption)} · 날짜 진행 {pct(dateProgress)} (세로선). 소진이 날짜선보다 오른쪽이면 예산보다 빠르게 쓰는 중.</p>
          </CardContent>
        </Card>
      )}

      {/* 브랜드별 목표 대비 집행 */}
      <Card>
        <CardContent className="p-4">
          <h3 className="font-semibold mb-4">브랜드별 광고예산 (목표 대비)</h3>
          <div className="space-y-3">
            {(t?.perBrand || []).filter(b => b.targetAd > 0 || b.actualAd > 0).sort((a, b) => b.actualAd - a.actualAd).map((b) => {
              const label = brandMap[b.brand]?.label || BRAND_LABELS[b.brand] || b.brand;
              const color = brandMap[b.brand]?.color || BRAND_COLORS[b.brand] || "#6b7280";
              const over = b.adConsumption > 1;
              const fast = b.targetAd > 0 && b.adConsumption > dateProgress + 0.05;
              const barColor = over ? "#ef4444" : fast ? "#f59e0b" : color;
              return (
                <div key={b.brand} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{label}</span>
                    <span>
                      {formatCurrency(b.actualAd)}
                      {b.targetAd > 0 && <span className="text-muted-foreground text-xs"> / {formatCurrency(b.targetAd)} ({pct(b.adConsumption)})</span>}
                    </span>
                  </div>
                  <div className="relative w-full h-2.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, (b.targetAd > 0 ? b.adConsumption : 0) * 100)}%`, backgroundColor: barColor }} />
                    {b.targetAd > 0 && <div className="absolute top-0 h-full w-0.5 bg-foreground/50" style={{ left: `${Math.min(100, dateProgress * 100)}%` }} title="날짜 진행률" />}
                  </div>
                </div>
              );
            })}
            {(t?.perBrand || []).filter(b => b.targetAd > 0 || b.actualAd > 0).length === 0 && (
              <p className="text-sm text-muted-foreground">집행 데이터 없음</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 채널별 분배 */}
      <Card>
        <CardContent className="p-4">
          <h3 className="font-semibold mb-4">매체별 집행 분배</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={byChannel} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis type="number" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" tickFormatter={(v) => `${(v / 10000).toFixed(0)}만`} />
              <YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" width={80} />
              <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} formatter={(val) => formatCurrency(Number(val))} />
              <Bar dataKey="spent" name="집행" fill="#2563eb" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* 채널 비중 테이블 */}
      <Card>
        <CardContent className="p-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b text-muted-foreground">
                <th className="pb-2 pr-4">매체</th>
                <th className="pb-2 pr-4 text-right">집행</th>
                <th className="pb-2 text-right">비중</th>
              </tr>
            </thead>
            <tbody>
              {byChannel.map((c) => (
                <tr key={c.channel} className="border-b border-border/50">
                  <td className="py-2 pr-4">{c.label}</td>
                  <td className="py-2 pr-4 text-right font-medium">{formatCurrency(c.spent)}</td>
                  <td className="py-2 text-right">{formatPercent(c.share)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </PageShell>
  );
}
