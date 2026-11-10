"use client";

// 퍼널 막대 (2026-11-10). 한 원천 안의 단계를 위에서 아래로, 첫 단계 폭을 100% 로 둔 가로 막대로 줄인다.
// 단계 사이에는 「다음 단계로 못 간 비율(이탈률)」을 적는다. 각 단계의 건수는 바로 아래 단계표에 있어 여기 다시 적지 않는다.
// ★ 같은 원천에서 실제로 수집되는 단계만 넘겨받는다. 노출·클릭(광고 매체)은 유입(판매처)과 모집단이 달라 여기 잇지 않는다.
// 폭·이탈률·단계 역전 판정은 src/lib/chart-math.ts funnelModel(테스트 있음). 뒤 단계가 앞 단계보다 크면 그리지 않고 이유만 적는다.
import { useState } from "react";
import { cn } from "@/lib/utils";
import { funnelModel, type FunnelStage } from "@/lib/chart-math";

export type { FunnelStage } from "@/lib/chart-math";

export function FunnelBars({ stages, color }: { stages: FunnelStage[]; color: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const model = funnelModel(stages);
  if (!model.ok) return <p className="text-[11px] text-amber-700 dark:text-amber-500">{model.reason}.</p>;
  const first = model.rows[0];
  return (
    <div className="space-y-0.5" aria-label="단계별 남은 폭과 이탈률">
      {model.rows.map((r, i) => (
        <div key={r.key}>
          <div className={cn("grid grid-cols-[56px_1fr] items-center gap-2 text-[11px] transition-opacity", hover && hover !== r.key && "opacity-45")}
            onMouseEnter={() => setHover(r.key)} onMouseLeave={() => setHover(null)}
            title={`${r.label}: 첫 단계(${first.label})의 ${r.ofFirst.toFixed(2)}%`}>
            <span className="text-muted-foreground">{r.label}</span>
            <div className="relative h-3.5">
              <div className="absolute inset-0 rounded-[4px] bg-[var(--chart-grid-soft)]" />
              <div className="absolute inset-y-0 left-0 rounded-[4px]" style={{ width: `${r.width}%`, backgroundColor: color, opacity: 1 - i * 0.18 }} />
            </div>
          </div>
          {r.drop != null && r.next && (
            <div className="grid grid-cols-[56px_1fr] gap-2 text-[10.5px] leading-4 text-muted-foreground">
              <span />
              <span className="tabular-nums">↓ 이탈 <b className={cn("chart-num", r.drop >= 90 ? "text-foreground" : "")}>{r.drop.toFixed(1)}%</b> <span className="opacity-80">({r.label} → {r.next})</span></span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
