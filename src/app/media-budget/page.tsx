"use client";

import { Suspense, useMemo, useState, useCallback } from "react";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { useFetch, useFilterParams } from "@/hooks/use-dashboard-data";
import { BRAND_LABELS, CHANNEL_LABELS, type DailyAdSpend } from "@/lib/types";
import { useConfig } from "@/hooks/use-config";
import { formatCurrency } from "@/lib/utils";

// 채널 표시 순서
const CHANNEL_ORDER = [
  "meta", "naver_search", "naver_shopping", "google_pmax",
  "google_search", "coupang_ads", "gfa",
];

type ViewMode = "spend" | "impressions" | "clicks";

export default function MediaBudgetPage() {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">로딩 중...</div>}>
      <MediaBudgetInner />
    </Suspense>
  );
}

function MediaBudgetInner() {
  const { brand, from, to } = useFilterParams();
  const { channelMap } = useConfig();
  const [viewMode, setViewMode] = useState<ViewMode>("spend");

  const { data, loading } = useFetch<{ ads: DailyAdSpend[] }>(
    `/api/ads?from=${from}&to=${to}${brand !== "all" ? `&brand=${brand}` : ""}`
  );

  const ads = useMemo(
    () => (data?.ads || []).filter((r) => !r.channel.startsWith("ga4_")),
    [data]
  );

  // 사용 채널 목록 (데이터에 있는 것만, 순서 우선)
  const channels = useMemo(() => {
    const inData = new Set(ads.map((r) => r.channel));
    const ordered = CHANNEL_ORDER.filter((c) => inData.has(c));
    const rest = [...inData].filter((c) => !CHANNEL_ORDER.includes(c)).sort();
    return [...ordered, ...rest];
  }, [ads]);

  const getLabel = useCallback(
    (ch: string) => channelMap[ch]?.label || CHANNEL_LABELS[ch] || ch,
    [channelMap]
  );

  // 날짜별 채널별 집계
  const rows = useMemo(() => {
    const dateMap = new Map<
      string,
      Record<string, { spend: number; impressions: number; clicks: number }>
    >();

    for (const r of ads) {
      if (!dateMap.has(r.date)) dateMap.set(r.date, {});
      const dm = dateMap.get(r.date)!;
      if (!dm[r.channel]) dm[r.channel] = { spend: 0, impressions: 0, clicks: 0 };
      dm[r.channel].spend += r.spend || 0;
      dm[r.channel].impressions += r.impressions || 0;
      dm[r.channel].clicks += r.clicks || 0;
    }

    return Array.from(dateMap.entries())
      .sort(([a], [b]) => b.localeCompare(a)) // 최신 날짜 위로
      .map(([date, byChannel]) => ({
        date,
        byChannel,
        total: {
          spend: Object.values(byChannel).reduce((s, v) => s + v.spend, 0),
          impressions: Object.values(byChannel).reduce((s, v) => s + v.impressions, 0),
          clicks: Object.values(byChannel).reduce((s, v) => s + v.clicks, 0),
        },
      }));
  }, [ads]);

  // 합계 행
  const totals = useMemo(() => {
    const t: Record<string, { spend: number; impressions: number; clicks: number }> = {};
    for (const row of rows) {
      for (const [ch, vals] of Object.entries(row.byChannel)) {
        if (!t[ch]) t[ch] = { spend: 0, impressions: 0, clicks: 0 };
        t[ch].spend += vals.spend;
        t[ch].impressions += vals.impressions;
        t[ch].clicks += vals.clicks;
      }
    }
    return t;
  }, [rows]);

  const grandTotal = useMemo(() => ({
    spend: Object.values(totals).reduce((s, v) => s + v.spend, 0),
    impressions: Object.values(totals).reduce((s, v) => s + v.impressions, 0),
    clicks: Object.values(totals).reduce((s, v) => s + v.clicks, 0),
  }), [totals]);

  // 최댓값 (heatmap용)
  const maxSpend = useMemo(
    () => Math.max(...rows.map((r) => r.total.spend), 1),
    [rows]
  );

  const getValue = (cell: { spend: number; impressions: number; clicks: number } | undefined) => {
    if (!cell) return 0;
    return cell[viewMode];
  };

  const formatValue = (v: number) => {
    if (viewMode === "spend") return formatCurrency(v);
    return v.toLocaleString();
  };

  // CSV 다운로드
  const handleCsvDownload = useCallback(() => {
    const get = (cell: { spend: number; impressions: number; clicks: number } | undefined) =>
      cell ? cell[viewMode] : 0;
    const headers = ["날짜", "합계", ...channels.map(getLabel)];
    const csvRows = [
      headers.join(","),
      ...rows.map((r) => [
        r.date,
        r.total[viewMode],
        ...channels.map((ch) => get(r.byChannel[ch])),
      ].join(",")),
      ["합계", grandTotal[viewMode], ...channels.map((ch) => get(totals[ch]))].join(","),
    ];
    const csv = "\uFEFF" + csvRows.join("\n"); // BOM for Excel
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `매체예산분배_${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [rows, channels, viewMode, from, to, totals, grandTotal, getLabel]);

  const formatDate = (d: string) => {
    const dt = new Date(d);
    const days = ["일", "월", "화", "수", "목", "금", "토"];
    return `${dt.getMonth() + 1}/${dt.getDate()} (${days[dt.getDay()]})`;
  };

  if (loading) {
    return (
      <PageShell title="매체예산 분배" description="채널별 광고비 일별 내역">
        <div className="h-64 flex items-center justify-center text-muted-foreground">로딩 중...</div>
      </PageShell>
    );
  }

  return (
    <PageShell title="매체예산 분배" description={`채널별 광고비 일별 내역 (${rows.length}일)`}>
      {/* 요약 KPI */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-card border rounded-lg p-3">
          <div className="text-xs text-muted-foreground">총 광고비</div>
          <div className="text-lg font-bold">{formatCurrency(grandTotal.spend)}</div>
        </div>
        <div className="bg-card border rounded-lg p-3">
          <div className="text-xs text-muted-foreground">총 노출</div>
          <div className="text-lg font-bold">{grandTotal.impressions.toLocaleString()}</div>
        </div>
        <div className="bg-card border rounded-lg p-3">
          <div className="text-xs text-muted-foreground">총 클릭</div>
          <div className="text-lg font-bold">{grandTotal.clicks.toLocaleString()}</div>
        </div>
        <div className="bg-card border rounded-lg p-3">
          <div className="text-xs text-muted-foreground">평균 CTR</div>
          <div className="text-lg font-bold">
            {grandTotal.impressions > 0
              ? `${((grandTotal.clicks / grandTotal.impressions) * 100).toFixed(2)}%`
              : "-"}
          </div>
        </div>
      </div>

      {/* 컨트롤 바 */}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
          {(["spend", "impressions", "clicks"] as ViewMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                viewMode === m
                  ? "bg-background shadow text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {m === "spend" ? "광고비" : m === "impressions" ? "노출수" : "클릭수"}
            </button>
          ))}
        </div>
        <button
          onClick={handleCsvDownload}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          CSV 다운로드
        </button>
      </div>

      {/* 엑셀 스타일 테이블 */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm border-collapse" style={{ minWidth: `${(channels.length + 2) * 110}px` }}>
            <thead>
              {/* 브랜드 필터 안내 */}
              {brand !== "all" && (
                <tr>
                  <th
                    colSpan={channels.length + 2}
                    className="py-1.5 px-3 bg-blue-50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 text-xs text-left font-normal border-b"
                  >
                    필터: {BRAND_LABELS[brand] || brand}
                  </th>
                </tr>
              )}
              <tr className="bg-muted/50">
                <th className="sticky left-0 z-10 bg-muted/80 backdrop-blur py-2.5 px-3 text-left font-semibold text-xs text-muted-foreground border-b border-r whitespace-nowrap">
                  날짜
                </th>
                <th className="py-2.5 px-3 text-right font-semibold text-xs border-b border-r bg-blue-50/50 dark:bg-blue-950/10 text-blue-700 dark:text-blue-300 whitespace-nowrap">
                  합계
                </th>
                {channels.map((ch) => (
                  <th key={ch} className="py-2.5 px-3 text-right font-semibold text-xs text-muted-foreground border-b border-r whitespace-nowrap">
                    {getLabel(ch)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={channels.length + 2} className="py-12 text-center text-muted-foreground text-sm">
                    데이터 없음
                  </td>
                </tr>
              ) : (
                rows.map((row, i) => {
                  const totalVal = getValue(row.total as { spend: number; impressions: number; clicks: number });
                  const intensity = viewMode === "spend" && maxSpend > 0
                    ? Math.round((row.total.spend / maxSpend) * 20) // 0~20 단계
                    : 0;
                  return (
                    <tr
                      key={row.date}
                      className={`border-b hover:bg-muted/30 transition-colors ${
                        i % 2 === 0 ? "bg-background" : "bg-muted/10"
                      }`}
                    >
                      <td className="sticky left-0 z-10 py-2 px-3 font-medium border-r whitespace-nowrap bg-inherit text-xs">
                        {formatDate(row.date)}
                        <span className="ml-1 text-muted-foreground text-[10px]">{row.date.slice(5)}</span>
                      </td>
                      <td
                        className="py-2 px-3 text-right font-semibold border-r text-xs whitespace-nowrap"
                        style={{
                          backgroundColor: viewMode === "spend" && intensity > 0
                            ? `rgba(37,99,235,${intensity * 0.035})`
                            : undefined,
                        }}
                      >
                        {formatValue(totalVal)}
                      </td>
                      {channels.map((ch) => {
                        const cell = row.byChannel[ch];
                        const v = getValue(cell);
                        return (
                          <td
                            key={ch}
                            className={`py-2 px-3 text-right border-r text-xs whitespace-nowrap ${
                              v === 0 ? "text-muted-foreground/40" : ""
                            }`}
                          >
                            {v === 0 ? "—" : formatValue(v)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}

              {/* 합계 행 */}
              {rows.length > 0 && (
                <tr className="border-t-2 bg-muted/30 font-semibold">
                  <td className="sticky left-0 z-10 py-2.5 px-3 border-r bg-muted/50 text-xs font-bold">
                    합 계
                  </td>
                  <td className="py-2.5 px-3 text-right border-r text-xs text-blue-700 dark:text-blue-300 font-bold">
                    {formatValue(grandTotal[viewMode])}
                  </td>
                  {channels.map((ch) => (
                    <td key={ch} className="py-2.5 px-3 text-right border-r text-xs font-bold">
                      {getValue(totals[ch]) === 0 ? "—" : formatValue(getValue(totals[ch]))}
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* 채널별 비중 */}
      {rows.length > 0 && viewMode === "spend" && (
        <Card>
          <CardContent className="p-4">
            <h3 className="font-semibold text-sm mb-3">채널별 비중</h3>
            <div className="space-y-2">
              {channels
                .map((ch) => ({ ch, spend: totals[ch]?.spend || 0 }))
                .sort((a, b) => b.spend - a.spend)
                .filter((x) => x.spend > 0)
                .map(({ ch, spend }) => {
                  const pct = grandTotal.spend > 0 ? (spend / grandTotal.spend) * 100 : 0;
                  return (
                    <div key={ch} className="flex items-center gap-3 text-sm">
                      <div className="w-20 text-xs text-muted-foreground text-right shrink-0">
                        {getLabel(ch)}
                      </div>
                      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-blue-500 transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="w-32 text-right text-xs shrink-0">
                        {formatCurrency(spend)}
                        <span className="text-muted-foreground ml-1">({pct.toFixed(1)}%)</span>
                      </div>
                    </div>
                  );
                })}
            </div>
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
