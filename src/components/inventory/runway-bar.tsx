"use client";

// 표 행마다 그리는 「남은 날」 막대 (기획 v2). 모든 행이 같은 축(0 ~ 120일)이라 위아래로 길이를 바로 비교한다.
//   점선 두 개 = 이 상품의 발주 필요선(사입 15 · 너티 20일 등, 판정 기준)과 과재고선(60일)
//   120일을 넘으면 막대 끝에 › 를 붙인다. 품절은 빨간 점 하나, 출고 0 은 막대 대신 글자.
//   발주를 넣은 상품은 입고 예정일 자리에 파란 마름모.
import type { InventoryRow } from "@/lib/inventory";
import { RUNWAY_AXIS_DAYS, daysBetween } from "@/lib/inventory";
import { BAR_COLOR, fmt1 } from "./inventory-ui";

const pct = (days: number) => `${(Math.min(Math.max(days, 0), RUNWAY_AXIS_DAYS) / RUNWAY_AXIS_DAYS) * 100}%`;

export function RunwayBar({ row, asOf }: { row: InventoryRow; asOf: string | null }) {
  const t = row.thresholds;
  const over = row.runway !== null && row.runway > RUNWAY_AXIS_DAYS;
  const arrive = row.incoming?.expected_at && asOf ? daysBetween(asOf, row.incoming.expected_at) : null;
  const label = row.status === "soldout" ? "0일" : row.runway === null ? (row.status === "excluded" ? "" : "계산 불가") : `${fmt1(row.runway)}일`;

  return (
    <div className="flex items-center gap-2 min-w-0" aria-label={`남은 날 ${label}`}>
      <div className="relative h-3 flex-1 min-w-[96px] rounded-sm bg-muted/60">
        {/* 기준선: 발주 필요 · 과재고 */}
        <span className="absolute inset-y-[-3px] border-l border-dashed" style={{ left: pct(t.warn), borderColor: "#ea580c" }} aria-hidden />
        <span className="absolute inset-y-[-3px] border-l border-dashed" style={{ left: pct(t.over), borderColor: "var(--sig-idle)" }} aria-hidden />
        {row.status === "soldout" && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full" style={{ backgroundColor: "var(--sig-danger)" }} aria-hidden />
        )}
        {row.runway !== null && row.status !== "soldout" && (
          <span className="absolute left-0 inset-y-0 rounded-sm" style={{ width: pct(row.runway), backgroundColor: BAR_COLOR[row.status] }} aria-hidden />
        )}
        {arrive !== null && arrive >= 0 && (
          <span
            className="absolute top-1/2 w-2.5 h-2.5 rotate-45 -translate-y-1/2 -translate-x-1/2 border border-white"
            style={{ left: pct(arrive), backgroundColor: "#2563eb" }}
            title={`입고 예정 ${row.incoming?.expected_at} · ${row.incoming?.qty}개`}
            aria-hidden
          />
        )}
        {over && <span className="absolute -right-2.5 top-1/2 -translate-y-1/2 text-[11px] leading-none font-bold text-muted-foreground" aria-hidden>›</span>}
      </div>
      <span className="num w-[58px] shrink-0 text-right text-xs tabular-nums text-muted-foreground">{label}</span>
    </div>
  );
}

/** 표 머리의 축 눈금 (0 · 30 · 60 · 90 · 120일) */
export function RunwayAxis() {
  return (
    <div className="flex items-center gap-2" aria-hidden>
      <div className="relative h-3 flex-1 min-w-[96px] text-[10px] text-muted-foreground">
        {[0, 30, 60, 90, 120].map((d) => (
          <span key={d} className="absolute -translate-x-1/2 num" style={{ left: pct(d) }}>{d}{d === 120 ? "+" : ""}</span>
        ))}
      </div>
      <span className="w-[58px] shrink-0" />
    </div>
  );
}
