"use client";

// 워터폴(폭포) 그래프 (2026-11-10). 매출에서 비용을 하나씩 빼 내려가 마지막에 이익이 남는 모양.
// 숫자는 부르는 쪽이 이미 계산한 값을 그대로 받는다(여기서 새로 계산하지 않는다).
// 각 막대는 [아래, 위] 범위 막대(recharts range bar)라 이익이 음수거나 중간 합계가 0 아래로 내려가도 그대로 그린다.
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell, LabelList, ReferenceLine,
} from "recharts";
import { DeferredResponsiveContainer } from "@/components/deferred-chart";
import { formatCurrency } from "@/lib/utils";
import { waterfallRows, waterfallLabel, type WaterfallStep } from "@/lib/chart-math";
import { barProps, gridProps, tooltipProps, xAxisProps, yAxisProps, TIP_CARD, BAR_RADIUS } from "./chart-style";

// 범위 계산·라벨은 src/lib/chart-math.ts(테스트 있음). 빼는 항목이 음수(환입)면 더해진 칸으로 그린다.
export type { WaterfallStep } from "@/lib/chart-math";

const COLOR = {
  start: "var(--wf-start)",
  minus: "var(--wf-minus)",
  plus: "var(--wf-plus)",
  loss: "var(--wf-loss)",
};

export function WaterfallChart({ steps, height = 240, faded = false }: { steps: WaterfallStep[]; height?: number; faded?: boolean }) {
  const rows = waterfallRows(steps);
  // 막대 사이 점선(앞 막대 끝 높이에서 다음 막대까지)
  const connectors = rows.slice(0, -1).map((r, i) => ({ y: r.end, a: r.label, b: rows[i + 1].label }));

  return (
    <DeferredResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 22, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
        <CartesianGrid {...gridProps} />
        <XAxis {...xAxisProps} dataKey="label" />
        <YAxis {...yAxisProps} tickFormatter={(v: number) => `${Math.round(v / 10000).toLocaleString("ko-KR")}만`} width={56} />
        <ReferenceLine y={0} stroke="var(--chart-baseline)" />
        {connectors.map((c) => (
          <ReferenceLine key={c.a} segment={[{ x: c.a, y: c.y }, { x: c.b, y: c.y }]} stroke="var(--chart-dim)" strokeDasharray="2 3" ifOverflow="extendDomain" />
        ))}
        <Tooltip {...tooltipProps({ kind: "bar" })}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const r = payload[0].payload as (typeof rows)[number];
            return (
              <div className={TIP_CARD}>
                <div className="font-semibold text-[11.5px] text-muted-foreground mb-1">{r.label}</div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">{r.kind !== "minus" ? "금액" : r.added ? "더한 금액(환입)" : "빼는 금액"}</span>
                  <span className="font-bold chart-num">{r.kind === "minus" && r.amount !== 0 ? (r.added ? "+" : "−") : ""}{formatCurrency(r.kind === "result" ? r.amount : Math.abs(r.amount))}</span>
                </div>
                {r.kind !== "start" && r.share != null && (
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">매출 대비</span>
                    <span className="font-bold chart-num">{r.share.toFixed(1)}%</span>
                  </div>
                )}
                {r.kind === "minus" && (
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">{r.added ? "더하고 남은 값" : "빼고 남은 값"}</span>
                    <span className="chart-num">{formatCurrency(r.end)}</span>
                  </div>
                )}
                {r.note && <div className="text-[11px] text-muted-foreground mt-1 whitespace-normal max-w-[240px]">{r.note}</div>}
              </div>
            );
          }} />
        <Bar {...barProps} dataKey="range" radius={BAR_RADIUS} isAnimationActive={false}>
          {rows.map((r) => <Cell key={r.key} fill={COLOR[r.tone as keyof typeof COLOR]} fillOpacity={faded ? 0.45 : 1} />)}
          <LabelList dataKey="end" position="top" content={(p: { x?: number | string; y?: number | string; width?: number | string; index?: number }) => {
            const r = rows[p.index ?? -1];
            if (!r || p.x == null || p.y == null) return null;
            const text = waterfallLabel(r);
            return (
              <text x={Number(p.x) + Number(p.width || 0) / 2} y={Number(p.y) - 6} textAnchor="middle" fontSize={10.5}
                fontWeight={r.kind === "minus" && !r.added ? 500 : 700} fill={r.kind === "minus" && !r.added ? "var(--muted-foreground)" : "var(--foreground)"}>{text}</text>
            );
          }} />
        </Bar>
      </BarChart>
    </DeferredResponsiveContainer>
  );
}
