"use client";

import { useMemo, useRef, useState } from "react";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent } from "@/components/ui/card";
import { useFetch } from "@/hooks/use-dashboard-data";
import { formatCurrency, formatNumber, cn } from "@/lib/utils";

// 키워드 탭 > 쿠팡 광고 키워드. 원천 raw_coupang_keyword(쿠팡 예약 일간 보고서, 매일 07:36 수집).
// 쿠팡은 1일·14일 두 기준으로 전환을 준다. 1일은 광고 직후 산 것, 14일은 2주 안에 산 것까지다.
//
// 한 번만 받는다. 서버가 (상품 × 키워드) 단위로 합쳐 주고, 상품 고르기·검색·정렬은 여기서 한다.
// 상품을 누르면 다시 부르지 않고 아래 키워드 표가 그 상품으로 바뀐다(2026-09-18 김호 요청).

interface Sum {
  impressions: number; clicks: number; spend: number;
  orders_1d: number; conv_sales_1d: number; orders_14d: number; conv_sales_14d: number;
}
interface Entry extends Sum { product: string; keyword: string }
interface PlacementEntry extends Sum { product: string; placement: string }
interface Resp { entries: Entry[]; placements: PlacementEntry[]; rows: number; latestCollected: string | null; error?: string }

const METRICS: (keyof Sum)[] = ["impressions", "clicks", "spend", "orders_1d", "conv_sales_1d", "orders_14d", "conv_sales_14d"];
const zero = (): Sum => ({ impressions: 0, clicks: 0, spend: 0, orders_1d: 0, conv_sales_1d: 0, orders_14d: 0, conv_sales_14d: 0 });
const addTo = (a: Sum, b: Sum) => { for (const k of METRICS) a[k] += b[k]; return a; };

const roas = (sales: number, spend: number) => (spend > 0 ? (sales / spend) * 100 : 0);
const pct = (n: number) => `${n.toFixed(0)}%`;

// 표 칸 정의. 값 함수가 있으면 정렬에 쓴다. 문자 칸은 가나다순.
type Row = Sum & { name: string; sub?: string };
interface Col { key: string; label: string; value: (r: Row) => number | string; render: (r: Row) => string; left?: boolean }
const nameCol = (label: string): Col => ({ key: "name", label, value: (r) => r.name, render: (r) => r.name, left: true });
const METRIC_COLS: Col[] = [
  { key: "impressions", label: "노출", value: (r) => r.impressions, render: (r) => formatNumber(r.impressions) },
  { key: "clicks", label: "클릭", value: (r) => r.clicks, render: (r) => formatNumber(r.clicks) },
  { key: "ctr", label: "CTR", value: (r) => (r.impressions ? r.clicks / r.impressions : 0), render: (r) => `${r.impressions ? ((r.clicks / r.impressions) * 100).toFixed(2) : "0.00"}%` },
  { key: "spend", label: "광고비", value: (r) => r.spend, render: (r) => formatCurrency(r.spend) },
  { key: "cpc", label: "CPC", value: (r) => (r.clicks ? r.spend / r.clicks : 0), render: (r) => (r.clicks ? formatCurrency(Math.round(r.spend / r.clicks)) : "-") },
  { key: "orders_1d", label: "주문 1일", value: (r) => r.orders_1d, render: (r) => formatNumber(r.orders_1d) },
  { key: "orders_14d", label: "주문 14일", value: (r) => r.orders_14d, render: (r) => formatNumber(r.orders_14d) },
  { key: "conv_sales_14d", label: "전환매출 14일", value: (r) => r.conv_sales_14d, render: (r) => formatCurrency(r.conv_sales_14d) },
  { key: "roas14", label: "ROAS 14일", value: (r) => roas(r.conv_sales_14d, r.spend), render: (r) => pct(roas(r.conv_sales_14d, r.spend)) },
];

// "돈만 쓰는 키워드" 기준. 14일 전환이 0 인데 이만큼 넘게 썼으면 올린다. 작은 금액까지 올리면 목록이 소음이 된다.
const WASTE_MIN_SPEND = 3000;

export function CoupangKeywordSection({ brand, from, to }: { brand: string; from: string; to: string }) {
  const { data, loading } = useFetch<Resp>(`/api/coupang-keywords?from=${from}&to=${to}`);
  const [picked, setPicked] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const kwRef = useRef<HTMLDivElement>(null);

  const entries = useMemo(() => data?.entries || [], [data]);
  const scoped = useMemo(() => (picked ? entries.filter((e) => e.product === picked) : entries), [entries, picked]);

  const products: Row[] = useMemo(() => {
    const m = new Map<string, Row>();
    for (const e of entries) {
      const r = m.get(e.product) || { ...zero(), name: e.product, sub: "0" };
      addTo(r, e);
      if (!e.keyword.startsWith("(")) r.sub = String(Number(r.sub) + 1);
      m.set(e.product, r);
    }
    return [...m.values()];
  }, [entries]);

  const placements: Row[] = useMemo(() => {
    const m = new Map<string, Row>();
    for (const p of data?.placements || []) {
      if (picked && p.product !== picked) continue;
      const r = m.get(p.placement) || { ...zero(), name: p.placement };
      m.set(p.placement, addTo(r, p) as Row);
    }
    return [...m.values()];
  }, [data, picked]);

  // 상품을 안 골랐으면 같은 키워드를 상품 넘어 합친다. sub 에 걸린 상품을 적는다.
  const keywords: Row[] = useMemo(() => {
    const m = new Map<string, Row & { products: Set<string> }>();
    for (const e of scoped) {
      const r = m.get(e.keyword) || { ...zero(), name: e.keyword, products: new Set<string>() };
      addTo(r, e);
      r.products.add(e.product);
      m.set(e.keyword, r);
    }
    return [...m.values()].map(({ products: ps, ...r }) => ({ ...r, sub: [...ps].join(", ") }));
  }, [scoped]);

  const total = useMemo(() => scoped.reduce((a, e) => addTo(a, e), zero()), [scoped]);
  const waste = useMemo(
    () => keywords.filter((k) => k.spend >= WASTE_MIN_SPEND && k.orders_14d === 0 && !k.name.startsWith("("))
      .sort((a, b) => b.spend - a.spend),
    [keywords],
  );
  const searched = useMemo(() => (query ? keywords.filter((k) => k.name.includes(query)) : keywords), [keywords, query]);

  const pick = (name: string | null) => {
    setPicked((cur) => (cur === name ? null : name));
    requestAnimationFrame(() => kwRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  if (loading) return <Card><CardContent className="p-8 text-center text-muted-foreground">쿠팡 키워드 불러오는 중...</CardContent></Card>;
  if (data?.error) return <Card><CardContent className="p-4 text-sm" style={{ color: "var(--sig-danger)" }}>쿠팡 키워드 오류: {data.error}</CardContent></Card>;

  const notNutty = brand !== "all" && brand !== "nutty";

  return (
    <div className="space-y-4">
      {notNutty && (
        <div className="rounded-lg border-l-4 border-amber-500 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-500">
          쿠팡 광고는 너티만 집행합니다. 아래는 브랜드 필터와 관계없이 너티 쿠팡 광고입니다.
        </div>
      )}
      {!data?.latestCollected ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          아직 수집된 쿠팡 키워드가 없습니다. 쿠팡 예약 일간 보고서를 매일 07:36 에 받아 쌓습니다.
        </CardContent></Card>
      ) : data.latestCollected < from ? (
        <div className="rounded-lg border-l-4 border-amber-500 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-500">
          쿠팡 키워드는 <b>{data.latestCollected}</b> 까지 쌓여 있어 선택하신 기간에는 데이터가 없습니다.
        </div>
      ) : null}

      {data?.rows ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <KpiCard title={picked ? `광고비 · ${picked}` : "광고비"} value={formatCurrency(total.spend)} />
            <KpiCard title="클릭" value={formatNumber(total.clicks)} />
            <KpiCard title="전환매출 (14일)" value={formatCurrency(total.conv_sales_14d)} />
            <KpiCard title="ROAS 1일" value={pct(roas(total.conv_sales_1d, total.spend))} />
            <KpiCard title="ROAS 14일" value={pct(roas(total.conv_sales_14d, total.spend))} />
          </div>

          <Card><CardContent className="p-4">
            <h3 className="font-semibold text-sm mb-3">노출 지면별{picked && <span className="font-normal text-muted-foreground"> · {picked}</span>}</h3>
            <SortTable rows={placements} cols={[nameCol("지면"), ...METRIC_COLS]} initial="spend" />
          </CardContent></Card>

          <Card><CardContent className="p-4">
            <h3 className="font-semibold text-sm">상품별 <span className="text-xs font-normal text-muted-foreground">캠페인 기준 · 누르면 아래 키워드 표가 그 상품으로 바뀝니다</span></h3>
            <p className="text-xs text-muted-foreground mb-2">쿠팡 캠페인을 상품 하나씩 짜 두어 캠페인 이름으로 묶었습니다(앞의 &quot;로켓배송_&quot;·날짜는 뗌).</p>
            <SortTable
              rows={products}
              cols={[nameCol("상품"), ...METRIC_COLS, { key: "kw", label: "검색 키워드", value: (r) => Number(r.sub), render: (r) => `${formatNumber(Number(r.sub))}개` }]}
              initial="spend" onRowClick={(r) => pick(r.name)} activeName={picked}
            />
          </CardContent></Card>

          {waste.length > 0 && (
            <Card><CardContent className="p-4">
              <h3 className="font-semibold text-sm">돈만 쓰는 키워드 <span className="text-xs font-normal text-muted-foreground">광고비 {formatCurrency(WASTE_MIN_SPEND)} 이상 · 14일 주문 0 · {waste.length}개{picked ? ` · ${picked}` : ""}</span></h3>
              <p className="text-xs text-muted-foreground mb-2">제외 키워드 후보입니다. 기간이 짧으면 우연일 수 있으니 기간을 넓혀 다시 보세요.</p>
              <SortTable rows={waste} cols={[nameCol("키워드"), ...METRIC_COLS]} initial="spend" maxHeight={320} />
            </CardContent></Card>
          )}

          <div ref={kwRef} className="scroll-mt-4">
            <Card><CardContent className="p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold text-sm">
                  키워드별 성과 <span className="text-xs font-normal text-muted-foreground">{formatNumber(searched.length)}개 전체</span>
                </h3>
                <div className="flex items-center gap-2 flex-wrap">
                  {picked ? (
                    <button onClick={() => setPicked(null)} className="text-xs rounded-full bg-primary text-primary-foreground px-2.5 py-1">
                      {picked} ✕ 전체 보기
                    </button>
                  ) : <span className="text-xs text-muted-foreground">전체 상품</span>}
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="키워드 검색"
                    className="h-7 rounded-md border bg-background px-2 text-xs w-40" />
                </div>
              </div>
              <SortTable
                rows={searched}
                cols={[nameCol("키워드"), ...(picked ? [] : [{ key: "sub", label: "상품", value: (r: Row) => r.sub || "", render: (r: Row) => r.sub || "", left: true }]), ...METRIC_COLS]}
                initial="spend" maxHeight={640}
              />
            </CardContent></Card>
          </div>
        </>
      ) : null}
    </div>
  );
}

// 머리글을 누르면 내림차순, 한 번 더 누르면 오름차순. 행은 자르지 않고 전부 그린다(스크롤 상자 안).
function SortTable({ rows, cols, initial, onRowClick, activeName, maxHeight }: {
  rows: Row[]; cols: Col[]; initial: string;
  onRowClick?: (r: Row) => void; activeName?: string | null; maxHeight?: number;
}) {
  const [sort, setSort] = useState<{ key: string; desc: boolean }>({ key: initial, desc: true });
  const sorted = useMemo(() => {
    const col = cols.find((c) => c.key === sort.key) || cols[0];
    const dir = sort.desc ? -1 : 1;
    return [...rows].sort((a, b) => {
      const x = col.value(a), y = col.value(b);
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "ko");
      return c * dir;
    });
  }, [rows, cols, sort]);
  const clickHead = (key: string) => setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: true }));

  return (
    <div className="overflow-auto rounded border" style={maxHeight ? { maxHeight } : undefined}>
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-card z-10">
          <tr className="text-muted-foreground border-b">
            {cols.map((c) => (
              <th key={c.key} onClick={() => clickHead(c.key)}
                className={cn("py-1.5 px-2 cursor-pointer select-none whitespace-nowrap hover:text-foreground", c.left ? "text-left" : "text-right")}
                aria-sort={sort.key === c.key ? (sort.desc ? "descending" : "ascending") : "none"}>
                {c.label}{sort.key === c.key ? (sort.desc ? " ▼" : " ▲") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.name} onClick={onRowClick ? () => onRowClick(r) : undefined}
              className={cn("border-b last:border-0", onRowClick && "cursor-pointer hover:bg-muted/60", activeName === r.name && "bg-muted font-medium")}>
              {cols.map((c) => (
                <td key={c.key} className={cn("py-1.5 px-2", c.left ? "text-left" : "text-right whitespace-nowrap")}
                  style={c.key === "roas14" && r.spend > 0 && r.orders_14d === 0 ? { color: "var(--sig-danger)" } : undefined}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
