"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useFetch } from "@/hooks/use-dashboard-data";
import { channelGroupsUrl } from "@/lib/api-urls";
import { formatCurrency, cn } from "@/lib/utils";
import { bucketize, isAfterLastData, lastDataDate, GRAN_LABELS, type Gran } from "@/lib/bucket";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from "recharts";
import { DeferredResponsiveContainer } from "@/components/deferred-chart";
import {
  xAxisProps, yAxisProps, gridProps, legendProps, tooltipProps, barProps, activeDotProps, BAR_RADIUS,
  useSeriesToggle, legendToggleProps,
} from "@/components/charts/chart-style";

/** 매출 막대 · 광고비 선 · ROAS 선. 매출과 비용·비율이라 툴팁 합계는 넣지 않고 범례로 골라 보기만 한다 */
const DETAIL_KEYS = ["매출", "광고비", "ROAS"];

// 판매처 하나를 골라 매출·광고비·ROAS 를 함께 보는 차트.
// 개요와 브랜드 페이지가 같은 구현을 쓴다 (한쪽만 고쳐져 갈라지는 것을 막는다).

interface Group { key: string; label: string; revenue: number; adSpend: number }
export interface StoreDetailResp {
  groups: Group[];
  /** 날짜 × 판매처 { revenue, adSpend } */
  series?: ({ date: string } & Record<string, { revenue: number; adSpend: number } | string>)[];
}

/** channel-groups 를 직접 불러 그린다(개요 화면). */
export function StoreDetailChart({ brand, from, to }: { brand: string; from: string; to: string }) {
  const { data } = useFetch<StoreDetailResp>(channelGroupsUrl(brand, from, to));
  return <StoreDetailChartView data={data} from={from} to={to} />;
}

/**
 * 이미 받은 channel-groups 응답으로 그린다.
 * 브랜드 화면은 같은 주소를 자기도 쓰므로 받은 것을 내려준다(2026-11-09: 같은 API 를 두 번 부르던 것 제거).
 */
export function StoreDetailChartView({ data, from, to }: { data: StoreDetailResp | null | undefined; from: string; to: string }) {
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
    // 축은 선택 기간 전체(오늘까지). 값 없는 날은 매출·광고비 0 으로 자리를 지킨다(2026-10-28).
    // 마지막 데이터 날짜 이후는 0 이 아니라 아직 안 들어온 구간이라 null.
    // ROAS 는 비율이라 광고비가 0 인 구간은 0x 가 아니라 빈칸(null, 선이 끊김).
    const last = lastDataDate(rows.map((r) => ({ date: String(r.date) })));
    return bucketize(
      rows.map((r) => ({ date: String(r.date), cell: r[active] as { revenue: number; adSpend: number } | undefined })),
      gran,
      (r) => ({ 매출: r.cell?.revenue || 0, 광고비: r.cell?.adSpend || 0 }),
      { from, to, fields: ["매출", "광고비"] }
    ).map((b) => {
      const pending = isAfterLastData(b.key, gran, last);
      const rev = b.values["매출"] || 0;
      const ad = b.values["광고비"] || 0;
      return {
        label: b.label,
        매출: pending ? null : rev,
        광고비: pending ? null : ad,
        ROAS: !pending && ad > 0 ? +(rev / ad).toFixed(2) : null,
      };
    });
  }, [data, active, gran, from, to]);

  const detailToggle = useSeriesToggle(DETAIL_KEYS);

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
            <DeferredResponsiveContainer width="100%" height="100%">
              <ComposedChart data={series}>
                <CartesianGrid {...gridProps} yAxisId="won" />
                <XAxis {...xAxisProps} dataKey="label" />
                <YAxis {...yAxisProps} yAxisId="won" tickFormatter={(v) => `${Math.round(v / 10000)}만`} />
                <YAxis {...yAxisProps} yAxisId="roas" orientation="right" tickFormatter={(v) => `${v}x`} />
                <Tooltip {...tooltipProps({ kind: "bar" })} formatter={(v, name) => [v == null ? "-" : name === "ROAS" ? `${v}x` : formatCurrency(Number(v)), String(name)]} />
                <Legend {...legendProps} {...legendToggleProps(detailToggle)} />
                <Bar {...barProps} isAnimationActive={false} yAxisId="won" dataKey="매출" fill="#2563eb" radius={BAR_RADIUS} hide={detailToggle.isHidden("매출")} />
                <Line isAnimationActive={false} yAxisId="won" dataKey="광고비" stroke="#ef4444" strokeWidth={2} dot={false} hide={detailToggle.isHidden("광고비")} {...activeDotProps} />
                <Line isAnimationActive={false} yAxisId="roas" dataKey="ROAS" stroke="#10b981" strokeWidth={2} dot={false} strokeDasharray="4 3" hide={detailToggle.isHidden("ROAS")} {...activeDotProps} />
              </ComposedChart>
            </DeferredResponsiveContainer>
          </div>
        ) : <p className="text-sm text-muted-foreground py-10 text-center">이 판매처의 기간 내 데이터가 없습니다</p>}
      </CardContent>
    </Card>
  );
}
