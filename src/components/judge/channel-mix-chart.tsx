"use client";

// 매출 구성 (주별/월별 쌓은 막대, 2026-11-03). 판매처별 또는 브랜드별로 쌓는다(2026-11-04).
//
// 예전 "주별/월별 매출"(합계 막대 1개)과 "판매처별 매출 비교"(기간 합계 가로 막대)를 하나로 합쳤다.
// 막대 높이 = 그 주·월 매출 합계(예전 막대와 같은 값), 칸 = 판매처. 기간 합계는 위 판매처 카드에 있다.
// ★ 원천은 판매 원장(daily_sales.revenue)이다. 광고 전환값을 쓰지 않는다(메타 구매 귀속이 막혀 왜곡된다).
//   그래서 이름도 "기여도"가 아니라 "구성"이다.
// 판매처는 무채색으로 두고, 비중이 가장 크게 움직인 판매처 하나만 강조색으로 칠한다(규칙: src/lib/judge-charts.ts).
// 「브랜드」 쌓기는 예전 「브랜드별 누적 매출 트렌드」(일별 브랜드 막대)를 대신한다. 같은 판매 원장(공구 차감 자체매출)이라
// 막대 높이는 판매처로 쌓든 브랜드로 쌓든 같다. 강조 규칙도 같다(가장 크게 움직인 브랜드 하나).
import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { DeferredResponsiveContainer } from "@/components/deferred-chart";
import { ComposedChart, Bar, Line, Cell, XAxis, YAxis, Tooltip, CartesianGrid, Legend, LabelList } from "recharts";
import { formatCurrency, cn } from "@/lib/utils";
import { axisEnd, daysBetween, lastDataDate } from "@/lib/bucket";
import { kstDate } from "@/lib/date";
import { periodAxis, periodKey, periodCalendarDays } from "@/lib/sales-period";
import { biggestShareShift, SHARE_LOOKBACK, SHARE_MIN_SHIFT_PP } from "@/lib/judge-charts";
import { BRAND_LABELS } from "@/lib/types";
import { useConfig } from "@/hooks/use-config";
import { CalendarHeatmap } from "@/components/charts/calendar-heatmap";
import { calendarPendingFrom, seriesTotal, topVisibleKey, TOTAL_LABEL, VISIBLE_TOTAL_LABEL } from "@/lib/chart-math";
import {
  xAxisProps, yAxisProps, gridProps, legendProps, tooltipProps, barProps, BAR_RADIUS, NO_RADIUS, TIP_CARD,
  useSeriesToggle, legendToggleProps, TooltipTotalRow,
} from "@/components/charts/chart-style";

// ★ 색은 설정 「채널 관리」·「브랜드 관리」에 보이는 정본 색(useConfig, types.ts)을 쓴다(2026-11-10 김호 지시).
//   처음엔 판단 그래프 문법대로 무채색 + 강조 하나로 그렸는데, 카페24·스마트스토어·기타가 다 회색이라
//   누가 누군지 안 보였다. 쌓은 막대처럼 계열이 여럿인 그래프는 계열 색이 먼저다.
//   가장 크게 움직인 하나는 색을 바꾸지 않고 테두리로 표시한다.
const FALLBACK = "#6b7280";
const INCOMPLETE_OPACITY = 0.45;

interface SalesRow { date: string; channel?: string | null; brand?: string | null; revenue?: number | null }
interface ChannelInfo { channel: string; label: string; revenue: number }
type Mode = "weekly" | "monthly";
type Dim = "channel" | "brand";

interface Bucket {
  period: string;
  complete: boolean;
  /** 진행 중(마지막 판매일 뒤로 날이 남음) / 기간 경계로 잘림 / 아직 안 들어옴 */
  state: "complete" | "in_progress" | "partial_range" | "pending";
  byChannel: Record<string, number>;
}

/**
 * salesThrough = 판매 원장 마지막 날(서버 fetchSalesThrough, 고른 기간과 무관, /api/dashboard 의 salesLastDate).
 * 막대의 진행 중·미수집 판정과 달력 빗금이 이 날짜를 기준으로 한다(2026-11-10 검수 M3).
 * 넘기지 않으면(옛 응답) 고른 기간 안 마지막 판매 행으로 대신한다.
 */
export function ChannelMixChart({ sales, channels, from, to, salesThrough }: { sales: SalesRow[]; channels: ChannelInfo[]; from: string; to: string; salesThrough?: string | null }) {
  const [mode, setMode] = useState<Mode>("weekly");
  const [dimPick, setDimPick] = useState<Dim>("channel");
  /** 막대(주·월) | 달력(일별 히트맵, 2026-11-10). mode(주·월 키)와 따로 둔다 */
  const [view, setView] = useState<"bars" | "calendar">("bars");
  const unit = mode === "weekly" ? "주" : "달";
  // 브랜드가 하나뿐이면(브랜드 필터) 브랜드 쌓기는 의미가 없어 토글을 숨긴다.
  const brandKeys = useMemo(() => {
    const tot = new Map<string, number>();
    for (const r of sales) tot.set(r.brand || "other", (tot.get(r.brand || "other") || 0) + (Number(r.revenue) || 0));
    return Array.from(tot.entries()).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  }, [sales]);
  const dim: Dim = brandKeys.length > 1 ? dimPick : "channel";
  const keyOf = (r: SalesRow) => (dim === "brand" ? r.brand || "other" : r.channel || "other");
  const what = dim === "brand" ? "브랜드" : "판매처";

  const buckets = useMemo<Bucket[]>(() => {
    if (!sales.length) return [];
    // 원장 마지막 날. null(원장이 비어 있음)이면 "" 로 두어 모든 날을 미수집으로 본다.
    const last = (salesThrough === undefined ? lastDataDate(sales) : salesThrough) ?? "";
    const axis = periodAxis(from, to, mode);
    const keys = Array.from(axis.keys()).sort();
    // 축 위에 실제로 있는 날 수(기간 필터·오늘 이후 제외) 와 판매가 들어온 날 수
    const inRange = new Map<string, number>();
    const synced = new Map<string, number>();
    for (const [k] of axis) { inRange.set(k, 0); synced.set(k, 0); }
    // periodAxis 는 첫날만 들고 있으므로 기간 안 날짜를 다시 센다(오늘 이후는 daysBetween 이 이미 뺀다).
    for (const s of daysBetween(from, to)) {
      const k = periodKey(s, mode);
      inRange.set(k, (inRange.get(k) || 0) + 1);
      if (s <= last) synced.set(k, (synced.get(k) || 0) + 1);
    }
    const endsToday = axisEnd(to) === kstDate();
    const map = new Map<string, Record<string, number>>(keys.map((k) => [k, {}]));
    for (const r of sales) {
      const k = periodKey(r.date, mode);
      const m = map.get(k);
      if (!m) continue; // 기간 밖 날짜는 이 차트에 없다(위 KPI 와 같은 기간)
      const ch = keyOf(r);
      m[ch] = (m[ch] || 0) + (Number(r.revenue) || 0);
    }
    return keys.map((k, i) => {
      const total = periodCalendarDays(k, axis.get(k)!, mode);
      const got = synced.get(k) || 0;
      const seen = inRange.get(k) || 0;
      let state: Bucket["state"] = "complete";
      if (got === 0) state = "pending";
      else if (got < seen || (seen < total && i === keys.length - 1 && endsToday)) state = "in_progress";
      else if (seen < total) state = "partial_range";
      return { period: k, complete: state === "complete", state, byChannel: map.get(k) || {} };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sales, from, to, mode, dim, salesThrough]);

  const order = dim === "brand" ? brandKeys : channels.map((c) => c.channel);
  const shift = useMemo(() => biggestShareShift(buckets), [buckets]);
  const { brandMap, channelMap } = useConfig();
  const color = (ch: string) => (dim === "brand" ? brandMap[ch]?.color : channelMap[ch]?.color) || FALLBACK;
  const labelOf = (ch: string) => (dim === "brand" ? BRAND_LABELS[ch] || ch : channels.find((c) => c.channel === ch)?.label || ch);
  // 범례로 판매처(브랜드) 골라 보기(2026-11-12). 「other」가 판매처·브랜드 양쪽에 있어 쌓기 기준을 바꾸면 숨김을 비운다.
  // 숨긴 칸은 막대에서 빠지고 남은 칸이 다시 쌓이며, 막대 위 숫자·툴팁 합계·비중(%)도 보이는 칸 기준으로 바뀐다.
  // 판정 문장과 테두리(가장 크게 움직인 하나)는 숨김과 무관하게 전체로 계산한다.
  const mixToggle = useSeriesToggle(order, dim);
  const mixTop = topVisibleKey(order, mixToggle.hidden);

  // 아직 안 들어온 구간은 막대를 그리지 않는다(0 이 아니라 미수집). 축 자리는 남긴다.
  const rows = buckets.map((b) => {
    const row: Record<string, string | number | boolean | null> = { period: b.period, state: b.state };
    for (const ch of order) row[ch] = b.state === "pending" ? null : (b.byChannel[ch] || 0);
    // 막대 위 합계 라벨. 예전 '주별/월별 매출' 카드가 보여 주던 그 주·월 합계와 같은 값이다(숨긴 칸이 없을 때).
    row.__total = seriesTotal(row, order, mixToggle.hidden)?.value ?? null;
    return row;
  });
  const lastBucket = buckets[buckets.length - 1];

  // 달력: 기간 전체 날짜에 그날 매출 합계(판매처·브랜드 구분 없이). 값이 없는 날은 0, 마지막 판매일 뒤는 동기화 대기.
  const calendar = useMemo(() => {
    const days = daysBetween(from, to);
    if (!days.length) return null;
    const tot = new Map<string, number>();
    for (const r of sales) {
      const d = String(r.date).slice(0, 10);
      tot.set(d, (tot.get(d) || 0) + (Number(r.revenue) || 0));
    }
    const last = salesThrough === undefined ? (sales.length ? lastDataDate(sales) : null) : salesThrough;
    // 빗금 = 원장 마지막 날 뒤만. 끝난 기간의 판매 없는 날은 0원 칸이다(chart-math calendarPendingFrom, 테스트 있음).
    const pendingFrom = calendarPendingFrom(days, last);
    return { days: days.map((d) => ({ date: d, value: tot.get(d) || 0 })), pendingFrom, last };
  }, [sales, from, to, salesThrough]);
  // 달력 데이터가 없으면(기간 날짜 없음) 달력 버튼을 끄고 막대 보기로 그린다(검수 L5)
  const shownView = view === "calendar" && calendar ? "calendar" : "bars";
  const mdShort = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
          <div>
            <h3 className="font-semibold">매출 구성</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{shownView === "calendar" ? "가로 = 주(월요일 시작), 세로 = 요일, 칸 = 그날 매출 합계(판매 원장 자체매출)" : <>가로 = {unit}, 세로 = 원(판매 원장 자체매출), 칸 = {what}</>}</p>
            <p className="text-xs text-muted-foreground">판단: 매출이 어느 {what}에서 늘고 줄었는지 (광고 귀속 아님)</p>
          </div>
          <div data-tour="sales-mix-toggle" className="flex flex-wrap gap-2">
          {brandKeys.length > 1 && (
            <div className="flex gap-1 bg-muted rounded-md p-0.5">
              {(["channel", "brand"] as const).map((d) => (
                <button key={d} onClick={() => setDimPick(d)}
                  className={cn("px-2 py-1 text-xs rounded", dim === d ? "bg-card shadow-sm font-medium" : "text-muted-foreground")}>
                  {d === "channel" ? "판매처" : "브랜드"}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-1 bg-muted rounded-md p-0.5">
            {(["weekly", "monthly"] as const).map((m) => (
              <button key={m} onClick={() => { setMode(m); setView("bars"); }}
                className={cn("px-2 py-1 text-xs rounded", shownView === "bars" && mode === m ? "bg-card shadow-sm font-medium" : "text-muted-foreground")}>
                {m === "weekly" ? "주별" : "월별"}
              </button>
            ))}
            <button onClick={() => setView("calendar")} disabled={!calendar}
              className={cn("px-2 py-1 text-xs rounded disabled:opacity-40", shownView === "calendar" ? "bg-card shadow-sm font-medium" : "text-muted-foreground")}>
              달력
            </button>
          </div>
          </div>
        </div>

        <p data-tour="sales-mix-verdict" className="text-sm mb-2">
          {shownView === "calendar" ? (
            <span className="text-muted-foreground">칸 하나 = 하루 매출 합계({what} 구분 없이). 진할수록 많이 판 날이고, 빗금 칸은 판매 동기화 대기{calendar?.last ? `(마지막 판매일 ${mdShort(calendar.last)} 뒤)` : ""}입니다.</span>
          ) : order.length < 2 ? (
            <span className="text-muted-foreground">이 기간 {what}가 {order[0] ? labelOf(order[0]) : "없음"} 하나라 구성 비교는 없습니다. 막대는 {unit}별 매출 합계입니다.</span>
          ) : shift ? (
            <><b style={{ color: color(shift.channel) }}>{labelOf(shift.channel)}</b> 비중이 직전 {shift.priorCount}{unit} 합계 대비 마지막 완료 {unit}에 {shift.shiftPp > 0 ? "+" : ""}{shift.shiftPp.toFixed(1)}%p 움직였습니다.</>
          ) : (
            <span className="text-muted-foreground">비중이 {SHARE_MIN_SHIFT_PP}%p 이상 움직인 {what}가 없습니다{buckets.filter((b) => b.complete).length < 2 ? ` (완료된 ${unit}가 2개 미만)` : ""}.</span>
          )}
        </p>

        {shownView === "calendar" && calendar ? (
          <CalendarHeatmap days={calendar.days} pendingFrom={calendar.pendingFrom} valueLabel="매출" format={(v) => formatCurrency(v)} />
        ) : (
          <DeferredResponsiveContainer width="100%" height={240}>
            <ComposedChart data={rows} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis {...xAxisProps} dataKey="period" />
              <YAxis {...yAxisProps} tickFormatter={(v) => `${(Number(v) / 10000).toFixed(0)}만`} />
              <Tooltip
                {...tooltipProps({ kind: "bar" })}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const r = payload[0].payload as Record<string, string | number | null>;
                  // 합계·비중 분모 = 보이는 칸 합(공용 seriesTotal, 다른 그래프 툴팁 합계와 같은 규칙)
                  const t = seriesTotal(r, order, mixToggle.hidden, TOTAL_LABEL, VISIBLE_TOTAL_LABEL);
                  const tot = t?.value ?? 0;
                  const note = r.state === "in_progress" ? " (진행 중)" : r.state === "partial_range" ? " (기간 일부)" : r.state === "pending" ? " (판매 미수집)" : "";
                  return (
                    <div className={TIP_CARD}>
                      <div className="font-semibold text-[11.5px] text-muted-foreground mb-0.5">{String(r.period)}{note}</div>
                      {order.filter((ch) => !mixToggle.isHidden(ch) && Number(r[ch]) > 0).map((ch) => (
                        <div key={ch} className="flex justify-between gap-3">
                          <span>{labelOf(ch)}</span>
                          <span className="chart-num">{formatCurrency(Number(r[ch]))} ({tot > 0 ? ((Number(r[ch]) / tot) * 100).toFixed(0) : 0}%)</span>
                        </div>
                      ))}
                      {t && <TooltipTotalRow label={t.label} value={t.value == null ? "-" : formatCurrency(t.value)} />}
                    </div>
                  );
                }}
              />
              <Legend {...legendProps} {...legendToggleProps(mixToggle)}
                formatter={(v) => <span style={{ color: "var(--foreground)" }}>{labelOf(String(v))}</span>} />
              {order.map((ch) => (
                <Bar {...barProps} key={ch} dataKey={ch} name={ch} stackId="channel" fill={color(ch)} isAnimationActive={false}
                  hide={mixToggle.isHidden(ch)}
                  stroke={shift?.channel === ch ? "var(--foreground)" : undefined} strokeWidth={shift?.channel === ch ? 1.5 : 0}
                  radius={ch === mixTop ? BAR_RADIUS : NO_RADIUS}>
                  {rows.map((r) => (
                    <Cell key={String(r.period)} fillOpacity={r.state === "complete" ? 1 : INCOMPLETE_OPACITY} />
                  ))}
                </Bar>
              ))}
              {/* 합계 라벨. 막대 위 라벨은 맨 위 판매처 값이 0 인 주에 안 그려져서, 보이지 않는 선의 점에 단다. */}
              <Line dataKey="__total" stroke="none" dot={false} activeDot={false} legendType="none" isAnimationActive={false} tooltipType="none">
                <LabelList dataKey="__total" position="top" fontSize={10} fill="var(--muted-foreground)"
                  formatter={(v: unknown) => (v == null ? "" : `${Math.round(Number(v) / 10000).toLocaleString("ko-KR")}만`)} />
              </Line>
            </ComposedChart>
          </DeferredResponsiveContainer>
        )}

        <div data-tour="sales-mix-rule" className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
          {shownView === "calendar" ? (<>
          <p>
            기간 안 날짜는 매출이 0 인 날도 칸을 둡니다(가장 옅은 칸). 진하기는 동기화된 날 가운데 가장 큰 날을 5단계로 나눈 것입니다.
            판매는 1~3일(길면 5일) 늦게 들어와, 빗금 바로 앞 며칠의 옅은 칸도 아직 덜 들어온 날일 수 있습니다(최근 5일 미반영 가능).
          </p>
          <p>
            달력 줄은 월요일 시작이라 「주별」 막대(1월 1일이 든 주가 W01, 한국 시간 토요일 시작)와 묶음이 다릅니다. 별도 공구 판매처 행은 빠져 있어 위 매출 KPI 와 같은 범위입니다.
          </p>
          </>) : (<>
          <p>
            막대 위 숫자 = 그 {unit} 매출 합계(만원, 마우스를 올리면 원 단위{mixToggle.hidden.length > 0 ? `, 지금은 범례로 숨긴 ${what}를 뺀 보이는 칸의 합` : ""}). 흐린 막대 = 다 안 찬 {unit}
            {lastBucket && lastBucket.state === "in_progress" ? ` (마지막 ${lastBucket.period} 은 진행 중, 판매 동기화가 1~3일 늦게 들어옵니다)` : ""}. 비중 비교에서 뺍니다.
          </p>
          <p>
            강조 규칙: 마지막 완료 {unit}의 {what} 비중을 직전 최대 {SHARE_LOOKBACK}{unit}(완료된 것만) 합계 비중과 비교해 가장 크게 움직인 {what} 하나에 테두리를 칩니다({SHARE_MIN_SHIFT_PP}%p 미만이면 표시하지 않음). 색은 설정 「채널 관리」·「브랜드 관리」 색과 같습니다.
            별도 공구 판매처 행은 빠져 있어 위 매출 KPI 와 같은 범위입니다.
          </p>
          </>)}
        </div>
      </CardContent>
    </Card>
  );
}
