"use client";

import { Suspense, useMemo, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { useFilterParams, useFetch } from "@/hooks/use-dashboard-data";
import { formatWon, cn } from "@/lib/utils";
import { bucketAxis, bucketKey, bucketLabel, lastDataDate, type Gran } from "@/lib/bucket";
import { SALES_GROUP_COLORS } from "@/lib/types";
import { DeferredResponsiveContainer } from "@/components/deferred-chart";
import { LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine } from "recharts";

interface SubAd { channel: string; label: string; spend: number; }
interface Group {
  /** adSpend = 기간 전체 광고비(실제 돈). adSpendToSales·roasToSales = 판매 원장 마지막 날까지(카드 판정·색·점선용).
   *  adRatio·revDelta·roasDelta 도 판매 집계일까지 기준(서버 /api/channel-groups 주석). roas = 기간 전체 광고비 기준(참고). */
  key: string; label: string; revenue: number; adSpend: number; roas: number; adSpendToSales: number; roasToSales: number; adRatio: number;
  subAds: SubAd[];
  revDelta: number | null; adDelta: number | null; roasDelta: number | null;
}
interface GroupCell { revenue: number; adSpend: number; }
interface SeriesRow { date: string; naver: GroupCell; jasamol: GroupCell; coupang: GroupCell; other?: GroupCell; }
interface ChannelGroupsData {
  from: string; to: string;
  /** 판매 원장 마지막 날(고른 브랜드 범위, 오늘 미만). compareThrough = 카드 비교가 쓴 이번 기간 끝 날짜. */
  salesThrough?: string | null; compareThrough?: string | null;
  groups: Group[];
  total: { revenue: number; adSpend: number; roas: number; adRatio: number };
  series: SeriesRow[];
}


function Delta({ v, invert = false }: { v: number | null; invert?: boolean }) {
  if (v === null || !isFinite(v)) return <span className="text-muted-foreground/50">-</span>;
  const up = v >= 0;
  const good = invert ? !up : up;
  const color = Math.abs(v) < 1 ? "text-muted-foreground" : good ? "text-emerald-600" : "text-red-500";
  return <span className={color}>{up ? "▲" : "▼"}{Math.abs(v).toFixed(0)}%</span>;
}

function roasColor(roas: number) {
  if (roas >= 5) return "#10b981";
  if (roas >= 2) return "#f59e0b";
  return "#ef4444";
}

// ROAS 는 비율이라 광고비가 0 이면 0x 가 아니라 "-" 로 둔다(2026-10-28).
function RoasText({ r, a }: { r: number; a: number }) {
  if (a <= 0) return <span>-</span>;
  const roas = r / a;
  return <span style={{ color: roasColor(roas) }}>{roas.toFixed(1)}x</span>;
}

function CellTd({ r, a, pending = false }: { r: number; a: number; pending?: boolean }) {
  return (
    <td className="py-2 px-3 text-right whitespace-nowrap">
      <div>{pending ? <span className="text-muted-foreground">판매 미수집</span> : formatWon(r)}</div>
      <div className="text-[11px] text-muted-foreground">{formatWon(a)} · {pending ? "-" : <RoasText r={r} a={a} />}</div>
    </td>
  );
}

export default function ChannelPage() {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">불러오는 중...</div>}>
      <ChannelInner />
    </Suspense>
  );
}

function ChannelInner() {
  const { brand, from, to } = useFilterParams();
  const { data, loading } = useFetch<ChannelGroupsData>(`/api/channel-groups?from=${from}&to=${to}&brand=${brand}`);
  // 표 기본 단위는 주별(2026-11-04). 일별은 30일이면 30줄이라 화면이 길어진다. 버튼으로 일별·월별을 고른다.
  const [gran, setGran] = useState<Gran>("week");

  const series = useMemo(() => data?.series || [], [data]);
  // 판매 원장이 들어온 마지막 날. 그 뒤 날짜는 판매 0 이 아니라 동기화 대기다.
  // ★ 서버가 고른 브랜드 범위로 정한 값(src/lib/sales-through.ts, QA2 M3). 카드의 「판매 집계일까지 ROAS」와 같은 날이다.
  //   서버 값이 없으면(옛 응답) 예전처럼 매출이 있는 마지막 날로 대신한다.
  const salesLast = useMemo(
    () => data?.salesThrough ?? lastDataDate(series.filter((r) => (r.naver?.revenue || 0) + (r.jasamol?.revenue || 0) + (r.coupang?.revenue || 0) + (r.other?.revenue || 0) > 0)),
    [data, series]
  );
  const buckets = useMemo(() => {
    const m: Record<string, { naver: { r: number; a: number }; jasamol: { r: number; a: number }; coupang: { r: number; a: number }; other: { r: number; a: number } }> = {};
    const empty = () => ({ naver: { r: 0, a: 0 }, jasamol: { r: 0, a: 0 }, coupang: { r: 0, a: 0 }, other: { r: 0, a: 0 } });
    if (!series.length) return [];
    // 축 = 선택 기간 전체(오늘까지). 매출·광고비가 없는 날도 0 으로 남긴다(2026-10-28).
    for (const key of bucketAxis(from, to, gran)) m[key] = empty();
    for (const row of series) {
      const key = bucketKey(row.date, gran);
      if (!m[key]) m[key] = empty();
      m[key].naver.r += row.naver?.revenue || 0; m[key].naver.a += row.naver?.adSpend || 0;
      m[key].jasamol.r += row.jasamol?.revenue || 0; m[key].jasamol.a += row.jasamol?.adSpend || 0;
      m[key].coupang.r += row.coupang?.revenue || 0; m[key].coupang.a += row.coupang?.adSpend || 0;
      // 기타(피피·에이블리 등)도 합산해야 전체 매출이 헤드라인과 맞는다.
      m[key].other.r += row.other?.revenue || 0; m[key].other.a += row.other?.adSpend || 0;
    }
    return Object.keys(m).sort().map((key) => {
      const b = m[key];
      const totalRev = b.naver.r + b.jasamol.r + b.coupang.r + b.other.r;
      const totalAd = b.naver.a + b.jasamol.a + b.coupang.a + b.other.a;
      // 마지막 판매일 뒤에 시작한 칸은 매출이 아직 안 들어온 칸이다(0원·0.0x 로 찍지 않는다).
      const pending = !!salesLast && key > bucketKey(salesLast, gran);
      return { key, label: bucketLabel(key, gran), ...b, totalRev, totalAd, pending };
    });
  }, [series, gran, from, to, salesLast]);

  // 판매처별 주간 ROAS 스몰 멀티플(2026-11-04). 예전에는 일별 ROAS 선 4개를 한 축에 겹쳐 그려 하루하루 출렁임에 묻혔다.
  // 주 단위로 접고 판매처마다 칸을 나눈다. 광고비가 0 인 판매처는 ROAS 가 없어 칸을 만들지 않는다.
  // 마지막 판매일 뒤에 시작한 주는 0 이 아니라 판매 미수집이라 비운다. 점선 = 그 판매처의 기간 ROAS.
  const weekly = useMemo(() => {
    if (!series.length) return { weeks: [] as string[], byGroup: {} as Record<string, (number | null)[]> };
    const last = salesLast;
    const weeks = bucketAxis(from, to, "week");
    const acc: Record<string, Record<string, { r: number; a: number }>> = {};
    for (const row of series) {
      if (last && row.date > last) continue; // 광고비만 있고 매출이 아직 안 들어온 날
      const k = bucketKey(row.date, "week");
      for (const g of ["naver", "jasamol", "coupang", "other"] as const) {
        const cell = row[g];
        if (!cell) continue;
        acc[g] = acc[g] || {};
        const w = (acc[g][k] = acc[g][k] || { r: 0, a: 0 });
        w.r += cell.revenue || 0; w.a += cell.adSpend || 0;
      }
    }
    const byGroup: Record<string, (number | null)[]> = {};
    for (const g of Object.keys(acc)) {
      byGroup[g] = weeks.map((wk) => {
        const w = acc[g][wk];
        if (!w || w.a <= 0 || (last && wk > bucketKey(last, "week"))) return null;
        return +(w.r / w.a).toFixed(2);
      });
    }
    return { weeks, byGroup };
  }, [series, from, to, salesLast]);

  if (loading) {
    return (
      <PageShell title="판매처 성과" description="판매처별 매출 vs 그 판매처를 끌어온 광고비 (전기간 대비)">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <Card key={i} className="p-6 animate-pulse"><CardContent className="p-0"><div className="h-32 bg-muted rounded" /></CardContent></Card>)}
        </div>
      </PageShell>
    );
  }

  const groups = data?.groups || [];
  // 카드·점선이 쓰는 「판매 집계일」 라벨. 기간 끝까지 다 들어왔으면 「기간 전체」.
  const cmp = data?.compareThrough ?? null;
  const throughLabel = !cmp ? "판매 집계 없음" : cmp >= to ? "기간 전체" : `판매 집계일 ${Number(cmp.slice(5, 7))}/${Number(cmp.slice(8, 10))}까지`;

  return (
    <PageShell title="판매처 성과" description="판매처별 매출 vs 그 판매처를 끌어온 광고비 · 원 단위 · 전기간 대비">
      {/* 통합 요약(총 매출·총 광고비·통합 ROAS·광고비 비중)은 2026-11-04 뺐다. Overview 상단 카드와 같은 숫자다. */}
      {/* 채널그룹 카드 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" data-tour="channel-store-cards">
        {groups.map((g, gi) => (
          // ★ 광고비 0 인 판매처(자사몰 등)는 ROAS 가 정의되지 않는다. 0.00x 빨강으로 찍으면
          //   "광고 성과 최악" 으로 읽히므로 표 셀(RoasText)과 같이 "-" 로 두고 색·경고선도 넣지 않는다(2026-11-03).
          // ROAS·색은 판매 집계일까지(그날까지의 매출 ÷ 그날까지의 광고비). 기간 전체 광고비로 나누면 매출이 아직 안 들어온
          // 날의 광고비만 분모에 더해져 ROAS 가 낮게 나온다(QA2 H2, 2026-11-10).
          <Card key={g.key} className="border-t-4" style={{ borderTopColor: g.adSpendToSales > 0 ? roasColor(g.roasToSales) : "var(--border)" }}>
            <CardContent className="p-5 space-y-4">
              <div className="flex items-start justify-between gap-2" data-tour={gi === 0 ? "channel-store-head" : undefined}>
                <h3 className="font-semibold text-sm">{g.label}</h3>
                {g.adSpendToSales > 0
                  ? (
                    <span className="text-right shrink-0">
                      <span className="block text-lg font-bold leading-tight" style={{ color: roasColor(g.roasToSales) }}>{g.roasToSales.toFixed(2)}x</span>
                      <span className="block text-[10px] text-muted-foreground">{throughLabel} ROAS</span>
                    </span>
                  )
                  : <span className="text-lg font-bold text-muted-foreground" title="판매 집계일까지 광고비가 없어 ROAS 를 계산하지 않습니다">-</span>}
              </div>
              <div className="grid grid-cols-2 gap-3" data-tour={gi === 0 ? "channel-store-amounts" : undefined}>
                <div>
                  <p className="text-[11px] text-muted-foreground">매출</p>
                  <p className="text-base font-bold">{formatWon(g.revenue)}</p>
                  <p className="text-[11px]" title="이번 기간과 직전 기간을 판매 집계일까지 같은 길이로 잘라 비교">전기간 <Delta v={g.revDelta} /></p>
                </div>
                <div>
                  {/* 금액은 기간 전체(실제 돈). 비중은 판매 집계일까지 광고비 ÷ 매출 */}
                  <p className="text-[11px] text-muted-foreground">광고비 기간 전체 (비중 {g.adRatio.toFixed(1)}%)</p>
                  <p className="text-base font-bold">{formatWon(g.adSpend)}</p>
                  <p className="text-[11px]">전기간 <Delta v={g.adDelta} invert /></p>
                  {g.adSpendToSales !== g.adSpend && (
                    <p className="text-[10px] text-muted-foreground">{throughLabel} {formatWon(g.adSpendToSales)}</p>
                  )}
                </div>
              </div>
              <div className="border-t pt-2 space-y-1" data-tour={gi === 0 ? "channel-ad-mix" : undefined}>
                <p className="text-[11px] text-muted-foreground">광고비 구성</p>
                {g.subAds.map((s) => (
                  <div key={s.channel} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{s.label}</span>
                    <span className="font-medium">{formatWon(s.spend)}</span>
                  </div>
                ))}
              </div>
              <div className="border-t pt-2 flex items-center justify-between text-xs" data-tour={gi === 0 ? "channel-roas-delta" : undefined}>
                <span className="text-muted-foreground">ROAS 전기간 대비 ({throughLabel}, 같은 길이)</span>
                <span className="font-medium"><Delta v={g.adSpendToSales > 0 ? g.roasDelta : null} /></span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 판매처별 주간 ROAS (스몰 멀티플) */}
      <Card data-tour="channel-roas-chart">
        <CardContent className="p-4">
          <h3 className="font-semibold text-sm">판매처별 주간 ROAS</h3>
          <p className="text-xs text-muted-foreground mt-0.5 mb-3">
            가로 = 주(월요일 시작), 세로 = 그 판매처 매출 ÷ 그 판매처를 끌어온 광고비(배). 점선 = 선택 기간 ROAS({throughLabel}). 판매처마다 축이 따로입니다
          </p>
          {groups.filter((g) => g.adSpendToSales > 0).length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">선택한 기간에 광고비가 쓰인 판매처가 없습니다.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {groups.filter((g) => g.adSpendToSales > 0).map((g) => {
                const pts = weekly.weeks.map((wk, i) => ({ week: wk, v: weekly.byGroup[g.key]?.[i] ?? null }));
                return (
                  <div key={g.key} className="rounded-lg border p-2 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs font-medium truncate flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: SALES_GROUP_COLORS[g.key] || "#6b7280" }} />
                        {g.label}
                      </span>
                      <span className="text-[11px] text-muted-foreground shrink-0">기간 {g.roasToSales.toFixed(2)}x</span>
                    </div>
                    <DeferredResponsiveContainer width="100%" height={72}>
                      <LineChart data={pts} margin={{ top: 6, right: 6, left: 6, bottom: 0 }}>
                        <XAxis dataKey="week" hide />
                        <YAxis hide domain={[0, "auto"]} />
                        <ReferenceLine y={g.roasToSales} stroke="var(--muted-foreground)" strokeDasharray="2 3" strokeOpacity={0.7} ifOverflow="extendDomain" />
                        <Tooltip cursor={false}
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const p = payload[0].payload as { week: string; v: number | null };
                            return <div className="rounded border bg-card px-1.5 py-1 text-[10px] shadow-sm">{bucketLabel(p.week, "week")} 주 · {p.v == null ? "광고비 0 또는 미수집" : `${p.v.toFixed(2)}x`}</div>;
                          }} />
                        <Line type="linear" dataKey="v" stroke="var(--muted-foreground)" strokeWidth={1.5} dot={{ r: 1.5 }} connectNulls={false} isAnimationActive={false} />
                      </LineChart>
                    </DeferredResponsiveContainer>
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">
            앞뒤 주가 기간에 일부만 걸치면 그 주는 일부 날짜만 더한 값입니다. 마지막 판매일{salesLast ? ` ${salesLast.slice(5)}` : ""} 뒤 날짜는 매출·광고비 모두 빼고 계산하고, 그 뒤에 시작한 주는 비웁니다(판매 동기화 대기).
          </p>
        </CardContent>
      </Card>

      {/* 기간별 표 (일/주/월): 각 셀 = 매출 / 광고비 · ROAS */}
      <Card data-tour="channel-trend">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="font-semibold text-sm">기간별 매출 · 광고비 · ROAS</h3>
            <div className="flex gap-0.5 rounded-lg bg-muted p-1" data-tour="channel-gran">
              {([["day", "일별"], ["week", "주별"], ["month", "월별"]] as const).map(([k, lbl]) => (
                <button key={k} onClick={() => setGran(k)}
                  className={cn("px-3 py-1 text-xs font-medium rounded-md transition-colors", gran === k ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>
          {buckets.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">선택한 기간에 데이터가 없습니다.</p>
          ) : (
            <div className="overflow-x-auto" data-tour="channel-trend-table">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left border-b text-muted-foreground">
                    <th className="pb-2 pr-3">기간</th>
                    <th className="pb-2 px-3 text-right">스마트스토어<span className="block text-[10px] font-normal">매출 / 광고비·ROAS</span></th>
                    <th className="pb-2 px-3 text-right">자사몰<span className="block text-[10px] font-normal">매출 / 광고비·ROAS</span></th>
                    <th className="pb-2 px-3 text-right">쿠팡<span className="block text-[10px] font-normal">매출 / 광고비·ROAS</span></th>
                    <th className="pb-2 pl-3 text-right">전체<span className="block text-[10px] font-normal">매출 / 광고비·ROAS</span></th>
                  </tr>
                </thead>
                <tbody>
                  {buckets.slice().reverse().map((b) => (
                    <tr key={b.key} className="border-b border-border/50">
                      <td className="py-2 pr-3 font-medium whitespace-nowrap">{b.label}</td>
                      <CellTd r={b.naver.r} a={b.naver.a} pending={b.pending} />
                      <CellTd r={b.jasamol.r} a={b.jasamol.a} pending={b.pending} />
                      <CellTd r={b.coupang.r} a={b.coupang.a} pending={b.pending} />
                      <td className="py-2 pl-3 text-right whitespace-nowrap">
                        <div className="font-semibold">{b.pending ? <span className="font-normal text-muted-foreground">판매 미수집</span> : formatWon(b.totalRev)}</div>
                        <div className="text-[11px] text-muted-foreground">{formatWon(b.totalAd)} · {b.pending ? "-" : <RoasText r={b.totalRev} a={b.totalAd} />}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground/70" data-tour="channel-rule-note">
            스마트스토어=스마트스토어 매출÷(네이버검색+쇼핑+GFA+밸런스랩메타) · 자사몰=카페24÷(메타·구글, 밸런스랩 제외) · 쿠팡=쿠팡÷쿠팡광고. 밸런스랩은 스마트스토어 전용이라 메타도 여기 포함. 매출은 공구 제외 자체매출. 주별=월요일 기준.
          </p>
        </CardContent>
      </Card>
    </PageShell>
  );
}
