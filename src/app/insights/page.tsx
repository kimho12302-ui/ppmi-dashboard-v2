"use client";

import { Suspense, useMemo } from "react";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { useFilterParams, useFetch } from "@/hooks/use-dashboard-data";
import { BRAND_LABELS, CHANNEL_LABELS, type DailySales, type DailyAdSpend } from "@/lib/types";
import { useConfig } from "@/hooks/use-config";
import { formatCurrency, cn } from "@/lib/utils";

type InsightLevel = "critical" | "warning" | "opportunity" | "info";

interface Insight {
  level: InsightLevel;
  title: string;
  description: string;
}

export default function InsightsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">로딩 중...</div>}>
      <InsightsInner />
    </Suspense>
  );
}

function InsightsInner() {
  const { brand, from, to } = useFilterParams();
  const { brandMap, channelMap } = useConfig();
  const { data, loading } = useFetch<{
    sales: DailySales[];
    ads: DailyAdSpend[];
  }>(`/api/dashboard?from=${from}&to=${to}`);

  const insights = useMemo(() => {
    const results: Insight[] = [];
    const salesData = data?.sales || [];
    const adsData = (data?.ads || []).filter((r) => !r.channel.startsWith("ga4_"));

    const filterBrand = (r: { brand: string }) => !brand || brand === "all" || r.brand === brand;

    const filteredSales = salesData.filter(filterBrand);
    const filteredAds = adsData.filter(filterBrand);

    // ── 1. 브랜드별 ROAS 분석 ──
    if (!brand || brand === "all") {
      const brandSpend: Record<string, number> = {};
      const brandConvValue: Record<string, number> = {};
      for (const r of adsData) {
        brandSpend[r.brand] = (brandSpend[r.brand] || 0) + (r.spend || 0);
        brandConvValue[r.brand] = (brandConvValue[r.brand] || 0) + (r.conversion_value || 0);
      }
      for (const b of Object.keys(brandSpend)) {
        const spend = brandSpend[b] || 0;
        const convVal = brandConvValue[b] || 0;
        const roas = spend > 0 ? convVal / spend : 0;
        const label = brandMap[b]?.label || BRAND_LABELS[b] || b;
        if (spend > 0 && roas < 1) {
          results.push({
            level: "critical",
            title: `${label} ROAS ${roas.toFixed(2)}x — 광고비 > 전환매출`,
            description: `광고비 ${formatCurrency(spend)} 대비 전환 매출 ${formatCurrency(convVal)}. 즉시 캠페인 효율 점검 필요.`,
          });
        } else if (roas >= 3) {
          results.push({
            level: "opportunity",
            title: `${label} ROAS ${roas.toFixed(2)}x — 스케일업 기회`,
            description: `광고비 ${formatCurrency(spend)}으로 전환 매출 ${formatCurrency(convVal)} 달성. 예산 증액 검토.`,
          });
        }
      }
    }

    // ── 2. 채널별 이상치 (±30% 변동) ──
    const channelDaily: Record<string, { date: string; spend: number }[]> = {};
    for (const r of filteredAds) {
      if (!channelDaily[r.channel]) channelDaily[r.channel] = [];
      channelDaily[r.channel].push({ date: r.date, spend: r.spend || 0 });
    }
    for (const [ch, days] of Object.entries(channelDaily)) {
      if (days.length < 3) continue;
      const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
      const recent = sorted.slice(-1)[0];
      const prev = sorted.slice(0, -1);
      const avg = prev.reduce((s, d) => s + d.spend, 0) / prev.length;
      if (avg <= 0) continue;
      const change = ((recent.spend - avg) / avg) * 100;
      const label = channelMap[ch]?.label || CHANNEL_LABELS[ch] || ch;
      if (Math.abs(change) >= 30) {
        results.push({
          level: Math.abs(change) >= 80 ? "critical" : "warning",
          title: `${label} 최근일 광고비 ${change > 0 ? "급증" : "급감"} (${change > 0 ? "+" : ""}${change.toFixed(0)}%)`,
          description: `평균 ${formatCurrency(Math.round(avg))}/일 → 최근 ${formatCurrency(recent.spend)}/일 (${recent.date}).`,
        });
      }
    }

    // ── 3. 3일 연속 매출 상승/하락 트렌드 ──
    const dailyRevenue: Record<string, number> = {};
    for (const r of filteredSales) {
      dailyRevenue[r.date] = (dailyRevenue[r.date] || 0) + (r.revenue || 0);
    }
    const sortedDays = Object.entries(dailyRevenue).sort(([a], [b]) => a.localeCompare(b));
    if (sortedDays.length >= 4) {
      const last4 = sortedDays.slice(-4);
      const diffs = [];
      for (let i = 1; i < last4.length; i++) {
        diffs.push(last4[i][1] - last4[i - 1][1]);
      }
      if (diffs.every((d) => d > 0)) {
        results.push({
          level: "opportunity",
          title: "📈 3일 연속 매출 상승 중!",
          description: `${last4[0][0]} ~ ${last4[last4.length - 1][0]}: ${last4.map(([, v]) => formatCurrency(v)).join(" → ")}`,
        });
      } else if (diffs.every((d) => d < 0)) {
        results.push({
          level: "warning",
          title: "📉 3일 연속 매출 하락 중",
          description: `${last4[0][0]} ~ ${last4[last4.length - 1][0]}: ${last4.map(([, v]) => formatCurrency(v)).join(" → ")}. 원인 확인 필요.`,
        });
      }
    }

    // ── 4. 매출 누락일 감지 ──
    const salesDates = new Set(filteredSales.map((r) => r.date));
    const adsDates = new Set(filteredAds.map((r) => r.date));
    const adOnlyDates = Array.from(adsDates).filter((d) => !salesDates.has(d)).sort();
    if (adOnlyDates.length > 0 && adOnlyDates.length <= 10) {
      results.push({
        level: adOnlyDates.length >= 3 ? "warning" : "info",
        title: `매출 데이터 누락 ${adOnlyDates.length}일`,
        description: `${adOnlyDates.slice(0, 5).join(", ")}${adOnlyDates.length > 5 ? ` 외 ${adOnlyDates.length - 5}일` : ""}. 엑셀 업로드 필요.`,
      });
    }

    // ── 5. 광고비 없는 날짜 (크론 실패 가능성) ──
    const salesOnlyDates = Array.from(salesDates).filter((d) => !adsDates.has(d)).sort();
    if (salesOnlyDates.length > 0 && salesOnlyDates.length <= 5) {
      results.push({
        level: "info",
        title: `광고 데이터 누락 ${salesOnlyDates.length}일`,
        description: `${salesOnlyDates.join(", ")}. API 크론 정상 작동 확인 필요.`,
      });
    }

    // ── 6. 총 광고비 대비 매출 효율 ──
    const totalRevenue = filteredSales.reduce((s, r) => s + (r.revenue || 0), 0);
    const totalSpend = filteredAds.reduce((s, r) => s + (r.spend || 0), 0);
    if (totalSpend > 0 && totalRevenue > 0) {
      const overallRoas = totalRevenue / totalSpend;
      if (overallRoas < 2) {
        results.push({
          level: "warning",
          title: `전체 매출/광고비 비율 ${overallRoas.toFixed(1)}x — 주의`,
          description: `매출 ${formatCurrency(totalRevenue)} / 광고비 ${formatCurrency(totalSpend)}. 채널별 효율 점검.`,
        });
      }
    }

    // ── 정렬: critical → warning → opportunity → info ──
    const order: Record<InsightLevel, number> = { critical: 0, warning: 1, opportunity: 2, info: 3 };
    results.sort((a, b) => order[a.level] - order[b.level]);

    if (results.length === 0) {
      results.push({
        level: "info",
        title: "특이사항 없음",
        description: "선택한 기간에 주목할 만한 이상치나 경고가 없습니다.",
      });
    }

    return results;
  }, [data, brand, brandMap, channelMap]);

  const levelConfig: Record<InsightLevel, { icon: string; border: string; badge: string; badgeLabel: string }> = {
    critical: { icon: "🔴", border: "border-l-red-500 bg-red-500/5", badge: "bg-red-500/10 text-red-600", badgeLabel: "즉시 대응" },
    warning: { icon: "🟡", border: "border-l-amber-500 bg-amber-500/5", badge: "bg-amber-500/10 text-amber-600", badgeLabel: "주의" },
    opportunity: { icon: "🟢", border: "border-l-emerald-500 bg-emerald-500/5", badge: "bg-emerald-500/10 text-emerald-600", badgeLabel: "기회" },
    info: { icon: "🔵", border: "border-l-blue-500 bg-blue-500/5", badge: "bg-blue-500/10 text-blue-600", badgeLabel: "참고" },
  };

  const countByLevel = insights.reduce((acc, i) => {
    acc[i.level] = (acc[i.level] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  if (loading) {
    return (
      <PageShell title="인사이트" description="자동 이상치 감지 · 트렌드 분석 · 효율 경고">
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="p-4 animate-pulse">
              <CardContent className="p-0"><div className="h-4 w-48 bg-muted rounded mb-2" /><div className="h-3 w-72 bg-muted rounded" /></CardContent>
            </Card>
          ))}
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell title="인사이트" description="자동 이상치 감지 · 트렌드 분석 · 효율 경고">
      {/* 요약 배지 */}
      <div className="flex flex-wrap gap-2">
        {(["critical", "warning", "opportunity", "info"] as InsightLevel[]).map((level) => {
          const count = countByLevel[level] || 0;
          if (count === 0) return null;
          const cfg = levelConfig[level];
          return (
            <span key={level} className={cn("text-xs font-medium px-2.5 py-1 rounded-full", cfg.badge)}>
              {cfg.icon} {cfg.badgeLabel} {count}건
            </span>
          );
        })}
      </div>

      {/* 인사이트 카드 */}
      <div className="space-y-3">
        {insights.map((insight, i) => {
          const cfg = levelConfig[insight.level];
          return (
            <Card key={i} className={cn("border-l-4", cfg.border)}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <span className="text-lg">{cfg.icon}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-semibold text-sm">{insight.title}</h4>
                      <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded", cfg.badge)}>{cfg.badgeLabel}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{insight.description}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground">
            💡 규칙 기반 자동 감지: ROAS &lt; 1 즉시경고, ±30% 일변동 이상치, 3일 연속 트렌드, 데이터 누락 알림, 매출/광고비 효율 분석.
          </p>
        </CardContent>
      </Card>
    </PageShell>
  );
}
