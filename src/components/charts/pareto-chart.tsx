"use client";

// 파레토 그래프 (2026-11-10). 큰 것부터 막대로 세우고, 위에 누적 비중 선을 겹친다.
// 「상위 몇 개가 전체의 몇 %를 차지하나」를 한눈에 본다. 80% 기준선은 점선.
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from "recharts";
import { DeferredResponsiveContainer } from "@/components/deferred-chart";
import { PARETO_LINE, type buildPareto } from "@/lib/chart-math";
import {
  barProps, gridProps, tooltipProps, xAxisProps, yAxisProps, activeDotProps, BAR_RADIUS, TIP_CARD,
} from "./chart-style";

// 계산(정렬·누적·80% 판정)은 src/lib/chart-math.ts(테스트 있음). 화면은 여기서 다시 내보낸 것을 쓴다.
export { buildPareto, PARETO_LINE, type ParetoItem } from "@/lib/chart-math";

export function ParetoChart({
  rows, format, valueName, height = 260, show = 30,
}: {
  rows: ReturnType<typeof buildPareto>["rows"];
  format: (v: number) => string;
  valueName: string;
  height?: number;
  /** 막대로 그리는 위 N개(나머지는 누적선 끝 값에만 들어 있다) */
  show?: number;
}) {
  const data = rows.slice(0, show);
  return (
    <DeferredResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 10, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis {...xAxisProps} dataKey="rank" interval="preserveStartEnd" minTickGap={8} />
        <YAxis {...yAxisProps} yAxisId="v" tickFormatter={(v: number) => (v >= 10000 ? `${Math.round(v / 10000)}만` : String(v))} width={48} />
        <YAxis {...yAxisProps} yAxisId="p" orientation="right" domain={[0, 100]} ticks={[0, 25, 50, 80, 100]} tickFormatter={(v: number) => `${v}%`} width={40} />
        <ReferenceLine yAxisId="p" y={PARETO_LINE} stroke="var(--chart-dim)" strokeDasharray="4 4"
          label={{ value: `${PARETO_LINE}%`, position: "insideBottomRight", fontSize: 10, fill: "var(--muted-foreground)" }} />
        <Tooltip {...tooltipProps({ kind: "bar", tickFormatter: (v: never) => `${v}위` })}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const r = payload[0].payload as (typeof data)[number];
            return (
              <div className={TIP_CARD}>
                <div className="font-semibold text-[11.5px] text-muted-foreground mb-1">{r.rank}위 · {r.label}</div>
                {r.sub && <div className="text-[11px] text-muted-foreground mb-1">{r.sub}</div>}
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">{valueName}</span><span className="font-bold chart-num">{format(r.value)} ({r.share.toFixed(1)}%)</span></div>
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">1위부터 누적</span><span className="font-bold chart-num">{r.cum.toFixed(1)}%</span></div>
              </div>
            );
          }} />
        <Bar {...barProps} yAxisId="v" dataKey="value" name={valueName} fill="var(--neutral-1)" radius={BAR_RADIUS} isAnimationActive={false} />
        <Line yAxisId="p" type="linear" dataKey="cum" name="누적 비중" stroke="var(--sig-danger)" strokeWidth={1.75}
          dot={false} {...activeDotProps} isAnimationActive={false} />
      </ComposedChart>
    </DeferredResponsiveContainer>
  );
}
