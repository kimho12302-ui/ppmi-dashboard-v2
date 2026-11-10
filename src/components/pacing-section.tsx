"use client";

import { useState } from "react";
import { useFetch } from "@/hooks/use-dashboard-data";
import { pacingUrl } from "@/lib/api-urls";
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
  /** 판매·광고 원장이 들어온 마지막 날짜와, 이 달 안에서 들어온 날 수(일평균의 분모). */
  salesThrough: string | null;
  adThrough: string | null;
  salesDays: number;
  adDays: number;
  salesProgress: number;
  adProgress: number;
  salesDaysRemaining: number;
  adDaysRemaining: number;
  minJudgeDays: number;
  hasTarget: boolean;
  target: { revenue: number; ad: number; roas: number; adRatio: number };
  /** ad = 실제 집행(오늘 장중 포함). adThroughSum = 광고비 원장 마지막 날까지(예산 비교용).
   *  adToSales = 판매 원장 마지막 날까지(roas·adRatio 의 분모). */
  actual: { revenue: number; revenueOwn: number; gonggu: number; orders: number; ad: number; adThroughSum?: number; adToSales?: number; roas: number; adRatio: number };
  /** ad = 실제 돈 기준 소진율, adThrough = 광고비 원장 마지막 날까지 소진율(집계 진행률과 비교) */
  achievement: { revenue: number; ad: number; adThrough?: number; roas: number };
  remaining: { revenue: number; ad: number; adThrough?: number; reqDailyRevenue: number; reqDailyAd: number; dailyAvgRevenue: number; dailyAvgAd: number };
  paceStatus: "ahead" | "on_track" | "behind" | "early" | "n/a";
  weekly: {
    week: string; days: number; startDay: number; endDay: number;
    targetRevenue: number; actualRevenue: number; revAchievement: number;
    targetAd: number; actualAd: number; adRatio: number; state: string;
  }[];
  perBrand: {
    brand: string; targetRevenue: number; actualRevenue: number; actualRevenueOwn: number; gonggu: number;
    revAchievement: number;
    salesThrough?: string | null;
    targetAd: number; actualAd: number; adConsumption: number; adConsumptionThrough?: number;
    actualRoas: number; actualRoasOwn?: number; targetRoas: number; actualAdRatio: number; targetAdRatio: number;
  }[];
}

const PACE = {
  ahead: { label: "목표 초과 페이스", cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30", dot: "#10b981" },
  on_track: { label: "정상 페이스", cls: "bg-amber-500/10 text-amber-600 border-amber-500/30", dot: "#f59e0b" },
  behind: { label: "페이스 미달", cls: "bg-red-500/10 text-red-600 border-red-500/30", dot: "#ef4444" },
  early: { label: "초반 · 판단 보류", cls: "bg-muted text-muted-foreground border-border", dot: "#6b7280" },
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

// from/to는 페이지에서 선택한 기간. 이 섹션은 월 목표 기준이라 달력 월에 고정되는데,
// 선택 기간이 그와 다르면 Overview KPI 카드와 숫자가 어긋나 보이므로 그 사실을 명시한다.
// (2026-11-03 Overview 맨 위에서 인사이트 화면 맨 위로 옮겼다.)
export function PacingSection({ brand, from, to }: { brand: string; from?: string; to?: string }) {
  const b = brand || "all";
  const [open, setOpen] = useState(true);
  const { data, loading } = useFetch<PacingData>(pacingUrl(b));

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

  const pace = PACE[data.paceStatus] || PACE["n/a"];
  const { target, actual, achievement, remaining, dateProgress } = data;
  // 마커(기준선)는 판매·광고비가 들어온 날 기준. 달력 진행률과 비교하면 동기화 지연만큼 늘 뒤처져 보인다.
  const salesProgress = data.salesProgress ?? dateProgress;
  const adProgress = data.adProgress ?? dateProgress;
  const early = data.paceStatus === "early";
  const monthLabel = `${Number(data.month.slice(5))}월`;
  const monthStart = `${data.month}-01`;
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

  // 판정 문장: "달성 가능한가"를 필요 런레이트 대비 현재 페이스로 답한다.
  const verdict = (() => {
    const { reqDailyRevenue: req, dailyAvgRevenue: avg } = data.remaining;
    const short = formatCurrency(Math.max(0, target.revenue - actual.revenue));
    if (achievement.revenue >= 1) {
      return { cls: "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        text: `${monthLabel} 목표 달성. 매출 ${formatCurrency(actual.revenue)} (목표 ${pct(achievement.revenue)}).` };
    }
    if (data.salesDaysRemaining <= 0) {
      return { cls: "border-red-500 bg-red-500/10 text-red-600",
        text: `${monthLabel} 종료. 목표 ${pct(achievement.revenue)}로 마감, ${short} 미달.` };
    }
    // ★ 판매가 며칠치밖에 안 들어온 초반에는 "달성 가능/불가" 를 말하지 않는다(2026-11-03).
    //   11-03 에 3일치(실제 판매는 2일치)로 "사실상 달성 불가" 빨간 문장이 떴다.
    if (early) {
      return { cls: "border-muted bg-muted/50 text-muted-foreground",
        text: `${monthLabel} 판매 ${data.salesDays}일치 집계${data.salesThrough ? `(${md(data.salesThrough)}까지)` : ""} · 목표까지 ${short}. 초반이라 판단 보류 (판매가 ${data.minJudgeDays}일 이상 들어오면 달성 가능 여부를 판정합니다).` };
    }
    if (avg <= 0) {
      return { cls: "border-muted bg-muted/50 text-muted-foreground",
        text: `${monthLabel} 잔여 ${data.salesDaysRemaining}일. 목표까지 ${short} 남았습니다.` };
    }
    const mult = req / avg;
    const base = `${monthLabel} 잔여 ${data.salesDaysRemaining}일 · 목표까지 ${short} · 필요 일매출 ${formatCurrency(req)} (판매 ${data.salesDays}일치 일평균 ${formatCurrency(avg)})`;
    if (mult <= 1.1) {
      return { cls: "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        text: `${base}. 현재 페이스로 달성 가능합니다.` };
    }
    if (mult <= 3) {
      return { cls: "border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-500",
        text: `${base}. 일매출을 ${mult.toFixed(1)}배로 올려야 달성합니다.` };
    }
    return { cls: "border-red-500 bg-red-500/10 text-red-600",
      text: `${base}. 필요 페이스가 현재의 ${mult.toFixed(0)}배로 사실상 달성 불가입니다. 남은 예산을 다음 달로 넘길지 판단이 필요합니다.` };
  })();
  // 선택 기간이 이 달 시작과 다르면 아래 KPI와 스코프가 다르다는 뜻.
  const scopeDiffers = !!from && from !== monthStart;

  // ★ 행마다 분자·분모를 같은 날까지로 맞춘다(QA 2회차, 2026-11-10).
  //   광고비 막대: 광고비 원장 마지막 날(adThrough)까지 집행 ÷ 목표, 세로선 = 같은 날까지의 집계 진행률.
  //     오늘 장중 집행은 비교에 넣지 않는다(실제 돈은 아래 「잔여 광고예산」·초과 경고가 오늘 포함으로 보여 준다).
  //   ROAS·광고비 비중: 매출이 들어온 날(salesThrough)까지의 광고비로 나눈 값(서버 계산).
  const adCompare = actual.adThroughSum ?? actual.ad;
  const adCompareAch = achievement.adThrough ?? achievement.ad;
  const salesNote = data.salesThrough ? ` (판매 ${md(data.salesThrough)}까지)` : "";
  const rows = [
    { key: "매출", target: target.revenue, actual: actual.revenue, ach: achievement.revenue, marker: salesProgress, fmt: formatCurrency, color: "#2563eb" },
    { key: `광고비${data.adThrough ? ` (${md(data.adThrough)}까지)` : ""}`, target: target.ad, actual: adCompare, ach: adCompareAch, marker: adProgress, fmt: formatCurrency, color: "#dc2626", invert: true },
    { key: `ROAS${salesNote}`, target: target.roas, actual: actual.roas, ach: achievement.roas, marker: undefined, fmt: (v: number) => `${v.toFixed(2)}x`, color: "#10b981" },
    { key: `광고비 비중${salesNote}`, target: target.adRatio, actual: actual.adRatio, ach: target.adRatio > 0 ? actual.adRatio / target.adRatio : 0, marker: undefined, fmt: (v: number) => pct(v), color: "#8b5cf6", invert: true },
  ];

  return (
    <Card className="border-l-4" style={{ borderLeftColor: pace.dot }}>
      <CardContent className="p-5 space-y-4">
        <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between flex-wrap gap-2 text-left">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">{open ? "▾" : "▸"}</span>
            <h3 className="font-semibold">목표 대비 페이싱 · {monthLabel} 누적</h3>
            <span className="text-xs text-muted-foreground">{monthStart} ~ {data.salesThrough && data.salesThrough >= monthStart ? data.salesThrough : "판매 미집계"}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full border ${pace.cls}`}>{pace.label}</span>
            {!open && <span className="text-xs text-muted-foreground">매출 달성 {pct(achievement.revenue)}</span>}
          </div>
          <div className="text-xs text-muted-foreground">
            {monthLabel} {data.daysElapsed}/{data.daysInMonth}일 경과 · 판매 {data.salesDays}일치·광고비 {data.adDays}일치 집계 · 잔여 {data.salesDaysRemaining}일
          </div>
        </button>

        {/* ★ 판정 한 줄. 대시보드는 이미 "필요 일매출 vs 현재 일평균"을 계산해 놓고도
            중간 크기 타일 하나로 다른 20개 숫자와 나란히 두어 결론이 묻혔다(2026-07 사용성 리뷰).
            열었을 때 가장 먼저 읽히는 자리에 문장으로 올린다. */}
        <div className={`rounded-lg px-3 py-2.5 text-sm font-medium border-l-4 ${verdict.cls}`}>
          {verdict.text}
        </div>

        {scopeDiffers && (
          <div className="rounded-lg border-l-4 border-amber-500 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-500">
            이 섹션은 <b>{monthLabel} 누적</b> 기준입니다. 선택하신 기간({from} ~ {to})과 달라 Overview &ldquo;선택 기간 실적&rdquo;의 숫자와 일치하지 않습니다.
          </div>
        )}

        {data.actual.gonggu > 0 && (
          <div className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            매출은 <b>공구 포함</b> 기준입니다 (목표가 공구 포함으로 설정됨).
            자체 {formatCurrency(data.actual.revenueOwn)} + 공구 {formatCurrency(data.actual.gonggu)} = {formatCurrency(data.actual.revenue)}
          </div>
        )}

        {open && <>
        {/* 광고예산 초과 경고 (의사결정 즉시 신호) */}
        {remaining.ad < 0 && (
          <div className="rounded-lg border-l-4 border-red-500 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-600">
            ⚠ 광고예산 초과: {formatCurrency(Math.abs(remaining.ad))}, 목표 {formatCurrency(target.ad)} 대비 {pct(target.ad > 0 ? actual.ad / target.ad : 0)} 소진 (광고비 집계 {data.adDays}일치, 진행 {pct(adProgress)})
          </div>
        )}
        {/* 날짜 진행률 바: 판매가 들어온 날 기준 */}
        <ProgressBar value={salesProgress} color="#94a3b8" />

        {/* 지표별 목표 vs 현황 vs 달성률 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
          {rows.map((r) => {
            const behind = !early && r.marker !== undefined && !r.invert && r.ach < r.marker * 0.9;
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
            <p className="text-[11px] text-muted-foreground">필요 일매출 (잔여 {data.salesDaysRemaining}일)</p>
            <p className="text-sm font-bold text-blue-600">{formatCurrency(Math.round(remaining.reqDailyRevenue))}
              <span className="text-[10px] text-muted-foreground font-normal"> / 현재 {formatCurrency(Math.round(remaining.dailyAvgRevenue))} ({data.salesDays}일 평균)</span>
            </p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">잔여 광고예산</p>
            <p className={`text-sm font-bold ${remaining.ad < 0 ? "text-red-500" : ""}`}>{formatCurrency(remaining.ad)}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">가용 일광고비</p>
            <p className="text-sm font-bold text-red-600">{formatCurrency(Math.round(remaining.reqDailyAd))}
              <span className="text-[10px] text-muted-foreground font-normal"> / 현재 {formatCurrency(Math.round(remaining.dailyAvgAd))} ({data.adDays}일 평균)</span>
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
                      {/* 진행 중인 주는 주 전체 목표와 비교하면 늘 미달로 보여 빨갛게 칠하지 않는다. */}
                      <td className={`text-right py-1 px-2 font-semibold ${wk.state === "past" && wk.revAchievement < 0.9 ? "text-red-500" : wk.revAchievement >= 1 ? "text-emerald-600" : ""}`}>
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

        {/* 묶음 보기(전체·펫)일 때 브랜드별 미니 페이싱 */}
        {(b === "all" || b === "pet") && data.perBrand.length > 0 && (
          <div className="pt-2 border-t space-y-2">
            <p className="text-xs text-muted-foreground">
              브랜드별 매출 달성률 (마커=판매 집계 진행률 {pct(salesProgress)}) · 목표는 <b>공구 포함</b> 기준 · ROAS 는 브랜드마다 판매가 들어온 날까지의 광고비로 나눔{early ? " · 초반이라 색 판정 보류" : ""}
            </p>
            {data.perBrand.filter(pb => pb.targetRevenue > 0).map((pb) => {
              const roasOk = pb.targetRoas > 0 && pb.actualRoas >= pb.targetRoas * 0.9;
              const barColor = early ? "#94a3b8" : pb.revAchievement >= salesProgress * 0.9 ? "#10b981" : "#ef4444";
              return (
              <div key={pb.brand} className="flex items-center gap-3 text-sm">
                <span className="w-16 flex-shrink-0 text-xs">{BRAND_LABELS[pb.brand] || pb.brand}</span>
                <div className="flex-1"><ProgressBar value={pb.revAchievement} marker={salesProgress} color={barColor} /></div>
                <span className="w-12 text-right text-xs font-medium">{pct(pb.revAchievement)}</span>
                {/* ROAS 목표 대비 (매출 달성했어도 ROAS 미달이면 크리에이티브 점검 신호)
                    공구가 있는 브랜드는 자체매출 기준 ROAS를 괄호로 병기한다 — 공구는 광고와 무관해
                    포함 기준만 보면 광고 성과를 과대평가하게 된다(밸런스랩 7월: 9.6x vs 자체 1.8x). */}
                <span className={`w-32 text-right text-[11px] ${pb.targetRoas > 0 && !early ? (roasOk ? "text-emerald-600" : "text-red-500") : "text-muted-foreground"}`}
                  title={`${pb.gonggu > 0 ? "실제 ROAS(공구 포함) / 목표 ROAS · 괄호=자체매출 기준(광고 성과)" : "실제 ROAS / 목표 ROAS"}${pb.salesThrough ? ` · 판매 ${md(pb.salesThrough)}까지의 광고비 기준` : ""}`}>
                  ROAS {pb.actualRoas.toFixed(1)}/{pb.targetRoas > 0 ? pb.targetRoas.toFixed(1) : "-"}x
                  {pb.gonggu > 0 && <span className="text-muted-foreground"> (자체 {(pb.actualRoasOwn ?? 0).toFixed(1)}x)</span>}
                </span>
                <span className="w-28 text-right text-[11px] text-muted-foreground">{formatCurrency(pb.actualRevenue)}/{formatCurrency(pb.targetRevenue)}</span>
                {/* 공구가 있는 브랜드는 자체매출을 병기한다. 밸런스랩은 매출의 66~97%가 공구라
                    자체매출만 보면 브랜드 성과를 심하게 과소 표시한다. */}
                <span className="w-32 text-right text-[11px] text-muted-foreground">
                  {pb.gonggu > 0
                    ? `자체 ${formatCurrency(pb.actualRevenueOwn)} + 공구 ${formatCurrency(pb.gonggu)}`
                    : ""}
                </span>
              </div>
            );})}
          </div>
        )}
        </>}
      </CardContent>
    </Card>
  );
}
