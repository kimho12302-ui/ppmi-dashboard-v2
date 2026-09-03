"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useFetch } from "@/hooks/use-dashboard-data";
import { formatCurrency, cn } from "@/lib/utils";
import { bucketize, GRAN_LABELS, type Gran } from "@/lib/bucket";
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";

// 판매처 하나를 골라 매출·광고비·ROAS 를 함께 보는 차트.
// 개요와 브랜드 페이지가 같은 구현을 쓴다 (한쪽만 고쳐져 갈라지는 것을 막는다).

interface Group { key: string; label: string; revenue: number; adSpend: number }
interface Resp {
  groups: Group[];
  /** 날짜 × 판매처 { revenue, adSpend } */
  series?: ({ date: string } & Record<string, { revenue: number; adSpend: number } | string>)[];
}

export function StoreDetailChart({ brand, from, to }: { brand: string; from: string; to: string }) {
  const { data } = useFetch<Resp>(`/api/channel-groups?brand=${brand}&from=${from}&to=${to}`);
  const [store, setStore] = useState<string | null>(null);
  const [gran, setGran] = useState<Gran>("day");

  const options = useMemo(
    () => (data?.groups || []).filter((g) => g.revenue > 0 || g.adSpend > 0),
    [data]
  );
  const active = store && options.some((g) => g.key === store) ? store : options[0]?.key || null;

  const series = useMemo(() => {
    const rows = (data?.series || []) as unknown as { date: string; [k: string]: { revenue: number; adSpend: number } | string }[];
    if (!rows.length || !active) return [];
    return bucketize(
      rows.map((r) => ({ date: String(r.date), cell: r[active] as { revenue: number; adSpend: number } | undefined })),
      gran,
      (r) => ({ 매출: r.cell?.revenue || 0, 광고비: r.cell?.adSpend || 0 })
    ).map((b) => ({
      label: b.label,
      매출: b.values["매출"] || 0,
      광고비: b.values["광고비"] || 0,
      ROAS: (b.values["광고비"] || 0) > 0 ? +((b.values["매출"] || 0) / (b.values["광고비"] || 1)).toFixed(2) : 0,
    }));
  }, [data, active, gran]);

  if (!options.length) return null;
  const activeLabel = options.find((g) => g.key === active)?.label || "";

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h3 className="font-semibold text-sm">
            판매처 상세 · {activeLabel}
            <span className="text-xs text-muted-foreground font-normal ml-2">매출 막대 · 광고비 선 · ROAS 선(우측축)</span>
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-0.5 rounded-lg bg-muted p-1 flex-wrap">
              {options.map((g) => (
                <button key={g.key} onClick={() => setStore(g.key)}
                  className={cn("px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap",
                    active === g.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                  {g.label.split(" (")[0]}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-0.5 rounded-lg bg-muted p-1">
              {GRAN_LABELS.map((g) => (
                <button key={g.key} onClick={() => setGran(g.key)}
                  className={cn("px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
                    gran === g.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                  {g.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {series.length > 0 ? (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={series}>
                <XAxis dataKey="label" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis yAxisId="won" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `${Math.round(v / 10000)}만`} />
                <YAxis yAxisId="roas" orientation="right" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}x`} />
                <Tooltip formatter={(v, name) => [name === "ROAS" ? `${v}x` : formatCurrency(Number(v)), String(name)]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="won" dataKey="매출" fill="#2563eb" radius={[3, 3, 0, 0]} />
                <Line yAxisId="won" dataKey="광고비" stroke="#ef4444" strokeWidth={2} dot={false} />
                <Line yAxisId="roas" dataKey="ROAS" stroke="#10b981" strokeWidth={2} dot={false} strokeDasharray="4 3" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : <p className="text-sm text-muted-foreground py-10 text-center">이 판매처의 기간 내 데이터가 없습니다</p>}
      </CardContent>
    </Card>
  );
}
