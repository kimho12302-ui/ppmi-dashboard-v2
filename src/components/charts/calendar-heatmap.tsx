"use client";

// 캘린더 히트맵 (2026-11-10). 일별 값 하나를 요일(세로) × 주(가로) 달력 칸으로 칠한다.
// - 기간 안 날짜는 전부 칸을 둔다. 값이 없는 날은 0 칸(가장 옅은 칸)이지 빈칸이 아니다.
// - pendingFrom 이후(판매 동기화 대기)는 0 이 아니라 아직 안 들어온 날이라 빗금 칸으로 따로 그린다.
// - 계열이 하나라 색은 강조색 하나의 진하기 5단계(시각화 아카이브 「무채색 + 강조 하나」).
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { calendarWeeks, weekdayMon } from "@/lib/chart-math";

export interface CalendarDay { date: string; value: number }

const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"];
const LEVELS = 5;

const weekday = weekdayMon;
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

export function CalendarHeatmap({
  days, pendingFrom, format, valueLabel,
}: {
  /** 기간 전체 날짜(빠진 날 없이). value 는 그날 합계 */
  days: CalendarDay[];
  /** 이 날짜부터는 판매 동기화 대기(빗금). null 이면 없음 */
  pendingFrom: string | null;
  format: (v: number) => string;
  valueLabel: string;
}) {
  const [hover, setHover] = useState<CalendarDay | null>(null);
  const { weeks, max } = useMemo(() => {
    if (!days.length) return { weeks: [] as (CalendarDay | null)[][], max: 0 };
    // 주 배치(월요일 시작, 기간 밖 칸 비움)는 src/lib/chart-math.ts calendarWeeks(테스트 있음)
    const byDate = new Map(days.map((d) => [d.date, d]));
    const out = calendarWeeks(days.map((d) => d.date)).map((w) => w.map((d) => (d ? byDate.get(d) ?? null : null)));
    const settled = days.filter((d) => !pendingFrom || d.date < pendingFrom);
    return { weeks: out, max: Math.max(0, ...settled.map((d) => d.value)) };
  }, [days, pendingFrom]);

  if (!weeks.length) return null;
  const level = (v: number) => (max <= 0 || v <= 0 ? 0 : Math.min(LEVELS, Math.ceil((v / max) * LEVELS)));
  const settledDays = days.filter((d) => !pendingFrom || d.date < pendingFrom);
  const best = settledDays.reduce<CalendarDay | null>((a, d) => (!a || d.value > a.value ? d : a), null);

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <div className="inline-grid gap-[3px]" style={{ gridTemplateColumns: `20px repeat(${weeks.length}, minmax(14px, 28px))` }}>
          {/* 머리: 그 주 월요일 날짜(첫 주와 월이 바뀌는 주만) */}
          <div />
          {weeks.map((w, i) => {
            const mon = w.find(Boolean)?.date;
            const showLabel = mon && (i === 0 || mon.slice(5, 7) !== weeks[i - 1].find(Boolean)?.date.slice(5, 7));
            return <div key={i} className="text-[10px] text-muted-foreground tabular-nums h-4 whitespace-nowrap overflow-visible">{showLabel ? md(mon!) : ""}</div>;
          })}
          {WEEKDAYS.map((wd, r) => (
            <div key={wd} className="contents">
              <div className={cn("text-[10px] text-muted-foreground leading-none flex items-center", r >= 5 && "opacity-70")}>{wd}</div>
              {weeks.map((w, c) => {
                const d = w[r];
                if (!d) return <div key={c} />;
                const pending = !!pendingFrom && d.date >= pendingFrom;
                const lv = level(d.value);
                return (
                  <div key={c}
                    onMouseEnter={() => setHover(d)} onMouseLeave={() => setHover(null)}
                    onClick={() => setHover((h) => (h?.date === d.date ? null : d))}
                    className={cn("aspect-square rounded-[4px] cursor-default transition-opacity", pending ? "cal-pending" : `cal-l${lv}`,
                      hover && hover.date !== d.date && "opacity-60")}
                    aria-label={`${d.date} ${pending ? "판매 동기화 대기" : `${valueLabel} ${format(d.value)}`}`} />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <div className="tabular-nums min-h-[18px]">
          {hover
            ? <><b className="text-foreground">{hover.date} ({WEEKDAYS[weekday(hover.date)]})</b> · {pendingFrom && hover.date >= pendingFrom ? "판매 동기화 대기(0 이 아니라 아직 안 들어온 날)" : <>{valueLabel} <b className="text-foreground chart-num">{format(hover.value)}</b></>}</>
            : best ? <>가장 많이 판 날 {md(best.date)}({WEEKDAYS[weekday(best.date)]}) {format(best.value)} · 칸에 마우스를 올리거나 누르면 그날 값</> : "판매가 들어온 날이 없습니다"}
        </div>
        <div className="flex items-center gap-1">
          <span>0</span>
          {Array.from({ length: LEVELS + 1 }, (_, i) => <span key={i} className={cn("inline-block w-3 h-3 rounded-[3px]", `cal-l${i}`)} />)}
          <span>{max > 0 ? format(max) : "-"}</span>
          {pendingFrom && <><span className="inline-block w-3 h-3 rounded-[3px] cal-pending ml-2" /><span>동기화 대기</span></>}
        </div>
      </div>
    </div>
  );
}
