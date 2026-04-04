"use client";

import { Suspense, useMemo } from "react";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { useFilterParams, useFetch } from "@/hooks/use-dashboard-data";
import { BRAND_LABELS, CHANNEL_LABELS, type DailySales, type DailyAdSpend } from "@/lib/types";
import { useConfig } from "@/hooks/use-config";
import { formatCurrency } from "@/lib/utils";

interface Insight {
  type: "warning" | "info" | "success";
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

    if (!brand || brand === "all") {
      // 브랜드별 분석
      const brandRevenue: Record<string, number> = {};
      const brandSpend: Record<string, number> = {};
      const brandConvValue: Record<string, number> = {};

      for (const r of salesData) {
        brandRevenue[r.brand] = (brandRevenue[r.brand] || 0) + (r.revenue || 0);
      }
      for (const r of adsData) {
        brandSpend[r.brand] = (brandSpend[r.brand] || 0) + (r.spend || 0);
        brandConvValue[r.brand] = (brandConvValue[r.brand] || 0) + (r.conversion_value || 0);
      }

      for (const b of Object.keys(brandSpend)) {
        const spend = brandSpend[b] || 0;
        const convVal = brandConvValue[b] || 0;
        const roas = spend > 0 ? convVal / spend : 0;
        const label = brandMap[b]?.label || BRAND_LABELS[b] || b;

        if (roas > 0 && roas < 1) {
          results.push({
            type: "warning",
            title: `${label} ROAS ${roas.toFixed(2)}x — 광고비 대비 전환 매출 부족`,
            description: `광고비 ${formatCurrency(spend)} 대비 전환 매출 ${formatCurrency(convVal)}. 캠페인 효율 점검 필요.`,
          });
        } else if (roas >= 3) {
          results.push({
            type: "success",
            title: `${label} ROAS ${roas.toFixed(2)}x — 우수`,
            description: `광고비 ${formatCurrency(spend)}으로 전환 매출 ${formatCurrency(convVal)} 달성.`,
          });
        }
      }
    }

    // 채널별 이상치 탐지
    const channelSpend: Record<string, number[]> = {};
    for (const r of adsData) {
      if (brand && brand !== "all" && r.brand !== brand) continue;
      if (!channelSpend[r.channel]) channelSpend[r.channel] = [];
      channelSpend[r.channel].push(r.spend || 0);
    }

    for (const [ch, spends] of Object.entries(channelSpend)) {
      if (spends.length < 7) continue;
      const avg = spends.reduce((s, v) => s + v, 0) / spends.length;
      const last = spends[spends.length - 1];
      const change = avg > 0 ? ((last - avg) / avg) * 100 : 0;
      const label = channelMap[ch]?.label || CHANNEL_LABELS[ch] || ch;

      if (Math.abs(change) >= 50) {
        results.push({
          type: "warning",
          title: `${label} 최근 광고비 ${change > 0 ? "급증" : "급감"} (${change > 0 ? "+" : ""}${change.toFixed(0)}%)`,
          description: `평균 ${formatCurrency(Math.round(avg))}/일 대비 최근 ${formatCurrency(last)}/일. 의도된 변경인지 확인.`,
        });
      }
    }

    // 매출 없는 날 감지
    const salesDates = new Set(salesData.map((r) => r.date));
    const adsDates = new Set(adsData.map((r) => r.date));
    const adOnlyDates = Array.from(adsDates).filter((d) => !salesDates.has(d));
    if (adOnlyDates.length > 0 && adOnlyDates.length <= 5) {
      results.push({
        type: "info",
        title: `광고비는 있지만 매출 데이터 없는 날짜 ${adOnlyDates.length}일`,
        description: `${adOnlyDates.slice(0, 3).join(", ")}${adOnlyDates.length > 3 ? " 외" : ""}. 매출 엑셀 업로드 필요.`,
      });
    }

    if (results.length === 0) {
      results.push({
        type: "info",
        title: "특이사항 없음",
        description: "선택한 기간에 주목할 만한 이상치나 경고가 없습니다.",
      });
    }

    return results;
  }, [data, brand, brandMap, channelMap]);

  const iconMap = {
    warning: "⚠️",
    info: "ℹ️",
    success: "✅",
  };

  const colorMap = {
    warning: "border-l-amber-500 bg-amber-500/5",
    info: "border-l-blue-500 bg-blue-500/5",
    success: "border-l-emerald-500 bg-emerald-500/5",
  };

  if (loading) {
    return (
      <PageShell title="인사이트" description="Rule-based 자동 분석">
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="p-4 animate-pulse">
              <CardContent className="p-0">
                <div className="h-4 w-48 bg-muted rounded mb-2" />
                <div className="h-3 w-72 bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell title="인사이트" description="Rule-based 자동 분석">
      <div className="space-y-3">
        {insights.map((insight, i) => (
          <Card key={i} className={`border-l-4 ${colorMap[insight.type]}`}>
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <span className="text-lg">{iconMap[insight.type]}</span>
                <div>
                  <h4 className="font-semibold text-sm">{insight.title}</h4>
                  <p className="text-sm text-muted-foreground mt-1">{insight.description}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground">
            💡 이 인사이트는 규칙 기반(Rule-based)으로 자동 생성됩니다. ROAS &lt; 1 경고, 광고비 ±50% 이상 변동 감지, 매출 누락일 알림 등을 포함합니다.
          </p>
        </CardContent>
      </Card>
    </PageShell>
  );
}
