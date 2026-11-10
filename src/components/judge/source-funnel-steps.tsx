"use client";

// 원천별 퍼널 단계표 (2026-11-03, 옛 「전환 퍼널」 깔때기 대체).
//
// 옛 깔때기는 수집 범위가 다른 단계(광고 노출·전 채널 유입·일부 채널 장바구니·카페24 회원가입·전 판매처 구매)를
// 한 줄로 이어 "이탈 0.0% (-769명)·전환 100%" 같은 성립하지 않는 숫자를 띄웠다. 회원가입은 구매 앞 단계도 아니다.
// 여기서는 관리도와 같은 원천 짝(/api/funnel-control)마다 그 원천에서 실제로 수집되는 단계만 보여 준다.
//  - 원천 사이에 화살표를 긋거나 합산하지 않는다(모집단이 다르다).
//  - 기간 합계는 관리도가 판정에 쓰는 날과 같은 날만 더한다(유입 행이 있고, 판매가 들어왔고, 오늘이 아니고,
//    수집 오류 의심일이 아닌 날). 그래서 유입→구매 전환율이 관리도 평균선(p̄)과 정확히 같다.
import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useFetch } from "@/hooks/use-dashboard-data";
import { daysBetween } from "@/lib/bucket";
import { kstDate } from "@/lib/date";
import { formatNumber } from "@/lib/utils";
import { buildControlChart } from "@/lib/judge-charts";
import { FunnelBars } from "@/components/charts/funnel-bars";

interface SourceDay { date: string; sessions: number | null; orders: number; cartAdds?: number }
/** salesLastDate = 이 원천의 판매 원장 마지막 날(원천의 판매 브랜드 범위). 없으면(옛 응답) 응답 최상위 값 */
interface Source { key: string; label: string; note: string | null; totalSessions: number; days: SourceDay[]; salesLastDate?: string | null }
interface ControlResponse { sources: Source[]; salesLastDate: string | null; error?: string }

/** 브랜드 단독 전환율을 낼 수 없을 때의 문구. 관리도 카드와 같은 문장을 쓴다. */
export const SINGLE_BRAND_FUNNEL_NOTE =
  "이 브랜드는 유입이 펫 3개 브랜드 합산으로만 기록돼 단독 전환율을 계산할 수 없습니다. 브랜드 필터를 '펫'으로 바꾸면 통합 스토어 기준으로 볼 수 있습니다.";

const SINGLE_STORE_BRANDS = ["nutty", "ironpet", "saip"];

export interface SourceFunnel {
  key: string;
  label: string;
  note: string | null;
  /** 합계에 넣은 날 수(관리도 판정 가능일). */
  days: number;
  firstDate: string | null;
  lastDate: string | null;
  sessions: number;
  /** 같은 행에서 장바구니가 수집되지 않으면 null(단계 자체를 그리지 않는다). */
  cartAdds: number | null;
  /** 장바구니가 구매보다 적으면 false. 두 단계의 수집 범위가 어긋난 것이라 단계로 잇지 않는다(/api/funnel 의 valid 와 같은 규칙). */
  cartValid: boolean;
  orders: number;
  /** 유입→구매 전환율(%) = 관리도 p̄. 판정 가능한 날이 없으면 null. */
  rate: number | null;
}

/** 관리도와 같은 응답·같은 제외 규칙으로 원천별 기간 합계를 만든다. */
export function useSourceFunnels(brand: string, from: string, to: string) {
  const { data, loading, error } = useFetch<ControlResponse>(`/api/funnel-control?brand=${brand || "all"}&from=${from}&to=${to}`);
  const today = kstDate();
  const funnels = useMemo<SourceFunnel[]>(() => {
    const axis = daysBetween(from, to);
    return (data?.sources || [])
      .filter((s) => s.totalSessions > 0)
      .map((s) => {
        const chart = buildControlChart(axis, s.days, { salesLastDate: s.salesLastDate !== undefined ? s.salesLastDate : data?.salesLastDate ?? null, today });
        const used = chart.points.filter((p) => p.rate != null);
        const usedDates = new Set(used.map((p) => p.date));
        const cartAdds = s.days.filter((d) => usedDates.has(d.date)).reduce((acc, d) => acc + (d.cartAdds || 0), 0);
        const orders = used.reduce((acc, p) => acc + (p.orders || 0), 0);
        return {
          key: s.key, label: s.label, note: s.note,
          days: used.length,
          firstDate: used[0]?.date ?? null,
          lastDate: used[used.length - 1]?.date ?? null,
          sessions: used.reduce((acc, p) => acc + (p.sessions || 0), 0),
          cartAdds: cartAdds > 0 ? cartAdds : null,
          // ★ 장바구니 < 구매 이면 장바구니가 일부만 수집된 것(QA2 L4). 퍼널 단계로 이으면 "구매가 장바구니보다 많은" 깔때기가 된다.
          cartValid: cartAdds >= orders,
          orders,
          rate: chart.center,
        };
      });
  }, [data, from, to, today]);
  return { funnels, salesLastDate: data?.salesLastDate ?? null, loading: loading && !data, error: error || data?.error || null };
}

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const pct = (num: number, den: number) => (den > 0 ? `${((num / den) * 100).toFixed(2)}%` : "-");

function Step({ name, value, sub }: { name: string; value: number; sub?: string }) {
  return (
    <div className="rounded-md border border-border px-3 py-2 min-w-[96px]">
      <div className="text-[11px] text-muted-foreground">{name}</div>
      <div className="text-base font-semibold tabular-nums">{formatNumber(value)}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function SourceFunnelSteps({ brand, from, to }: { brand: string; from: string; to: string }) {
  const { funnels, salesLastDate, loading, error } = useSourceFunnels(brand, from, to);

  const header = (
    <div className="mb-3">
      <h3 className="font-semibold">원천별 단계</h3>
      <p className="text-xs text-muted-foreground mt-0.5">
        같은 원천(판매처) 안에서 실제로 수집되는 단계만 잇습니다. 원천끼리는 유입을 재는 방법이 달라 합치거나 잇지 않습니다.
      </p>
    </div>
  );

  if (loading) return <Card><CardContent className="p-4">{header}<div className="h-28 rounded bg-muted animate-pulse" /></CardContent></Card>;
  if (error) return <Card><CardContent className="p-4">{header}<p className="text-sm text-muted-foreground">불러오지 못했습니다 ({error})</p></CardContent></Card>;
  if (!funnels.length) {
    return (
      <Card><CardContent className="p-4">{header}
        <p className="text-sm text-muted-foreground">
          {SINGLE_STORE_BRANDS.includes(brand) ? SINGLE_BRAND_FUNNEL_NOTE : "이 기간에 유입이 수집된 원천이 없습니다."}
        </p>
      </CardContent></Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4">
        {header}
        {/* 원천마다 한 칸. 넓은 화면은 2열로 놓아 아래 관리도가 첫 화면에 들어오게 한다(2026-11-04). */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-3">
          {funnels.map((f) => (
            <div key={f.key} className="min-w-0 border-t border-border pt-3 lg:[&:nth-child(-n+2)]:border-t-0 lg:[&:nth-child(-n+2)]:pt-0 first:border-t-0 first:pt-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                <span className="text-sm font-medium">{f.label}</span>
                <span className="text-[11px] text-muted-foreground">
                  {f.days > 0 && f.firstDate && f.lastDate
                    ? `${md(f.firstDate)}~${md(f.lastDate)} 중 ${f.days}일 합계`
                    : "유입과 판매가 둘 다 들어온 날이 없어 합계를 내지 않습니다"}
                </span>
              </div>
              {/* 퍼널 그림(2026-11-10): 같은 원천에서 단계가 셋 이상 이어질 때만(유입 → 장바구니 → 구매). 건수는 바로 아래 칸에 있어
                  여기는 폭(첫 단계 = 100%)과 단계 사이 이탈률만 그린다. 두 단계(유입 → 구매)뿐이면 이탈률이 아래 「유입 대비 %」를 뒤집은 값이라 그리지 않는다. */}
              {f.days > 0 && f.cartAdds != null && f.cartValid && (
                <div data-tour="funnel-source-bars" className="mb-2">
                  <FunnelBars color="var(--neutral-1)" stages={[
                    { key: "sessions", label: "유입", value: f.sessions },
                    { key: "cart", label: "장바구니", value: f.cartAdds },
                    { key: "orders", label: "구매", value: f.orders },
                  ]} />
                </div>
              )}
              {f.days > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <Step name="유입" value={f.sessions} />
                  {f.cartAdds != null && f.cartValid && (
                    <>
                      <span className="text-muted-foreground" aria-hidden>→</span>
                      <Step name="장바구니" value={f.cartAdds} sub={`유입 대비 ${pct(f.cartAdds, f.sessions)}`} />
                    </>
                  )}
                  <span className="text-muted-foreground" aria-hidden>→</span>
                  <Step name="구매" value={f.orders} sub={`유입 대비 ${f.rate != null ? `${f.rate.toFixed(2)}%` : "-"}`} />
                </div>
              )}
              {f.days > 0 && f.cartAdds != null && !f.cartValid && (
                <p className="text-[11px] text-amber-700 dark:text-amber-500 mt-1.5">
                  장바구니 {formatNumber(f.cartAdds)}건이 구매 {formatNumber(f.orders)}건보다 적어 이 원천은 장바구니가 일부만 수집된 것으로 보고 단계로 잇지 않습니다.
                </p>
              )}
              {f.note && <p className="text-[11px] text-muted-foreground mt-1.5">{f.note}</p>}
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          장바구니 칸이 없는 원천은 장바구니가 그 원천의 유입과 같은 행에서 수집되지 않아 뺐습니다. 합계는 유입·판매가 둘 다 들어온 날만 더합니다.
          구매 = 판매 원장 주문 수(같은 판매처). 판매 동기화가 {salesLastDate ? `${md(salesLastDate)}까지` : "아직"} 들어와 그 뒤 날짜와 오늘, 유입이 수집되지 않은 날, 수집 오류 의심일(관리도 기준)은 빼고 더합니다.
          유입 대비 구매 비율은 아래 관리도의 평균선과 같은 값입니다.
        </p>
      </CardContent>
    </Card>
  );
}
