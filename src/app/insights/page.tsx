"use client";

import { Suspense } from "react";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { useFilterParams, useFetch } from "@/hooks/use-dashboard-data";
import { cn } from "@/lib/utils";

type InsightType = "critical" | "warning" | "opportunity" | "info";

interface Insight {
  type: InsightType;
  text: string;
  detail?: string;
  actions?: string[];
}

export default function InsightsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">Loading...</div>}>
      <InsightsInner />
    </Suspense>
  );
}

function InsightsInner() {
  const { brand, from, to } = useFilterParams();
  const { data, loading } = useFetch<{ insights: Insight[] }>(
    `/api/insights?from=${from}&to=${to}&brand=${brand}`
  );

  const insights = data?.insights || [];

  const levelConfig: Record<InsightType, { icon: string; border: string; badge: string; badgeLabel: string }> = {
    critical: { icon: "🔴", border: "border-l-red-500 bg-red-500/5", badge: "bg-red-500/10 text-red-600", badgeLabel: "즉시 대응" },
    warning: { icon: "🟡", border: "border-l-amber-500 bg-amber-500/5", badge: "bg-amber-500/10 text-amber-600", badgeLabel: "주의" },
    opportunity: { icon: "🟢", border: "border-l-emerald-500 bg-emerald-500/5", badge: "bg-emerald-500/10 text-emerald-600", badgeLabel: "기회" },
    info: { icon: "🔵", border: "border-l-blue-500 bg-blue-500/5", badge: "bg-blue-500/10 text-blue-600", badgeLabel: "참고" },
  };

  const countByLevel = insights.reduce((acc, i) => {
    acc[i.type] = (acc[i.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  if (loading) {
    return (
      <PageShell title="인사이트" description="자동 이상치 감지 · 트렌드 분석 · 효율 경고 · 원인 분석">
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
    <PageShell title="인사이트" description="자동 이상치 감지 · 트렌드 분석 · 효율 경고 · 원인 분석">
      {/* Summary badges */}
      <div className="flex flex-wrap gap-2">
        {(["critical", "warning", "opportunity", "info"] as InsightType[]).map((level) => {
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

      {/* Insight cards */}
      <div className="space-y-3">
        {insights.length === 0 && (
          <Card className="border-l-4 border-l-blue-500 bg-blue-500/5">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <span className="text-lg">{levelConfig.info.icon}</span>
                <div>
                  <h4 className="font-semibold text-sm">특이사항 없음</h4>
                  <p className="text-sm text-muted-foreground">선택한 기간에 주목할 만한 이상치나 경고가 없습니다.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {insights.map((insight, i) => {
          const cfg = levelConfig[insight.type];
          return (
            <Card key={i} className={cn("border-l-4", cfg.border)}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <span className="text-lg flex-shrink-0">{cfg.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h4 className="font-semibold text-sm">{insight.text}</h4>
                      <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap", cfg.badge)}>
                        {cfg.badgeLabel}
                      </span>
                    </div>

                    {insight.detail && (
                      <p className="text-sm text-muted-foreground whitespace-pre-line mb-2">{insight.detail}</p>
                    )}

                    {insight.actions && insight.actions.length > 0 && (
                      <div className="mt-2 space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">권장 액션:</p>
                        <ul className="space-y-0.5">
                          {insight.actions.map((action, j) => (
                            <li key={j} className="text-xs text-muted-foreground flex items-start gap-1.5">
                              <span className="text-primary mt-0.5">&bull;</span>
                              <span>{action}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
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
            💡 규칙 기반 자동 감지: ROAS &lt; 1 적자채널, 전체 ROAS 목표 미달, 전환율/장바구니 이탈률, 매출 15%+ 하락 시 브랜드/채널/제품별 원인 분석.
          </p>
        </CardContent>
      </Card>
    </PageShell>
  );
}
