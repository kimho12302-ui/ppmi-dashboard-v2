"use client";

import { useMemo, useState, type ReactNode } from "react";
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
//   - 각 검색어를 자기 기준 기간(2024-10 ~ 2025-09) 평균 = 100 으로 맞춘 지수. 기본은 4주 이동평균 선만 그린다.
//   - 카테고리 안 검색어는 칩으로 하나를 고른다. 고른 검색어만 진하게 + 그 검색어의 주별 원값(얇은 선).
//     나머지 검색어는 연하게 남긴다(2026-11-03 리뷰: 같은 색 6줄이 엉켜 읽히지 않았다).
//     모발검사는 주 30~40회라 주별 값이 크게 출렁인다. 읽는 선은 이동평균이다.
//   - 세로축 위 끝 = 이동평균 값들의 95번째 백분위(최소 150). 그 위 일시 급등은 잘라 그리고 한 줄로 알린다.
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
const YAXIS_W = 40;
const LABEL_GAP = 36;      // 라벨 한 덩어리(이름 14px + 퍼센트 18px) + 여백
const FADED = 0.28;        // 고르지 않은 검색어 선 투명도
const Y_PERCENTILE = 0.95; // 세로축 위 끝 기준

const pctText = (v: number | null) => (v === null ? "비교 불가" : `${v > 0 ? "+" : ""}${Math.round(v * 100)}%`);
const lastValue = (xs: (number | null)[]) => {
  for (let i = xs.length - 1; i >= 0; i--) if (xs[i] !== null) return xs[i] as number;
  return null;
};
const weekTick = (w: string) => `${w.slice(2, 4)}.${w.slice(5, 7)}`;

/** 값 목록의 p 백분위(가장 가까운 순위). 빈 목록이면 null. */
function percentile(xs: number[], p: number) {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
}

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

interface LineSpec { key: string; name: string; color: string; dash?: string; series: TermSeries; faded?: boolean }
interface Spike { value: number; term: string; at: number }

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap",
        active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** 세로축 위 끝(이동평균 95번째 백분위, 최소 150)과 그 위로 잘린 가장 큰 일시 급등. */
function yScale(main: LineSpec[], compare: LineSpec[]): { yMax: number; spike: Spike | null } {
  const vals = [...main, ...compare].flatMap((l) => l.series.ma).filter((v): v is number => v !== null);
  const p = percentile(vals, Y_PERCENTILE) ?? 100;
  const yMax = Math.max(150, Math.ceil((p * 1.1) / 50) * 50);
  let spike: Spike | null = null;
  for (const l of main) {
    l.series.ma.forEach((v, i) => {
      if (v !== null && v > yMax && (spike === null || v > spike.value)) spike = { value: v, term: l.name, at: i };
    });
  }
  return { yMax, spike };
}

function DemandChart({ data }: { data: SearchDemand }) {
  const categories = data.groups.filter((g) => g.kind === "category");
  const compareGroups = data.groups.filter((g) => g.kind === "compare");
  const [selected, setSelected] = useState(categories[0]?.id ?? "");
  const [pickedTerm, setPickedTerm] = useState<string | null>(null);
  const activeId = categories.some((c) => c.id === selected) ? selected : categories[0]?.id ?? "";
  const ci = categories.findIndex((c) => c.id === activeId);
  const color = CATEGORY_COLOR[activeId] ?? FALLBACK_COLORS[Math.max(ci, 0) % FALLBACK_COLORS.length];
  const members = useMemo(() => data.terms.filter((t) => t.group === activeId), [data.terms, activeId]);
  // 카테고리를 바꾸면 고른 검색어가 그 안에 없으므로 첫 검색어로 돌아간다.
  const focus = members.some((m) => m.term === pickedTerm) ? (pickedTerm as string) : members[0]?.term ?? "";

  const lines = useMemo<LineSpec[]>(() => members.map((s, i) => ({
    key: `t${i}`, name: s.term, series: s, color, faded: s.term !== focus,
  })), [members, color, focus]);
  const focusLine = lines.find((l) => !l.faded);

  const compareLines = useMemo<LineSpec[]>(() => data.compare.map((s, i) => ({
    key: `c${i}`, name: s.term, series: s,
    color: COMPARE_STYLE[i % COMPARE_STYLE.length].color, dash: COMPARE_STYLE[i % COMPARE_STYLE.length].dash,
  })), [data.compare]);

  const rows = useMemo(() => data.weeks.map((w, i) => {
    const row: Record<string, string | number | null> = { week: w };
    for (const l of lines) row[`${l.key}m`] = l.series.ma[i];
    if (focusLine) row.focusRaw = focusLine.series.index[i];
    for (const l of compareLines) row[`${l.key}m`] = l.series.ma[i];
    return row;
  }), [data.weeks, lines, focusLine, compareLines]);

  const { yMax, spike } = useMemo(() => yScale(lines, compareLines), [lines, compareLines]);

  const ticks = useMemo(() => data.weeks.filter((w, i) => {
    if (i === 0) return true;
    const m = Number(w.slice(5, 7));
    return w.slice(5, 7) !== data.weeks[i - 1].slice(5, 7) && [1, 4, 7, 10].includes(m);
  }), [data.weeks]);

  const labels = useMemo(() => endLabels([...lines, ...compareLines], yMax), [lines, compareLines, yMax]);
  const spikeAt = spike && data.weeks.length > 1 ? Math.min(0.9, Math.max(0.1, spike.at / (data.weeks.length - 1))) : 0;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-0.5 rounded-lg bg-muted p-1 w-fit max-w-full">
          {categories.map((c) => (
            <Chip key={c.id} active={activeId === c.id} onClick={() => { setSelected(c.id); setPickedTerm(null); }}>{c.label}</Chip>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {/* 2026-11-10: 브랜드 필터와 무관한 밸런스랩 주제 묶음이라는 것을 먼저 밝힌다(키워드 탭 정리) */}
          <span className="font-medium text-foreground/80">밸런스랩 주제 · 정적 데이터, 수동 수집 마지막 수집일 {data.collectedAt}</span>
          {" · "}자동 갱신 안 됨 · 상단 기간·브랜드 선택과 상관없이 {data.weeks[0].slice(0, 7)} 부터 전 기간
        </p>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-3">
            {members.length > 1 && (
              <div className="flex flex-wrap items-center gap-0.5 rounded-lg bg-muted p-1 w-fit max-w-full">
                {members.map((m) => (
                  <Chip key={m.term} active={focus === m.term} onClick={() => setPickedTerm(m.term)}>{m.term}</Chip>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              4주 이동평균 · 검색어마다 {data.baseline.from.slice(0, 7)}~{data.baseline.to.slice(0, 7)} 평균 = 100 · 오른쪽 % = 최근 13주 전년비
            </p>
          </div>
          <div className="flex min-w-0">
            <div className="relative flex-1 min-w-0" style={{ height: CHART_H }}>
              {spike && (
                <span
                  className="absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded bg-card/90 px-1 text-[11px] text-muted-foreground"
                  style={{ left: `calc(${YAXIS_W}px + (100% - ${YAXIS_W + MARGIN.right}px) * ${spikeAt})` }}
                >
                  일시 급등, 최대 {Math.round(spike.value)}{lines.length > 1 ? ` (${spike.term})` : ""}
                </span>
              )}
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows} margin={MARGIN}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} vertical={false} />
                  <XAxis dataKey="week" ticks={ticks} tickFormatter={weekTick} height={XAXIS_H}
                    tick={{ fontSize: 11, fill: chartTheme.tick }} interval="preserveStartEnd" minTickGap={12} />
                  <YAxis domain={[0, yMax]} allowDataOverflow width={YAXIS_W} tick={{ fontSize: 11, fill: chartTheme.tick }} />
                  <ReferenceLine y={100} stroke={chartTheme.tick} strokeDasharray="2 4" />
                  <Tooltip content={<DemandTooltip lines={lines} compareLines={compareLines} />} />
                  {lines.filter((l) => l.faded).map((l) => (
                    <Line key={l.key} dataKey={`${l.key}m`} stroke={l.color} strokeWidth={2} strokeOpacity={FADED}
                      dot={false} activeDot={false} isAnimationActive={false} />
                  ))}
                  {compareLines.map((l) => (
                    <Line key={l.key} dataKey={`${l.key}m`} stroke={l.color} strokeWidth={2} strokeDasharray={l.dash}
                      dot={false} isAnimationActive={false} />
                  ))}
                  {focusLine && (
                    <Line key="focus-raw" dataKey="focusRaw" stroke={focusLine.color} strokeWidth={1} strokeOpacity={0.4}
                      dot={false} activeDot={false} isAnimationActive={false} />
                  )}
                  {focusLine && (
                    <Line key="focus-ma" dataKey={`${focusLine.key}m`} stroke={focusLine.color} strokeWidth={3}
                      dot={false} isAnimationActive={false} />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="relative w-[92px] sm:w-[124px] shrink-0" style={{ height: CHART_H }} aria-label="최근 13주 전년 대비">
              {labels.map((l) => (
                <div key={l.key} className="absolute left-2 right-0" style={{ top: l.y - 14, opacity: l.faded ? 0.45 : 1 }}>
                  <div className="text-[11px] leading-[14px] truncate" style={{ color: l.color }}>{l.name}</div>
                  <div className={cn("text-sm leading-[18px] tabular-nums", l.faded ? "font-normal" : "font-semibold")} style={{ color: l.color }}>
                    {pctText(l.yoy)}
                  </div>
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
          데이터랩은 상대 지수라 검색 횟수가 아닙니다. 얇은 선 = 고른 검색어의 주별 원값.
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
    return { key: l.key, name: l.name, color: l.color, yoy: l.series.yoy, faded: !!l.faded, y };
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
        <p key={l.key} className={cn("tabular-nums", l.faded && "text-muted-foreground")}>
          <span style={{ color: l.color, opacity: l.faded ? 0.6 : 1 }}>{l.name}</span> {fmt(row[`${l.key}m`])}
          {!l.faded && <span className="text-muted-foreground"> (그 주 {fmt(row.focusRaw)})</span>}
        </p>
      ))}
      {compareLines.map((l) => (
        <p key={l.key} className="tabular-nums"><span style={{ color: l.color }}>{l.name}</span> {fmt(row[`${l.key}m`])}</p>
      ))}
      <p className="text-muted-foreground mt-1">4주 이동평균, 기준 100</p>
    </div>
  );
}
