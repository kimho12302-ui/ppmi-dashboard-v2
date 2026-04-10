"use client";

import { Suspense, useMemo, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent } from "@/components/ui/card";
import { useFilterParams, useFetch } from "@/hooks/use-dashboard-data";
import { formatCurrency, formatNumber, formatPercent, cn } from "@/lib/utils";
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine,
} from "recharts";
import type { KeywordPerformance } from "@/lib/types";

const PLATFORM_LABELS: Record<string, string> = {
  naver_search: "네이버 검색",
  naver_shopping: "네이버 쇼핑",
  naver_gfa: "GFA",
  google_search: "구글 검색",
  google_display: "구글 디스플레이",
  meta: "메타",
};

const PLATFORM_COLORS: Record<string, string> = {
  naver_search: "#15803d",
  naver_shopping: "#0e7490",
  naver_gfa: "#6d28d9",
  google_search: "#c2410c",
  google_display: "#b45309",
  meta: "#1d4ed8",
};

export default function KeywordsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">로딩 중...</div>}>
      <KeywordsInner />
    </Suspense>
  );
}

function KeywordsInner() {
  const { from, to, brand } = useFilterParams();
  const { data, loading } = useFetch<{ keywords: KeywordPerformance[] }>(`/api/keywords?from=${from}&to=${to}&brand=${brand}`);
  const [sortBy, setSortBy] = useState<"cost" | "clicks" | "conversions" | "ctr">("cost");
  const [platformFilter, setPlatformFilter] = useState<string>("all");

  const keywords = useMemo(() => data?.keywords || [], [data]);

  /* 플랫폼 목록 */
  const platforms = useMemo(() => {
    const set = new Set(keywords.map((k) => k.platform));
    return Array.from(set).sort();
  }, [keywords]);

  /* 키워드 집계 */
  const aggregated = useMemo(() => {
    const filtered = platformFilter === "all" ? keywords : keywords.filter((k) => k.platform === platformFilter);
    const map: Record<string, { keyword: string; platform: string; cost: number; clicks: number; impressions: number; conversions: number; convValue: number }> = {};
    for (const k of filtered) {
      const key = `${k.platform}-${k.keyword}`;
      if (!map[key]) map[key] = { keyword: k.keyword, platform: k.platform, cost: 0, clicks: 0, impressions: 0, conversions: 0, convValue: 0 };
      map[key].cost += k.cost || 0;
      map[key].clicks += k.clicks || 0;
      map[key].impressions += k.impressions || 0;
      map[key].conversions += k.conversions || 0;
      map[key].convValue += k.conversion_value || 0;
    }
    return Object.values(map)
      .map((v) => ({
        ...v,
        ctr: v.impressions > 0 ? (v.clicks / v.impressions) * 100 : 0,
        cpc: v.clicks > 0 ? v.cost / v.clicks : 0,
        roas: v.cost > 0 ? v.convValue / v.cost : 0,
      }))
      .sort((a, b) => {
        switch (sortBy) {
          case "cost": return b.cost - a.cost;
          case "clicks": return b.clicks - a.clicks;
          case "conversions": return b.conversions - a.conversions;
          case "ctr": return b.ctr - a.ctr;
          default: return b.cost - a.cost;
        }
      })
      .slice(0, 50);
  }, [keywords, platformFilter, sortBy]);

  /* KPI */
  const totals = useMemo(() => {
    const filtered = platformFilter === "all" ? keywords : keywords.filter((k) => k.platform === platformFilter);
    const cost = filtered.reduce((s, k) => s + (k.cost || 0), 0);
    const clicks = filtered.reduce((s, k) => s + (k.clicks || 0), 0);
    const impressions = filtered.reduce((s, k) => s + (k.impressions || 0), 0);
    return {
      cost,
      clicks,
      uniqueKeywords: new Set(filtered.map((k) => k.keyword)).size,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    };
  }, [keywords, platformFilter]);

  /* 9.3 키워드 그룹핑 (브랜드 vs 일반) */
  const groupedStats = useMemo(() => {
    const brandKws = ["너티", "nutty", "아이언펫", "ironpet", "밸런스랩", "큐모발", "사입"];
    const filtered = platformFilter === "all" ? keywords : keywords.filter((k) => k.platform === platformFilter);
    const brand = { cost: 0, clicks: 0, impressions: 0, conversions: 0, count: 0 };
    const general = { cost: 0, clicks: 0, impressions: 0, conversions: 0, count: 0 };
    const seen = new Set<string>();
    for (const k of filtered) {
      const isBrand = brandKws.some((bk) => k.keyword.toLowerCase().includes(bk));
      const target = isBrand ? brand : general;
      target.cost += k.cost || 0;
      target.clicks += k.clicks || 0;
      target.impressions += k.impressions || 0;
      target.conversions += k.conversions || 0;
      const key = `${isBrand ? "b" : "g"}-${k.keyword}`;
      if (!seen.has(key)) { seen.add(key); target.count++; }
    }
    return { brand, general };
  }, [keywords, platformFilter]);

  /* 9.4 TOP 비용 vs TOP 전환 비교 */
  const topComparison = useMemo(() => {
    const byCost = [...aggregated].sort((a, b) => b.cost - a.cost).slice(0, 10);
    const byConv = [...aggregated].sort((a, b) => b.conversions - a.conversions).slice(0, 10);
    const convSet = new Set(byConv.map((k) => k.keyword));
    const overlap = byCost.filter((k) => convSet.has(k.keyword)).map((k) => k.keyword);
    return { byCost, byConv, overlap };
  }, [aggregated]);

  /* 9.5 버블 차트 데이터 (CTR vs 노출, 버블크기=비용) */
  const bubbleData = useMemo(() => {
    return aggregated
      .filter((k) => k.impressions > 0 && k.cost > 0)
      .slice(0, 30)
      .map((k) => ({
        keyword: k.keyword,
        ctr: Math.round(k.ctr * 100) / 100,
        impressions: k.impressions,
        cost: k.cost,
        cpc: Math.round(k.cpc),
        clicks: k.clicks,
      }));
  }, [aggregated]);

  if (loading) {
    return (
      <PageShell title="키워드" description="키워드별 광고 성과">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="p-5 animate-pulse">
              <CardContent className="p-0">
                <div className="h-4 w-20 bg-muted rounded mb-2" />
                <div className="h-8 w-28 bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell title="키워드" description="키워드별 광고 성과">
      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="키워드 수" value={formatNumber(totals.uniqueKeywords)} />
        <KpiCard title="총 비용" value={formatCurrency(totals.cost)} />
        <KpiCard title="총 클릭" value={formatNumber(totals.clicks)} />
        <KpiCard title="평균 CTR" value={formatPercent(totals.ctr)} />
      </div>

      {/* 필터 */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-0.5 rounded-lg bg-muted p-1">
          <button
            onClick={() => setPlatformFilter("all")}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
              platformFilter === "all" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            전체
          </button>
          {platforms.map((p) => (
            <button
              key={p}
              onClick={() => setPlatformFilter(p)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap",
                platformFilter === p ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {PLATFORM_LABELS[p] || p}
            </button>
          ))}
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          className="text-xs px-2 py-1.5 rounded-md bg-muted border-none"
        >
          <option value="cost">비용순</option>
          <option value="clicks">클릭순</option>
          <option value="conversions">전환순</option>
          <option value="ctr">CTR순</option>
        </select>
      </div>

      {/* 키워드 테이블 */}
      <Card>
        <CardContent className="p-4 overflow-x-auto">
          <h3 className="font-semibold mb-4">TOP 50 키워드</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b text-muted-foreground">
                <th className="pb-2 pr-4">#</th>
                <th className="pb-2 pr-4">플랫폼</th>
                <th className="pb-2 pr-4">키워드</th>
                <th className="pb-2 pr-4 text-right">비용</th>
                <th className="pb-2 pr-4 text-right">노출</th>
                <th className="pb-2 pr-4 text-right">클릭</th>
                <th className="pb-2 pr-4 text-right">CTR</th>
                <th className="pb-2 pr-4 text-right">CPC</th>
                <th className="pb-2 text-right">전환</th>
              </tr>
            </thead>
            <tbody>
              {aggregated.map((k, i) => (
                <tr key={`${k.platform}-${k.keyword}`} className="border-b border-border/50 hover:bg-muted/50">
                  <td className="py-2 pr-4 text-muted-foreground">{i + 1}</td>
                  <td className="py-2 pr-4">
                    <span
                      className="text-xs px-1.5 py-0.5 rounded"
                      style={{
                        backgroundColor: `${PLATFORM_COLORS[k.platform] || '#6b7280'}20`,
                        color: PLATFORM_COLORS[k.platform] || '#6b7280',
                      }}
                    >
                      {PLATFORM_LABELS[k.platform] || k.platform}
                    </span>
                  </td>
                  <td className="py-2 pr-4 font-medium">{k.keyword}</td>
                  <td className="py-2 pr-4 text-right">{formatCurrency(k.cost)}</td>
                  <td className="py-2 pr-4 text-right">{formatNumber(k.impressions)}</td>
                  <td className="py-2 pr-4 text-right">{formatNumber(k.clicks)}</td>
                  <td className="py-2 pr-4 text-right">{formatPercent(k.ctr)}</td>
                  <td className="py-2 pr-4 text-right">{k.cpc > 0 ? formatCurrency(Math.round(k.cpc)) : "—"}</td>
                  <td className="py-2 text-right">{formatNumber(k.conversions)}</td>
                </tr>
              ))}
              {aggregated.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-muted-foreground">
                    키워드 데이터가 없습니다
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
      {/* 9.3 브랜드 vs 일반 키워드 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[
          { label: "🏷️ 브랜드 키워드", data: groupedStats.brand, color: "#2563eb" },
          { label: "🔍 일반 키워드", data: groupedStats.general, color: "#6b7280" },
        ].map((g) => (
          <Card key={g.label}>
            <CardContent className="p-4">
              <h4 className="font-semibold text-sm mb-2" style={{ color: g.color }}>{g.label}</h4>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">키워드 수</span><p className="font-bold">{formatNumber(g.data.count)}</p></div>
                <div><span className="text-muted-foreground">비용</span><p className="font-bold">{formatCurrency(g.data.cost)}</p></div>
                <div><span className="text-muted-foreground">클릭</span><p className="font-bold">{formatNumber(g.data.clicks)}</p></div>
                <div><span className="text-muted-foreground">전환</span><p className="font-bold">{formatNumber(g.data.conversions)}</p></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 9.4 TOP 비용 vs TOP 전환 */}
      {aggregated.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardContent className="p-4">
              <h4 className="font-semibold text-sm mb-2">💰 비용 TOP 10</h4>
              <div className="space-y-1">
                {topComparison.byCost.map((k, i) => (
                  <div key={k.keyword} className={cn("flex items-center gap-2 text-sm py-1", topComparison.overlap.includes(k.keyword) && "bg-yellow-500/10 rounded px-1")}>
                    <span className="text-muted-foreground w-4">{i + 1}</span>
                    <span className="flex-1 truncate">{k.keyword}</span>
                    <span className="font-medium">{formatCurrency(k.cost)}</span>
                    {topComparison.overlap.includes(k.keyword) && <span className="text-[10px] text-yellow-600">⭐</span>}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <h4 className="font-semibold text-sm mb-2">🎯 전환 TOP 10</h4>
              <div className="space-y-1">
                {topComparison.byConv.map((k, i) => (
                  <div key={k.keyword} className={cn("flex items-center gap-2 text-sm py-1", topComparison.overlap.includes(k.keyword) && "bg-yellow-500/10 rounded px-1")}>
                    <span className="text-muted-foreground w-4">{i + 1}</span>
                    <span className="flex-1 truncate">{k.keyword}</span>
                    <span className="font-medium">{formatNumber(k.conversions)}건</span>
                    {topComparison.overlap.includes(k.keyword) && <span className="text-[10px] text-yellow-600">⭐</span>}
                  </div>
                ))}
              </div>
              {topComparison.overlap.length > 0 && (
                <p className="text-xs text-muted-foreground mt-2">⭐ = 비용·전환 모두 TOP 10 ({topComparison.overlap.length}개)</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* 9.5 버블 그래프 (CTR vs 노출, 버블=비용) — 사분면 참조선 포함 */}
      {bubbleData.length > 0 && (() => {
        const avgCtr = bubbleData.reduce((s, d) => s + d.ctr, 0) / bubbleData.length;
        const avgImp = bubbleData.reduce((s, d) => s + d.impressions, 0) / bubbleData.length;
        return (
          <Card>
            <CardContent className="p-4">
              <h3 className="font-semibold text-sm mb-1">키워드 사분면 — CTR vs 노출 (버블 크기 = 비용)</h3>
              <div className="flex gap-4 text-xs text-muted-foreground mb-3 flex-wrap">
                <span className="text-green-600 font-medium">●  스타: 고CTR + 고노출</span>
                <span className="text-blue-600 font-medium">●  잠재력: 고CTR + 저노출</span>
                <span className="text-yellow-600 font-medium">●  비용최적화: 저CTR + 고노출</span>
                <span className="text-red-500 font-medium">●  재검토: 저CTR + 저노출</span>
              </div>
              <ResponsiveContainer width="100%" height={380}>
                <ScatterChart margin={{ top: 10, right: 30, bottom: 30, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis
                    type="number" dataKey="ctr" name="CTR"
                    tick={{ fontSize: 10 }} stroke="var(--muted-foreground)"
                    label={{ value: "CTR (%)", position: "insideBottom", offset: -10, fontSize: 11, fill: "var(--muted-foreground)" }}
                  />
                  <YAxis
                    type="number" dataKey="impressions" name="노출"
                    tick={{ fontSize: 10 }} stroke="var(--muted-foreground)"
                    tickFormatter={(v) => v >= 10000 ? `${(v / 10000).toFixed(0)}만` : formatNumber(v)}
                    label={{ value: "노출", angle: -90, position: "insideLeft", fontSize: 11, fill: "var(--muted-foreground)" }}
                  />
                  <ZAxis type="number" dataKey="cost" range={[40, 400]} name="비용" />
                  <ReferenceLine x={avgCtr} stroke="#94a3b8" strokeDasharray="4 4"
                    label={{ value: `평균 CTR ${avgCtr.toFixed(1)}%`, position: "top", fontSize: 9, fill: "#94a3b8" }} />
                  <ReferenceLine y={avgImp} stroke="#94a3b8" strokeDasharray="4 4"
                    label={{ value: `평균 노출 ${avgImp >= 10000 ? (avgImp / 10000).toFixed(0) + "만" : formatNumber(Math.round(avgImp))}`, position: "right", fontSize: 9, fill: "#94a3b8" }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }}
                    formatter={(val, name) => {
                      const v = Number(val);
                      if (name === "CTR") return [`${v}%`, name];
                      if (name === "노출") return [formatNumber(v), name];
                      if (name === "비용") return [formatCurrency(v), name];
                      return [v, name];
                    }}
                    labelFormatter={(_, payload) => payload?.[0]?.payload?.keyword || ""}
                  />
                  <Scatter data={bubbleData} fill="#2563eb" fillOpacity={0.6} />
                </ScatterChart>
              </ResponsiveContainer>
              <p className="text-xs text-muted-foreground mt-2">
                💡 참조선 기준: 평균 CTR·노출. 우상단 = 스타 키워드. 큰 버블 = 비용 높음.
              </p>
            </CardContent>
          </Card>
        );
      })()}
    </PageShell>
  );
}
