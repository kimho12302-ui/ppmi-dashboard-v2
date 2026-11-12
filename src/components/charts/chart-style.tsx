"use client";

// 그래프 겉모양 공용 모듈 (2026-11-10).
//
// ztd-charts 0.6.0(MIT) 의 모양만 옮겨 왔다. 라이브러리는 recharts 그대로이고 ztd 는 설치·import 하지 않는다.
// 2026-11-10 ztd 로 교체를 시험했더니 24개 중 10개가 정보를 잃어(계열 색·보조 y축·쌓은 영역 null 처리) 접었고,
// 김호 결정 「모양이라도 따와서 그려 넣어」에 따라 겉모습만 여기 모았다. 그래프마다 손으로 스타일을 박지 말고
// 아래 props·컴포넌트를 펼쳐 쓴다. 데이터·계열·축 개수·기준선·툴팁 내용은 각 화면이 그대로 가진다.
//
// 옮긴 값(ztd dist 의 src/theme/tokens.ts·core/css.ts·charts 공통):
//   축 글자 10.5px · 막대 모서리 4px(radiusMark) · 마우스 밖 계열 투명도 0.38(dim) · 전환 0.18s
//   툴팁 카드: 테두리 1px · 모서리 12 · 안쪽 8×11 · 글자 12/18 · 그림자 0 10px 28px -8px
//   x축 말풍선: 높이 18 · 모서리 9 · 굵게 · 잉크색 바탕 · 카드색 3px 테두리
// 색은 전부 CSS 변수(globals.css --chart-*)라 다크 모드에서 따로 맞는다.

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import {
  DefaultTooltipContent, LabelList, ZIndexLayer, useActiveTooltipCoordinate, useActiveTooltipLabel, useChartWidth, usePlotArea,
  type ActiveDotProps, type BarShapeProps, type DefaultTooltipContentProps, type LegendPayload,
} from "recharts";
import {
  isLastVisible, pruneHidden, seriesTotal, toggleHidden, TOTAL_LABEL, VISIBLE_TOTAL_LABEL,
} from "@/lib/chart-math";

// ── 토큰 ─────────────────────────────────────────────────────────────────────
export const AXIS_FONT = 10.5;
/** 마우스를 올리지 않은 막대의 투명도(ztd dim). 색이 아니라 투명도로만 옅게 한다. */
export const DIM_OPACITY = 0.38;
/** 세로 막대 위쪽만 둥글게(쌓은 막대는 맨 위 계열에만 쓴다) */
export const BAR_RADIUS: [number, number, number, number] = [4, 4, 0, 0];
/** 가로 막대 오른쪽만 둥글게 */
export const BAR_RADIUS_H: [number, number, number, number] = [0, 4, 4, 0];
export const NO_RADIUS: [number, number, number, number] = [0, 0, 0, 0];
/** 점을 찍는 최대 점 개수. 이보다 많으면 선이 점으로 뭉개져 마우스 올린 점만 보인다. */
export const DOT_MAX_POINTS = 40;

const TICK = { fontSize: AXIS_FONT, fill: "var(--chart-tick)" };

// ── 축·보조선 ────────────────────────────────────────────────────────────────
/** x축: 눈금 표시 없음, 바닥선만 옅게(ztd 의 0 기준선). tickFormatter·ticks·minTickGap 은 화면이 덧붙인다. */
export const xAxisProps = {
  tickLine: false,
  axisLine: { stroke: "var(--chart-baseline)" },
  tick: TICK,
  tickMargin: 4,
} as const;
/** y축: 눈금 표시·세로 축선 없음 */
export const yAxisProps = { tickLine: false, axisLine: false, tick: TICK } as const;
/** 숨긴 축(스몰 멀티플)은 그대로 hide 를 쓴다. 작은 칸 글자 크기를 바꿀 때 */
export const tickOf = (fontSize: number) => ({ ...TICK, fontSize });
/** 가로 보조선만 아주 옅게(세로 보조선 없음) */
export const gridProps = { vertical: false, stroke: "var(--chart-grid-soft)" } as const;
/** 가로 막대(layout="vertical")는 값 축이 가로라 세로 보조선만 둔다 */
export const gridPropsH = { horizontal: false, stroke: "var(--chart-grid-soft)" } as const;

// ── 범례 ─────────────────────────────────────────────────────────────────────
/** 글자는 회색, 색은 아이콘이 낸다(globals.css .recharts-legend-item-text) */
export const legendProps = { iconSize: 9, wrapperStyle: { fontSize: 11, paddingTop: 6 } } as const;

// ── 툴팁 ─────────────────────────────────────────────────────────────────────
const TIP_SHADOW = "0 10px 28px -8px rgba(0,0,0,0.28), 0 2px 6px rgba(0,0,0,0.08)";
/** 기본 툴팁(내용은 recharts 기본 그대로: formatter·labelFormatter·itemSorter·null 숨김) 위에 입히는 카드 모양 */
const tooltipBase = {
  wrapperClassName: "chart-tip",
  contentStyle: {
    backgroundColor: "var(--card)", color: "var(--foreground)",
    border: "1px solid var(--chart-tooltip-border)", borderRadius: 12, padding: "8px 11px",
    fontSize: 12, lineHeight: "18px", boxShadow: TIP_SHADOW,
    // 좁은 화면에서 넘치지 않게: 그래프 그림 영역 폭(화면 폭 − 카드 여백·y축 약 140px)을 넘지 않고, 넘치면 줄을 바꾼다(검수 L6)
    whiteSpace: "normal", overflowWrap: "anywhere", minWidth: 112, maxWidth: "min(320px, calc(100vw - 140px))",
  },
  labelStyle: { fontWeight: 600, fontSize: 11.5, color: "var(--muted-foreground)", marginBottom: 4 },
  // color 는 넣지 않는다. recharts 가 계열 색을 li 에 넣고, 그 색으로 앞의 점을 칠한다(globals.css .chart-tip)
  itemStyle: { display: "flex", alignItems: "center", gap: 7, paddingTop: 1, paddingBottom: 1 },
  separator: "",
  animationDuration: 160,
  animationEasing: "ease-out",
} as const;

/** 커서 없이 카드 모양·움직임만(산점도처럼 cursor 를 따로 쓰는 그래프) */
export const tooltipCardProps = tooltipBase;

/** 직접 그린 툴팁(content=) 의 바깥 상자. 내용은 각 화면 그대로 두고 이 클래스만 씌운다. */
export const TIP_CARD = "chart-tip-card";
/** 스몰 멀티플처럼 작은 칸의 한 줄 툴팁 */
export const TIP_CARD_SM = "chart-tip-card chart-tip-card--sm";

type CursorKind = "bar" | "bar-h" | "line";
interface TooltipOpts {
  /** bar: 막대(마우스 올린 칸만 진하게 + 말풍선) · bar-h: 가로 막대 · line: 선·영역(세로 안내선 + 말풍선) */
  kind: CursorKind;
  /** x축 tickFormatter 를 그대로 넘긴다. 말풍선이 축 글자와 같은 모양이 되게 */
  tickFormatter?: (v: never, i: number) => string;
  /** x축을 숨긴 그래프는 false */
  pill?: boolean;
}

/** 툴팁 공용 props. 화면의 formatter·labelFormatter·itemSorter·content 는 뒤에 덧붙인다. */
export function tooltipProps(opts: TooltipOpts) {
  return {
    ...tooltipBase,
    cursor: <HoverCursor kind={opts.kind} format={opts.tickFormatter} pill={opts.pill !== false} />,
  };
}

// ── 마우스 올림 표시 ─────────────────────────────────────────────────────────
interface HoverCursorProps {
  kind: CursorKind;
  format?: (v: never, i: number) => string;
  pill: boolean;
  /** recharts 가 넣어 주는 활성 칸 번호 */
  payloadIndex?: string | number;
}

/**
 * recharts Tooltip 의 cursor 자리에 들어가는 컴포넌트. 마우스가 그래프 위에 있을 때만 그려진다.
 * - 막대: 올린 칸(쌓은 막대는 그 칸 전체)만 진하게, 나머지는 투명도 0.38. 계열 색·진행 중 칸의 옅은 칠은 그대로 곱해진다.
 * - 선·영역: 아주 옅은 세로 안내선
 * - x축 그 날짜 글자 위에 검은 둥근 말풍선
 */
export function HoverCursor(props: HoverCursorProps) {
  const plot = usePlotArea();
  const coord = useActiveTooltipCoordinate();
  if (!plot || !coord) return null;
  const isBar = props.kind !== "line";
  return (
    <>
      {isBar && props.payloadIndex != null && <BarDim index={String(props.payloadIndex)} />}
      {props.kind === "line" && (
        <line x1={coord.x} x2={coord.x} y1={plot.y} y2={plot.y + plot.height}
          stroke="var(--chart-dim)" strokeWidth={1} pointerEvents="none" />
      )}
      {props.pill && props.kind !== "bar-h" && (
        <ZIndexLayer zIndex={2100}>
          <AxisPill x={coord.x} y={plot.y + plot.height} format={props.format} />
        </ZIndexLayer>
      )}
    </>
  );
}

/** 막대 shape. data-i 로 칸 번호를 달아 두면 HoverCursor 가 CSS 한 줄로 나머지를 옅게 한다(막대마다 훅 없음). */
export function HoverBar(props: BarShapeProps) {
  const { x, y, width, height, fill, fillOpacity, radius, stroke, strokeWidth, originalDataIndex, index } = props as unknown as {
    x: number; y: number; width: number; height: number; fill?: string; fillOpacity?: number;
    radius?: number | [number, number, number, number]; stroke?: string; strokeWidth?: number;
    originalDataIndex?: number; index?: number;
  };
  if (x == null || y == null || !width || !height) return <g />;
  const i = originalDataIndex ?? index;
  return (
    <g className="hb" data-i={i}>
      <path d={roundedRect(x, y, width, height, radius)} fill={fill} fillOpacity={fillOpacity}
        stroke={stroke} strokeWidth={stroke ? strokeWidth : 0} />
    </g>
  );
}
/** Bar 에 펼쳐 넣는다: <Bar {...barProps} .../> */
export const barProps = { shape: HoverBar } as const;

function roundedRect(x: number, y: number, w: number, h: number, radius?: number | [number, number, number, number]) {
  // 음수 높이(아래로 그리는 막대)는 정규화한다
  const x0 = w < 0 ? x + w : x;
  const y0 = h < 0 ? y + h : y;
  const W = Math.abs(w);
  const H = Math.abs(h);
  const r = Array.isArray(radius) ? radius : [radius || 0, radius || 0, radius || 0, radius || 0];
  const cap = Math.min(W, H) / 2;
  const [tl, tr, br, bl] = r.map((v) => Math.max(0, Math.min(v, cap)));
  return [
    `M${x0 + tl},${y0}`, `H${x0 + W - tr}`, tr ? `A${tr},${tr} 0 0 1 ${x0 + W},${y0 + tr}` : "",
    `V${y0 + H - br}`, br ? `A${br},${br} 0 0 1 ${x0 + W - br},${y0 + H}` : "",
    `H${x0 + bl}`, bl ? `A${bl},${bl} 0 0 1 ${x0},${y0 + H - bl}` : "",
    `V${y0 + tl}`, tl ? `A${tl},${tl} 0 0 1 ${x0 + tl},${y0}` : "", "Z",
  ].join(" ");
}

function BarDim({ index }: { index: string }) {
  const ref = useRef<SVGGElement>(null);
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  useLayoutEffect(() => {
    const svg = ref.current?.ownerSVGElement;
    if (!svg) return;
    svg.setAttribute("data-hc", id);
    return () => svg.removeAttribute("data-hc");
  }, [id]);
  const safe = index.replace(/[^0-9]/g, "");
  return (
    <g ref={ref} aria-hidden>
      <style>{`svg[data-hc="${id}"] .hb:not([data-i="${safe}"]){opacity:${DIM_OPACITY}}`}</style>
    </g>
  );
}

/** 글자 폭 어림(굵은 10.5px). 한글·전각은 글자 크기만큼, 나머지는 0.6배 */
function textWidth(s: string) {
  let w = 0;
  for (const ch of s) w += /[ㄱ-힝　-ヿ＀-￯]/.test(ch) ? AXIS_FONT : AXIS_FONT * 0.6;
  return w;
}

function AxisPill({ x, y, format }: { x: number; y: number; format?: (v: never, i: number) => string }) {
  const label = useActiveTooltipLabel();
  const chartWidth = useChartWidth() ?? 0;
  if (label == null || label === "") return null;
  const text = format ? format(label as never, 0) : String(label);
  if (!text) return null;
  const w = textWidth(text) + 14;
  const cx = chartWidth ? Math.max(w / 2 + 1, Math.min(chartWidth - w / 2 - 1, x)) : x;
  // 축 글자 가운데(바닥선 + 4px 여백 + 글자 반 높이)에 맞춘다
  const cy = y + 4 + AXIS_FONT * 0.85 + 2;
  return (
    <g pointerEvents="none" aria-hidden className="chart-pill">
      <rect x={cx - w / 2} y={cy - 9} width={w} height={18} rx={9}
        fill="var(--chart-ink)" stroke="var(--card)" strokeWidth={3} paintOrder="stroke" />
      <text x={cx} y={cy} dy="0.35em" textAnchor="middle" fontSize={AXIS_FONT} fontWeight={700} fill="var(--chart-on-ink)">{text}</text>
    </g>
  );
}

// ── 선의 점 ──────────────────────────────────────────────────────────────────
/** 속이 흰(카드색) 작은 원, 테두리는 선 색(recharts 가 선 stroke 를 넘긴다) */
export const LINE_DOT = { r: 2.4, fill: "var(--card)", strokeWidth: 1.3 } as const;
/** 점이 적은 선만 점을 찍는다. 많으면 false(마우스 올린 점만 보인다) */
export const lineDot = (points: number) => (points <= DOT_MAX_POINTS ? LINE_DOT : false);

/** 마우스 올린 점: 크게, 속은 카드색, 옅은 후광 */
export function ActiveDot(props: { cx?: number; cy?: number; fill?: string; stroke?: string }) {
  const { cx, cy } = props;
  if (cx == null || cy == null) return <g />;
  // recharts 는 activeDot 의 fill 에 선 색을 넣는다
  const color = props.fill && props.fill !== "#fff" ? props.fill : props.stroke || "var(--foreground)";
  return (
    <g pointerEvents="none">
      <circle cx={cx} cy={cy} r={8} fill={color} opacity={0.16} />
      <circle cx={cx} cy={cy} r={4.2} fill="var(--card)" stroke={color} strokeWidth={2} />
    </g>
  );
}
/** Line·Area 에 펼쳐 넣는다: activeDot */
export const activeDotProps = { activeDot: (p: ActiveDotProps) => <ActiveDot cx={p.cx} cy={p.cy} fill={typeof p.fill === "string" ? p.fill : undefined} /> };

// ── 선 끝 라벨 ───────────────────────────────────────────────────────────────
/** 마지막 null 아닌 값의 위치 */
export function lastIndexOf(rows: readonly object[], key: string): number {
  for (let i = rows.length - 1; i >= 0; i--) if ((rows[i] as Record<string, unknown> | undefined)?.[key] != null) return i;
  return -1;
}

/**
 * 계열이 적은 선 그래프의 오른쪽 끝 라벨(「평균 1.43%」처럼 이름·마지막 값).
 * <Line>{endLabel(...)}</Line> 처럼 선의 자식으로 넣는다. 오른쪽 여백(margin.right)을 라벨 폭만큼 둘 것.
 */
export function endLabel(opts: { rows: readonly object[]; dataKey: string; name?: string; format: (v: number) => string }): ReactElement {
  const last = lastIndexOf(opts.rows, opts.dataKey);
  return (
    <LabelList dataKey={opts.dataKey} content={(p: { x?: number | string; y?: number | string; index?: number; value?: unknown }) => {
      if (p.index !== last || p.value == null || p.x == null || p.y == null) return null;
      return (
        <text x={Number(p.x) + 7} y={Number(p.y)} dy="0.35em" fontSize={11} fill="var(--foreground)" pointerEvents="none">
          {opts.name && <tspan fill="var(--muted-foreground)" fontWeight={500}>{opts.name} </tspan>}
          <tspan fontWeight={700} className="chart-num">{opts.format(Number(p.value))}</tspan>
        </text>
      );
    }} />
  );
}

// ── 등장 애니메이션 ──────────────────────────────────────────────────────────
/**
 * 짧고 부드럽게(0.42초, 끝이 느려지는 곡선). 움직임 줄이기 설정이면 끈다.
 * ★ 조밀한 일별 막대·선(수백 개 사각형)은 성능 때문에 원래대로 isAnimationActive={false} 를 유지한다(2026-10-14 프로파일).
 */
export function useEnterAnim() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return { isAnimationActive: !reduced, animationDuration: 420, animationEasing: "ease-out" as const };
}

// ── 색 토큰(검색 수요 그래프가 쓰던 theme-colors 흡수) ─────────────────────────
export const chartTheme = {
  grid: "var(--chart-grid-soft)",
  tick: "var(--chart-tick)",
  tooltipBg: "var(--chart-tooltip-bg)",
  tooltipBorder: "var(--chart-tooltip-border)",
  tooltipText: "var(--chart-tooltip-text)",
};

// ── 범례 눌러 골라 보기 (2026-11-12) ──────────────────────────────────────────
// 김호: "그래프에서 범례 클릭하면 선택해서 보게 해줘".
// 숨김은 각 Bar·Line·Area 의 hide 로 한다(dataKey 를 지우지 않는다: 지우면 색 순서가 바뀐다).
// hide 한 계열은 recharts 가 y축 범위·쌓기·툴팁에서 뺀다. 상태는 그래프 컴포넌트 안(새로고침하면 처음으로).

const NO_HIDDEN: readonly string[] = [];

export interface SeriesToggle {
  /** 범례로 고를 수 있는 계열 dataKey(그리는 순서) */
  keys: readonly string[];
  /** 숨긴 계열 */
  hidden: readonly string[];
  isHidden: (key: string) => boolean;
  toggle: (key: string) => void;
  /** 「전체 보기」 */
  reset: () => void;
}

/**
 * 범례 토글 상태. keys = 고를 수 있는 계열 전부(합계 대상이 아니어도 된다, 예: 매출 막대 위 광고비 선).
 * scope = 계열 이름이 겹칠 수 있는 차원 전환(판매처 ↔ 브랜드의 「other」, 라인업 ↔ 제품의 「기타」)이 일어나면 바꾸는 값.
 *         scope 가 바뀌면 숨김을 비운다. 같은 scope 안에서 없어진 키는 정리한다(pruneHidden).
 */
export function useSeriesToggle(keys: readonly string[], scope: string = ""): SeriesToggle {
  const sig = keys.join("\u0000");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableKeys = useMemo(() => [...keys], [sig]);
  const [state, setState] = useState<{ scope: string; hidden: readonly string[] }>({ scope, hidden: NO_HIDDEN });
  const raw = state.scope === scope ? state.hidden : NO_HIDDEN;
  const hidden = useMemo(() => pruneHidden(raw, stableKeys), [raw, stableKeys]);
  // 계열 목록·차원이 바뀌어 정리된 결과를 상태에도 반영한다(같은 이름이 나중에 돌아와도 숨긴 채로 남지 않게)
  useEffect(() => {
    if (state.scope !== scope || state.hidden !== hidden) setState({ scope, hidden });
  }, [scope, hidden, state.scope, state.hidden]);
  const toggle = useCallback((key: string) => {
    setState((s) => {
      const cur = pruneHidden(s.scope === scope ? s.hidden : NO_HIDDEN, stableKeys);
      const next = toggleHidden(cur, key, stableKeys);
      return next === s.hidden && s.scope === scope ? s : { scope, hidden: next };
    });
  }, [scope, stableKeys]);
  const reset = useCallback(() => setState({ scope, hidden: NO_HIDDEN }), [scope]);
  const isHidden = useCallback((key: string) => hidden.includes(key), [hidden]);
  return useMemo(() => ({ keys: stableKeys, hidden, isHidden, toggle, reset }), [stableKeys, hidden, isHidden, toggle, reset]);
}

type LegendFormatter = (value: string | undefined, entry: LegendPayload, index: number) => ReactNode;

interface ToggleLegendProps {
  toggle: SeriesToggle;
  /** recharts Legend 가 넣어 준다 */
  payload?: readonly LegendPayload[];
  /** <Legend formatter> 를 그대로 받는다(이름 바꾸기) */
  formatter?: LegendFormatter;
}

function legendKey(e: LegendPayload): string | null {
  const k = (e as { dataKey?: unknown }).dataKey;
  return typeof k === "string" || typeof k === "number" ? String(k) : null;
}

/**
 * <Legend content> 자리에 들어가는 눌러 고르는 범례. 항목마다 button(aria-pressed = 보이는 중, Enter·Space 동작).
 * 숨긴 항목은 흐리고 취소선. 보이는 마지막 하나는 눌러도 숨지 않는다. 하나라도 숨겼으면 「전체 보기」.
 * legendType="none" 계열(매출 구성의 합계 라벨용 투명 선 등)은 그리지 않는다.
 */
export function ToggleLegend({ toggle, payload, formatter }: ToggleLegendProps) {
  const items = (payload || []).filter((e) => e.type !== "none");
  if (!items.length) return null;
  const anyHidden = toggle.hidden.length > 0;
  return (
    <div className="chart-legend" role="group" aria-label="범례: 누르면 그 계열을 숨기거나 다시 보입니다">
      {items.map((e, i) => {
        const key = legendKey(e);
        const name = e.value ?? key ?? "";
        const label = formatter ? formatter(e.value, e, i) : name;
        const color = e.color || "var(--muted-foreground)";
        const icon = <LegendIcon type={e.type} color={color} />;
        if (key == null || !toggle.keys.includes(key)) {
          return <span key={`s${i}`} className="chart-legend-item chart-legend-item--static">{icon}<span className="chart-legend-text">{label}</span></span>;
        }
        const hidden = toggle.isHidden(key);
        const locked = !hidden && isLastVisible(toggle.hidden, key, toggle.keys);
        return (
          <button key={key} type="button"
            className={"chart-legend-item" + (hidden ? " is-hidden" : "") + (locked ? " is-locked" : "")}
            aria-pressed={!hidden}
            aria-disabled={locked || undefined}
            title={locked ? "마지막 하나는 숨길 수 없습니다" : hidden ? "눌러서 다시 보기" : "눌러서 숨기기"}
            onClick={() => toggle.toggle(key)}>
            {icon}<span className="chart-legend-text">{label}</span>
          </button>
        );
      })}
      {anyHidden && (
        <button type="button" className="chart-legend-reset" onClick={(e) => {
          // 누르면 이 버튼이 사라지므로 키보드 포커스를 첫 범례 항목으로 옮긴다
          const group = e.currentTarget.parentElement;
          toggle.reset();
          requestAnimationFrame(() => group?.querySelector<HTMLButtonElement>(".chart-legend-item")?.focus());
        }}>전체 보기</button>
      )}
    </div>
  );
}

function LegendIcon({ type, color }: { type?: string; color: string }) {
  const line = type === "line" || type === "plainline";
  return <span aria-hidden className={line ? "chart-legend-icon chart-legend-icon--line" : "chart-legend-icon"} style={{ ["--c" as string]: color }} />;
}

/** <Legend {...legendProps} {...legendToggleProps(t)} formatter={...} /> */
export function legendToggleProps(toggle: SeriesToggle) {
  return { content: <ToggleLegend toggle={toggle} /> };
}

// ── 툴팁 합계 (2026-11-12) ────────────────────────────────────────────────────
// 김호: "합산 그래프는 마우스오버했을 때 총합도 보이게 해줘".
// 더해서 뜻이 있는 계열(sumKeys)만 화면이 고른다. 비율(ROAS·CTR·전환율)·다른 단위·상위 N개만 그린 선은 넣지 않는다.
// 값은 툴팁 줄(payload)이 아니라 그 칸의 행에서 읽는다(recharts 는 null·숨긴 줄을 툴팁에서 이미 빼서, 줄로는 전부 null 을 알 수 없다).

/** 툴팁 맨 아래 구분선 + 「합계 1,234,567원」 한 줄. 직접 그린 툴팁도 이걸 쓴다. */
export function TooltipTotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="chart-tip-total">
      <span>{label}</span><span className="chart-num">{value}</span>
    </div>
  );
}

export interface TotalTooltipOpts {
  sumKeys: readonly string[];
  hiddenKeys?: readonly string[];
  formatTotal: (v: number) => string;
  /** 기본 「합계」. 매출 막대 + 광고비 선처럼 다른 금액 계열이 같이 있으면 「매출 합계」처럼 무엇의 합인지 */
  totalLabel?: string;
  /** 숨긴 계열이 있을 때. 기본 「보이는 항목 합계」(totalLabel 을 주면 「보이는 매출 합계」) */
  visibleTotalLabel?: string;
}

/** 합계 라벨 한 벌(툴팁·직접 그린 툴팁 공용) */
export function totalLabels(opts: Pick<TotalTooltipOpts, "totalLabel" | "visibleTotalLabel">): [string, string] {
  return [opts.totalLabel || TOTAL_LABEL, opts.visibleTotalLabel || (opts.totalLabel ? `보이는 ${opts.totalLabel}` : VISIBLE_TOTAL_LABEL)];
}

const INNER_TIP_STYLE = {
  margin: 0, padding: 0, border: "none", background: "transparent", backgroundColor: "transparent",
  boxShadow: "none", borderRadius: 0, minWidth: 0, maxWidth: "none", whiteSpace: "normal", overflowWrap: "anywhere",
} as const;

type TotalTooltipProps = DefaultTooltipContentProps & TotalTooltipOpts & { active?: boolean };

/** recharts 기본 툴팁 내용(formatter·labelFormatter·itemSorter 그대로) 아래에 합계 줄을 붙인다 */
export function TotalTooltip(props: TotalTooltipProps) {
  const { sumKeys, hiddenKeys, formatTotal, contentStyle, active, payload } = props;
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as Record<string, unknown> | undefined;
  const [base, visible] = totalLabels(props);
  const t = seriesTotal(row, sumKeys, hiddenKeys || NO_HIDDEN, base, visible);
  return (
    <div style={contentStyle}>
      <DefaultTooltipContent {...props} contentStyle={INNER_TIP_STYLE} />
      {t && <TooltipTotalRow label={t.label} value={t.value == null ? "-" : formatTotal(t.value)} />}
    </div>
  );
}

/** <Tooltip {...tooltipProps(...)} formatter={...} {...totalTooltipProps({ sumKeys, hiddenKeys: t.hidden, formatTotal })} /> */
export function totalTooltipProps(opts: TotalTooltipOpts) {
  return { content: <TotalTooltip {...(opts as TotalTooltipProps)} /> };
}
