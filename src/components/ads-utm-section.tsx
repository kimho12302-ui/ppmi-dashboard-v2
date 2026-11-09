"use client";

import { Card, CardContent } from "@/components/ui/card";
import { useFetch } from "@/hooks/use-dashboard-data";
import { formatCurrency, formatNumber } from "@/lib/utils";

// 광고 분석 「GA4 UTM」 탭 (2026-11-09).
// 예전 탭은 daily_ad_spend 의 ga4_* 행(GA4 가 본 구글 광고 비용)을 카드로 그렸는데,
// /api/ads 가 그 행을 처음부터 빼고 불러와 탭이 늘 비어 있었다. 그 행은 google_ads 와 겹치고
// 구글 광고를 멈춘 2026-05-14 에 끝났으므로 되살리지 않는다.
// 대신 sync_ga4_utm.py 가 매일 채우는 utm_analytics(유입 경로별 세션·주요 이벤트·매출)를 /api/utm 으로 보여 준다.
// 이 표에는 광고비가 없고, 위 KPI·매체 합계에 더하지 않는다. utm_analytics 에 brand 칸이 없어 브랜드 칩을 따르지 않는다.

interface UtmSource { source: string; medium: string; sessions: number; users: number; new_users: number }
interface UtmCampaign {
  source: string; medium: string; campaign: string;
  sessions: number; conversions: number; revenue: number; bounce_rate: number; avg_duration: number;
}
interface UtmResponse { data?: UtmSource[]; campaigns?: UtmCampaign[]; scopeNote?: string; error?: string }

const SOURCE_ROWS = 10;
const CAMPAIGN_ROWS = 15;
// GA4 가 utm_campaign 이 없을 때 채우는 자리표시값. 캠페인 표에서 뺀다.
const isPlaceholderCampaign = (c: string) => /^\(.*\)$/.test(c.trim()) || c.trim() === "";

export function AdsUtmSection({ from, to }: { from: string; to: string }) {
  const { data, loading, error } = useFetch<UtmResponse>(`/api/utm?from=${from}&to=${to}`);

  if (loading) {
    return <Card><CardContent className="p-8 text-center text-muted-foreground">GA4 유입 기록 로딩 중...</CardContent></Card>;
  }
  const failure = error || data?.error;
  if (failure) {
    return <Card><CardContent className="p-4 text-sm text-amber-600">GA4 유입 기록을 불러오지 못했습니다 ({failure})</CardContent></Card>;
  }

  const sources = (data?.data || []).slice(0, SOURCE_ROWS);
  const campaigns = (data?.campaigns || []).filter((c) => !isPlaceholderCampaign(c.campaign)).slice(0, CAMPAIGN_ROWS);
  const maxSessions = Math.max(1, ...sources.map((s) => s.sessions));

  return (
    <Card data-tour="ads-ga4">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <h3 className="font-semibold text-sm">GA4 유입 경로 · UTM 캠페인</h3>
          {data?.scopeNote && <span className="text-xs text-muted-foreground">{data.scopeNote}</span>}
        </div>
        <p className="text-xs text-muted-foreground">
          구글 애널리틱스(GA4)가 센 방문 기록입니다. 광고비가 없는 표라 위 KPI·광고비 합계에 들어가지 않습니다.
          위쪽 브랜드 칩은 이 표에 적용되지 않습니다.
        </p>

        {sources.length === 0 && campaigns.length === 0 ? (
          <p className="text-sm text-muted-foreground">이 기간에 수집된 GA4 유입 기록이 없습니다</p>
        ) : (
          <>
            <div>
              <p className="text-xs text-muted-foreground mb-2">소스/매체별 세션 (상위 {SOURCE_ROWS}개)</p>
              <div className="space-y-1.5">
                {sources.map((s) => (
                  <div key={`${s.source}/${s.medium}`} className="flex items-center gap-3 text-sm">
                    <span className="w-48 shrink-0 truncate" title={`${s.source} / ${s.medium}`}>
                      {s.source} <span className="text-muted-foreground">/ {s.medium}</span>
                    </span>
                    <div className="flex-1 h-3.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-amber-500" style={{ width: `${(s.sessions / maxSessions) * 100}%` }} />
                    </div>
                    <span className="w-16 text-right text-xs font-medium">{formatNumber(s.sessions)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto">
              <p className="text-xs text-muted-foreground mb-2">UTM 캠페인별 (utm_campaign 이 붙은 유입만, 세션 상위 {CAMPAIGN_ROWS}개)</p>
              {campaigns.length === 0 ? (
                <p className="text-sm text-muted-foreground">이 기간에 utm_campaign 이 붙은 유입이 없습니다</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b">
                      <th className="text-left py-2 font-medium">캠페인</th>
                      <th className="text-left py-2 font-medium">소스/매체</th>
                      <th className="text-right py-2 font-medium">세션</th>
                      <th className="text-right py-2 font-medium" title="GA4 주요 이벤트 횟수. 구매 건수가 아닙니다">주요 이벤트</th>
                      <th className="text-right py-2 font-medium">GA4 매출</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.map((c) => (
                      <tr key={`${c.source}/${c.medium}/${c.campaign}`} className="border-b border-border/50 last:border-0">
                        <td className="py-2 truncate max-w-[240px]" title={c.campaign}>{c.campaign}</td>
                        <td className="py-2 text-muted-foreground text-xs">{c.source}/{c.medium}</td>
                        <td className="py-2 text-right">{formatNumber(c.sessions)}</td>
                        <td className="py-2 text-right">{formatNumber(c.conversions)}</td>
                        <td className="py-2 text-right font-medium">{formatCurrency(c.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
        <p className="text-xs text-muted-foreground">
          「주요 이벤트」는 GA4 가 정한 주요 행동이 일어난 횟수라 구매 건수가 아닙니다. 한 방문에서 여러 번 셀 수 있습니다.
        </p>
      </CardContent>
    </Card>
  );
}
