"use client";

import { Suspense, useMemo } from "react";
import { PageShell } from "@/components/page-shell";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent } from "@/components/ui/card";
import { useFetch } from "@/hooks/use-dashboard-data";
import { BRAND_LABELS, BRAND_COLORS, CHANNEL_LABELS, type DailyAdTotal } from "@/lib/types";
import { dailyAdsUrl } from "@/lib/api-urls";
import { useConfig } from "@/hooks/use-config";
import { formatCurrency, formatPercent } from "@/lib/utils";
import { kstDate, kstMonth } from "@/lib/date";

interface PacingData {
  daysInMonth: number; daysElapsed: number; daysRemaining: number; dateProgress: number;
  // 광고비 원장이 들어온 날 기준(오늘 장중 행 제외, 어제까지). 인사이트 페이싱 카드와 같은 값이다.
  adThrough: string | null; adDays: number; adProgress: number; adDaysRemaining: number;
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
  // KST 기준(2026-11-04). 예전엔 달 시작은 브라우저 로컬, 오늘은 UTC(toISOString)라
  // KST 00:00~09:00 에는 오늘이 어제로 잘렸고, 해외 시간대에선 달 시작까지 어긋났다.
  const month = kstMonth();
  const monthStart = `${month}-01`;
  const today = kstDate();
  const [yearNum, monthNum] = month.split("-").map(Number);

  const { data: pacing, loading: pacingLoading } = useFetch<PacingData>(`/api/pacing?brand=all`);
  // 날짜 × 매체 합계만 받는다(2026-11-09). 이 화면은 행마다 날짜·매체·광고비만 쓴다.
  const { data: adsData, loading: adsLoading } = useFetch<{ ads: DailyAdTotal[] }>(dailyAdsUrl("all", monthStart, today));
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
  // ★ 한 기준으로 맞춤(2026-11-09): 「월말 예상」·「일 평균」·세로선·「잔여 ○일」 모두 광고비 원장이 들어온 날(어제까지) 기준.
  //   예전엔 세로선·잔여 일은 오늘 날짜(달력), 월말 예상은 이 화면이 직접 센 날 수(오늘 장중 행 포함)라
  //   같은 화면 안에서 분모가 셋이었고, 「가용 일」 금액은 원장 기준으로 나눈 값인데 옆 글자는 달력 잔여 일이었다.
  //   기준은 /api/pacing 의 adDays·adProgress 다(인사이트 「목표 대비 페이싱」 카드와 같은 값).
  const adDays = t?.adDays ?? 0;
  const adProgress = t?.adProgress ?? 0;                 // 집계 진행률 = 원장 날 수 ÷ 이번 달 일수
  const dailyAvg = t?.remaining.dailyAvgAd ?? 0;          // 원장이 들어온 날까지 집행 ÷ 그 날 수
  const projected = t ? Math.round(dailyAvg * t.daysInMonth) : 0;            // 월말 예상 집행
  const remaining = t?.remaining.ad ?? 0;            // 목표-집행 (음수=초과)
  const hasTarget = !!t?.hasTarget && targetAd > 0;
  // 페이스 판정용 소진율: 세로선과 같은 날(원장 마지막 날)까지의 집행으로 잰다. 오늘 장중 집행은 빼야 같은 날끼리 비교가 된다.
  const consumptionThrough = targetAd > 0 ? (dailyAvg * adDays) / targetAd : 0;

  // 페이스 판정: 원장까지 소진율 vs 집계 진행률
  const overPace = hasTarget && consumptionThrough > adProgress + 0.05;
  const projOver = hasTarget && projected > targetAd;

  if (loading) {
    return (
      <PageShell title="예산 페이싱" description="이번 달 광고 예산 집행 현황" hideFilters>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="p-5 animate-pulse"><CardContent className="p-0"><div className="h-8 w-28 bg-muted rounded" /></CardContent></Card>
          ))}
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell title="예산 페이싱" description={`${yearNum}년 ${monthNum}월 광고 예산 집행 (${t?.daysElapsed ?? 0}/${t?.daysInMonth ?? 0}일 경과, 광고비 원장 ${adDays}일치${t?.adThrough ? ` · ${t.adThrough}까지` : ""}, 매체비 기준)`} hideFilters>
      {!hasTarget && (
        <Card><CardContent className="p-4 text-sm text-muted-foreground">
          이번 달 광고예산 목표가 없습니다. <a href="/settings?tab=targets" className="text-primary hover:underline">설정 &gt; 목표설정</a>에서 등록하면 목표 대비 소진율이 표시됩니다.
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
        <KpiCard title="목표 광고예산" value={hasTarget ? formatCurrency(targetAd) : "-"} subtitle="이번 달 매체비 목표" />
        <KpiCard title="집행" value={formatCurrency(actualAd)} subtitle={hasTarget ? `소진율 ${pct(consumption)} · 집계 진행 ${pct(adProgress)}` : `일 평균 ${formatCurrency(Math.round(dailyAvg))} (원장 ${adDays}일)`} />
        <KpiCard title="월말 예상" value={formatCurrency(projected)} subtitle={`일 평균 × ${t?.daysInMonth ?? 0}일 (원장 ${adDays}일 기준)${hasTarget ? (projOver ? ` · 목표 ${formatCurrency(targetAd)} 초과 예상` : ` · 목표 대비 ${pct(targetAd > 0 ? projected / targetAd : 0)}`) : ""}`} />
        <KpiCard title="잔여 예산" value={hasTarget ? formatCurrency(remaining) : "-"} subtitle={hasTarget ? `가용 일 ${formatCurrency(Math.round(t!.remaining.reqDailyAd))} (잔여 ${t!.adDaysRemaining}일)` : undefined} />
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
              <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, consumptionThrough * 100)}%`, backgroundColor: consumption > 1 ? "#ef4444" : overPace ? "#f59e0b" : "#10b981" }} />
              <div className="absolute top-0 h-full w-0.5 bg-foreground/60" style={{ left: `${Math.min(100, adProgress * 100)}%` }} title="집계 진행률" />
            </div>
            <p className="text-xs text-muted-foreground">소진 {pct(consumptionThrough)} · 집계 진행 {pct(adProgress)} (세로선, 광고비 원장 {adDays}일 ÷ {t?.daysInMonth ?? 0}일). 둘 다 원장이 들어온 날까지 기준입니다. 소진이 세로선보다 오른쪽이면 예산보다 빠르게 쓰는 중.</p>
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
              // 브랜드별 집행은 오늘 장중 행까지 들어 있다(API 가 브랜드별 원장까지 합계를 주지 않음). 세로선은 집계 진행률.
              const fast = b.targetAd > 0 && b.adConsumption > adProgress + 0.05;
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
                    {b.targetAd > 0 && <div className="absolute top-0 h-full w-0.5 bg-foreground/50" style={{ left: `${Math.min(100, adProgress * 100)}%` }} title="집계 진행률" />}
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

      {/* 매체별 집행: 예전엔 막대그래프와 표가 같은 금액을 두 번 보여 줬다(2026-11-04 하나로).
          매체별 일별 내역은 「매체별 집행」 화면에 있다. */}
      <Card>
        <CardContent className="p-4 overflow-x-auto">
          <h3 className="font-semibold mb-3">매체별 집행 (이번 달)</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b text-muted-foreground">
                <th className="pb-2 pr-4">매체</th>
                <th className="pb-2 pr-4 text-right">집행</th>
                <th className="pb-2 pr-4 text-right">비중</th>
                <th className="pb-2 w-1/3"><span className="sr-only">비중 막대</span></th>
              </tr>
            </thead>
            <tbody>
              {byChannel.map((c) => (
                <tr key={c.channel} className="border-b border-border/50">
                  <td className="py-2 pr-4">{c.label}</td>
                  <td className="py-2 pr-4 text-right font-medium">{formatCurrency(c.spent)}</td>
                  <td className="py-2 pr-4 text-right">{formatPercent(c.share)}</td>
                  <td className="py-2">
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-slate-500" style={{ width: `${Math.min(100, c.share)}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
              {byChannel.length === 0 && (
                <tr><td colSpan={4} className="py-6 text-center text-muted-foreground">집행 데이터 없음</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </PageShell>
  );
}
