"use client";

import { Suspense } from "react";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { useFilterParams, useFetch } from "@/hooks/use-dashboard-data";
import { formatWon } from "@/lib/utils";

interface SubAd { channel: string; label: string; spend: number; }
interface Group {
  key: string; label: string; revenue: number; adSpend: number; roas: number; adRatio: number;
  subAds: SubAd[];
  revDelta: number | null; adDelta: number | null; roasDelta: number | null;
}
interface ChannelGroupsData {
  from: string; to: string;
  groups: Group[];
  total: { revenue: number; adSpend: number; roas: number; adRatio: number };
}

function Delta({ v, invert = false }: { v: number | null; invert?: boolean }) {
  if (v === null || !isFinite(v)) return <span className="text-muted-foreground/50">—</span>;
  const up = v >= 0;
  const good = invert ? !up : up; // 광고비는 증가가 꼭 좋은 건 아님 → invert
  const color = Math.abs(v) < 1 ? "text-muted-foreground" : good ? "text-emerald-600" : "text-red-500";
  return <span className={color}>{up ? "▲" : "▼"}{Math.abs(v).toFixed(0)}%</span>;
}

function roasColor(roas: number) {
  if (roas >= 5) return "#10b981";
  if (roas >= 2) return "#f59e0b";
  return "#ef4444";
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

              {/* 광고비 세부 (어떤 광고가 이 판매처를 끌어왔나) */}
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

      {/* 비교 테이블 */}
      <Card>
        <CardContent className="p-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b text-muted-foreground">
                <th className="pb-2 pr-3">채널그룹</th>
                <th className="pb-2 px-3 text-right">매출</th>
                <th className="pb-2 px-3 text-right">광고비</th>
                <th className="pb-2 px-3 text-right">ROAS</th>
                <th className="pb-2 pl-3 text-right">광고비비중</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.key} className="border-b border-border/50">
                  <td className="py-2 pr-3 font-medium">{g.label}</td>
                  <td className="py-2 px-3 text-right">{formatWon(g.revenue)}</td>
                  <td className="py-2 px-3 text-right">{formatWon(g.adSpend)}</td>
                  <td className="py-2 px-3 text-right font-semibold" style={{ color: roasColor(g.roas) }}>{g.roas.toFixed(2)}x</td>
                  <td className={`py-2 pl-3 text-right ${g.adRatio > 40 ? "text-red-500" : g.adRatio > 25 ? "text-yellow-600" : ""}`}>{g.adRatio.toFixed(1)}%</td>
                </tr>
              ))}
              {total && (
                <tr className="font-semibold">
                  <td className="py-2 pr-3">합계</td>
                  <td className="py-2 px-3 text-right">{formatWon(total.revenue)}</td>
                  <td className="py-2 px-3 text-right">{formatWon(total.adSpend)}</td>
                  <td className="py-2 px-3 text-right">{total.roas.toFixed(2)}x</td>
                  <td className="py-2 pl-3 text-right">{total.adRatio.toFixed(1)}%</td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="text-[11px] text-muted-foreground/70 mt-3">
            매핑: 네이버=스마트스토어 매출 ÷ (네이버검색+쇼핑+GFA) · 자사몰=카페24 매출 ÷ (메타+구글) · 쿠팡=쿠팡 매출 ÷ 쿠팡광고. 매출은 공구 제외 자체매출. 전기간=직전 동일 길이 구간.
          </p>
        </CardContent>
      </Card>
    </PageShell>
  );
}
