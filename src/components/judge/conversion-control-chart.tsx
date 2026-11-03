"use client";

// 퍼널 관리도: "어제 전환율이 떨어진 게 우연인지 아닌지" (2026-11-03).
//
// 회색이 기본이고 평균 ±3σ 밖으로 나간 날만 강조색 점으로 칠한다.
// 계산 규칙은 src/lib/judge-charts.ts, 원천 짝은 /api/funnel-control 주석 참고.
import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useFetch } from "@/hooks/use-dashboard-data";
import { daysBetween } from "@/lib/bucket";
import { kstDate } from "@/lib/date";
import { formatNumber, cn } from "@/lib/utils";
import { buildControlChart, CONTROL_MIN_DAYS, CONTROL_SIGMA, type ControlPoint } from "@/lib/judge-charts";
import { DeferredResponsiveContainer } from "@/components/deferred-chart";
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from "recharts";

const ACCENT = "var(--sig-danger)";
const NEUTRAL = "var(--muted-foreground)";

interface SourceDay { date: string; sessions: number | null; orders: number }
interface Source { key: string; label: string; note: string | null; totalSessions: number; days: SourceDay[] }
interface ControlResponse { sources: Source[]; salesLastDate: string | null; error?: string }

const REASON_LABEL: Record<NonNullable<ControlPoint["reason"]>, string> = {
  no_sessions: "유입 미수집",
  sales_pending: "판매 동기화 대기",
  today: "오늘(진행 중)",
};

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

export function ConversionControlChart({ brand, from, to }: { brand: string; from: string; to: string }) {
  const { data, loading, error } = useFetch<ControlResponse>(`/api/funnel-control?brand=${brand || "all"}&from=${from}&to=${to}`);
  const [picked, setPicked] = useState<string | null>(null);

  const sources = useMemo(() => (data?.sources || []).filter((s) => s.totalSessions > 0), [data]);
  // 기본 = 기간 중 유입이 가장 큰 원천.
  const active = useMemo(() => {
    const chosen = sources.find((s) => s.key === picked);
    if (chosen) return chosen;
    return [...sources].sort((a, b) => b.totalSessions - a.totalSessions)[0] || null;
  }, [sources, picked]);

  const today = kstDate();
  const chart = useMemo(() => {
    if (!active) return null;
    return buildControlChart(daysBetween(from, to), active.days, { salesLastDate: data?.salesLastDate ?? null, today });
  }, [active, from, to, data?.salesLastDate, today]);

  const header = (
    <div className="mb-3">
      <h3 className="font-semibold">일별 구매 전환율 관리도</h3>
      <p className="text-xs text-muted-foreground mt-0.5">판단: 전환율이 떨어지거나 오른 날이 우연한 흔들림인지, 따로 원인을 찾아야 하는 날인지</p>
    </div>
  );

  if (loading && !data) {
    return <Card><CardContent className="p-4">{header}<div className="h-[220px] rounded bg-muted animate-pulse" /></CardContent></Card>;
  }
  if (error || data?.error) {
    return <Card><CardContent className="p-4">{header}<p className="text-sm text-muted-foreground">불러오지 못했습니다 ({error || data?.error})</p></CardContent></Card>;
  }
  if (!active || !chart) {
    const single = brand === "nutty" || brand === "ironpet" || brand === "saip";
    return (
      <Card><CardContent className="p-4">{header}
        <p className="text-sm text-muted-foreground">
          {single
            ? "이 브랜드는 유입이 펫 3개 브랜드 합산으로만 기록돼 단독 전환율을 계산할 수 없습니다. 브랜드 필터를 '펫'으로 바꾸면 통합 스토어 기준으로 볼 수 있습니다."
            : "이 기간에 유입이 수집된 원천이 없어 그리지 않습니다."}
        </p>
      </CardContent></Card>
    );
  }

  const outs = chart.points.filter((p) => p.status === "out");
  const judged = chart.points.filter((p) => p.rate != null);
  const latest = judged[judged.length - 1];
  const excluded = chart.points.filter((p) => p.status === "excluded");
  const pendingDays = excluded.filter((p) => p.reason === "sales_pending").length;
  const missingDays = excluded.filter((p) => p.reason === "no_sessions").length;

  const rows = chart.points.map((p) => ({ ...p, label: p.date.slice(5) }));

  return (
    <Card>
      <CardContent className="p-4">
        {header}
        {sources.length > 1 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {sources.map((s) => (
              <button key={s.key} onClick={() => setPicked(s.key)}
                className={cn("px-2 py-1 text-xs rounded", s.key === active.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                {s.label}
              </button>
            ))}
          </div>
        )}

        {/* 결론 한 줄. 표본이 짧으면 판단하지 않는다. */}
        <p className="text-sm mb-2">
          {!chart.enough ? (
            <span className="text-muted-foreground">기간이 짧아 판단 보류 (판정 가능한 날 {chart.n}일, {CONTROL_MIN_DAYS}일 이상 필요)</span>
          ) : outs.length === 0 ? (
            <>모든 날이 평균 ±{CONTROL_SIGMA}σ 안입니다. 이 기간의 오르내림은 우연한 흔들림 범위입니다.</>
          ) : (
            <>
              <b style={{ color: ACCENT }}>{outs.length}일</b>이 평균 ±{CONTROL_SIGMA}σ 밖입니다:{" "}
              {outs.map((p) => `${md(p.date)} ${p.rate!.toFixed(2)}%`).join(", ")}
            </>
          )}
          {chart.enough && latest && (
            <span className="text-muted-foreground"> · 판정 가능한 마지막 날 {md(latest.date)}: {latest.status === "out" ? "범위 밖" : "범위 안"}</span>
          )}
        </p>

        <DeferredResponsiveContainer width="100%" height={220}>
          <LineChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" minTickGap={16} />
            <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" width={44} tickFormatter={(v: number) => `${v.toFixed(1)}%`} />
            <Tooltip
              contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }}
              content={({ active: on, payload }) => {
                if (!on || !payload?.length) return null;
                const p = payload[0].payload as ControlPoint & { label: string };
                return (
                  <div className="rounded-lg border bg-card px-2 py-1.5 text-[11px] shadow-sm">
                    <div className="font-medium">{p.date}</div>
                    {p.rate != null ? (
                      <>
                        <div>전환율 {p.rate.toFixed(2)}% {p.status === "out" && <b style={{ color: ACCENT }}>(범위 밖)</b>}</div>
                        <div className="text-muted-foreground">구매 {formatNumber(p.orders || 0)} ÷ 유입 {formatNumber(p.sessions || 0)}</div>
                      </>
                    ) : (
                      <div className="text-muted-foreground">판정 제외: {p.reason ? REASON_LABEL[p.reason] : "-"}</div>
                    )}
                  </div>
                );
              }}
            />
            {chart.enough && chart.mean != null && (
              <ReferenceLine y={chart.mean} stroke={NEUTRAL} strokeWidth={1} ifOverflow="extendDomain"
                label={{ value: `평균 ${chart.mean.toFixed(2)}%`, position: "insideTopRight", fontSize: 10, fill: "var(--muted-foreground)" }} />
            )}
            {chart.enough && chart.ucl != null && (
              <ReferenceLine y={chart.ucl} stroke={ACCENT} strokeDasharray="4 4" ifOverflow="extendDomain"
                label={{ value: `+${CONTROL_SIGMA}σ ${chart.ucl.toFixed(2)}%`, position: "insideTopLeft", fontSize: 10, fill: ACCENT }} />
            )}
            {chart.enough && chart.lcl != null && (
              <ReferenceLine y={chart.lcl} stroke={ACCENT} strokeDasharray="4 4" ifOverflow="extendDomain"
                label={{ value: `−${CONTROL_SIGMA}σ ${chart.lcl.toFixed(2)}%`, position: "insideBottomLeft", fontSize: 10, fill: ACCENT }} />
            )}
            <Line
              type="linear" dataKey="rate" stroke={NEUTRAL} strokeOpacity={0.45} strokeWidth={1.25}
              connectNulls={false} isAnimationActive={false}
              dot={(props: { cx?: number; cy?: number; payload?: ControlPoint; index?: number }) => {
                const { cx, cy, payload, index } = props;
                if (cx == null || cy == null || !payload || payload.rate == null) return <g key={`d${index}`} />;
                const out = payload.status === "out";
                return <circle key={`d${index}`} cx={cx} cy={cy} r={out ? 4.5 : 2.5} fill={out ? ACCENT : NEUTRAL} fillOpacity={out ? 1 : 0.7} stroke="none" />;
              }}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </DeferredResponsiveContainer>

        <div className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
          <p>
            전환율 = 같은 원천의 구매 ÷ 유입. 평균·σ 는 이 기간에서 판정 가능한 {chart.n}일로 계산합니다.
            {chart.enough && chart.lcl == null && " 하한(−3σ)이 0% 아래라 하락 이탈은 이 데이터로 가려낼 수 없습니다(하루 구매가 적어 0건인 날도 정상 범위)."}
          </p>
          {(pendingDays > 0 || missingDays > 0) && (
            <p>
              점을 그리지 않은 날: {[
                pendingDays > 0 ? `판매 동기화 대기 ${pendingDays}일${data?.salesLastDate ? `(${md(data.salesLastDate)} 이후)` : ""}` : null,
                missingDays > 0 ? `유입 미수집 ${missingDays}일` : null,
              ].filter(Boolean).join(" · ")}. 0 으로 그리면 하락 이탈로 잘못 뜹니다.
            </p>
          )}
          {active.note && <p>{active.note}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
