"use client";

import { useMemo, useState } from "react";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent } from "@/components/ui/card";
import { useFetch } from "@/hooks/use-dashboard-data";
import { formatCurrency, formatNumber, cn } from "@/lib/utils";

// 키워드 탭 > 쿠팡 광고 키워드. 원천 raw_coupang_keyword(쿠팡 예약 일간 보고서, 매일 07:36 수집).
// 쿠팡은 1일·14일 두 기준으로 전환을 준다. 1일은 광고 직후 산 것, 14일은 2주 안에 산 것까지다.

interface Sum {
  impressions: number; clicks: number; spend: number;
  orders_1d: number; conv_sales_1d: number; orders_14d: number; conv_sales_14d: number;
}
interface KeywordRow extends Sum { keyword: string; placements: string[]; campaigns: string[] }
interface PlacementRow extends Sum { placement: string }
interface ProductRow extends Sum { product: string; keywordCount: number }
interface Resp {
  keywords: KeywordRow[]; placements: PlacementRow[]; products: ProductRow[];
  total: Sum; rows: number; latestCollected: string | null; error?: string;
}

type SortKey = "spend" | "clicks" | "conv_sales_14d" | "roas14" | "ctr";

const roas = (sales: number, spend: number) => (spend > 0 ? (sales / spend) * 100 : 0);
const pct = (n: number) => `${n.toFixed(0)}%`;

// "돈만 쓰는 키워드" 기준. 14일 전환이 0 인데 이만큼 넘게 썼으면 올린다. 작은 금액까지 올리면 목록이 소음이 된다.
const WASTE_MIN_SPEND = 3000;

export function CoupangKeywordSection({ brand, from, to }: { brand: string; from: string; to: string }) {
  const { data, loading } = useFetch<Resp>(`/api/coupang-keywords?from=${from}&to=${to}`);
  const [sortBy, setSortBy] = useState<SortKey>("spend");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);

  const list = useMemo(() => {
    const rows = (data?.keywords || []).filter((k) => !query || k.keyword.includes(query));
    const val = (k: KeywordRow) =>
      sortBy === "roas14" ? roas(k.conv_sales_14d, k.spend)
        : sortBy === "ctr" ? (k.impressions ? k.clicks / k.impressions : 0)
          : k[sortBy];
    return [...rows].sort((a, b) => val(b) - val(a)).slice(0, 200);
  }, [data, sortBy, query]);

  const waste = useMemo(
    () => (data?.keywords || [])
      .filter((k) => k.spend >= WASTE_MIN_SPEND && k.orders_14d === 0 && !k.keyword.startsWith("("))
      .slice(0, 20),
    [data],
  );

  if (loading) return <Card><CardContent className="p-8 text-center text-muted-foreground">쿠팡 키워드 불러오는 중...</CardContent></Card>;
  if (data?.error) return <Card><CardContent className="p-4 text-sm" style={{ color: "var(--sig-danger)" }}>쿠팡 키워드 오류: {data.error}</CardContent></Card>;

  const t = data?.total;
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
          아직 수집된 쿠팡 키워드가 없습니다. 쿠팡 예약 일간 보고서를 매일 07:36 에 받아 쌓습니다(2026-09-19 부터).
        </CardContent></Card>
      ) : data.latestCollected < from ? (
        <div className="rounded-lg border-l-4 border-amber-500 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-500">
          쿠팡 키워드는 <b>{data.latestCollected}</b> 까지 쌓여 있어 선택하신 기간에는 데이터가 없습니다.
        </div>
      ) : null}

      {t && data?.rows ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <KpiCard title="광고비" value={formatCurrency(t.spend)} />
            <KpiCard title="클릭" value={formatNumber(t.clicks)} />
            <KpiCard title="전환매출 (14일)" value={formatCurrency(t.conv_sales_14d)} />
            <KpiCard title="ROAS 1일" value={pct(roas(t.conv_sales_1d, t.spend))} />
            <KpiCard title="ROAS 14일" value={pct(roas(t.conv_sales_14d, t.spend))} />
          </div>

          <Card>
            <CardContent className="p-4">
              <h3 className="font-semibold text-sm mb-3">노출 지면별</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-muted-foreground border-b">
                    <th className="text-left py-1.5 pr-2">지면</th><th className="text-right px-2">광고비</th><th className="text-right px-2">클릭</th>
                    <th className="text-right px-2">주문 14일</th><th className="text-right px-2">ROAS 14일</th>
                  </tr></thead>
                  <tbody>{data.placements.map((p) => (
                    <tr key={p.placement} className="border-b last:border-0">
                      <td className="py-1.5 pr-2">{p.placement}</td>
                      <td className="text-right px-2">{formatCurrency(p.spend)}</td>
                      <td className="text-right px-2">{formatNumber(p.clicks)}</td>
                      <td className="text-right px-2">{formatNumber(p.orders_14d)}</td>
                      <td className="text-right px-2">{pct(roas(p.conv_sales_14d, p.spend))}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <h3 className="font-semibold text-sm">상품별 <span className="text-xs font-normal text-muted-foreground">캠페인 기준 · 누르면 그 상품의 키워드</span></h3>
              <p className="text-xs text-muted-foreground mb-2">쿠팡 캠페인을 상품 하나씩 짜 두어 캠페인 이름으로 묶었습니다(앞의 &quot;로켓배송_&quot;·날짜는 뗌).</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-muted-foreground border-b">
                    <th className="text-left py-1.5 pr-2">상품</th><th className="text-right px-2">광고비</th><th className="text-right px-2">클릭</th>
                    <th className="text-right px-2">주문 14일</th><th className="text-right px-2">전환매출 14일</th><th className="text-right px-2">ROAS 14일</th>
                    <th className="text-right px-2">검색 키워드</th>
                  </tr></thead>
                  <tbody>{(data.products || []).map((p) => (
                    <tr key={p.product} onClick={() => setPicked(picked === p.product ? null : p.product)}
                      className={cn("border-b last:border-0 cursor-pointer hover:bg-muted/60", picked === p.product && "bg-muted")}>
                      <td className="py-1.5 pr-2 font-medium">{picked === p.product ? "▾ " : "▸ "}{p.product}</td>
                      <td className="text-right px-2">{formatCurrency(p.spend)}</td>
                      <td className="text-right px-2">{formatNumber(p.clicks)}</td>
                      <td className="text-right px-2">{formatNumber(p.orders_14d)}</td>
                      <td className="text-right px-2">{formatCurrency(p.conv_sales_14d)}</td>
                      <td className="text-right px-2">{pct(roas(p.conv_sales_14d, p.spend))}</td>
                      <td className="text-right px-2">{formatNumber(p.keywordCount)}개</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              {picked && <ProductKeywords product={picked} from={from} to={to} onClose={() => setPicked(null)} />}
            </CardContent>
          </Card>

          {waste.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <h3 className="font-semibold text-sm">돈만 쓰는 키워드 <span className="text-xs font-normal text-muted-foreground">광고비 {formatCurrency(WASTE_MIN_SPEND)} 이상 · 14일 주문 0</span></h3>
                <p className="text-xs text-muted-foreground mb-2">제외 키워드 후보입니다. 기간이 짧으면 우연일 수 있으니 기간을 넓혀 다시 보세요.</p>
                <ul className="text-xs divide-y">
                  {waste.map((k) => (
                    <li key={k.keyword} className="py-1.5 flex justify-between gap-2">
                      <span>{k.keyword}</span>
                      <span className="text-muted-foreground whitespace-nowrap">{formatCurrency(k.spend)} · 클릭 {formatNumber(k.clicks)}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold text-sm">키워드별 성과 <span className="text-xs font-normal text-muted-foreground">{formatNumber(data.keywords.length)}개</span></h3>
                <div className="flex items-center gap-2">
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="키워드 검색"
                    className="h-7 rounded-md border bg-background px-2 text-xs w-36" />
                  <div className="flex gap-0.5 rounded-lg bg-muted p-0.5">
                    {([["spend", "광고비"], ["clicks", "클릭"], ["conv_sales_14d", "전환매출"], ["roas14", "ROAS"], ["ctr", "CTR"]] as [SortKey, string][]).map(([k, l]) => (
                      <button key={k} onClick={() => setSortBy(k)}
                        className={cn("px-2 py-1 text-xs rounded-md", sortBy === k ? "bg-card shadow-sm" : "text-muted-foreground")}>{l}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-muted-foreground border-b">
                    <th className="text-left py-1.5 pr-2">키워드</th>
                    <th className="text-right px-2">노출</th><th className="text-right px-2">클릭</th><th className="text-right px-2">CTR</th>
                    <th className="text-right px-2">광고비</th><th className="text-right px-2">CPC</th>
                    <th className="text-right px-2">주문 1일/14일</th><th className="text-right px-2">전환매출 14일</th><th className="text-right px-2">ROAS 14일</th>
                  </tr></thead>
                  <tbody>{list.map((k) => (
                    <tr key={k.keyword} className="border-b last:border-0" title={`캠페인: ${k.campaigns.join(", ")}\n지면: ${k.placements.join(", ")}`}>
                      <td className="py-1.5 pr-2">{k.keyword}</td>
                      <td className="text-right px-2">{formatNumber(k.impressions)}</td>
                      <td className="text-right px-2">{formatNumber(k.clicks)}</td>
                      <td className="text-right px-2">{k.impressions ? ((k.clicks / k.impressions) * 100).toFixed(2) : "0.00"}%</td>
                      <td className="text-right px-2">{formatCurrency(k.spend)}</td>
                      <td className="text-right px-2">{k.clicks ? formatCurrency(Math.round(k.spend / k.clicks)) : "-"}</td>
                      <td className="text-right px-2">{formatNumber(k.orders_1d)} / {formatNumber(k.orders_14d)}</td>
                      <td className="text-right px-2">{formatCurrency(k.conv_sales_14d)}</td>
                      <td className="text-right px-2">{pct(roas(k.conv_sales_14d, k.spend))}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

// 상품 하나를 눌렀을 때만 붙는다. 같은 API 에 product 를 주면 그 상품의 행만으로 키워드를 낸다.
function ProductKeywords({ product, from, to, onClose }: { product: string; from: string; to: string; onClose: () => void }) {
  const { data, loading } = useFetch<Resp>(`/api/coupang-keywords?from=${from}&to=${to}&product=${encodeURIComponent(product)}`);
  const [sortBy, setSortBy] = useState<SortKey>("spend");
  const rows = useMemo(() => {
    const list = (data?.keywords || []).filter((k) => !k.keyword.startsWith("("));
    const val = (k: KeywordRow) => sortBy === "roas14" ? roas(k.conv_sales_14d, k.spend)
      : sortBy === "ctr" ? (k.impressions ? k.clicks / k.impressions : 0) : k[sortBy];
    return [...list].sort((a, b) => val(b) - val(a)).slice(0, 50);
  }, [data, sortBy]);
  const noKw = data?.keywords.find((k) => k.keyword.startsWith("("));

  return (
    <div className="mt-3 rounded-lg border p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{product} · 검색 키워드 상위 50</h4>
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5 rounded-lg bg-muted p-0.5">
            {([["spend", "광고비"], ["conv_sales_14d", "전환매출"], ["roas14", "ROAS"], ["clicks", "클릭"]] as [SortKey, string][]).map(([k, l]) => (
              <button key={k} onClick={() => setSortBy(k)}
                className={cn("px-2 py-1 text-xs rounded-md", sortBy === k ? "bg-card shadow-sm" : "text-muted-foreground")}>{l}</button>
            ))}
          </div>
          <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">닫기</button>
        </div>
      </div>
      {loading ? <p className="text-xs text-muted-foreground">불러오는 중...</p> : (
        <>
          {noKw && (
            <p className="text-xs text-muted-foreground">
              이 상품 광고비 중 {formatCurrency(noKw.spend)}은 키워드 없는 지면(비검색·외부)에서 썼습니다. 아래는 검색 지면 키워드입니다.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-muted-foreground border-b">
                <th className="text-left py-1.5 pr-2">키워드</th><th className="text-right px-2">클릭</th><th className="text-right px-2">광고비</th>
                <th className="text-right px-2">주문 14일</th><th className="text-right px-2">전환매출 14일</th><th className="text-right px-2">ROAS 14일</th>
              </tr></thead>
              <tbody>{rows.map((k) => (
                <tr key={k.keyword} className="border-b last:border-0">
                  <td className="py-1.5 pr-2">{k.keyword}</td>
                  <td className="text-right px-2">{formatNumber(k.clicks)}</td>
                  <td className="text-right px-2">{formatCurrency(k.spend)}</td>
                  <td className="text-right px-2">{formatNumber(k.orders_14d)}</td>
                  <td className="text-right px-2">{formatCurrency(k.conv_sales_14d)}</td>
                  <td className="text-right px-2" style={{ color: k.spend > 0 && k.orders_14d === 0 ? "var(--sig-danger)" : undefined }}>
                    {pct(roas(k.conv_sales_14d, k.spend))}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
