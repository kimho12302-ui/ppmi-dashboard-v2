"use client";

import { useMemo, useRef, useState } from "react";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent } from "@/components/ui/card";
import { useFetch } from "@/hooks/use-dashboard-data";
import { formatCurrency, formatNumber, cn } from "@/lib/utils";
import { SortTable, type SortCol } from "@/components/sort-table";

// 키워드 탭 > 네이버 검색어. 사람들이 실제로 친 검색어(등록 키워드가 아님). 2026-09-18 신설.
// 네이버는 **파워링크 검색어 단위 전환을 주지 않는다.** 구매·ROAS 는 쇼핑검색에만 있다. 파워링크 전환은
// 등록 키워드 단위로 첫 번째 탭(키워드 분석)에 있다.
//
// ★ 2026-09-30: 계정 탭(너티·사입·아이언펫 / 밸런스랩)을 없앴다. 페이지 상단 브랜드 필터와 겹쳐
//   "밸런스랩 → 네이버 검색어 → 또 밸런스랩 → 전체" 를 눌러야 했다(김호 지적). 이제 상단 필터를 따르고,
//   가를 여지가 남을 때만 하위 칩을 낸다. 계정은 브랜드에서 유도하므로 화면에 안 나온다.
//     전체  → 칩 [전체·너티·사입·아이언펫·밸런스랩]
//     펫    → 칩 [전체·너티·사입·아이언펫]   (밸런스랩 칩은 안 보인다)
//     그 외 → 칩 없음. 상단에서 이미 하나로 좁혔다

type AdType = "powerlink" | "shopping";
interface Sum { impressions: number; clicks: number; cost: number; purchases: number; purchase_value: number; cart_adds: number }
interface Entry extends Sum { ad_type: AdType; product: string; query: string }
interface Resp {
  brand: string; entries: Entry[]; rows: number; latestCollected: string | null;
  campaignCost: { powerlink: number; shopping: number }; error?: string;
}
type Row = Sum & { name: string; sub?: string; types?: string };

const M: (keyof Sum)[] = ["impressions", "clicks", "cost", "purchases", "purchase_value", "cart_adds"];
const zero = (): Sum => ({ impressions: 0, clicks: 0, cost: 0, purchases: 0, purchase_value: 0, cart_adds: 0 });
const addTo = <T extends Sum>(a: T, b: Sum) => { for (const k of M) a[k] += Number(b[k]) || 0; return a; };
const roas = (v: number, c: number) => (c > 0 ? (v / c) * 100 : 0);
const pct = (n: number) => `${n.toFixed(0)}%`;
const TYPE_LABEL: Record<AdType, string> = { powerlink: "파워링크", shopping: "쇼핑검색" };
const WASTE_MIN_COST = 3000;

const METRIC_COLS: SortCol<Row>[] = [
  { key: "impressions", label: "노출", value: (r) => r.impressions, render: (r) => formatNumber(r.impressions) },
  { key: "clicks", label: "클릭", value: (r) => r.clicks, render: (r) => formatNumber(r.clicks) },
  { key: "ctr", label: "CTR", value: (r) => (r.impressions ? r.clicks / r.impressions : 0), render: (r) => `${r.impressions ? ((r.clicks / r.impressions) * 100).toFixed(2) : "0.00"}%` },
  { key: "cost", label: "광고비", value: (r) => r.cost, render: (r) => formatCurrency(r.cost) },
  { key: "cpc", label: "CPC", value: (r) => (r.clicks ? r.cost / r.clicks : 0), render: (r) => (r.clicks ? formatCurrency(Math.round(r.cost / r.clicks)) : "-") },
  { key: "purchases", label: "구매", value: (r) => r.purchases, render: (r) => formatNumber(r.purchases) },
  { key: "purchase_value", label: "구매매출", value: (r) => r.purchase_value, render: (r) => formatCurrency(r.purchase_value) },
  { key: "cart_adds", label: "장바구니", value: (r) => r.cart_adds, render: (r) => formatNumber(r.cart_adds) },
  { key: "roas", label: "ROAS(구매)", value: (r) => roas(r.purchase_value, r.cost), render: (r) => pct(roas(r.purchase_value, r.cost)) },
];
const nameCol = (label: string): SortCol<Row> => ({ key: "name", label, value: (r) => r.name, render: (r) => r.name, left: true });

// 상단 브랜드 필터별로 하위에 낼 칩. 빈 배열이면 칩 줄 자체를 안 그린다.
const SUB_BRANDS: Record<string, { key: string; label: string }[]> = {
  all: [
    { key: "all", label: "전체" }, { key: "nutty", label: "너티" }, { key: "saip", label: "사입" },
    { key: "ironpet", label: "아이언펫" }, { key: "balancelab", label: "밸런스랩" },
  ],
  pet: [
    { key: "pet", label: "전체" }, { key: "nutty", label: "너티" },
    { key: "saip", label: "사입" }, { key: "ironpet", label: "아이언펫" },
  ],
};

export function NaverSearchTermSection({ brand, from, to }: { brand: string; from: string; to: string }) {
  const subs = SUB_BRANDS[brand] || [];
  // 하위 칩은 상단 필터가 바뀌면 그 필터 자신으로 돌아간다. 펫에서 '사입'을 고른 채 밸런스랩으로
  // 옮기면 사입 데이터가 밸런스랩 화면에 남는다.
  const [sub, setSub] = useState<string | null>(null);
  const effective = subs.some(s => s.key === sub) ? (sub as string) : brand;
  const { data, loading } = useFetch<Resp>(`/api/naver-search-terms?brand=${effective}&from=${from}&to=${to}`);
  const [type, setType] = useState<"all" | AdType>("all");
  const [picked, setPicked] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const kwRef = useRef<HTMLDivElement>(null);

  const typed = useMemo(() => (data?.entries || []).filter((e) => type === "all" || e.ad_type === type), [data, type]);
  const scoped = useMemo(() => (picked ? typed.filter((e) => e.product === picked) : typed), [typed, picked]);

  const products: Row[] = useMemo(() => {
    const m = new Map<string, Row & { q: Set<string>; t: Set<string> }>();
    for (const e of typed) {
      const r = m.get(e.product) || { ...zero(), name: e.product, q: new Set<string>(), t: new Set<string>() };
      addTo(r, e); r.q.add(e.query); r.t.add(TYPE_LABEL[e.ad_type]);
      m.set(e.product, r);
    }
    return [...m.values()].map(({ q, t, ...r }) => ({ ...r, sub: String(q.size), types: [...t].join("·") }));
  }, [typed]);

  const terms: Row[] = useMemo(() => {
    const m = new Map<string, Row & { p: Set<string>; t: Set<string> }>();
    for (const e of scoped) {
      const r = m.get(e.query) || { ...zero(), name: e.query, p: new Set<string>(), t: new Set<string>() };
      addTo(r, e); r.p.add(e.product); r.t.add(TYPE_LABEL[e.ad_type]);
      m.set(e.query, r);
    }
    return [...m.values()].map(({ p, t, ...r }) => ({ ...r, sub: [...p].join(", "), types: [...t].join("·") }));
  }, [scoped]);

  const total = useMemo(() => scoped.reduce((a, e) => addTo(a, e), zero()), [scoped]);
  const byType = useMemo(() => {
    const t = { powerlink: zero(), shopping: zero() };
    for (const e of data?.entries || []) addTo(t[e.ad_type], e);
    return t;
  }, [data]);
  // 쇼핑검색만 구매가 있으므로 "돈만 쓰는" 판정도 쇼핑검색 행만 본다.
  const waste = useMemo(() => {
    const m = new Map<string, Row>();
    for (const e of scoped.filter((x) => x.ad_type === "shopping")) {
      const r = m.get(e.query) || { ...zero(), name: e.query, sub: e.product };
      m.set(e.query, addTo(r, e));
    }
    return [...m.values()].filter((r) => r.cost >= WASTE_MIN_COST && r.purchases === 0);
  }, [scoped]);
  const searched = useMemo(() => (query ? terms.filter((k) => k.name.includes(query)) : terms), [terms, query]);

  const pick = (name: string) => {
    setPicked((cur) => (cur === name ? null : name));
    requestAnimationFrame(() => kwRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const switchSub = (k: string) => { setSub(k); setPicked(null); setQuery(""); };

  const cov = (t: AdType) => {
    const c = data?.campaignCost?.[t] || 0;
    return c > 0 ? `${((byType[t].cost / c) * 100).toFixed(1)}%` : "-";
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {subs.length > 0 && (
          <div className="flex gap-0.5 rounded-lg bg-muted p-1">
            {subs.map(({ key, label }) => (
              <button key={key} onClick={() => switchSub(key)}
                className={cn("px-3 py-1.5 text-xs rounded-md", effective === key ? "bg-card shadow-sm font-medium" : "text-muted-foreground")}>{label}</button>
            ))}
          </div>
        )}
        <div className="flex gap-0.5 rounded-lg bg-muted p-1">
          {([["all", "전체"], ["powerlink", "파워링크"], ["shopping", "쇼핑검색"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => { setType(k); setPicked(null); }}
              className={cn("px-3 py-1.5 text-xs rounded-md", type === k ? "bg-card shadow-sm font-medium" : "text-muted-foreground")}>{l}</button>
          ))}
        </div>
      </div>

      {loading ? <Card><CardContent className="p-8 text-center text-muted-foreground">네이버 검색어 불러오는 중...</CardContent></Card>
        : data?.error ? <Card><CardContent className="p-4 text-sm" style={{ color: "var(--sig-danger)" }}>네이버 검색어 오류: {data.error}</CardContent></Card>
        : !data?.rows ? (
          // 빈 화면의 사유를 가른다. 수집이 살아 있는데 이 브랜드만 0 이면 집행을 안 한 것이고,
          // 수집 자체가 조회 기간보다 앞서 멈췄으면 파이프 문제다. 아이언펫이 전자다(2026-05 이후 0행).
          <Card><CardContent className="p-6 text-sm text-muted-foreground space-y-1">
            <p>이 기간에 쌓인 검색어가 없습니다{data?.latestCollected ? ` (계정 마지막 수집일 ${data.latestCollected})` : ""}.</p>
            {data?.latestCollected && data.latestCollected >= from && (
              <p className="text-xs">수집은 돌고 있습니다. 이 브랜드가 그 기간에 검색광고를 집행하지 않았다는 뜻입니다.</p>
            )}
          </CardContent></Card>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              사람들이 실제로 친 검색어입니다. 네이버는 <b>파워링크 검색어별 전환을 주지 않아</b> 구매·ROAS 는 쇼핑검색에만 있습니다
              (파워링크 전환은 등록 키워드 단위로 &quot;키워드 분석&quot; 탭). 검색어 보고서가 잡은 광고비: 파워링크 {cov("powerlink")} · 쇼핑검색 {cov("shopping")}
              (네이버가 소량 검색어를 보고서에서 빼서 100% 가 안 될 수 있음).
            </p>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <KpiCard title={picked ? `광고비 · ${picked}` : "광고비"} value={formatCurrency(total.cost)} />
              <KpiCard title="클릭" value={formatNumber(total.clicks)} />
              <KpiCard title="구매 (쇼핑검색)" value={formatNumber(total.purchases)} />
              <KpiCard title="구매매출 (쇼핑검색)" value={formatCurrency(total.purchase_value)} />
              <KpiCard title="장바구니 (쇼핑검색)" value={formatNumber(total.cart_adds)} />
            </div>

            <Card><CardContent className="p-4">
              <h3 className="font-semibold text-sm">상품별 <span className="text-xs font-normal text-muted-foreground">쇼핑검색은 상품, 파워링크는 광고그룹 · 누르면 아래 검색어 표가 그 상품으로 바뀝니다</span></h3>
              <div className="mt-2">
                <SortTable rows={products} initial="cost" onRowClick={(r) => pick(r.name)} activeName={picked} maxHeight={360}
                  cols={[nameCol("상품"), { key: "types", label: "유형", value: (r) => r.types || "", render: (r) => r.types || "", left: true }, ...METRIC_COLS,
                    { key: "sub", label: "검색어", value: (r) => Number(r.sub), render: (r) => `${formatNumber(Number(r.sub))}개` }]} />
              </div>
            </CardContent></Card>

            {waste.length > 0 && (
              <Card><CardContent className="p-4">
                <h3 className="font-semibold text-sm">돈만 쓰는 검색어 <span className="text-xs font-normal text-muted-foreground">쇼핑검색 · 광고비 {formatCurrency(WASTE_MIN_COST)} 이상 · 구매 0 · {waste.length}개</span></h3>
                <p className="text-xs text-muted-foreground mb-2">제외 검색어 후보입니다. 기간이 짧으면 우연일 수 있으니 기간을 넓혀 다시 보세요.</p>
                <SortTable rows={waste} initial="cost" maxHeight={320}
                  cols={[nameCol("검색어"), { key: "sub", label: "상품", value: (r) => r.sub || "", render: (r) => r.sub || "", left: true }, ...METRIC_COLS]} />
              </CardContent></Card>
            )}

            <div ref={kwRef} className="scroll-mt-4">
              <Card><CardContent className="p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold text-sm">검색어별 성과 <span className="text-xs font-normal text-muted-foreground">{formatNumber(searched.length)}개 전체</span></h3>
                  <div className="flex items-center gap-2 flex-wrap">
                    {picked ? (
                      <button onClick={() => setPicked(null)} className="text-xs rounded-full bg-primary text-primary-foreground px-2.5 py-1">{picked} ✕ 전체 보기</button>
                    ) : <span className="text-xs text-muted-foreground">전체 상품</span>}
                    <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="검색어 검색"
                      className="h-7 rounded-md border bg-background px-2 text-xs w-40" />
                  </div>
                </div>
                <SortTable rows={searched} initial="cost" maxHeight={640}
                  cols={[nameCol("검색어"), { key: "types", label: "유형", value: (r) => r.types || "", render: (r) => r.types || "", left: true },
                    ...(picked ? [] : [{ key: "sub", label: "상품", value: (r: Row) => r.sub || "", render: (r: Row) => r.sub || "", left: true }]),
                    ...METRIC_COLS]} />
              </CardContent></Card>
            </div>
          </>
        )}
    </div>
  );
}
