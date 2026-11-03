"use client";

// 채널별 매출 구성 (주별/월별 쌓은 막대, 2026-11-03).
//
// 예전 "주별/월별 매출"(합계 막대 1개)과 "판매처별 매출 비교"(기간 합계 가로 막대)를 하나로 합쳤다.
// 막대 높이 = 그 주·월 매출 합계(예전 막대와 같은 값), 칸 = 판매처. 기간 합계는 위 판매처 카드에 있다.
// ★ 원천은 판매 원장(daily_sales.revenue)이다. 광고 전환값을 쓰지 않는다(메타 구매 귀속이 막혀 왜곡된다).
//   그래서 이름도 "기여도"가 아니라 "구성"이다.
// 판매처는 무채색으로 두고, 비중이 가장 크게 움직인 판매처 하나만 강조색으로 칠한다(규칙: src/lib/judge-charts.ts).
import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { DeferredResponsiveContainer } from "@/components/deferred-chart";
import { ComposedChart, Bar, Line, Cell, XAxis, YAxis, Tooltip, CartesianGrid, Legend, LabelList } from "recharts";
import { formatCurrency, cn } from "@/lib/utils";
import { axisEnd, daysBetween, lastDataDate } from "@/lib/bucket";
import { kstDate } from "@/lib/date";
import { periodAxis, periodKey, periodCalendarDays } from "@/lib/sales-period";
import { biggestShareShift, SHARE_LOOKBACK, SHARE_MIN_SHIFT_PP } from "@/lib/judge-charts";

const ACCENT = "var(--sig-danger)";
// 판매처 무채색(진한 것부터). 비중 큰 판매처가 진하다.
// 흰 카드·어두운 카드 둘 다에서 보이는 중간 톤만 쓴다(아주 옅은 #e2e8f0 류는 라이트 모드에서 사라진다).
const NEUTRALS = ["#475569", "#94a3b8", "#64748b", "#a8b3c4", "#334155", "#7c8a9e"];
const INCOMPLETE_OPACITY = 0.45;

interface SalesRow { date: string; channel?: string | null; revenue?: number | null }
interface ChannelInfo { channel: string; label: string; revenue: number }
type Mode = "weekly" | "monthly";

interface Bucket {
  period: string;
  complete: boolean;
  /** 진행 중(마지막 판매일 뒤로 날이 남음) / 기간 경계로 잘림 / 아직 안 들어옴 */
  state: "complete" | "in_progress" | "partial_range" | "pending";
  byChannel: Record<string, number>;
}

export function ChannelMixChart({ sales, channels, from, to }: { sales: SalesRow[]; channels: ChannelInfo[]; from: string; to: string }) {
  const [mode, setMode] = useState<Mode>("weekly");
  const unit = mode === "weekly" ? "주" : "달";

  const buckets = useMemo<Bucket[]>(() => {
    if (!sales.length) return [];
    const last = lastDataDate(sales);
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
      const ch = r.channel || "other";
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
  }, [sales, from, to, mode]);

  const order = channels.map((c) => c.channel);
  const shift = useMemo(() => biggestShareShift(buckets), [buckets]);
  const color = (ch: string, i: number) => (shift?.channel === ch ? ACCENT : NEUTRALS[i % NEUTRALS.length]);
  const labelOf = (ch: string) => channels.find((c) => c.channel === ch)?.label || ch;

  // 아직 안 들어온 구간은 막대를 그리지 않는다(0 이 아니라 미수집). 축 자리는 남긴다.
  const rows = buckets.map((b) => {
    const row: Record<string, string | number | boolean | null> = { period: b.period, state: b.state };
    for (const ch of order) row[ch] = b.state === "pending" ? null : (b.byChannel[ch] || 0);
    // 막대 위 합계 라벨. 예전 '주별/월별 매출' 카드가 보여 주던 그 주·월 합계와 같은 값이다.
    row.__total = b.state === "pending" ? null : order.reduce((a, ch) => a + (b.byChannel[ch] || 0), 0);
    return row;
  });
  const lastBucket = buckets[buckets.length - 1];

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
          <div>
            <h3 className="font-semibold">채널별 매출 구성</h3>
            <p className="text-xs text-muted-foreground mt-0.5">판단: 매출이 어느 판매처에서 늘고 줄었는지 (판매 원장 기준, 광고 귀속 아님)</p>
          </div>
          <div className="flex gap-1 bg-muted rounded-md p-0.5">
            {(["weekly", "monthly"] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)}
                className={cn("px-2 py-1 text-xs rounded", mode === m ? "bg-card shadow-sm font-medium" : "text-muted-foreground")}>
                {m === "weekly" ? "주별" : "월별"}
              </button>
            ))}
          </div>
        </div>

        <p className="text-sm mb-2">
          {order.length < 2 ? (
            <span className="text-muted-foreground">이 기간 판매처가 {order[0] ? labelOf(order[0]) : "없음"} 하나라 구성 비교는 없습니다. 막대는 {unit}별 매출 합계입니다.</span>
          ) : shift ? (
            <><b style={{ color: ACCENT }}>{labelOf(shift.channel)}</b> 비중이 직전 {shift.priorCount}{unit} 합계 대비 마지막 완료 {unit}에 {shift.shiftPp > 0 ? "+" : ""}{shift.shiftPp.toFixed(1)}%p 움직였습니다.</>
          ) : (
            <span className="text-muted-foreground">비중이 {SHARE_MIN_SHIFT_PP}%p 이상 움직인 판매처가 없습니다{buckets.filter((b) => b.complete).length < 2 ? ` (완료된 ${unit}가 2개 미만)` : ""}.</span>
          )}
        </p>

        <DeferredResponsiveContainer width="100%" height={240}>
          <ComposedChart data={rows} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="period" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
            <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" tickFormatter={(v) => `${(Number(v) / 10000).toFixed(0)}만`} />
            <Tooltip
              cursor={{ fill: "var(--muted)", opacity: 0.4 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const r = payload[0].payload as Record<string, string | number | null>;
                const tot = order.reduce((s, ch) => s + (Number(r[ch]) || 0), 0);
                const note = r.state === "in_progress" ? " (진행 중)" : r.state === "partial_range" ? " (기간 일부)" : r.state === "pending" ? " (판매 미수집)" : "";
                return (
                  <div className="rounded-lg border bg-card px-2 py-1.5 text-[11px] shadow-sm">
                    <div className="font-medium">{String(r.period)}{note}</div>
                    <div className="flex justify-between gap-3 font-semibold border-b mb-1 pb-1"><span>합계</span><span>{formatCurrency(tot)}</span></div>
                    {order.filter((ch) => Number(r[ch]) > 0).map((ch) => (
                      <div key={ch} className="flex justify-between gap-3">
                        <span>{labelOf(ch)}</span>
                        <span>{formatCurrency(Number(r[ch]))} ({tot > 0 ? ((Number(r[ch]) / tot) * 100).toFixed(0) : 0}%)</span>
                      </div>
                    ))}
                  </div>
                );
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }}
              formatter={(v) => <span style={{ color: "var(--foreground)" }}>{labelOf(String(v))}</span>} />
            {order.map((ch, i) => (
              <Bar key={ch} dataKey={ch} name={ch} stackId="channel" fill={color(ch, i)} isAnimationActive={false}
                radius={i === order.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}>
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

        <div className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
          <p>
            막대 위 숫자 = 그 {unit} 매출 합계(만원, 마우스를 올리면 원 단위). 흐린 막대 = 다 안 찬 {unit}
            {lastBucket && lastBucket.state === "in_progress" ? ` (마지막 ${lastBucket.period} 은 진행 중, 판매 동기화가 1~3일 늦게 들어옵니다)` : ""}. 비중 비교에서 뺍니다.
          </p>
          <p>
            강조 규칙: 마지막 완료 {unit}의 판매처 비중을 직전 최대 {SHARE_LOOKBACK}{unit}(완료된 것만) 합계 비중과 비교해 가장 크게 움직인 판매처 하나만 칠합니다({SHARE_MIN_SHIFT_PP}%p 미만이면 칠하지 않음).
            별도 공구 판매처 행은 빠져 있어 위 매출 KPI 와 같은 범위입니다.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
