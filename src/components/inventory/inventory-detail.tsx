"use client";

// 행을 누르면 열리는 상품 하나의 상세 (기획 v2). 그래프는 한 번에 하나.
//   위: 재고 선(그날 시작 재고) + 오늘 가용에서 하루 출고만큼 줄어드는 예상 소진 점선
//   아래: 입고(위로) · 출고(아래로) 막대. 기간 전체 날짜를 축에 두고, 움직임이 없는 날은 0
//   맨 아래: 날짜별 원본 표(위킵 날짜별 그대로)
// 공용 그래프 스타일(components/charts)은 다른 작업이 바꾸는 중이라 쓰지 않고 이 파일에서 그린다.
import { useEffect, useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { forecastLine, RUNWAY_AXIS_DAYS, type DayPoint, type InventoryRow } from "@/lib/inventory";
import { fmt1, fmtInt, fmtWon, md, scaleTitle } from "./inventory-ui";

const DAYS = [
  { key: "30", label: "30일" }, { key: "90", label: "90일" }, { key: "180", label: "180일" }, { key: "all", label: "1월부터" },
] as const;
type DaysKey = (typeof DAYS)[number]["key"];

interface DetailResponse { series?: DayPoint[]; from?: string; to?: string; setupNeeded?: boolean; error?: string }
interface ChartPoint { date: string; stock?: number; forecast?: number; inflow?: number; outflow?: number }

export function InventoryDetail({ row, asOf, windowDays }: { row: InventoryRow; asOf: string | null; windowDays: number }) {
  const [days, setDays] = useState<DaysKey>("90");
  const [data, setData] = useState<DetailResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null);
    setFailed(false);
    fetch(`/api/inventory?sku=${encodeURIComponent(row.sku_no)}&days=${days}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: DetailResponse) => { if (alive) setData(j); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [row.sku_no, days]);

  const perDay = row.speed.perDay + (row.coupang_per_day ?? 0);
  const chart = useMemo<ChartPoint[]>(() => {
    const series = data?.series ?? [];
    const pts: ChartPoint[] = series.map((p) => ({
      date: p.date, stock: p.start, inflow: p.shipin + p.returned + p.faulty + p.damage, outflow: -p.shipout,
    }));
    // 예상 소진: 오늘(스냅샷 날) 가용 + 이동·내부(+ 쿠팡) 에서 시작. 120일 넘게 버티면 120일에서 멈춘다
    if (asOf && perDay > 0 && row.total_stock > 0) {
      const f = forecastLine(asOf, row.total_stock, perDay, RUNWAY_AXIS_DAYS);
      const byDate = new Map(pts.map((p) => [p.date, p]));
      for (const q of f) {
        const hit = byDate.get(q.date);
        if (hit) hit.forecast = q.value;
        else pts.push({ date: q.date, forecast: q.value });
      }
      // 마지막 실측 점과 예상 점선이 이어지게
      const last = pts.filter((p) => p.stock !== undefined).at(-1);
      if (last && last.date < asOf) last.forecast = last.stock;
    }
    return pts.sort((a, b) => (a.date < b.date ? -1 : 1));
  }, [data, asOf, perDay, row.total_stock]);

  const table = useMemo(() => [...(data?.series ?? [])].reverse(), [data]);

  return (
    <div className="space-y-4 p-3 sm:p-4 bg-muted/20 border-t" data-tour="inventory-detail">
      <div className="grid gap-3 sm:grid-cols-3 text-xs">
        <Fact title="하루 출고 (위킵)">
          최근 {windowDays}일 위킵 출고 <b className="num">{fmtInt(row.speed.total)}</b>개 ÷ {windowDays}일 = <b className="num">{fmt1(row.speed.perDay)}</b>개/일
          <span className="block text-muted-foreground">기간 {md(row.speed.from)} ~ {md(row.speed.to)} · 시트 방식 {fmt1(row.sheet_per_day)}개/일 ({row.sheet_basis})</span>
        </Fact>
        <Fact title="재고">
          위킵 가용 <b className="num">{fmtInt(row.available)}</b>
          <OtherStock row={row} />
          <span className="block text-muted-foreground">안전 {fmtInt(row.safe)} · 유보 {fmtInt(row.reserve)} · 하자 {fmtInt(row.faulty)} (판정에 안 씀)</span>
        </Fact>
        <Fact title="판정">
          {row.reason}
          {row.runway_coupang !== null && (
            <span className="block">위킵 쪽 {row.runway_wekeep === null ? "계산 불가" : `${fmt1(row.runway_wekeep)}일`} · 쿠팡 쪽 {fmt1(row.runway_coupang)}일 (짧은 쪽으로 판정)</span>
          )}
          <span className="block text-muted-foreground">
            {row.coupang_per_day !== null && <>쿠팡 하루 판매 {fmt1(row.coupang_per_day)}개 · </>}
            재고 가치 {fmtWon(row.value)}{row.unit_cost ? ` (원가 ${fmtInt(row.unit_cost)}원 · ${row.cost_basis ?? "출처 없음"})` : " (원가 표에 없음: 설정 > 재고 > 원가)"}
            {row.runway_with_incoming !== null && <> · 입고 포함 {fmt1(row.runway_with_incoming)}일</>}
          </span>
          <span className="block text-muted-foreground">판매 규모 {scaleTitle(row)}{row.held ? " · 보류 묶음(① 아래 접힘)" : ""}</span>
        </Fact>
      </div>

      <div className="rounded-lg border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-3">
          <div>
            <p className="text-sm font-semibold">나가고 들어온 것</p>
            <p className="text-[11px] text-muted-foreground">가로 = 날짜(빠진 날 없음) · 위 = 그날 시작 재고(실선)와 오늘부터 예상 소진(점선) · 아래 = 입고(위로)·출고(아래로)</p>
          </div>
          <div className="flex gap-1 rounded-md bg-muted p-0.5" role="group" aria-label="그래프 기간">
            {DAYS.map((d) => (
              <button key={d.key} type="button" onClick={() => setDays(d.key)} aria-pressed={days === d.key}
                className={`px-2 py-0.5 rounded text-xs ${days === d.key ? "bg-card shadow-sm text-foreground" : "text-muted-foreground"}`}>{d.label}</button>
            ))}
          </div>
        </div>
        {failed && <p className="p-4 text-sm" style={{ color: "var(--sig-danger)" }}>날짜별 재고를 읽지 못했습니다. 못 읽은 것은 0 이 아닙니다.</p>}
        {data?.setupNeeded && <p className="p-4 text-sm text-muted-foreground">위킵 날짜별 표가 아직 없습니다(SQL 실행 전).</p>}
        {!data && !failed && <div className="m-3 h-56 rounded bg-muted/40 animate-pulse" />}
        {data?.series && (
          <div className="px-1 pb-2">
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chart} syncId={`inv-${row.sku_no}`} margin={{ top: 18, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
                  <XAxis dataKey="date" hide />
                  <YAxis width={44} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} allowDecimals={false} />
                  <Tooltip content={<StockTip />} />
                  {asOf && <ReferenceLine x={asOf} stroke="var(--muted-foreground)" strokeDasharray="3 3" label={{ value: "오늘", fontSize: 10, fill: "var(--muted-foreground)", position: "top" }} />}
                  <Line type="stepAfter" dataKey="stock" stroke="var(--foreground)" strokeWidth={1.6} dot={false} isAnimationActive={false} connectNulls={false} />
                  <Line type="linear" dataKey="forecast" stroke="#ea580c" strokeWidth={1.6} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="h-28">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chart} syncId={`inv-${row.sku_no}`} margin={{ top: 4, right: 12, left: 0, bottom: 0 }} stackOffset="sign">
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
                  <XAxis dataKey="date" tickFormatter={md} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} minTickGap={24} />
                  <YAxis width={44} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} allowDecimals={false} tickFormatter={(v: number) => fmtInt(Math.abs(v))} />
                  <Tooltip content={<FlowTip />} />
                  <ReferenceLine y={0} stroke="var(--border)" />
                  <Bar dataKey="inflow" stackId="f" fill="#2563eb" isAnimationActive={false} />
                  <Bar dataKey="outflow" stackId="f" fill="rgb(100 116 139 / 0.75)" isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="px-3 text-[11px] text-muted-foreground">
              재고 선은 위킵이 매일 주는 「그날 시작 재고」입니다. 위킵은 재고도 움직임도 없는 날 행을 안 줘서, 그런 날은 전날 마감 재고를 이어 그립니다.
              점선은 지금 재고({fmtInt(row.total_stock)}개)를 하루 {fmt1(perDay)}개씩 쓴다고 본 것이며 120일에서 멈춥니다.
            </p>
          </div>
        )}
      </div>

      {data?.series && (
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-xs num">
              <thead className="sticky top-0 bg-muted text-muted-foreground">
                <tr>{["날짜", "시작 재고", "입고", "출고", "반품", "하자 입고", "파손 입고"].map((h) => <th key={h} className="px-2 py-1.5 text-right first:text-left font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {table.map((p) => (
                  <tr key={p.date} className={`border-t ${p.hasRow ? "" : "text-muted-foreground"}`}>
                    <td className="px-2 py-1 text-left">{p.date}{!p.hasRow && <span className="ml-1 text-[10px]">(행 없음)</span>}</td>
                    <td className="px-2 py-1 text-right">{fmtInt(p.start)}</td>
                    <td className="px-2 py-1 text-right">{p.shipin ? fmtInt(p.shipin) : 0}</td>
                    <td className="px-2 py-1 text-right">{p.shipout ? fmtInt(p.shipout) : 0}</td>
                    <td className="px-2 py-1 text-right">{p.returned}</td>
                    <td className="px-2 py-1 text-right">{p.faulty}</td>
                    <td className="px-2 py-1 text-right">{p.damage}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/** 쿠팡·이동·내부 재고. 미입력은 0 이 아니라 「미입력」 */
function OtherStock({ row }: { row: InventoryRow }) {
  const v = (n: number | null) => (n === null ? "미입력" : fmtInt(n));
  return (
    <>
      {row.brand === "nutty" && <> · 쿠팡 <b className="num">{v(row.coupang)}</b>{row.coupang_as_of ? <span className="text-muted-foreground"> ({md(row.coupang_as_of)})</span> : null}</>}
      {" "}· 이동 {v(row.transit)} · 내부 {v(row.internal)}
      {row.incoming && <span className="block" style={{ color: "#2563eb" }}>입고 예정 {fmtInt(row.incoming.qty)}개{row.incoming.expected_at ? ` · ${row.incoming.expected_at}` : ""}</span>}
    </>
  );
}

function Fact({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-2.5">
      <p className="text-[11px] font-semibold text-muted-foreground mb-1">{title}</p>
      <div className="leading-relaxed">{children}</div>
    </div>
  );
}

interface TipProps { active?: boolean; payload?: { payload: ChartPoint }[] }
function StockTip({ active, payload }: TipProps) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className="rounded-md border bg-card px-2 py-1.5 text-xs shadow-sm num">
      <p className="font-medium">{p.date}</p>
      {p.stock !== undefined && <p>시작 재고 {fmtInt(p.stock)}</p>}
      {p.forecast !== undefined && <p style={{ color: "#ea580c" }}>예상 {fmtInt(p.forecast)}</p>}
    </div>
  );
}
function FlowTip({ active, payload }: TipProps) {
  const p = payload?.[0]?.payload;
  if (!active || !p || p.inflow === undefined) return null;
  return (
    <div className="rounded-md border bg-card px-2 py-1.5 text-xs shadow-sm num">
      <p className="font-medium">{p.date}</p>
      <p>들어옴 {fmtInt(p.inflow)} · 출고 {fmtInt(Math.abs(p.outflow ?? 0))}</p>
    </div>
  );
}
