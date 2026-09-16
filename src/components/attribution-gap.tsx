"use client";

import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import { CHANNEL_LABELS } from "@/lib/types";

interface ChannelRow { channel: string; spend: number; roas: number; reportedRevenue?: number }

/**
 * 광고 신고 매출 vs 실제 판매 매출.
 *
 * 매체마다 같은 주문을 자기 기여로 신고한다. 채널별로는 틀린 게 아닌데 더하면 실매출을 넘는다.
 * 2026-09 실측(사입 9/3~9/14): 쇼핑광고 19,215,820 + GFA 15,992,700 + 검색광고 3,691,300
 * = 38,899,820 인데 실제 판매는 18,417,880 이었다(211%).
 *
 * 이 카드의 목적은 '얼마나 벌었나'가 아니라 **'채널 ROAS 를 더하면 안 된다'를 보이게 하는 것**이다.
 * 헤드라인 ROAS 는 실매출 기준이라 안전하고, 채널 ROAS 는 채널 내부 비교에만 쓴다.
 */
export function AttributionGap({
  channels, actualRevenue, adSpend,
}: { channels: ChannelRow[]; actualRevenue: number; adSpend: number }) {
  const rows = (channels || []).filter(c => (c.reportedRevenue ?? 0) > 0 || c.spend > 0);
  const reported = rows.reduce((s, c) => s + (c.reportedRevenue ?? 0), 0);
  if (rows.length === 0 || reported <= 0 || actualRevenue <= 0) return null;

  const ratio = reported / actualRevenue;
  const overclaim = ratio > 1.15;
  const realRoas = adSpend > 0 ? actualRevenue / adSpend : 0;
  const reportedRoas = adSpend > 0 ? reported / adSpend : 0;

  return (
    <Card><CardContent className="p-4">
      <div className="flex items-baseline justify-between gap-2 flex-wrap mb-3">
        <h3 className="font-semibold text-sm">
          광고 신고 vs 실제 판매 <span className="text-xs text-muted-foreground font-normal">귀속 중복 점검</span>
        </h3>
        <span className="stamp px-2 py-1 rounded border"
          style={overclaim
            ? { color: "var(--sig-danger)", backgroundColor: "var(--sig-danger-surface)", borderColor: "var(--sig-danger-border)" }
            : { color: "var(--sig-ok)", backgroundColor: "var(--sig-ok-surface)", borderColor: "var(--sig-ok-border)" }}>
          신고가 실매출의 {Math.round(ratio * 100)}%
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2.5 mb-3">
        <div className="surface-sunken p-3">
          <p className="text-xs text-muted-foreground">실제 판매 매출</p>
          <p className="num font-bold mt-0.5">{formatCurrency(actualRevenue)}</p>
          <p className="num text-xs mt-0.5" style={{ color: "var(--sig-ok)" }}>ROAS {realRoas.toFixed(2)}x · 이 값을 쓰세요</p>
        </div>
        <div className="surface-sunken p-3">
          <p className="text-xs text-muted-foreground">광고 신고 합계</p>
          <p className="num font-bold mt-0.5">{formatCurrency(reported)}</p>
          <p className="num text-xs mt-0.5" style={{ color: overclaim ? "var(--sig-danger)" : "var(--muted-foreground)" }}>
            ROAS {reportedRoas.toFixed(2)}x · 합산하면 틀립니다
          </p>
        </div>
        <div className="surface-sunken p-3 col-span-2 lg:col-span-1">
          <p className="text-xs text-muted-foreground">차이</p>
          <p className="num font-bold mt-0.5" style={{ color: overclaim ? "var(--sig-danger)" : undefined }}>
            {reported >= actualRevenue ? "+" : ""}{formatCurrency(reported - actualRevenue)}
          </p>
          <p className="stamp text-muted-foreground mt-0.5">같은 주문을 여러 매체가 각자 셈</p>
        </div>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground border-b">
            <th className="text-left py-2 font-medium">매체</th>
            <th className="text-right py-2 font-medium">광고비</th>
            <th className="text-right py-2 font-medium">신고 전환매출</th>
            <th className="text-right py-2 font-medium">신고 ROAS</th>
          </tr>
        </thead>
        <tbody>
          {rows.sort((a, b) => (b.reportedRevenue ?? 0) - (a.reportedRevenue ?? 0)).map(c => (
            <tr key={c.channel} className="border-b last:border-0">
              <td className="py-2">{CHANNEL_LABELS[c.channel] || c.channel}</td>
              <td className="py-2 text-right num">{formatCurrency(c.spend)}</td>
              <td className="py-2 text-right num">{formatCurrency(c.reportedRevenue ?? 0)}</td>
              <td className="py-2 text-right num text-muted-foreground">{c.roas.toFixed(2)}x</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="stamp text-muted-foreground mt-2">
        매체별 값은 그 매체 안에서 비교할 때만 쓰세요. 세로로 더하면 실매출을 넘습니다.
      </p>
    </CardContent></Card>
  );
}
