"use client";

// 덤벨 그래프 (2026-11-10). 항목마다 「직전 기간 점 ○ → 이번 기간 점 ●」을 한 줄에 잇는다.
// 누가 좋아지고 나빠졌는지를 줄의 방향과 길이로 본다. 이음선은 좋아졌으면 초록, 나빠졌으면 빨강.
// 값이 없는 쪽(표본 부족·광고비 0)은 점을 찍지 않고 이유를 적는다.
// 축은 한 그래프 안에서 하나(0 부터 최댓값까지)라 줄끼리 길이를 비교할 수 있다.
// 숫자는 같은 화면 카드에 이미 있어 늘 적지 않고, 줄에 마우스를 올렸을 때 아래 한 줄에만 보인다.
import { useState } from "react";
import { cn } from "@/lib/utils";

export interface DumbbellRow {
  key: string;
  label: string;
  /** 이번 점 색(판매처·매체 설정 색) */
  color: string;
  prev: number | null;
  cur: number | null;
  /** 값이 없을 때 이유 */
  missingNote?: string;
}

export function DumbbellChart({
  rows, format, prevLabel, curLabel, higherIsBetter = true, axisLabel,
}: {
  rows: DumbbellRow[];
  format: (v: number) => string;
  prevLabel: string;
  curLabel: string;
  higherIsBetter?: boolean;
  /** 축 오른쪽 끝 글자(예: 「최대 6.9x」) 앞에 붙는 이름 */
  axisLabel: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(0, ...rows.flatMap((r) => [r.prev ?? 0, r.cur ?? 0]));
  const x = (v: number) => (max > 0 ? (v / max) * 100 : 0);
  const h = rows.find((r) => r.key === hover) || null;
  return (
    <div className="space-y-1">
      {rows.map((r) => {
        const both = r.prev != null && r.cur != null;
        const up = both ? r.cur! >= r.prev! : null;
        const good = up == null ? null : higherIsBetter ? up : !up;
        const lo = both ? Math.min(x(r.prev!), x(r.cur!)) : 0;
        const hi = both ? Math.max(x(r.prev!), x(r.cur!)) : 0;
        return (
          <div key={r.key} className={cn("grid grid-cols-[96px_1fr] sm:grid-cols-[140px_1fr] items-center gap-3 text-xs transition-opacity py-0.5",
            hover && hover !== r.key && "opacity-40")}
            onMouseEnter={() => setHover(r.key)} onMouseLeave={() => setHover(null)}
            onClick={() => setHover((h) => (h === r.key ? null : r.key))}>
            <span className="truncate">{r.label}</span>
            <div className="relative h-5 mx-1.5">
              <div className="absolute inset-x-0 top-1/2 h-px bg-[var(--chart-grid-soft)]" />
              {both && (
                <div className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full"
                  style={{ left: `${lo}%`, width: `${hi - lo}%`, backgroundColor: good ? "var(--sig-ok)" : "var(--sig-danger)", opacity: 0.55 }} />
              )}
              {r.prev != null && (
                <span className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 bg-card"
                  style={{ left: `${x(r.prev)}%`, borderColor: "var(--muted-foreground)" }} />
              )}
              {r.cur != null && (
                <span className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full border-2 border-card shadow-sm"
                  style={{ left: `${x(r.cur)}%`, backgroundColor: r.color }} />
              )}
              {!both && (
                <span className="absolute right-0 top-1/2 -translate-y-1/2 text-[10.5px] text-muted-foreground">{r.missingNote || "비교 불가"}</span>
              )}
            </div>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground pt-1 border-t border-[var(--chart-grid-soft)]">
        <span className="min-h-[18px] tabular-nums">
          {h ? (
            <><b className="text-foreground">{h.label}</b> · {prevLabel} <span className="chart-num">{h.prev != null ? format(h.prev) : "-"}</span> → {curLabel} <b className="text-foreground chart-num">{h.cur != null ? format(h.cur) : "-"}</b>
              {h.prev != null && h.cur != null && h.prev > 0 && <> ({h.cur >= h.prev ? "▲" : "▼"}{Math.abs((h.cur / h.prev - 1) * 100).toFixed(0)}%)</>}
              {(h.prev == null || h.cur == null) && h.missingNote ? ` · ${h.missingNote}` : ""}</>
          ) : <>줄에 마우스를 올리거나 누르면 두 값이 나옵니다 · 축 0 ~ {axisLabel} {max > 0 ? format(max) : "-"}</>}
        </span>
        <span className="inline-flex items-center gap-3">
          <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full border-2 bg-card" style={{ borderColor: "var(--muted-foreground)" }} />{prevLabel}</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: "var(--muted-foreground)" }} />{curLabel}</span>
        </span>
      </div>
    </div>
  );
}
