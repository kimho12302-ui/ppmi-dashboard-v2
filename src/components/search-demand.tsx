"use client";

import { useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { useFetch } from "@/hooks/use-dashboard-data";
import { chartTheme } from "@/components/charts/theme-colors";
import { cn } from "@/lib/utils";
import type { SearchDemand, SearchDemandResult, TermSeries } from "@/lib/search-demand";

// 키워드 탭 > 검색 수요. 네이버 데이터랩 주별 지수. 2026-11-03 신설.
// 데이터는 사람이 브라우저로 한 번 긁어 넣은 파일(src/data/search-demand-weekly.json)이다. 자동 갱신이 아니므로
// 화면 맨 위에 "수동 수집, 마지막 수집일"을 늘 보인다.
// "우리 카테고리 검색어가 시장(비교군)보다 얼마나 줄었나"를 한 장으로 본다.
//   - 각 검색어를 자기 첫 52주 평균 = 100 으로 맞춘 지수. 얇은 선 = 주별 원값, 굵은 선 = 4주 이동평균.
//     모발검사는 주 30~40회라 주별 값이 크게 출렁인다. 읽는 선은 이동평균이다.
//   - 비교군 두 줄(건강 일반어·무관 일반어 평균)은 어떤 카테고리를 골라도 항상 같이 그린다.
//   - 오른쪽 숫자 = 최근 13주 전년 동기 대비. KPI 카드로 같은 숫자를 또 쓰지 않는다.
// 계산은 src/lib/search-demand.ts 한 곳에서 한다(서버). 이 파일은 그리기만 한다.

type Resp = SearchDemandResult & { error?: string };

const CATEGORY_COLOR: Record<string, string> = {
  // 키 = 파일 groups 의 묶음 이름
  "모발": "#b45309",
  "음식물과민증": "#0f766e",
  "타액호르몬": "#7c3aed",
  "브랜드": "#304FE8",
};
const FALLBACK_COLORS = ["#be123c", "#0369a1", "#4d7c0f", "#a21caf"];
const COMPARE_STYLE = [
  { color: "#6b7280", dash: undefined, label: "실선" },
  { color: "#9ca3af", dash: "6 4", label: "점선" },
];

const CHART_H = 380;
const MARGIN = { top: 12, right: 8, bottom: 4, left: 0 };
const XAXIS_H = 28;
const LABEL_GAP = 36; // 라벨 한 덩어리(이름 14px + 퍼센트 18px) + 여백

/** 한 색에서 검색어마다 밝기만 다르게. 0 = 원색, 1 = 흰색. */
function tint(hex: string, t: number) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * t);
  const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

const pctText = (v: number | null) => (v === null ? "비교 불가" : `${v > 0 ? "+" : ""}${Math.round(v * 100)}%`);
const lastValue = (xs: (number | null)[]) => {
  for (let i = xs.length - 1; i >= 0; i--) if (xs[i] !== null) return xs[i] as number;
  return null;
};
const weekTick = (w: string) => `${w.slice(2, 4)}.${w.slice(5, 7)}`;

export function SearchDemandSection() {
  const { data, loading, error } = useFetch<Resp>("/api/search-demand");
  if (loading && !data) return <Card><CardContent className="p-8 text-center text-muted-foreground">검색 수요 불러오는 중...</CardContent></Card>;
  if (error || (data && "error" in data && data.error)) {
    return <Card><CardContent className="p-4 text-sm text-amber-600">검색 수요 오류: {error || (data as { error?: string }).error}</CardContent></Card>;
  }
  if (!data || !data.ready) {
    return <NotReady notice={data && !data.ready ? data.notice : null} collectedAt={data && !data.ready ? data.collectedAt : null} />;
  }
  return <DemandChart data={data} />;
}

function NotReady({ notice, collectedAt }: { notice: string | null; collectedAt: string | null }) {
  return (
    <Card className="border-amber-300 dark:border-amber-800 bg-amber-500/5">
      <CardContent className="p-4 text-sm text-muted-foreground space-y-1">
        <p className="font-medium text-amber-700 dark:text-amber-500">데이터 없음 · 마지막 수집일 {collectedAt ?? "없음"}</p>
        <p>{notice || "주별 검색 수요 파일이 아직 올라오지 않았습니다."}</p>
        <p className="text-xs">검색 수요가 0이어서 비어 있는 것이 아니라, 수동 수집한 값이 아직 없는 것입니다.</p>
      </CardContent>
    </Card>
  );
}

interface LineSpec { key: string; name: string; color: string; dash?: string; series: TermSeries }

function DemandChart({ data }: { data: SearchDemand }) {
  const categories = data.groups.filter((g) => g.kind === "category");
  const compareGroups = data.groups.filter((g) => g.kind === "compare");
  const [selected, setSelected] = useState(categories[0]?.id ?? "");
  const activeId = categories.some((c) => c.id === selected) ? selected : categories[0]?.id ?? "";
  const ci = categories.findIndex((c) => c.id === activeId);
  const baseColor = CATEGORY_COLOR[activeId] ?? FALLBACK_COLORS[Math.max(ci, 0) % FALLBACK_COLORS.length];

  const lines = useMemo<LineSpec[]>(() => {
    const members = data.terms.filter((t) => t.group === activeId);
    return members.map((s, i) => ({
      key: `t${i}`, name: s.term, series: s,
      color: tint(baseColor, members.length > 1 ? (i / (members.length - 1)) * 0.35 : 0),
    }));
  }, [data.terms, activeId, baseColor]);

  const compareLines = useMemo<LineSpec[]>(() => data.compare.map((s, i) => ({
    key: `c${i}`, name: s.term, series: s,
    color: COMPARE_STYLE[i % COMPARE_STYLE.length].color, dash: COMPARE_STYLE[i % COMPARE_STYLE.length].dash,
  })), [data.compare]);

  const rows = useMemo(() => data.weeks.map((w, i) => {
    const row: Record<string, string | number | null> = { week: w };
    for (const l of lines) { row[`${l.key}r`] = l.series.index[i]; row[`${l.key}m`] = l.series.ma[i]; }
    for (const l of compareLines) row[`${l.key}m`] = l.series.ma[i];
    return row;
  }), [data.weeks, lines, compareLines]);

  // 세로 범위는 굵은 선(이동평균) 기준. 얇은 원값이 튀는 주는 위가 잘린다(읽는 선은 굵은 선이다).
  const yMax = useMemo(() => {
    const vals = [...lines, ...compareLines].flatMap((l) => l.series.ma).filter((v): v is number => v !== null);
    return Math.max(150, Math.ceil((Math.max(...vals, 100) * 1.15) / 50) * 50);
  }, [lines, compareLines]);

  const ticks = useMemo(() => data.weeks.filter((w, i) => {
    if (i === 0) return true;
    const m = Number(w.slice(5, 7));
    return w.slice(5, 7) !== data.weeks[i - 1].slice(5, 7) && [1, 4, 7, 10].includes(m);
  }), [data.weeks]);

  const labels = useMemo(() => endLabels([...lines, ...compareLines], yMax), [lines, compareLines, yMax]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-0.5 rounded-lg bg-muted p-1 w-fit">
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelected(c.id)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap",
                activeId === c.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground/80">수동 수집, 마지막 수집일 {data.collectedAt}</span>
          {" · "}자동 갱신 안 됨 · 상단 기간·브랜드 선택과 상관없이 {data.weeks[0].slice(0, 7)} 부터 전 기간
        </p>
      </div>

      <Card>
        <CardContent className="p-4">
          <h3 className="font-semibold text-sm">네이버 검색 수요, 주별 지수 ({data.baseline.from.slice(0, 7)} ~ {data.baseline.to.slice(0, 7)} 평균 = 100)</h3>
          <p className="text-xs text-muted-foreground mt-1 mb-3">
            굵은 선 = 4주 이동평균, 얇은 선 = 주별 원값. 오른쪽 숫자 = 최근 13주({data.yoyWindow.from} ~ {data.yoyWindow.to} 주) 전년 같은 13주 대비.
          </p>
          <div className="flex min-w-0">
            <div className="flex-1 min-w-0" style={{ height: CHART_H }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows} margin={MARGIN}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} vertical={false} />
                  <XAxis dataKey="week" ticks={ticks} tickFormatter={weekTick} height={XAXIS_H}
                    tick={{ fontSize: 11, fill: chartTheme.tick }} interval="preserveStartEnd" minTickGap={12} />
                  <YAxis domain={[0, yMax]} allowDataOverflow width={40} tick={{ fontSize: 11, fill: chartTheme.tick }} />
                  <ReferenceLine y={100} stroke={chartTheme.tick} strokeDasharray="2 4" />
                  <Tooltip content={<DemandTooltip lines={lines} compareLines={compareLines} />} />
                  {lines.map((l) => (
                    <Line key={`${l.key}r`} dataKey={`${l.key}r`} stroke={l.color} strokeWidth={1} strokeOpacity={0.35}
                      dot={false} activeDot={false} isAnimationActive={false} connectNulls={false} />
                  ))}
                  {compareLines.map((l) => (
                    <Line key={`${l.key}m`} dataKey={`${l.key}m`} stroke={l.color} strokeWidth={2} strokeDasharray={l.dash}
                      dot={false} isAnimationActive={false} />
                  ))}
                  {lines.map((l) => (
                    <Line key={`${l.key}m`} dataKey={`${l.key}m`} stroke={l.color} strokeWidth={2.75}
                      dot={false} isAnimationActive={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="relative w-[92px] sm:w-[124px] shrink-0" style={{ height: CHART_H }} aria-label="최근 13주 전년 대비">
              {labels.map((l) => (
                <div key={l.key} className="absolute left-2 right-0" style={{ top: l.y - 14 }}>
                  <div className="text-[11px] leading-[14px] truncate" style={{ color: l.color }}>{l.name}</div>
                  <div className="text-sm leading-[18px] font-semibold tabular-nums" style={{ color: l.color }}>{pctText(l.yoy)}</div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="text-xs text-muted-foreground space-y-1">
        {compareGroups.map((g, i) => (
          <p key={g.id}>
            <span className="font-medium" style={{ color: COMPARE_STYLE[i % COMPARE_STYLE.length].color }}>
              {g.label} 평균 (회색 {COMPARE_STYLE[i % COMPARE_STYLE.length].label})
            </span>
            : {g.terms.join(" · ")}. 검색어마다 지수를 낸 뒤 평균.
          </p>
        ))}
        <p>
          출처: {data.source}, 기기·성별·연령 전체. 마지막 완결 주 {data.latestWeek} · 수집일 {data.collectedAt}.
          데이터랩은 상대 지수라 검색 횟수가 아닙니다. 검색어마다 조회 하나의 값만 씁니다.
        </p>
        {data.partialWeeks.length > 0 && <p>진행 중이라 뺀 주: {data.partialWeeks.join(", ")}</p>}
        {data.ungrouped.length > 0 && <p>묶음(groups)에 없어 뺀 검색어: {data.ungrouped.join(", ")}</p>}
      </div>
    </>
  );
}

/** 오른쪽 라벨 세로 위치. 마지막 이동평균 값 높이에 두고, 겹치면 아래로 민다. */
function endLabels(all: LineSpec[], yMax: number) {
  const plotH = CHART_H - MARGIN.top - MARGIN.bottom - XAXIS_H;
  const items = all.map((l) => {
    const v = lastValue(l.series.ma) ?? 0;
    const y = MARGIN.top + (1 - Math.min(v, yMax) / yMax) * plotH;
    return { key: l.key, name: l.name, color: l.color, yoy: l.series.yoy, y };
  }).sort((a, b) => a.y - b.y);
  for (let i = 1; i < items.length; i++) items[i].y = Math.max(items[i].y, items[i - 1].y + LABEL_GAP);
  // 아래로 넘치면 전체를 위로 올린다(맨 아래 라벨이 차트 높이 안에 들게).
  const overflow = items.length ? items[items.length - 1].y - (CHART_H - 20) : 0;
  if (overflow > 0) for (const it of items) it.y = Math.max(14, it.y - overflow);
  return items;
}

interface TipProps {
  active?: boolean;
  label?: string;
  payload?: { payload?: Record<string, number | null> }[];
  lines: LineSpec[];
  compareLines: LineSpec[];
}

function DemandTooltip({ active, label, payload, lines, compareLines }: TipProps) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const fmt = (v: number | null | undefined) => (v === null || v === undefined ? "-" : Math.round(v).toString());
  return (
    <div className="rounded-lg border bg-card px-3 py-2 shadow-md text-xs" style={{ borderColor: chartTheme.tooltipBorder }}>
      <p className="font-medium text-muted-foreground mb-1">{label} 주</p>
      {lines.map((l) => (
        <p key={l.key} className="tabular-nums">
          <span style={{ color: l.color }}>{l.name}</span> {fmt(row[`${l.key}m`])}
          <span className="text-muted-foreground"> (그 주 {fmt(row[`${l.key}r`])})</span>
        </p>
      ))}
      {compareLines.map((l) => (
        <p key={l.key} className="tabular-nums"><span style={{ color: l.color }}>{l.name}</span> {fmt(row[`${l.key}m`])}</p>
      ))}
      <p className="text-muted-foreground mt-1">4주 이동평균, 기준 100</p>
    </div>
  );
}
