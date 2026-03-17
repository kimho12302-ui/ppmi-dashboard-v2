"use client";

import { useMemo, useState } from "react";
import { useFetch, useDateRange } from "@/hooks/use-dashboard-data";
import { Filters } from "@/components/filters";
import { Loading } from "@/components/ui/loading";
import { Card } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { BRAND_COLORS, BRAND_LABELS } from "@/lib/types";
import { formatCurrency, formatNumber } from "@/lib/utils";
import type { KeywordPerformance } from "@/lib/types";

type SortKey = "clicks" | "impressions" | "cost" | "conversions" | "ctr" | "cpc";

export default function KeywordsPage() {
  const { from, to, days, setDays } = useDateRange(30);
  const [brand, setBrand] = useState("all");
  const [sortBy, setSortBy] = useState<SortKey>("clicks");
  const [sortAsc, setSortAsc] = useState(false);
  const { data, loading } = useFetch<{ keywords: KeywordPerformance[] }>(
    `/api/keywords?from=${from}&to=${to}&brand=${brand}`
  );

  const kpis = useMemo(() => {
    if (!data) return null;
    const totalCost = data.keywords.reduce((s, r) => s + (r.cost || 0), 0);
    const totalClicks = data.keywords.reduce((s, r) => s + (r.clicks || 0), 0);
    const totalConversions = data.keywords.reduce((s, r) => s + (r.conversions || 0), 0);
    const totalImpressions = data.keywords.reduce((s, r) => s + (r.impressions || 0), 0);
    return {
      totalCost,
      totalClicks,
      totalConversions,
      avgCtr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
    };
  }, [data]);

  const keywordTable = useMemo(() => {
    if (!data) return [];
    // Aggregate by keyword + brand
    const byKeyword = new Map<string, {
      keyword: string; brand: string; platform: string;
      impressions: number; clicks: number; cost: number; conversions: number;
    }>();
    data.keywords.forEach((r) => {
      const key = `${r.keyword}__${r.brand}`;
      const existing = byKeyword.get(key);
      if (existing) {
        existing.impressions += r.impressions || 0;
        existing.clicks += r.clicks || 0;
        existing.cost += r.cost || 0;
        existing.conversions += r.conversions || 0;
      } else {
        byKeyword.set(key, {
          keyword: r.keyword,
          brand: r.brand,
          platform: r.platform,
          impressions: r.impressions || 0,
          clicks: r.clicks || 0,
          cost: r.cost || 0,
          conversions: r.conversions || 0,
        });
      }
    });
    const rows = Array.from(byKeyword.values()).map((r) => ({
      ...r,
      ctr: r.impressions > 0 ? (r.clicks / r.impressions) * 100 : 0,
      cpc: r.clicks > 0 ? r.cost / r.clicks : 0,
    }));
    rows.sort((a, b) => sortAsc ? a[sortBy] - b[sortBy] : b[sortBy] - a[sortBy]);
    return rows.slice(0, 100);
  }, [data, sortBy, sortAsc]);

  const handleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortBy(key);
      setSortAsc(false);
    }
  };

  if (loading) return <Loading />;

  const SortHeader = ({ label, sortKey }: { label: string; sortKey: SortKey }) => (
    <th
      className="px-4 py-3 font-medium text-muted-foreground text-right cursor-pointer hover:text-foreground transition-colors select-none"
      onClick={() => handleSort(sortKey)}
    >
      {label} {sortBy === sortKey ? (sortAsc ? "↑" : "↓") : ""}
    </th>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">키워드 분석</h1>
        <p className="text-sm text-muted-foreground">검색 키워드 성과 분석</p>
      </div>

      <Filters brand={brand} onBrandChange={setBrand} days={days} onDaysChange={setDays} />

      {kpis && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="총 광고비" value={formatCurrency(kpis.totalCost)} />
          <KpiCard title="총 클릭수" value={formatNumber(kpis.totalClicks)} />
          <KpiCard title="총 전환수" value={formatNumber(kpis.totalConversions)} />
          <KpiCard title="평균 CTR" value={kpis.avgCtr.toFixed(2) + "%"} />
        </div>
      )}

      <Card>
        <div className="px-6 py-4 border-b">
          <h3 className="text-sm font-semibold text-muted-foreground">키워드 성과 테이블</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="px-4 py-3 font-medium text-muted-foreground">키워드</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">브랜드</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">플랫폼</th>
                <SortHeader label="노출" sortKey="impressions" />
                <SortHeader label="클릭" sortKey="clicks" />
                <SortHeader label="CTR" sortKey="ctr" />
                <SortHeader label="CPC" sortKey="cpc" />
                <SortHeader label="비용" sortKey="cost" />
                <SortHeader label="전환" sortKey="conversions" />
              </tr>
            </thead>
            <tbody>
              {keywordTable.map((row, i) => (
                <tr key={i} className="border-b last:border-b-0 hover:bg-muted/50 transition-colors">
                  <td className="px-4 py-3 font-medium">{row.keyword}</td>
                  <td className="px-4 py-3">
                    <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ backgroundColor: BRAND_COLORS[row.brand] || "#888" }} />
                    {BRAND_LABELS[row.brand] || row.brand}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{row.platform}</td>
                  <td className="px-4 py-3 text-right">{formatNumber(row.impressions)}</td>
                  <td className="px-4 py-3 text-right">{formatNumber(row.clicks)}</td>
                  <td className="px-4 py-3 text-right">{row.ctr.toFixed(2)}%</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(row.cpc)}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(row.cost)}</td>
                  <td className="px-4 py-3 text-right">{formatNumber(row.conversions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
