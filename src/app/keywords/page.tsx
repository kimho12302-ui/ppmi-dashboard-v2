"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent } from "@/components/ui/card";
import { useFilterParams, useFetch, usePrefetch } from "@/hooks/use-dashboard-data";
import { saChangesUrl } from "@/lib/api-urls";
import { formatCurrency, formatNumber, formatPercent, cn } from "@/lib/utils";
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine,
} from "recharts";
import { xAxisProps, yAxisProps, gridProps, tooltipCardProps, TIP_CARD } from "@/components/charts/chart-style";
import { ParetoChart, buildPareto, PARETO_LINE } from "@/components/charts/pareto-chart";
import { AD_CHANNEL_COLORS, type KeywordPerformance } from "@/lib/types";
import { CoupangKeywordSection } from "@/components/coupang-keywords";
import { NaverSearchTermSection } from "@/components/naver-search-terms";
import { SearchDemandSection } from "@/components/search-demand";
import { KeywordSourceStatus, useStalled, stalledChipNote } from "@/components/keyword-source-status";
import { kstDate } from "@/lib/date";
import type { SourceLatest } from "@/lib/sa-balancelab";

const PLATFORM_LABELS: Record<string, string> = {
  naver_search: "네이버 검색",
  naver_shopping: "네이버 쇼핑",
  naver_gfa: "GFA",
  google_search: "구글 검색",
  google_display: "구글 디스플레이",
  meta: "메타",
};

// 같은 매체 = 모든 화면 같은 색(2026-11-09). 키워드 원장의 플랫폼 키를 types.ts 정본 매체 색에 잇는다.
// naver_gfa 는 정본의 gfa 와 같은 매체다. 구글 디스플레이는 정본에 없어 여기서만 칠한다.
const PLATFORM_COLORS: Record<string, string> = {
  naver_search: AD_CHANNEL_COLORS.naver_search,
  naver_shopping: AD_CHANNEL_COLORS.naver_shopping,
  naver_gfa: AD_CHANNEL_COLORS.gfa,
  google_search: AD_CHANNEL_COLORS.google_search,
  google_display: "#b45309",
  meta: AD_CHANNEL_COLORS.meta,
};

type KeywordTab = "keywords" | "gsc" | "coupang" | "naver" | "demand";

export default function KeywordsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">로딩 중...</div>}>
      <KeywordsInner />
    </Suspense>
  );
}

function KeywordsInner() {
  const { from, to, brand: rawBrand, setBrand } = useFilterParams();
  // ★ 2026-11-10: 키워드 화면은 「전체」를 쓰지 않는다. 펫(검색광고 계정 main)과 밸런스랩(계정 balancelab)은 키워드가
  //   안 겹쳐(김호 확인) 합치면 KPI 가 두 계정을 섞는다. 「전체」로 들어오면 밸런스랩으로 바꾼다(콘텐츠 화면과 같은 방식).
  //   다른 화면의 「전체」는 그대로다(사이드바 이동은 브랜드를 안 들고 간다).
  const brand = rawBrand === "all" ? "balancelab" : rawBrand;
  useEffect(() => { if (rawBrand === "all") setBrand("balancelab"); }, [rawBrand, setBrand]);
  const { data, loading } = useFetch<{ keywords: KeywordPerformance[]; latestCollected?: string | null; sources?: SourceLatest[]; sourcesError?: boolean }>(`/api/keywords?from=${from}&to=${to}&brand=${brand}`);
  const [sortBy, setSortBy] = useState<"cost" | "clicks" | "conversions" | "ctr" | "roas" | "waste">("cost");
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [tab, setTab] = useState<KeywordTab>("keywords");
  /** 키워드 사분면 카드의 보기: 사분면 | 비용 집중(파레토, 2026-11-10) */
  const [quadView, setQuadView] = useState<"quadrant" | "pareto">("quadrant");
  // SA 조정 이력 칸은 키워드 응답이 올 때까지 마운트되지 않는다. 기다리지 않게 같이 부른다.
  // 2026-11-10 부터 조정 이력은 네이버 검색어 탭(밸런스랩)에만 있다. 칸이 부르는 주소와 글자까지 같아야 미리 부른 응답을 쓴다.
  usePrefetch([tab === "naver" && brand === "balancelab" ? saChangesUrl("balancelab") : null]);
  const stalled = useStalled(data?.sources, kstDate());

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
          case "roas": return b.roas - a.roas;
          // 낭비순: 돈은 썼는데 매출이 없는 것부터. 자를 키워드를 찾는 정렬이다.
          case "waste": return (b.convValue > 0 ? -1 : b.cost) - (a.convValue > 0 ? -1 : a.cost);
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
    const convValue = filtered.reduce((s, k) => s + (k.conversion_value || 0), 0);
    // 전환매출 컬럼이 아직 없는 DB 에서는 값이 전부 undefined 로 온다. 그때 ROAS 0.00x 를
    // 자신있게 찍으면 "성과가 없다"로 오독된다 → 측정 자체가 안 된 상태를 구분해서 표시한다.
    const hasConvValue = filtered.some((k) => k.conversion_value !== undefined && k.conversion_value !== null);
    return {
      cost,
      clicks,
      uniqueKeywords: new Set(filtered.map((k) => k.keyword)).size,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      convValue,
      hasConvValue,
      roas: cost > 0 ? convValue / cost : 0,
      // 낭비 광고비는 **원본 행(하루)마다** 전환매출 0 인 날의 광고비. DB 합산 응답은 묶기 전에 더한 wasted_cost 를 준다.
      wasted: filtered.reduce((s, k) => s + (k.wasted_cost ?? ((k.conversion_value || 0) === 0 ? (k.cost || 0) : 0)), 0),
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

  /* 파레토(2026-11-10): 광고비가 몇 개 키워드에 몰려 있나. 매체·키워드 쌍마다 기간 광고비를 더한다(위 「총 비용」과 같은 범위).
     매출(전환값) 기준은 쓰지 않는다: 메타 구매 귀속이 막혀 있고 네이버 SA 전환값은 매체 신고값이라 키워드끼리 나눠 갖는 실제 매출이 아니다. */
  const pareto = useMemo(() => {
    const filtered = platformFilter === "all" ? keywords : keywords.filter((k) => k.platform === platformFilter);
    const m = new Map<string, { key: string; label: string; value: number; sub: string }>();
    for (const k of filtered) {
      const key = `${k.platform}|${k.keyword}`;
      const cur = m.get(key) || { key, label: k.keyword, value: 0, sub: PLATFORM_LABELS[k.platform] || k.platform };
      cur.value += k.cost || 0;
      m.set(key, cur);
    }
    return buildPareto(Array.from(m.values()));
  }, [keywords, platformFilter]);

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
      <PageShell hideAllBrand title="키워드" description="키워드별 광고 성과">
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
    <PageShell hideAllBrand title="키워드" description="키워드별 광고 성과">
      {/* 탭. 좁은 화면에서는 줄을 바꾼다(390px 에서 가로로 넘쳤다) */}
      <div className="flex flex-wrap items-center gap-0.5 rounded-lg bg-muted p-1 w-fit max-w-full" data-tour="keywords-tabs">
        {([
          { key: "keywords", label: "키워드 분석" },
          { key: "gsc", label: "Google Search Console (ironpet.store)" },
          { key: "coupang", label: "쿠팡 광고 키워드" },
          { key: "naver", label: "네이버 검색어" },
          { key: "demand", label: "검색 수요 (밸런스랩 주제·정적)" },
        ] as { key: KeywordTab; label: string }[]).map((t) => (
          <button
            key={t.key}
            data-tour={"keywords-tab-" + t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap",
              tab === t.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "gsc" && <GscSection brand={brand} from={from} to={to} />}
      {tab === "coupang" && <CoupangKeywordSection brand={brand} from={from} to={to} />}
      {tab === "naver" && <NaverSearchTermSection brand={brand} from={from} to={to} />}
      {tab === "demand" && <SearchDemandSection />}

      {/* 밸런스랩 검색광고 직접 조정 이력은 2026-11-10 네이버 검색어 탭으로 옮겼다(두 탭에 같은 칸이 있었다). */}

      {/* 수집 중단을 빈 화면으로 오독하지 않도록 마지막 수집일을 명시한다(2026-08 리뷰, 2026-11-10 플랫폼·브랜드별로).
          멈춘 원천은 지우지 않고 「수집 멈춤(마지막 YYYY-MM-DD)」으로 남긴다. */}
      {tab === "keywords" && !loading && (
        <KeywordSourceStatus stalled={stalled} labels={PLATFORM_LABELS} from={from} to={to} latestCollected={data?.latestCollected} sourcesError={data?.sourcesError} />
      )}

      {tab === "keywords" && <>
      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" data-tour="keywords-kpis">
        <KpiCard title="키워드 수" value={formatNumber(totals.uniqueKeywords)} />
        <KpiCard title="총 비용" value={formatCurrency(totals.cost)} />
        <KpiCard title="총 클릭" value={formatNumber(totals.clicks)} />
        <KpiCard title="평균 CTR" value={formatPercent(totals.ctr)} />
      </div>
      {/* 성과(ROAS) 행. 전환매출 없이는 '어떤 키워드가 돈을 벌었나'를 판단할 수 없다. */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2.5" data-tour="keywords-roas-kpis">
        <KpiCard
          size="compact"
          title="전환매출"
          value={totals.hasConvValue ? formatCurrency(totals.convValue) : "-"}
          confidence={totals.hasConvValue ? undefined : { level: "unmeasurable", note: "전환매출 미수집: keyword_performance.conversion_value 컬럼 추가 필요" }}
        />
        <KpiCard
          size="compact"
          title="ROAS"
          value={totals.hasConvValue ? `${totals.roas.toFixed(2)}x` : "-"}
          confidence={totals.hasConvValue ? undefined : { level: "unmeasurable", note: "전환매출이 없어 계산 불가" }}
        />
        <KpiCard
          size="compact"
          title="매출 0 키워드 비용"
          value={totals.hasConvValue ? formatCurrency(totals.wasted) : "-"}
          subtitle={totals.hasConvValue ? "자를 후보" : undefined}
          confidence={totals.hasConvValue ? undefined : { level: "unmeasurable", note: "전환매출이 없어 판별 불가" }}
        />
      </div>

      {/* 필터 */}
      <div className="flex flex-wrap items-center gap-4" data-tour="keywords-filters">
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
              {PLATFORM_LABELS[p] || p}{stalledChipNote(p, stalled, data?.sources)}
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
          <option value="roas">ROAS순</option>
          <option value="waste">낭비순 (매출 0, 비용 큰 것)</option>
        </select>
      </div>

      {/* 키워드 테이블 */}
      <Card data-tour="keywords-top50">
        <CardContent className="p-4 overflow-x-auto">
          <h3 className="font-semibold mb-4">TOP 50 키워드 <span className="md:hidden text-xs font-normal text-muted-foreground">(좁은 화면은 4열만, 넓히면 11열)</span></h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b text-muted-foreground">
                <th className="pb-2 pr-4 hidden md:table-cell">#</th>
                <th className="pb-2 pr-4 hidden md:table-cell">플랫폼</th>
                <th className="pb-2 pr-4">키워드</th>
                <th className="pb-2 pr-4 text-right">비용</th>
                <th className="pb-2 pr-4 text-right hidden md:table-cell">노출</th>
                <th className="pb-2 pr-4 text-right">클릭</th>
                <th className="pb-2 pr-4 text-right hidden md:table-cell">CTR</th>
                <th className="pb-2 pr-4 text-right hidden md:table-cell">CPC</th>
                <th className="pb-2 pr-4 text-right hidden md:table-cell">전환</th>
                <th className="pb-2 pr-4 text-right hidden md:table-cell">전환매출</th>
                <th className="pb-2 text-right">ROAS</th>
              </tr>
            </thead>
            <tbody>
              {aggregated.map((k, i) => (
                <tr key={`${k.platform}-${k.keyword}`} className="border-b border-border/50 hover:bg-muted/50">
                  <td className="py-2 pr-4 text-muted-foreground hidden md:table-cell">{i + 1}</td>
                  <td className="py-2 pr-4 hidden md:table-cell">
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
                  <td className="py-2 pr-4 text-right hidden md:table-cell">{formatNumber(k.impressions)}</td>
                  <td className="py-2 pr-4 text-right">{formatNumber(k.clicks)}</td>
                  <td className="py-2 pr-4 text-right hidden md:table-cell">{formatPercent(k.ctr)}</td>
                  <td className="py-2 pr-4 text-right hidden md:table-cell">{k.cpc > 0 ? formatCurrency(Math.round(k.cpc)) : "-"}</td>
                  <td className="py-2 pr-4 text-right hidden md:table-cell">{formatNumber(k.conversions)}</td>
                  <td className="py-2 pr-4 text-right hidden md:table-cell">{totals.hasConvValue ? (k.convValue > 0 ? formatCurrency(k.convValue) : "0원") : "-"}</td>
                  <td className="py-2 text-right num">
                    {!totals.hasConvValue ? "-" : k.cost === 0 ? "-" : (
                      <span style={{ color: k.roas >= 1 ? "var(--sig-ok)" : k.convValue === 0 ? "var(--sig-danger)" : "var(--sig-warn)" }}>
                        {k.roas.toFixed(2)}x
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {aggregated.length === 0 && (
                <tr>
                  <td colSpan={11} className="py-8 text-center text-muted-foreground">
                    키워드 데이터가 없습니다
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* 9.3 브랜드 vs 일반 키워드 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" data-tour="keywords-brand-split">
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" data-tour="keywords-top10">
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

      {/* 9.5 버블 그래프 (CTR vs 노출, 버블=비용), 사분면 참조선 포함 */}
      {bubbleData.length > 0 && (() => {
        // 평균 CTR 은 키워드별 CTR 의 단순 평균이 아니라 노출 가중(클릭 합 ÷ 노출 합). 노출 10회짜리 키워드의
        // CTR 10% 가 노출 1만 회짜리와 같은 무게로 들어가 참조선이 오른쪽으로 끌려갔다(2026-11-04).
        const sumImp = bubbleData.reduce((s, d) => s + d.impressions, 0);
        const avgCtr = sumImp > 0 ? (bubbleData.reduce((s, d) => s + d.clicks, 0) / sumImp) * 100 : 0;
        const avgImp = sumImp / bubbleData.length;
        return (
          <Card data-tour="keywords-quadrant">
            <CardContent className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2 mb-1">
                <h3 className="font-semibold text-sm">{quadView === "quadrant" ? "키워드 사분면: CTR vs 노출 (버블 크기 = 비용)" : "광고비 집중도 (파레토)"}</h3>
                <div data-tour="keywords-quadrant-view" className="flex gap-0.5 rounded-md bg-muted p-0.5">
                  {([["quadrant", "사분면"], ["pareto", "광고비 집중"]] as const).map(([k, lbl]) => (
                    <button key={k} onClick={() => setQuadView(k)}
                      className={cn("px-2 py-1 text-xs rounded", quadView === k ? "bg-card shadow-sm font-medium" : "text-muted-foreground")}>{lbl}</button>
                  ))}
                </div>
              </div>
              {quadView === "pareto" ? (
                <>
                  <p className="text-xs text-muted-foreground mb-1">
                    가로 = 광고비 순위(1위부터), 막대 = 그 키워드 광고비, 빨간 선 = 1위부터 더한 누적 비중(오른쪽 축). 점선 = {PARETO_LINE}%.
                    매체·키워드 쌍 {pareto.rows.length.toLocaleString("ko-KR")}개 중 위 30개만 막대로 그립니다.
                  </p>
                  <p data-tour="keywords-pareto-verdict" className="text-sm mb-2">
                    {pareto.rows.length === 0 ? <span className="text-muted-foreground">이 기간 광고비가 쓰인 키워드가 없습니다.</span>
                      : <>광고비의 <b>{PARETO_LINE}%</b>가 상위 <b>{pareto.reachCount}개</b> 키워드(전체 {pareto.rows.length}개의 {((pareto.reachCount / pareto.rows.length) * 100).toFixed(0)}%)에 몰려 있습니다.</>}
                  </p>
                  {pareto.rows.length > 0 && <ParetoChart rows={pareto.rows} format={(v) => formatCurrency(Math.round(v))} valueName="광고비" />}
                  <p className="text-xs text-muted-foreground mt-2">
                    광고비 기준입니다. 매출 기준은 그리지 않습니다: 메타는 구매 귀속이 막혀 있고, 네이버 SA 전환값은 매체가 신고한 값이라 키워드끼리 실제 매출을 나눠 가진 값이 아닙니다(전환값은 위 표 ROAS 열에서 참고만).
                    위 필터에서 매체를 고르면 그 매체만 셉니다.
                  </p>
                </>
              ) : (<>
              <p className="text-xs text-muted-foreground mb-3">
                오른쪽 = CTR 평균 이상, 위 = 노출 평균 이상. 전환은 이 그림에 없어 위치만으로 좋고 나쁨을 판정하지 않습니다(전환은 위 표 ROAS 열).
              </p>
              <ResponsiveContainer width="100%" height={380}>
                <ScatterChart margin={{ top: 10, right: 30, bottom: 30, left: 10 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis
                    {...xAxisProps}
                    type="number" dataKey="ctr" name="CTR"
                    label={{ value: "CTR (%)", position: "insideBottom", offset: -10, fontSize: 11, fill: "var(--muted-foreground)" }}
                  />
                  <YAxis
                    {...yAxisProps}
                    type="number" dataKey="impressions" name="노출"
                    tickFormatter={(v) => v >= 10000 ? `${(v / 10000).toFixed(0)}만` : formatNumber(v)}
                    label={{ value: "노출", angle: -90, position: "insideLeft", fontSize: 11, fill: "var(--muted-foreground)" }}
                  />
                  <ZAxis type="number" dataKey="cost" range={[40, 400]} name="비용" />
                  <ReferenceLine x={avgCtr} stroke="#94a3b8" strokeDasharray="4 4"
                    label={{ value: `평균 CTR ${avgCtr.toFixed(1)}% (노출 가중)`, position: "top", fontSize: 9, fill: "#94a3b8" }} />
                  <ReferenceLine y={avgImp} stroke="#94a3b8" strokeDasharray="4 4"
                    label={{ value: `평균 노출 ${avgImp >= 10000 ? (avgImp / 10000).toFixed(0) + "만" : formatNumber(Math.round(avgImp))}`, position: "right", fontSize: 9, fill: "#94a3b8" }} />
                  <Tooltip
                    {...tooltipCardProps}
                    cursor={{ strokeDasharray: "3 3", stroke: "var(--chart-dim)" }}
                    wrapperStyle={{ zIndex: 100 }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload;
                      return (
                        <div className={TIP_CARD}>
                          <p className="font-bold text-sm mb-1.5">{d.keyword}</p>
                          <p>CTR: <b>{d.ctr}%</b></p>
                          <p>노출: <b>{formatNumber(d.impressions)}</b></p>
                          <p>클릭: <b>{formatNumber(d.clicks)}</b></p>
                          <p>비용: <b>{formatCurrency(d.cost)}</b></p>
                          {d.conversions > 0 && <p>전환: <b>{d.conversions}</b></p>}
                        </div>
                      );
                    }}
                  />
                  <Scatter name="키워드" data={bubbleData} fill="#475569" fillOpacity={0.55} isAnimationActive={false} />
                </ScatterChart>
              </ResponsiveContainer>
              <p className="text-xs text-muted-foreground mt-2">
                참조선: CTR 은 노출 가중 평균(클릭 합 ÷ 노출 합), 노출은 키워드당 평균. 지금 고른 정렬 순서로 위 30개 키워드만 그립니다(기본 비용순이면 비용 상위 30개).
              </p>
              </>)}
            </CardContent>
          </Card>
        );
      })()}
      </>}
    </PageShell>
  );
}

/* ── GSC 섹션 (P10) ── */
interface GscQuery {
  query: string; device: string; clicks: number; impressions: number; ctr: number; position: number;
}
interface GscSummary {
  totalClicks: number; totalImpressions: number; avgCtr: number; avgPosition: number;
}

function GscSection({ brand, from, to }: { brand: string; from: string; to: string }) {
  const { data, loading } = useFetch<{ queries: GscQuery[]; summary: GscSummary; error?: string; notice?: string | null; siteUrl?: string }>(
    `/api/gsc?brand=${brand}&from=${from}&to=${to}`
  );
  const [sortBy, setSortBy] = useState<"clicks" | "impressions" | "ctr" | "position">("clicks");
  const [view, setView] = useState<"bubble" | "table">("bubble");

  const allQueries = useMemo(() => data?.queries || [], [data]);

  const queries = useMemo(() => {
    return [...allQueries].sort((a, b) => {
      if (sortBy === "impressions") return b.impressions - a.impressions;
      if (sortBy === "ctr") return b.ctr - a.ctr;
      if (sortBy === "position") return a.position - b.position;
      return b.clicks - a.clicks;
    }).slice(0, 100);
  }, [allQueries, sortBy]);

  /* 기기 통합 집계 → 버블 데이터 (노출 가중 평균 순위) */
  const gscBubbleData = useMemo(() => {
    const map: Record<string, { query: string; clicks: number; impressions: number; wPosTot: number }> = {};
    for (const q of allQueries) {
      if (!map[q.query]) map[q.query] = { query: q.query, clicks: 0, impressions: 0, wPosTot: 0 };
      map[q.query].clicks += q.clicks;
      map[q.query].impressions += q.impressions;
      map[q.query].wPosTot += q.position * q.impressions;
    }
    return Object.values(map)
      .filter(d => d.clicks > 0 && d.impressions > 0)
      .map(d => ({
        query: d.query,
        clicks: d.clicks,
        impressions: d.impressions,
        ctr: (d.clicks / d.impressions) * 100,
        position: d.wPosTot / d.impressions,
      }))
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 50);
  }, [allQueries]);

  /* 사분면 기준선 + 분류 */
  const { avgCtr, avgImp, quadrants } = useMemo(() => {
    type BubbleItem = (typeof gscBubbleData)[number];
    const empty = { avgCtr: 0, avgImp: 0, quadrants: { hiCtrHiImp: [] as BubbleItem[], hiCtrLoImp: [] as BubbleItem[], loCtrHiImp: [] as BubbleItem[], loCtrLoImp: [] as BubbleItem[] } };
    if (!gscBubbleData.length) return empty;
    // 평균 CTR 은 노출 가중(클릭 합 ÷ 노출 합). 검색어별 CTR 단순 평균은 노출 적은 검색어에 끌려간다(2026-11-04).
    const sumImp = gscBubbleData.reduce((s, d) => s + d.impressions, 0);
    const avgCtr = sumImp > 0 ? (gscBubbleData.reduce((s, d) => s + d.clicks, 0) / sumImp) * 100 : 0;
    const avgImp = sumImp / gscBubbleData.length;
    return {
      avgCtr, avgImp,
      quadrants: {
        hiCtrHiImp:      gscBubbleData.filter(d => d.ctr >= avgCtr && d.impressions >= avgImp),
        hiCtrLoImp: gscBubbleData.filter(d => d.ctr >= avgCtr && d.impressions < avgImp),
        loCtrHiImp:   gscBubbleData.filter(d => d.ctr < avgCtr && d.impressions >= avgImp),
        loCtrLoImp:    gscBubbleData.filter(d => d.ctr < avgCtr && d.impressions < avgImp),
      },
    };
  }, [gscBubbleData]);

  if (loading) return <Card><CardContent className="p-8 text-center text-muted-foreground">GSC 로딩 중...</CardContent></Card>;
  if (data?.error) return <Card><CardContent className="p-4 text-sm text-amber-600">GSC 오류: {data.error}</CardContent></Card>;
  {/* 이 속성에 없는 브랜드를 골랐을 때, 빈 결과가 "검색 성과 0"으로 오독되지 않도록 사유를 명시 */}
  if (data?.notice) return (
    <Card className="border-amber-300 dark:border-amber-800 bg-amber-500/5">
      <CardContent className="p-4 text-sm text-muted-foreground">
        <p className="font-medium text-amber-700 dark:text-amber-500 mb-1">이 브랜드의 GSC 데이터가 없습니다</p>
        <p>{data.notice}</p>
      </CardContent>
    </Card>
  );

  const summary = data?.summary;
  return (
    <>
      <p className="text-xs text-muted-foreground" data-tour="keywords-gsc-scope">
        구글 <b>자연 검색</b>(광고 아님)입니다. 연결된 사이트는 <b>ironpet.store 하나</b>라 펫 검색어만 있습니다.
      </p>
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="총 클릭" value={formatNumber(summary.totalClicks)} />
          <KpiCard title="총 노출" value={formatNumber(summary.totalImpressions)} />
          <KpiCard title="평균 CTR" value={formatPercent(summary.avgCtr * 100)} />
          <KpiCard title="평균 순위" value={summary.avgPosition.toFixed(1)} />
        </div>
      )}

      {/* 뷰 토글 */}
      <div className="flex items-center gap-0.5 rounded-lg bg-muted p-1 w-fit">
        {([
          { key: "bubble", label: "버블 그래프" },
          { key: "table", label: "검색어 테이블" },
        ] as { key: "bubble" | "table"; label: string }[]).map(v => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap",
              view === v.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* 버블 그래프 뷰 */}
      {view === "bubble" && (
        <Card>
          <CardContent className="p-4">
            <h3 className="font-semibold text-sm mb-1">구글 유입 검색어 사분면: CTR vs 노출 (버블 크기 = 클릭수)</h3>
            <p className="text-xs text-muted-foreground mb-3">
              오른쪽 = CTR 평균 이상(노출 가중), 위 = 노출 평균 이상. 구매 전환은 GSC 에 없어 위치만 보여 주고 판정하지 않습니다.
            </p>
            {gscBubbleData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">데이터가 없습니다. (GSC 권한 또는 날짜 범위 확인)</p>
            ) : (
              <ResponsiveContainer width="100%" height={420}>
                <ScatterChart margin={{ top: 10, right: 60, bottom: 30, left: 10 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis
                    {...xAxisProps}
                    type="number" dataKey="ctr" name="CTR" domain={[0, "auto"]}
                    tickFormatter={(v) => `${Number(v).toFixed(1)}%`}
                    label={{ value: "CTR (%)", position: "insideBottom", offset: -10, fontSize: 11, fill: "var(--muted-foreground)" }}
                  />
                  <YAxis
                    {...yAxisProps}
                    type="number" dataKey="impressions" name="노출"
                    tickFormatter={(v) => v >= 10000 ? `${(v / 10000).toFixed(0)}만` : formatNumber(v)}
                    label={{ value: "노출", angle: -90, position: "insideLeft", fontSize: 11, fill: "var(--muted-foreground)" }}
                  />
                  <ZAxis type="number" dataKey="clicks" range={[30, 600]} name="클릭" />
                  <ReferenceLine x={avgCtr} stroke="#94a3b8" strokeDasharray="4 4"
                    label={{ value: `평균 ${avgCtr.toFixed(1)}% (노출 가중)`, position: "insideTopRight", fontSize: 9, fill: "#94a3b8" }} />
                  <ReferenceLine y={avgImp} stroke="#94a3b8" strokeDasharray="4 4"
                    label={{ value: `평균 ${avgImp >= 10000 ? (avgImp / 10000).toFixed(0) + "만" : formatNumber(Math.round(avgImp))}`, position: "right", fontSize: 9, fill: "#94a3b8" }} />
                  <Tooltip
                    {...tooltipCardProps}
                    cursor={{ strokeDasharray: "3 3", stroke: "var(--chart-dim)" }}
                    wrapperStyle={{ zIndex: 100 }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload;
                      return (
                        <div className={TIP_CARD}>
                          <p className="font-bold text-sm mb-1.5">{d.query}</p>
                          <p>CTR: <b>{d.ctr.toFixed(2)}%</b></p>
                          <p>노출: <b>{formatNumber(d.impressions)}</b></p>
                          <p>클릭: <b>{formatNumber(d.clicks)}</b></p>
                        </div>
                      );
                    }}
                  />
                  <Scatter name="검색어" data={gscBubbleData} fill="#475569" fillOpacity={0.55} isAnimationActive={false} />
                </ScatterChart>
              </ResponsiveContainer>
            )}
            {gscBubbleData.length > 0 && (
              <div className="mt-3 grid grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
                {[
                  { label: "오른쪽 위", count: quadrants.hiCtrHiImp.length, desc: "CTR 평균 이상 · 노출 평균 이상" },
                  { label: "오른쪽 아래", count: quadrants.hiCtrLoImp.length, desc: "CTR 평균 이상 · 노출 평균 미만" },
                  { label: "왼쪽 위", count: quadrants.loCtrHiImp.length, desc: "CTR 평균 미만 · 노출 평균 이상" },
                  { label: "왼쪽 아래", count: quadrants.loCtrLoImp.length, desc: "CTR 평균 미만 · 노출 평균 미만" },
                ].map(q => (
                  <div key={q.label} className="bg-muted/40 rounded p-2">
                    <span className="font-semibold">{q.label} {q.count}개</span>
                    <p className="text-muted-foreground mt-0.5">{q.desc}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 테이블 뷰 */}
      {view === "table" && (
        <Card>
          <CardContent className="p-4 overflow-x-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">검색 쿼리 성과 (ironpet.store)</h3>
              <div className="flex items-center gap-1">
                {(["clicks", "impressions", "ctr", "position"] as const).map(s => (
                  <button key={s} onClick={() => setSortBy(s)}
                    className={cn("px-2 py-1 text-xs rounded", sortBy === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                    {s === "clicks" ? "클릭순" : s === "impressions" ? "노출순" : s === "ctr" ? "CTR순" : "순위순"}
                  </button>
                ))}
              </div>
            </div>
            {queries.length === 0 ? (
              <p className="text-sm text-muted-foreground">데이터가 없습니다. (GSC 서비스 계정 권한 또는 날짜 범위 확인)</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b text-muted-foreground">
                    <th className="pb-2 pr-4">#</th>
                    <th className="pb-2 pr-4">검색어</th>
                    <th className="pb-2 pr-4">기기</th>
                    <th className="pb-2 pr-4 text-right">클릭</th>
                    <th className="pb-2 pr-4 text-right">노출</th>
                    <th className="pb-2 pr-4 text-right">CTR</th>
                    <th className="pb-2 text-right">평균 순위</th>
                  </tr>
                </thead>
                <tbody>
                  {queries.map((q, i) => (
                    <tr key={`${q.query}-${q.device}`} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="py-2 pr-4 text-muted-foreground">{i + 1}</td>
                      <td className="py-2 pr-4 font-medium max-w-[240px] truncate">{q.query}</td>
                      <td className="py-2 pr-4 text-muted-foreground text-xs">{q.device}</td>
                      <td className="py-2 pr-4 text-right">{formatNumber(q.clicks)}</td>
                      <td className="py-2 pr-4 text-right text-muted-foreground">{formatNumber(q.impressions)}</td>
                      <td className="py-2 pr-4 text-right">{(q.ctr * 100).toFixed(2)}%</td>
                      <td className="py-2 text-right">{q.position.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
