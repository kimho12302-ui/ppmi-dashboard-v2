"use client";

import { useState } from "react";
import { useFetch } from "@/hooks/use-dashboard-data";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import { BRAND_LABELS } from "@/lib/types";

interface PacingData {
  month: string;
  brand: string;
  daysInMonth: number;
  daysElapsed: number;
  daysRemaining: number;
  dateProgress: number;
  hasTarget: boolean;
  target: { revenue: number; ad: number; roas: number; adRatio: number };
  actual: { revenue: number; orders: number; ad: number; roas: number; adRatio: number };
  achievement: { revenue: number; ad: number; roas: number };
  remaining: { revenue: number; ad: number; reqDailyRevenue: number; reqDailyAd: number; dailyAvgRevenue: number; dailyAvgAd: number };
  paceStatus: "ahead" | "on_track" | "behind" | "n/a";
  weekly: {
    week: string; days: number; startDay: number; endDay: number;
    targetRevenue: number; actualRevenue: number; revAchievement: number;
    targetAd: number; actualAd: number; adRatio: number; state: string;
  }[];
  perBrand: {
    brand: string; targetRevenue: number; actualRevenue: number; revAchievement: number;
    targetAd: number; actualAd: number; adConsumption: number;
    actualRoas: number; targetRoas: number; actualAdRatio: number; targetAdRatio: number;
  }[];
}

const PACE = {
  ahead: { label: "목표 초과 페이스", cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30", dot: "#10b981" },
  on_track: { label: "정상 페이스", cls: "bg-amber-500/10 text-amber-600 border-amber-500/30", dot: "#f59e0b" },
  behind: { label: "페이스 미달", cls: "bg-red-500/10 text-red-600 border-red-500/30", dot: "#ef4444" },
  "n/a": { label: "데이터 부족", cls: "bg-muted text-muted-foreground border-border", dot: "#6b7280" },
};

function pct(v: number) { return `${(v * 100).toFixed(0)}%`; }

// 달성률 막대 + 날짜진행률 기준선(매출/광고비에서 페이스 판단용)
function ProgressBar({ value, marker, color }: { value: number; marker?: number; color: string }) {
  const w = Math.min(100, Math.max(0, value * 100));
  return (
    <div className="relative h-2.5 bg-muted rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all" style={{ width: `${w}%`, backgroundColor: color }} />
      {marker !== undefined && (
        <div className="absolute top-0 h-full w-0.5 bg-foreground/60" style={{ left: `${Math.min(100, marker * 100)}%` }} title="날짜 진행률" />
      )}
    </div>
  );
}

export function PacingSection({ brand }: { brand: string }) {
  const b = brand || "all";
  const [open, setOpen] = useState(true);
  const { data, loading } = useFetch<PacingData>(`/api/pacing?brand=${b}`);

  if (loading) {
    return <Card className="animate-pulse"><CardContent className="p-5"><div className="h-5 w-40 bg-muted rounded mb-3" /><div className="h-24 bg-muted rounded" /></CardContent></Card>;
  }
  if (!data || !data.hasTarget) {
    return (
      <Card><CardContent className="p-4 text-sm text-muted-foreground">
        이번 달({data?.month}) 목표가 없습니다. 설정에서 월 목표를 등록하면 목표 대비 페이싱이 표시됩니다.
      </CardContent></Card>
    );
  }

  const pace = PACE[data.paceStatus];
  const { target, actual, achievement, remaining, dateProgress } = data;
  const monthLabel = `${Number(data.month.slice(5))}월`;

  const rows = [
    { key: "매출", target: target.revenue, actual: actual.revenue, ach: achievement.revenue, marker: dateProgress, fmt: formatCurrency, color: "#2563eb" },
    { key: "광고비", target: target.ad, actual: actual.ad, ach: achievement.ad, marker: dateProgress, fmt: formatCurrency, color: "#dc2626", invert: true },
    { key: "ROAS", target: target.roas, actual: actual.roas, ach: achievement.roas, marker: undefined, fmt: (v: number) => `${v.toFixed(2)}x`, color: "#10b981" },
    { key: "광고비 비중", target: target.adRatio, actual: actual.adRatio, ach: target.adRatio > 0 ? actual.adRatio / target.adRatio : 0, marker: undefined, fmt: (v: number) => pct(v), color: "#8b5cf6", invert: true },
  ];

  return (
    <Card className="border-l-4" style={{ borderLeftColor: pace.dot }}>
      <CardContent className="p-5 space-y-4">
        <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between flex-wrap gap-2 text-left">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">{open ? "▾" : "▸"}</span>
            <h3 className="font-semibold">목표 대비 페이싱 · {monthLabel}</h3>
            <span className={`text-xs px-2 py-0.5 rounded-full border ${pace.cls}`}>{pace.label}</span>
            {!open && <span className="text-xs text-muted-foreground">매출 달성 {pct(achievement.revenue)}</span>}
          </div>
          <div className="text-xs text-muted-foreground">
            {monthLabel} {data.daysElapsed}/{data.daysInMonth}일 경과 ({pct(dateProgress)}) · 잔여 {data.daysRemaining}일
          </div>
        </button>

        {open && <>
        {/* 광고예산 초과 경고 (의사결정 즉시 신호) */}
        {remaining.ad < 0 && (
          <div className="rounded-lg border-l-4 border-red-500 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-600">
            ⚠ 광고예산 초과: {formatCurrency(Math.abs(remaining.ad))} — 목표 {formatCurrency(target.ad)} 대비 {pct(target.ad > 0 ? actual.ad / target.ad : 0)} 소진 (날짜 진행 {pct(dateProgress)})
          </div>
        )}
        {/* 날짜 진행률 바 */}
        <ProgressBar value={dateProgress} color="#94a3b8" />

        {/* 지표별 목표 vs 현황 vs 달성률 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
          {rows.map((r) => {
            const behind = r.marker !== undefined && !r.invert && r.ach < r.marker * 0.9;
            return (
              <div key={r.key} className="space-y-1">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-medium">{r.key}</span>
                  <span className="text-xs text-muted-foreground">
                    <span className="text-foreground font-medium">{r.fmt(r.actual)}</span> / {r.fmt(r.target)}
                    <span className={`ml-2 font-semibold ${behind ? "text-red-500" : "text-foreground"}`}>{pct(r.ach)}</span>
                  </span>
                </div>
                <ProgressBar value={r.ach} marker={r.marker} color={r.color} />
              </div>
            );
          })}
        </div>

        {/* 잔여 + 필요 일런레이트 */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-1 border-t">
          <div>
            <p className="text-[11px] text-muted-foreground">목표까지 잔여 매출</p>
            <p className="text-sm font-bold">{formatCurrency(remaining.revenue)}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">필요 일매출 (잔여 {data.daysRemaining}일)</p>
            <p className="text-sm font-bold text-blue-600">{formatCurrency(Math.round(remaining.reqDailyRevenue))}
              <span className="text-[10px] text-muted-foreground font-normal"> / 현재 {formatCurrency(Math.round(remaining.dailyAvgRevenue))}</span>
            </p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">잔여 광고예산</p>
            <p className={`text-sm font-bold ${remaining.ad < 0 ? "text-red-500" : ""}`}>{formatCurrency(remaining.ad)}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">가용 일광고비</p>
            <p className="text-sm font-bold text-red-600">{formatCurrency(Math.round(remaining.reqDailyAd))}
              <span className="text-[10px] text-muted-foreground font-normal"> / 현재 {formatCurrency(Math.round(remaining.dailyAvgAd))}</span>
            </p>
          </div>
        </div>

        {/* 주차별 목표 대비 실적 */}
        {data.weekly && data.weekly.length > 0 && (
          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground mb-2">주차별 매출 (목표 대비)</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b">
                    <th className="text-left py-1 pr-2">주차</th>
                    <th className="text-right py-1 px-2">목표</th>
                    <th className="text-right py-1 px-2">실적</th>
                    <th className="text-right py-1 px-2">달성</th>
                    <th className="text-right py-1 pl-2">광고비중</th>
                  </tr>
                </thead>
                <tbody>
                  {data.weekly.map((wk) => (
                    <tr key={wk.week} className={`border-b border-border/40 ${wk.state === "current" ? "bg-amber-500/5" : wk.state === "future" ? "opacity-50" : ""}`}>
                      <td className="py-1 pr-2 font-medium">{wk.week} <span className="text-muted-foreground">({wk.startDay}~{wk.endDay}일)</span>{wk.state === "current" && <span className="ml-1 text-amber-600">●</span>}</td>
                      <td className="text-right py-1 px-2 text-muted-foreground">{formatCurrency(wk.targetRevenue)}</td>
                      <td className="text-right py-1 px-2 font-medium">{formatCurrency(wk.actualRevenue)}</td>
                      <td className={`text-right py-1 px-2 font-semibold ${wk.state !== "future" && wk.revAchievement < 0.9 ? "text-red-500" : wk.revAchievement >= 1 ? "text-emerald-600" : ""}`}>
                        {wk.state === "future" ? "-" : pct(wk.revAchievement)}
                      </td>
                      <td className="text-right py-1 pl-2 text-muted-foreground">{wk.actualRevenue > 0 ? pct(wk.adRatio) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 전체 보기일 때 브랜드별 미니 페이싱 */}
        {b === "all" && data.perBrand.length > 0 && (
          <div className="pt-2 border-t space-y-2">
            <p className="text-xs text-muted-foreground">브랜드별 매출 달성률 (마커=날짜진행률 {pct(dateProgress)})</p>
            {data.perBrand.filter(pb => pb.targetRevenue > 0).map((pb) => {
              const roasOk = pb.targetRoas > 0 && pb.actualRoas >= pb.targetRoas * 0.9;
              return (
              <div key={pb.brand} className="flex items-center gap-3 text-sm">
                <span className="w-16 flex-shrink-0 text-xs">{BRAND_LABELS[pb.brand] || pb.brand}</span>
                <div className="flex-1"><ProgressBar value={pb.revAchievement} marker={dateProgress} color={pb.revAchievement >= dateProgress * 0.9 ? "#10b981" : "#ef4444"} /></div>
                <span className="w-12 text-right text-xs font-medium">{pct(pb.revAchievement)}</span>
                {/* ROAS 목표 대비 (매출 달성했어도 ROAS 미달이면 크리에이티브 점검 신호) */}
                <span className={`w-24 text-right text-[11px] ${pb.targetRoas > 0 ? (roasOk ? "text-emerald-600" : "text-red-500") : "text-muted-foreground"}`} title="실제 ROAS / 목표 ROAS">
                  ROAS {pb.actualRoas.toFixed(1)}/{pb.targetRoas > 0 ? pb.targetRoas.toFixed(1) : "-"}x
                </span>
                <span className="w-28 text-right text-[11px] text-muted-foreground">{formatCurrency(pb.actualRevenue)}/{formatCurrency(pb.targetRevenue)}</span>
              </div>
            );})}
          </div>
        )}
        </>}
      </CardContent>
    </Card>
  );
}
