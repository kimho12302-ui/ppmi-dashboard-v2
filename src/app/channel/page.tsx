"use client";

import { Suspense, useMemo, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { useFilterParams, useFetch } from "@/hooks/use-dashboard-data";
import { formatWon, cn } from "@/lib/utils";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";

interface SubAd { channel: string; label: string; spend: number; }
interface Group {
  key: string; label: string; revenue: number; adSpend: number; roas: number; adRatio: number;
  subAds: SubAd[];
  revDelta: number | null; adDelta: number | null; roasDelta: number | null;
}
interface GroupCell { revenue: number; adSpend: number; }
interface SeriesRow { date: string; naver: GroupCell; jasamol: GroupCell; coupang: GroupCell; }
interface ChannelGroupsData {
  from: string; to: string;
  groups: Group[];
  total: { revenue: number; adSpend: number; roas: number; adRatio: number };
  series: SeriesRow[];
}

type Gran = "day" | "week" | "month";

function bucketKey(date: string, gran: Gran): string {
  if (gran === "month") return date.slice(0, 7);
  if (gran === "week") {
    const d = new Date(date + "T00:00:00Z");
    if (isNaN(d.getTime())) return date;
    const dow = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1)); // 그 주 월요일
    return d.toISOString().slice(0, 10);
  }
  return date;
}
function bucketLabel(key: string, gran: Gran): string {
  if (gran === "month") { const [y, m] = key.split("-"); return `${y}.${m}`; }
  const [, m, d] = key.split("-");
  if (gran === "week") return `${Number(m)}/${Number(d)} 주`;
  return `${Number(m)}/${Number(d)}`;
}

function Delta({ v, invert = false }: { v: number | null; invert?: boolean }) {
  if (v === null || !isFinite(v)) return <span className="text-muted-foreground/50">—</span>;
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

function CellTd({ r, a }: { r: number; a: number }) {
  const roas = a > 0 ? r / a : 0;
  return (
    <td className="py-2 px-3 text-right whitespace-nowrap">
      <div>{formatWon(r)}</div>
      <div className="text-[11px] text-muted-foreground">{formatWon(a)} · <span style={{ color: roasColor(roas) }}>{roas.toFixed(1)}x</span></div>
    </td>
  );
}

export default function ChannelPage() {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">로딩 중...</div>}>
      <ChannelInner />
    </Suspense>
  );
}

function ChannelInner() {
  const { brand, from, to } = useFilterParams();
  const { data, loading } = useFetch<ChannelGroupsData>(`/api/channel-groups?from=${from}&to=${to}&brand=${brand}`);
  const [gran, setGran] = useState<Gran>("day");

  const series = useMemo(() => data?.series || [], [data]);
  const buckets = useMemo(() => {
    const m: Record<string, { naver: { r: number; a: number }; jasamol: { r: number; a: number }; coupang: { r: number; a: number } }> = {};
    for (const row of series) {
      const key = bucketKey(row.date, gran);
      if (!m[key]) m[key] = { naver: { r: 0, a: 0 }, jasamol: { r: 0, a: 0 }, coupang: { r: 0, a: 0 } };
      m[key].naver.r += row.naver?.revenue || 0; m[key].naver.a += row.naver?.adSpend || 0;
      m[key].jasamol.r += row.jasamol?.revenue || 0; m[key].jasamol.a += row.jasamol?.adSpend || 0;
      m[key].coupang.r += row.coupang?.revenue || 0; m[key].coupang.a += row.coupang?.adSpend || 0;
    }
    return Object.keys(m).sort().map((key) => {
      const b = m[key];
      const totalRev = b.naver.r + b.jasamol.r + b.coupang.r;
      const totalAd = b.naver.a + b.jasamol.a + b.coupang.a;
      return { key, label: bucketLabel(key, gran), ...b, totalRev, totalAd, totalRoas: totalAd > 0 ? totalRev / totalAd : 0 };
    });
  }, [series, gran]);

  const chartData = useMemo(() => buckets.map((b) => ({
    label: b.label,
    네이버: b.naver.a > 0 ? +(b.naver.r / b.naver.a).toFixed(2) : 0,
    자사몰: b.jasamol.a > 0 ? +(b.jasamol.r / b.jasamol.a).toFixed(2) : 0,
    쿠팡: b.coupang.a > 0 ? +(b.coupang.r / b.coupang.a).toFixed(2) : 0,
    전체: +b.totalRoas.toFixed(2),
  })), [buckets]);

  if (loading) {
    return (
      <PageShell title="채널 성과" description="판매처별 매출 vs 그 판매처를 끌어온 광고비 (전기간 대비)">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <Card key={i} className="p-6 animate-pulse"><CardContent className="p-0"><div className="h-32 bg-muted rounded" /></CardContent></Card>)}
        </div>
      </PageShell>
    );
  }

  const groups = data?.groups || [];
  const total = data?.total;

  return (
    <PageShell title="채널 성과" description="판매처별 매출 vs 그 판매처를 끌어온 광고비 · 원 단위 · 전기간 대비">
      {/* 통합 요약 */}
      {total && (
        <Card>
          <CardContent className="p-4 grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div><p className="text-xs text-muted-foreground">총 매출 (자체)</p><p className="text-lg font-bold">{formatWon(total.revenue)}</p></div>
            <div><p className="text-xs text-muted-foreground">총 광고비</p><p className="text-lg font-bold">{formatWon(total.adSpend)}</p></div>
            <div><p className="text-xs text-muted-foreground">통합 ROAS</p><p className="text-lg font-bold">{total.roas.toFixed(2)}x</p></div>
            <div><p className="text-xs text-muted-foreground">광고비 비중</p><p className="text-lg font-bold">{total.adRatio.toFixed(1)}%</p></div>
          </CardContent>
        </Card>
      )}

      {/* 채널그룹 카드 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {groups.map((g) => (
          <Card key={g.key} className="border-t-4" style={{ borderTopColor: roasColor(g.roas) }}>
            <CardContent className="p-5 space-y-4">
              <div className="flex items-start justify-between">
                <h3 className="font-semibold text-sm">{g.label}</h3>
                <span className="text-lg font-bold" style={{ color: roasColor(g.roas) }}>{g.roas.toFixed(2)}x</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[11px] text-muted-foreground">매출</p>
                  <p className="text-base font-bold">{formatWon(g.revenue)}</p>
                  <p className="text-[11px]">전기간 <Delta v={g.revDelta} /></p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">광고비 (비중 {g.adRatio.toFixed(1)}%)</p>
                  <p className="text-base font-bold">{formatWon(g.adSpend)}</p>
                  <p className="text-[11px]">전기간 <Delta v={g.adDelta} invert /></p>
                </div>
              </div>
              <div className="border-t pt-2 space-y-1">
                <p className="text-[11px] text-muted-foreground">광고비 구성</p>
                {g.subAds.map((s) => (
                  <div key={s.channel} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{s.label}</span>
                    <span className="font-medium">{formatWon(s.spend)}</span>
                  </div>
                ))}
              </div>
              <div className="border-t pt-2 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">ROAS 전기간 대비</span>
                <span className="font-medium"><Delta v={g.roasDelta} /></span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 기간별 ROAS 추이 (일/주/월) */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="font-semibold text-sm">기간별 추이 — 매출 / 광고비 / ROAS</h3>
            <div className="flex gap-0.5 rounded-lg bg-muted p-1">
              {([["day", "일별"], ["week", "주별"], ["month", "월별"]] as const).map(([k, lbl]) => (
                <button key={k} onClick={() => setGran(k)}
                  className={cn("px-3 py-1 text-xs font-medium rounded-md transition-colors", gran === k ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          {chartData.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">선택한 기간에 데이터가 없습니다.</p>
          ) : (
            <>
              {/* ROAS 추이 라인차트 */}
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                  <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" tickFormatter={(v) => `${v}x`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }}
                    formatter={(v) => `${Number(v).toFixed(2)}x`}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="네이버" stroke="#10b981" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="자사몰" stroke="#f59e0b" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="쿠팡" stroke="#3b82f6" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="전체" stroke="#6b7280" strokeWidth={2} strokeDasharray="4 2" dot={false} />
                </LineChart>
              </ResponsiveContainer>

              {/* 상세 표: 각 셀 = 매출 / 광고비 · ROAS */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left border-b text-muted-foreground">
                      <th className="pb-2 pr-3">기간</th>
                      <th className="pb-2 px-3 text-right">네이버<span className="block text-[10px] font-normal">매출 / 광고비·ROAS</span></th>
                      <th className="pb-2 px-3 text-right">자사몰<span className="block text-[10px] font-normal">매출 / 광고비·ROAS</span></th>
                      <th className="pb-2 px-3 text-right">쿠팡<span className="block text-[10px] font-normal">매출 / 광고비·ROAS</span></th>
                      <th className="pb-2 pl-3 text-right">전체<span className="block text-[10px] font-normal">매출 / 광고비·ROAS</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {buckets.slice().reverse().map((b) => (
                      <tr key={b.key} className="border-b border-border/50">
                        <td className="py-2 pr-3 font-medium whitespace-nowrap">{b.label}</td>
                        <CellTd r={b.naver.r} a={b.naver.a} />
                        <CellTd r={b.jasamol.r} a={b.jasamol.a} />
                        <CellTd r={b.coupang.r} a={b.coupang.a} />
                        <td className="py-2 pl-3 text-right whitespace-nowrap">
                          <div className="font-semibold">{formatWon(b.totalRev)}</div>
                          <div className="text-[11px] text-muted-foreground">{formatWon(b.totalAd)} · <span style={{ color: roasColor(b.totalRoas) }}>{b.totalRoas.toFixed(1)}x</span></div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <p className="text-[11px] text-muted-foreground/70">
            네이버=스마트스토어 매출÷(네이버검색+쇼핑+GFA) · 자사몰=카페24÷(메타+구글) · 쿠팡=쿠팡÷쿠팡광고. 매출은 공구 제외 자체매출. 주별=월요일 기준.
          </p>
        </CardContent>
      </Card>
    </PageShell>
  );
}
