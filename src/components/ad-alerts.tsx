"use client";

import { Card, CardContent } from "@/components/ui/card";
import { useFetch } from "@/hooks/use-dashboard-data";
import { formatCurrency, formatNumber } from "@/lib/utils";

// 광고 분석 페이지 맨 위. 예전 aside 네이버 광고 루틴이 내던 판단(전일 대비 급변, 비용 썼는데 전환 0)을
// 캠페인 단위로 보여 준다. 규칙은 /api/ad-alerts 맨 위 상수가 정본이다.

interface Spike { source: string; campaign: string; brand: string; date: string; spend: number; prev: number; changePct: number | null }
interface ZeroConv { source: string; campaign: string; brand: string; from: string; to: string; spend: number; clicks: number }
interface Resp {
  rules: { spikeRatio: number; spikeMinWon: number; zeroConvDays: number; zeroConvMinWon: number };
  asOf: { gfa: string | null; coupang: string | null };
  spikes: Spike[]; zeroConv: ZeroConv[];
  conversionBasis: { gfa: string; coupang: string };
  error?: string;
}

export function AdAlerts() {
  const { data, loading } = useFetch<Resp>("/api/ad-alerts");
  if (loading || !data) return null;
  if (data.error) {
    return <Card><CardContent className="p-4 text-sm" style={{ color: "var(--sig-danger)" }}>광고 이상 신호를 불러오지 못했습니다: {data.error}</CardContent></Card>;
  }
  const r = data.rules;
  const none = data.spikes.length === 0 && data.zeroConv.length === 0;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-semibold text-sm">
            ⚠️ 광고 이상 신호
            <span className="ml-2 text-xs font-normal" style={{ color: none ? "var(--sig-ok)" : "var(--sig-warn)" }}>
              {none ? "이상 없음" : `확인 필요 ${data.spikes.length + data.zeroConv.length}`}
            </span>
          </h3>
          <span className="text-xs text-muted-foreground">
            기준일 GFA {data.asOf.gfa ?? "-"} · 쿠팡 {data.asOf.coupang ?? "-"} · 캠페인 단위
          </span>
        </div>

        <section>
          <h4 className="text-xs font-medium mb-1">
            전일 대비 급변 <span className="text-muted-foreground font-normal">±{Math.round(r.spikeRatio * 100)}% 넘고 차이 {formatCurrency(r.spikeMinWon)} 이상</span>
          </h4>
          {data.spikes.length === 0 ? <p className="text-xs text-muted-foreground">없음</p> : (
            <table className="w-full text-xs">
              <thead><tr className="text-muted-foreground border-b">
                <th className="text-left py-1 pr-2">매체</th><th className="text-left px-2">캠페인</th>
                <th className="text-right px-2">전날</th><th className="text-right px-2">기준일</th><th className="text-right px-2">변화</th>
              </tr></thead>
              <tbody>{data.spikes.map((s) => (
                <tr key={`${s.source}-${s.campaign}`} className="border-b last:border-0">
                  <td className="py-1 pr-2">{s.source}</td>
                  <td className="px-2">{s.campaign}</td>
                  <td className="text-right px-2">{formatCurrency(s.prev)}</td>
                  <td className="text-right px-2">{formatCurrency(s.spend)}</td>
                  <td className="text-right px-2" style={{ color: s.spend > s.prev ? "var(--sig-danger)" : "var(--sig-warn)" }}>
                    {s.changePct === null ? "새로 집행" : `${s.changePct > 0 ? "+" : ""}${s.changePct}%`}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </section>

        <section>
          <h4 className="text-xs font-medium mb-1">
            비용 썼는데 전환 0 <span className="text-muted-foreground font-normal">최근 {r.zeroConvDays}일 광고비 {formatCurrency(r.zeroConvMinWon)} 이상 · 전환 기준 GFA {data.conversionBasis.gfa}, 쿠팡 {data.conversionBasis.coupang}</span>
          </h4>
          {data.zeroConv.length === 0 ? <p className="text-xs text-muted-foreground">없음</p> : (
            <table className="w-full text-xs">
              <thead><tr className="text-muted-foreground border-b">
                <th className="text-left py-1 pr-2">매체</th><th className="text-left px-2">캠페인</th>
                <th className="text-right px-2">기간</th><th className="text-right px-2">광고비</th><th className="text-right px-2">클릭</th>
              </tr></thead>
              <tbody>{data.zeroConv.map((z) => (
                <tr key={`${z.source}-${z.campaign}`} className="border-b last:border-0">
                  <td className="py-1 pr-2">{z.source}</td>
                  <td className="px-2">{z.campaign}</td>
                  <td className="text-right px-2 whitespace-nowrap">{z.from.slice(5)}~{z.to.slice(5)}</td>
                  <td className="text-right px-2">{formatCurrency(z.spend)}</td>
                  <td className="text-right px-2">{formatNumber(z.clicks)}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
