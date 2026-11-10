"use client";

// 퍼널 막대 (2026-11-10). 한 원천 안의 단계를 위에서 아래로, 첫 단계 폭을 100% 로 둔 가로 막대로 줄인다.
// 단계 사이에는 「다음 단계로 못 간 비율(이탈률)」을 적는다. 각 단계의 건수는 바로 아래 단계표에 있어 여기 다시 적지 않는다.
// ★ 같은 원천에서 실제로 수집되는 단계만 넘겨받는다. 노출·클릭(광고 매체)은 유입(판매처)과 모집단이 달라 여기 잇지 않는다.
import { useState } from "react";
import { cn } from "@/lib/utils";

export interface FunnelStage { key: string; label: string; value: number }

/** 아주 작은 단계(구매 1% 등)도 보이게 하는 최소 폭(%) */
const MIN_W = 0.6;

export function FunnelBars({ stages, color }: { stages: FunnelStage[]; color: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const first = stages[0]?.value || 0;
  if (first <= 0 || stages.length < 2) return null;
  return (
    <div className="space-y-0.5" aria-label="단계별 남은 폭과 이탈률">
      {stages.map((s, i) => {
        const w = Math.max(MIN_W, (s.value / first) * 100);
        const next = stages[i + 1];
        const drop = next && s.value > 0 ? (1 - next.value / s.value) * 100 : null;
        return (
          <div key={s.key}>
            <div className={cn("grid grid-cols-[56px_1fr] items-center gap-2 text-[11px] transition-opacity", hover && hover !== s.key && "opacity-45")}
              onMouseEnter={() => setHover(s.key)} onMouseLeave={() => setHover(null)}
              title={`${s.label}: 첫 단계(${stages[0].label})의 ${((s.value / first) * 100).toFixed(2)}%`}>
              <span className="text-muted-foreground">{s.label}</span>
              <div className="relative h-3.5">
                <div className="absolute inset-0 rounded-[4px] bg-[var(--chart-grid-soft)]" />
                <div className="absolute inset-y-0 left-0 rounded-[4px]" style={{ width: `${w}%`, backgroundColor: color, opacity: 1 - i * 0.18 }} />
              </div>
            </div>
            {drop != null && (
              <div className="grid grid-cols-[56px_1fr] gap-2 text-[10.5px] leading-4 text-muted-foreground">
                <span />
                <span className="tabular-nums">↓ 이탈 <b className={cn("chart-num", drop >= 90 ? "text-foreground" : "")}>{drop.toFixed(1)}%</b> <span className="opacity-80">({s.label} → {next.label})</span></span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
