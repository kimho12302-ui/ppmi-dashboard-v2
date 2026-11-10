"use client";

// 네이버 검색광고 캠페인별 주간 추이 스몰 멀티플 (2026-11-03).
// 판단: 캠페인이 많을 때 "요즘 눈에 띄게 나빠진 캠페인" 만 골라 보기.
// 강조 규칙은 src/lib/judge-charts.ts 상수로 정하고, 카드 아래에 같은 상수로 문장을 만든다.
import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useFetch } from "@/hooks/use-dashboard-data";
import { formatCurrency, cn } from "@/lib/utils";
import {
  judgeMultiple, weekValue,
  MULTIPLE_WEEKS, MULTIPLE_RECENT_WEEKS, MULTIPLE_DROP_PCT, MULTIPLE_MIN_COST,
  type MultipleMetric, type WeekCell,
} from "@/lib/judge-charts";
import { DeferredResponsiveContainer } from "@/components/deferred-chart";
import { NAVER_ROAS_UNTRUSTED_ACCOUNTS } from "@/lib/conversion-tracking";
import { LineChart, Line, YAxis, XAxis, ReferenceLine, Tooltip } from "recharts";

const ACCENT = "var(--sig-danger)";
const NEUTRAL = "var(--muted-foreground)";

// 밸런스랩 검색광고 계정의 전환매출은 장바구니 전환에 상품가가 붙어 부풀려져 있다
// (2026-11-02 원인 확정: add_to_cart 전환). 이 계정 캠페인은 ROAS 로 판단하지 않는다.
// 목록은 아래 「캠페인별 성과」 표와 같은 상수를 쓴다(src/lib/conversion-tracking.ts).
const ROAS_UNTRUSTED_ACCOUNTS = NAVER_ROAS_UNTRUSTED_ACCOUNTS;

interface Campaign {
  campaignId: string; campaignName: string; type: string; brand: string; account: string;
  cells: WeekCell[]; totalCost: number;
}
interface WeeklyResponse { weeks: string[]; campaigns: Campaign[]; collectedThrough: string | null; error?: string }

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const fmt = (v: number | null, metric: MultipleMetric) =>
  v == null ? "-" : metric === "roas" ? `${v.toFixed(1)}x` : formatCurrency(Math.round(v));

export function NaverCampaignMultiples({ brand, to }: { brand: string; to: string }) {
  const { data, loading, error } = useFetch<WeeklyResponse>(`/api/naver-campaign-weekly?brand=${brand || "all"}&to=${to}`);
  const [metricPick, setMetricPick] = useState<MultipleMetric | null>(null);

  const all = useMemo(() => data?.campaigns || [], [data]);
  const shown = useMemo(() => all.filter((c) => c.totalCost >= MULTIPLE_MIN_COST), [all]);
  const hidden = all.length - shown.length;
  const anyRoasUsable = shown.some((c) => !ROAS_UNTRUSTED_ACCOUNTS.has(c.account));
  const metric: MultipleMetric = metricPick ?? (anyRoasUsable ? "roas" : "cost");

  // ROAS 를 믿을 수 없는 계정의 타일은 같은 자리에 주간 비용 선을 그린다(2026-11-04). 판정(verdict)은 하지 않는다.
  // 비용과 ROAS 판정을 한 격자에서 섞으면 "강조 N개" 가 서로 다른 규칙의 합이 된다.
  const tiles = useMemo(() => shown.map((c) => {
    const roasBlocked = metric === "roas" && ROAS_UNTRUSTED_ACCOUNTS.has(c.account);
    const verdict = roasBlocked ? null : judgeMultiple(c.cells, metric);
    const shownMetric: MultipleMetric = roasBlocked ? "cost" : metric;
    const points = c.cells.map((x) => ({ week: x.week, v: weekValue(x, shownMetric), cost: x.cost }));
    return { c, roasBlocked, verdict, points, shownMetric };
  }), [shown, metric]);
  const blockedCount = tiles.filter((t) => t.roasBlocked).length;
  const flaggedCount = tiles.filter((t) => t.verdict?.flagged).length;

  const weeks = data?.weeks || [];
  const header = (
    <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
      <div>
        <h3 className="font-semibold">캠페인별 최근 {MULTIPLE_WEEKS}주 추이</h3>
        <p className="text-xs text-muted-foreground mt-0.5">가로 = 주(월요일 시작), 세로 = {metric === "roas" ? "주간 ROAS(네이버 신고 전환매출 ÷ 비용)" : "주간 비용(원)"}, 캠페인마다 축이 따로. 점선 = {MULTIPLE_WEEKS}주 평균</p>
        <p className="text-xs text-muted-foreground">판단: 캠페인이 많을 때 요즘 눈에 띄게 {metric === "roas" ? "효율이 나빠진" : "집행이 줄어든"} 캠페인만 골라내기</p>
      </div>
      <div data-tour="ads-naver-metric" className="flex gap-1 bg-muted rounded-md p-0.5">
        {(["roas", "cost"] as const).map((m) => (
          <button key={m} onClick={() => setMetricPick(m)} disabled={m === "roas" && !anyRoasUsable}
            className={cn("px-2 py-1 text-xs rounded disabled:opacity-40", metric === m ? "bg-card shadow-sm font-medium" : "text-muted-foreground")}>
            {m === "roas" ? "주간 ROAS(신고)" : "주간 비용"}
          </button>
        ))}
      </div>
    </div>
  );

  if (loading && !data) return <Card><CardContent className="p-4">{header}<div className="h-40 rounded bg-muted animate-pulse" /></CardContent></Card>;
  if (error || data?.error) return <Card><CardContent className="p-4">{header}<p className="text-sm text-muted-foreground">불러오지 못했습니다 ({error || data?.error})</p></CardContent></Card>;
  if (!tiles.length) return <Card><CardContent className="p-4">{header}<p className="text-sm text-muted-foreground">최근 {MULTIPLE_WEEKS}주에 비용 {formatCurrency(MULTIPLE_MIN_COST)} 이상 쓴 캠페인이 없습니다.</p></CardContent></Card>;

  return (
    <Card>
      <CardContent className="p-4">
        {header}
        <p className="text-sm mb-3">
          {flaggedCount > 0
            ? <><b style={{ color: ACCENT }}>{flaggedCount}개</b> 캠페인이 강조 규칙에 걸렸습니다 (캠페인 {tiles.length}개 중).</>
            : <>강조 규칙에 걸린 캠페인이 없습니다 (캠페인 {tiles.length}개).</>}
        </p>
        {/* 타일마다 반복하던 안내를 격자 위 한 줄로 모았다(2026-11-04). */}
        {blockedCount > 0 && (
          <p className="text-xs text-muted-foreground mb-3">
            밸런스랩 계정 캠페인 {blockedCount}개는 장바구니 전환이 매출로 잡혀 ROAS 를 믿을 수 없어 판단하지 않고 <b>주간 비용</b>으로 그립니다(타일에 「비용」 표시).
          </p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
          {tiles.map(({ c, roasBlocked, verdict, points, shownMetric }) => {
            const flagged = !!verdict?.flagged;
            return (
              <div key={c.campaignId}
                className={cn("rounded-lg border p-2 min-w-0", flagged ? "border-[var(--sig-danger-border)] bg-[var(--sig-danger-surface)]" : "border-border")}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium truncate" title={c.campaignName}>{c.campaignName}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">{roasBlocked ? "비용 · " : ""}{c.type}</span>
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {MULTIPLE_WEEKS}주 비용 {formatCurrency(c.totalCost)}
                  {verdict && <> · 최근 {MULTIPLE_RECENT_WEEKS}주 {fmt(verdict.recent, metric)} / {MULTIPLE_WEEKS}주 {fmt(verdict.base, metric)}</>}
                </div>
                {(
                  <DeferredResponsiveContainer width="100%" height={56}>
                    <LineChart data={points} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                      <XAxis dataKey="week" hide />
                      <YAxis hide domain={[0, "auto"]} />
                      {verdict?.base != null && (
                        <ReferenceLine y={verdict.base} stroke={NEUTRAL} strokeDasharray="2 3" strokeOpacity={0.6} ifOverflow="extendDomain" />
                      )}
                      <Tooltip
                        cursor={false}
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const p = payload[0].payload as { week: string; v: number | null; cost: number };
                          return (
                            <div className="rounded border bg-card px-1.5 py-1 text-[10px] shadow-sm">
                              {md(p.week)} 주 · {shownMetric === "roas" ? (p.v == null ? "비용 0" : fmt(p.v, shownMetric)) : fmt(p.v, shownMetric)}
                            </div>
                          );
                        }}
                      />
                      <Line type="linear" dataKey="v" stroke={flagged ? ACCENT : NEUTRAL} strokeWidth={flagged ? 2 : 1.25}
                        dot={false} connectNulls={false} isAnimationActive={false} />
                    </LineChart>
                  </DeferredResponsiveContainer>
                )}
              </div>
            );
          })}
        </div>
        <div data-tour="ads-naver-rule" className="mt-3 space-y-0.5 text-[11px] text-muted-foreground">
          <p>
            강조 규칙: 최근 {MULTIPLE_RECENT_WEEKS}주 평균이 {MULTIPLE_WEEKS}주 평균보다 {MULTIPLE_DROP_PCT}% 이상 낮고, 마지막 주가 그 앞주보다 낮은 캠페인
            {metric === "roas" ? " (ROAS 는 비용 가중 평균)" : " (주 평균 비용)"}. 점선 = {MULTIPLE_WEEKS}주 평균.
          </p>
          <p>
            {weeks.length ? `${md(weeks[0])} 주 ~ ${md(weeks[weeks.length - 1])} 주(월요일 시작), 다 끝난 주만. ` : ""}
            진행 중인 주는 하루이틀치라 뺐습니다{data?.collectedThrough ? ` (수집 ${md(data.collectedThrough)}까지)` : ""}.{" "}
            {MULTIPLE_WEEKS}주 비용 {formatCurrency(MULTIPLE_MIN_COST)} 미만 캠페인 {hidden}개는 생략, 비용 큰 순.
          </p>
          {metric === "roas" && (
            <p>ROAS 는 네이버가 신고한 전환매출 기준입니다. 비용이 0 인 주는 빈칸. 최근 2주 전환은 재수집(14일)으로 나중에 늘 수 있습니다.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
