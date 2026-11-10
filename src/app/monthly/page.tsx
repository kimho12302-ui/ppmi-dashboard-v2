"use client";

import { Suspense, useCallback, useMemo, useState, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { useFetch, useFilterParams } from "@/hooks/use-dashboard-data";
import { AD_CHANNEL_COLORS, BRAND_LABELS } from "@/lib/types";
import { useConfig } from "@/hooks/use-config";
import { formatCurrency, formatNumber, formatPercent, cn } from "@/lib/utils";
import { kstDate } from "@/lib/date";
import { BlPnlView, PNL_DEFAULT_PICK, isPnlPick, type PnlPick } from "@/components/bl-pnl-view";
import {
  LineChart, Line, ReferenceLine, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, ComposedChart, Bar,
} from "recharts";

interface MonthlySummary {
  month: string;
  revenue: number;
  orders: number;
  adSpend: number;
  cogs: number;
  shippingCost: number;
  profit: number;
  profitRate: number;
  roas: number;
  mer: number;
  cv: number;
  aov: number;
  adRatio: number;
  cac: number;
  channelCosts: Record<string, number>;
  revGrowth?: number;
  orderGrowth?: number;
}

interface YTD {
  revenue: number;
  orders: number;
  adSpend: number;
  cogs: number;
  shippingCost: number;
  profit: number;
  profitRate: number;
  roas: number;
  aov: number;
}

interface MonthlyData {
  summary: MonthlySummary[];
  ytd: YTD;
  year: string;
  /** 진행 중인 달. salesDays = 그 달에 판매 원장이 들어온 날 수(오늘 제외). */
  inProgress?: { month: string; salesDays: number; salesThrough: string | null } | null;
  /** 원가 매칭률(0~1, 행 단위, Overview 와 같은 방식). 판매 행이 없으면 null */
  cogsMatchRate?: number | null;
}

// 차트 색: 무채색 + 강조 하나(시각화 아카이브 원칙). 매출만 강조색, 비용은 회색 단계로 구분한다.
const C_ACCENT = "#2563eb";
// 광고비가 가장 진하고 원가·배송비 순으로 옅다. 라이트·다크 둘 다에서 보이는 중간 톤(#475569 는 다크 배경에 묻혔다).
const C_COST = { adSpend: "#64748b", cogs: "#a3afc0", shippingCost: "#d5dce6" } as const;
const C_LINE = "#475569";
/** 진행 중인 달 막대·점은 흐리게. 며칠치만 들어 있어 다른 달과 같은 무게로 보이면 안 된다 */
const IN_PROGRESS_OPACITY = 0.35;
const tooltipStyle = { backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 };
/** 비율 미니 그래프 두 칸. 축 하나에 단위 하나 */
const RATIO_CHARTS = [
  { key: "profitRate", title: "이익률", axis: (v: number) => `${v.toFixed(0)}%`, tip: (v: number) => `${v.toFixed(1)}%` },
  { key: "roas", title: "ROAS (매출 ÷ 광고비)", axis: (v: number) => `${v.toFixed(1)}x`, tip: (v: number) => `${v.toFixed(2)}x` },
] as const;

export default function MonthlyPage() {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">로딩 중...</div>}>
      <MonthlyInner />
    </Suspense>
  );
}

// 보기 두 개 (2026-10-28): 요약 | 밸런스랩 제품별 손익. 손익은 원래 /brand/balancelab/pnl 이었는데
// 사이드바가 길어져 이 페이지 안으로 옮겼다. 보기·연도·제품은 URL 에 남겨 새로고침·공유해도 그대로 열린다.
//   /monthly                              요약, 올해
//   /monthly?view=pnl&product=food&year=2025  손익, 음식물, 2025년
// 기본값(view=summary, product=nutrition, year=올해)은 URL 에서 뺀다.
type MonthlyView = "summary" | "pnl";
const VIEWS: { key: MonthlyView; label: string }[] = [
  { key: "summary", label: "요약" },
  { key: "pnl", label: "밸런스랩 제품별 손익" },
];

const segBtn = (active: boolean) => cn(
  "px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap",
  active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
);

function MonthlyInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { brand } = useFilterParams();
  const { brandMap } = useConfig();
  const currentYear = Number(kstDate().slice(0, 4));
  const years = [currentYear - 1, currentYear];

  const view: MonthlyView = searchParams.get("view") === "pnl" ? "pnl" : "summary";
  const yearParam = Number(searchParams.get("year"));
  const year = years.includes(yearParam) ? yearParam : currentYear;
  const productParam = searchParams.get("product");
  const pick: PnlPick = isPnlPick(productParam) ? productParam : PNL_DEFAULT_PICK;

  /** 보기·연도·제품을 URL 에 쓴다. 기간·브랜드 같은 다른 쿼리는 그대로 둔다. replace 라 뒤로가기가 쌓이지 않는다 */
  const setQuery = useCallback((patch: { view?: MonthlyView; year?: number; product?: PnlPick }) => {
    const params = new URLSearchParams(searchParams.toString());
    const put = (key: string, value: string, def: string) => {
      if (value === def) params.delete(key); else params.set(key, value);
    };
    const nextView = patch.view ?? view;
    put("view", nextView, "summary");
    if (patch.year !== undefined) put("year", String(patch.year), String(currentYear));
    if (nextView === "pnl") {
      if (patch.product !== undefined) put("product", patch.product, PNL_DEFAULT_PICK);
    } else {
      params.delete("product");
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [searchParams, router, pathname, view, currentYear]);

  const [brandFilter, setBrandFilter] = useState(brand);
  // 글로벌 브랜드 필터 변경 시 동기화 (마운트 시 brand가 늦게 로드돼 '전체'로 리셋되던 버그)
  useEffect(() => { setBrandFilter(brand || "all"); }, [brand]);

  // Brand list (hard-coded since we know brands)
  const brands = ["all", "nutty", "ironpet", "saip", "balancelab"];

  return (
    <PageShell
      title="월별 요약"
      description={view === "pnl"
        ? "밸런스랩 제품별 손익 · 시트 「★브랜드별 매출」 밸런스랩 제품 블록을 판매 원장·광고비 원장으로 자동 계산"
        : "월별 성과 요약 · 원가/배송비/이익 분석"}
      hideFilters
    >
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4">
        {/* 보기 전환 */}
        <div data-tour="monthly-view-tabs" className="flex items-center gap-0.5 rounded-lg bg-muted p-1" role="tablist" aria-label="보기">
          {VIEWS.map((v) => (
            <button key={v.key} role="tab" aria-selected={view === v.key} onClick={() => setQuery({ view: v.key })} className={segBtn(view === v.key)}>
              {v.label}
            </button>
          ))}
        </div>

        {/* Year selector: 두 보기가 같은 연도를 쓴다 */}
        <div data-tour="monthly-year" className="flex items-center gap-0.5 rounded-lg bg-muted p-1">
          {years.map((y) => (
            <button key={y} onClick={() => setQuery({ year: y })} className={segBtn(year === y)}>
              {y}년
            </button>
          ))}
        </div>

        {/* Brand filter: 손익 보기는 밸런스랩 전용이라 숨긴다 */}
        {view === "summary" && (
          <div data-tour="monthly-brand" className="flex items-center gap-0.5 rounded-lg bg-muted p-1">
            {brands.map((b) => (
              <button key={b} onClick={() => setBrandFilter(b)} className={segBtn(brandFilter === b)}>
                {b === "all" ? "전체" : (brandMap[b]?.label || BRAND_LABELS[b] || b)}
              </button>
            ))}
          </div>
        )}
      </div>

      {view === "pnl"
        ? <BlPnlView year={String(year)} pick={pick} onPickChange={(p) => setQuery({ product: p })} />
        : <SummaryView year={year} brandFilter={brandFilter} />}
    </PageShell>
  );
}

/** 요약 보기. 이 보기가 떠 있을 때만 월별 요약 API 를 부른다 */
function SummaryView({ year, brandFilter }: { year: number; brandFilter: string }) {
  const { data, loading } = useFetch<MonthlyData>(
    `/api/monthly-summary?year=${year}&brand=${brandFilter}`
  );

  const summary = data?.summary || [];
  const ytd = data?.ytd;
  const reversed = [...summary].reverse(); // desc for table
  const inProgress = data?.inProgress ?? null;

  // 채널별 광고비 ((M)Dash Board 재현)
  const CH_LABEL: Record<string, string> = { meta: "메타", naver_search: "네이버검색", naver_shopping: "네이버쇼핑", google_pmax: "구글P-Max", google_search: "구글검색", google_ads: "구글", coupang_ads: "쿠팡", gfa: "GFA", gdn: "GDN", influencer: "인플루언서" };
  // 매체 색은 types.ts 정본(AD_CHANNEL_COLORS)을 쓴다(같은 매체 = 모든 화면 같은 색, 2026-11-09).
  // 정본에 없는 옛 원장 키(google_ads·gdn·influencer)만 여기서 따로 칠한다.
  const CH_COLOR: Record<string, string> = { google_ads: "#fbbf24", gdn: "#a78bfa", influencer: "#ec4899", ...AD_CHANNEL_COLORS };
  const channelKeys = Array.from(new Set(summary.flatMap((m) => Object.keys(m.channelCosts || {})))).filter(Boolean);
  // 차트 축: 데이터가 있는 첫 달~마지막 달 사이의 빈 달도 빠지지 않게 채운다(2026-10-28).
  // 금액은 0, 비율(이익률·ROAS)은 0 이 아니라 빈칸(null). 첫 데이터 달 이전은 수집 전이라 넣지 않는다.
  // 표는 서버가 계산한 전월비가 있어 행을 끼워 넣지 않는다.
  const chartSummary = useMemo(() => {
    if (summary.length < 2) return summary as (Omit<MonthlySummary, "profitRate" | "roas"> & { profitRate: number | null; roas: number | null })[];
    const byMonth = new Map(summary.map((m) => [m.month, m]));
    const out: (Omit<MonthlySummary, "profitRate" | "roas"> & { profitRate: number | null; roas: number | null })[] = [];
    let [y, mo] = summary[0].month.split("-").map(Number);
    const last = summary[summary.length - 1].month;
    for (let i = 0; i < 240; i++) {
      const key = `${y}-${String(mo).padStart(2, "0")}`;
      if (key > last) break;
      out.push(byMonth.get(key) || {
        month: key, revenue: 0, orders: 0, adSpend: 0, cogs: 0, shippingCost: 0, profit: 0,
        profitRate: null, roas: null, mer: 0, cv: 0, aov: 0, adRatio: 0, cac: 0, channelCosts: {},
      });
      mo += 1; if (mo > 12) { mo = 1; y += 1; }
    }
    return out;
  }, [summary]);
  const channelData = chartSummary.map((m) => ({ month: m.month, ...m.channelCosts }));

  // 이익 각주 (2026-11-04). 이익은 매출에서 광고비·잡비·원가·배송비를 뺀 값인데
  //  (1) 원가표에 없는 제품은 원가 0 으로 들어가 이익이 커 보이고(Overview 와 같은 매칭률 기준)
  //  (2) 배송비 원장이 비어 있으면 배송비가 전 달 0 으로 들어간다. 둘 다 숫자 옆에서 알려야 한다.
  const cogsMatchRate = data?.cogsMatchRate ?? null;
  const profitNotes: string[] = [];
  if (cogsMatchRate != null) {
    const pct = Math.round(cogsMatchRate * 100);
    profitNotes.push(cogsMatchRate < 0.95
      ? `원가 매칭 ${pct}%: 원가표에 없는 제품 판매분은 원가 0으로 계산돼 이익이 실제보다 크게 표시됩니다`
      : `원가 매칭 ${pct}%`);
  }
  if (summary.length > 0 && summary.every((m) => !m.shippingCost)) {
    profitNotes.push("배송비 원장이 비어 있어 배송비가 전 달 0으로 계산됩니다");
  }

  if (loading) {
    return <div className="h-64 bg-muted rounded-lg animate-pulse" />;
  }

  return (
    <>
      {/* YTD Summary */}
      {ytd && (
        <div className="space-y-1.5">
          <div data-tour="monthly-ytd" className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">YTD 매출</p>
                <p className="text-xl font-bold">{formatCurrency(ytd.revenue)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">YTD 광고비</p>
                <p className="text-xl font-bold">{formatCurrency(ytd.adSpend)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">YTD 원가</p>
                <p className="text-xl font-bold">{formatCurrency(ytd.cogs)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">YTD 이익{profitNotes.length > 0 && <sup>*</sup>}</p>
                <p className={cn("text-xl font-bold", ytd.profit >= 0 ? "text-emerald-600" : "text-red-500")}>
                  {formatCurrency(ytd.profit)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">YTD 이익률{profitNotes.length > 0 && <sup>*</sup>}</p>
                <p className={cn("text-xl font-bold", ytd.profitRate >= 0 ? "text-emerald-600" : "text-red-500")}>
                  {formatPercent(ytd.profitRate)}
                </p>
              </CardContent>
            </Card>
          </div>
          {/* 이익 각주: YTD 카드와 아래 표의 월별 이익·이익률에 같이 걸린다 */}
          {profitNotes.length > 0 && (
            <p className="text-xs text-muted-foreground">* 이익·이익률(월별 표 포함): {profitNotes.join(" · ")}</p>
          )}
        </div>
      )}

      {/* 매출 vs 총비용: 매출 막대 하나와 비용 3종을 쌓은 막대 하나를 나란히 */}
      <Card data-tour="monthly-chart-cost">
        <CardContent className="p-4">
          <h3 className="font-semibold text-sm mb-1">매출 vs 총비용</h3>
          <p className="text-xs text-muted-foreground mb-3">
            왼쪽 막대는 매출, 오른쪽 막대는 광고비·원가·배송비를 쌓은 값입니다. 잡비는 이익에만 반영하고 막대에는 넣지 않았습니다.
            {inProgress && ` 흐린 막대(${inProgress.month})는 진행 중인 달이라 ${inProgress.salesDays}일치만 들어 있습니다.`}
          </p>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={chartSummary} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" tickFormatter={(v) => `${(v / 10000).toFixed(0)}만`} />
              <Tooltip contentStyle={tooltipStyle} formatter={(val) => formatCurrency(Number(val))} />
              <Legend wrapperStyle={{ fontSize: 11 }} itemSorter={null} />
              <Bar dataKey="revenue" name="매출" stackId="rev" fill={C_ACCENT} radius={[3, 3, 0, 0]} isAnimationActive={false}>
                {chartSummary.map((m) => <Cell key={m.month} fillOpacity={m.month === inProgress?.month ? IN_PROGRESS_OPACITY : 1} />)}
              </Bar>
              {(["adSpend", "cogs", "shippingCost"] as const).map((k, i) => (
                <Bar key={k} dataKey={k} name={k === "adSpend" ? "광고비" : k === "cogs" ? "원가" : "배송비"} stackId="cost" fill={C_COST[k]}
                  radius={i === 2 ? [3, 3, 0, 0] : undefined} isAnimationActive={false}>
                  {chartSummary.map((m) => <Cell key={m.month} fillOpacity={m.month === inProgress?.month ? IN_PROGRESS_OPACITY : 1} />)}
                </Bar>
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* 이익률·ROAS: 단위가 달라 이중축이던 것을 단일축 미니 그래프 두 칸으로(2026-11-04) */}
      <div data-tour="monthly-chart-rate" className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {RATIO_CHARTS.map((g) => (
          <Card key={g.key}>
            <CardContent className="p-4">
              <h3 className="font-semibold text-sm mb-2">
                {g.title}{g.key === "profitRate" && profitNotes.length > 0 && <sup>*</sup>}
                {inProgress && <span className="ml-1 text-xs font-normal text-muted-foreground">(빈 점: 진행 중인 달)</span>}
              </h3>
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={chartSummary} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 9 }} stroke="var(--muted-foreground)" tickFormatter={(v: string) => v.slice(2)} />
                  <YAxis tick={{ fontSize: 9 }} stroke="var(--muted-foreground)" tickFormatter={g.axis} width={44} />
                  {g.key === "profitRate" && <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeDasharray="4 4" />}
                  <Tooltip contentStyle={tooltipStyle} formatter={(val) => [g.tip(Number(val)), g.title]} />
                  <Line
                    type="monotone" dataKey={g.key} stroke={C_LINE} strokeWidth={2} isAnimationActive={false}
                    dot={(props: { cx?: number; cy?: number; index?: number; payload?: { month: string } }) => {
                      const { cx, cy, index, payload } = props;
                      if (cx == null || cy == null) return <g key={`d-${index}`} />;
                      const live = payload?.month === inProgress?.month;
                      return <circle key={`d-${index}`} cx={cx} cy={cy} r={3} fill={live ? "var(--card)" : C_LINE} stroke={C_LINE} />;
                    }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 매체별 광고비 (월별 스택) */}
      {channelKeys.length > 0 && (
        <Card data-tour="monthly-chart-channel">
          <CardContent className="p-4">
            <h3 className="font-semibold text-sm mb-3">채널별 광고비 추이</h3>
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={channelData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" tickFormatter={(v) => `${(v / 10000).toFixed(0)}만`} />
                <Tooltip
                  contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }}
                  formatter={(val, name) => [formatCurrency(Number(val)), CH_LABEL[name as string] || name]}
                />
                <Legend formatter={(v) => CH_LABEL[v] || v} />
                {channelKeys.map((ch) => (
                  <Bar key={ch} dataKey={ch} name={ch} stackId="ch" fill={CH_COLOR[ch] || "#9ca3af"} />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      <Card data-tour="monthly-table">
        <CardContent className="p-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b text-muted-foreground">
                <th className="pb-2 pr-3">월</th>
                <th className="pb-2 pr-3 text-right">매출</th>
                <th className="pb-2 pr-3 text-right">전월비</th>
                <th className="pb-2 pr-3 text-right">주문</th>
                <th className="pb-2 pr-3 text-right">AOV</th>
                <th className="pb-2 pr-3 text-right">광고비</th>
                <th className="pb-2 pr-3 text-right">광고비중</th>
                <th className="pb-2 pr-3 text-right">CAC</th>
                <th className="pb-2 pr-3 text-right">원가</th>
                <th className="pb-2 pr-3 text-right">배송비</th>
                <th className="pb-2 pr-3 text-right">ROAS</th>
                <th className="pb-2 pr-3 text-right">MER</th>
                <th className="pb-2 pr-3 text-right">이익</th>
                <th className="pb-2 text-right">이익률</th>
              </tr>
            </thead>
            <tbody>
              {reversed.map((r) => (
                <tr key={r.month} className="border-b border-border/50 hover:bg-muted/50">
                  {/* 진행 중인 달은 며칠치만 들어 있어 전월비를 비운다(서버도 revGrowth 를 주지 않는다). */}
                  <td className="py-2 pr-3 font-medium whitespace-nowrap">
                    {r.month}
                    {inProgress?.month === r.month && (
                      <span className="ml-1 text-[11px] font-normal text-muted-foreground" title="판매 원장이 들어온 날 수(오늘 제외). 달이 끝나지 않아 전월비를 내지 않습니다">
                        ({inProgress.salesDays}일)
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right">{formatCurrency(r.revenue)}</td>
                  <td className="py-2 pr-3 text-right">
                    {r.revGrowth !== undefined && inProgress?.month !== r.month ? (
                      <span className={cn("text-xs", r.revGrowth >= 0 ? "text-emerald-500" : "text-red-500")}>
                        {r.revGrowth >= 0 ? "▲" : "▼"}{Math.abs(r.revGrowth).toFixed(0)}%
                      </span>
                    ) : <span className="text-xs text-muted-foreground">-</span>}
                  </td>
                  <td className="py-2 pr-3 text-right">{formatNumber(r.orders)}</td>
                  <td className="py-2 pr-3 text-right">{formatCurrency(r.aov)}</td>
                  <td className="py-2 pr-3 text-right">{formatCurrency(r.adSpend)}</td>
                  <td className={cn("py-2 pr-3 text-right", r.adRatio > 35 ? "text-red-500" : r.adRatio > 25 ? "text-yellow-600" : "text-foreground")}>
                    {r.adRatio.toFixed(1)}%
                  </td>
                  <td className="py-2 pr-3 text-right">{r.cac > 0 ? formatCurrency(Math.round(r.cac)) : "-"}</td>
                  <td className="py-2 pr-3 text-right">{formatCurrency(r.cogs)}</td>
                  <td className="py-2 pr-3 text-right">{formatCurrency(r.shippingCost)}</td>
                  <td className={cn("py-2 pr-3 text-right", r.roas >= 3 ? "text-emerald-600" : r.roas >= 1 ? "text-yellow-600" : "text-red-500")}>
                    {r.roas.toFixed(2)}x
                  </td>
                  <td className="py-2 pr-3 text-right text-muted-foreground">{(r.mer || 0).toFixed(2)}x</td>
                  <td className={cn("py-2 pr-3 text-right font-medium", r.profit >= 0 ? "text-emerald-600" : "text-red-500")}>
                    {formatCurrency(r.profit)}
                  </td>
                  <td className={cn("py-2 text-right", r.profitRate >= 0 ? "text-emerald-600" : "text-red-500")}>
                    {formatPercent(r.profitRate)}
                  </td>
                </tr>
              ))}
              {reversed.length === 0 && (
                <tr>
                  <td colSpan={14} className="py-8 text-center text-muted-foreground">데이터 없음</td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </>
  );
}
