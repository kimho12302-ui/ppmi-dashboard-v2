"use client";

import { useFetch } from "@/hooks/use-dashboard-data";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency, formatNumber } from "@/lib/utils";

interface ProductAdRow {
  product_id: string;
  product_name: string;
  brand: string;
  lineup: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversion_value: number;
  roas: number;
  salesProduct: string | null;
  /** 이 줄로 합친 광고 상품 이름들(같은 기본 품목으로 이어지는 광고는 한 줄) */
  adNames?: string[];
  /** 실매출에 넣은 판매처(이 줄 광고 매체가 손님을 보내는 판매처, src/lib/ad-store.ts) */
  salesStores?: string[];
  /** 판매처를 정하지 않은 매체. 이 매체만 있는 줄은 실매출을 비운다 */
  unmappedChannels?: string[];
  actualRevenue: number | null;
  actualQuantity: number | null;
  actualRoas: number | null;
}
const STORE_LABEL: Record<string, string> = { smartstore: "스마트스토어", cafe24: "자사몰(카페24)", coupang: "쿠팡" };
const storeText = (stores?: string[]) => (stores || []).map((s) => STORE_LABEL[s] || s).join("·");
interface LineupRow { lineup: string; brand: string; spend: number; conversion_value: number; roas: number }

/**
 * 제품(상품)별 광고 성과.
 *
 * 기존 '제품별 성과'는 판매 원장(product_sales) 기준이라 매출만 보인다. 여기는 광고 원장
 * (ad_product_performance) 기준이라 **그 제품에 얼마를 써서 얼마를 벌었는지**가 보인다.
 * 두 표를 합치지 않는 이유: 판매 원장의 제품명과 광고 플랫폼 상품명이 서로 다른 체계라
 * 텍스트로 억지 매칭하면 조용히 어긋난다. 매칭이 검증되기 전까지는 나란히 둔다.
 */
export function ProductAdTable({ from, to, brand }: { from: string; to: string; brand: string }) {
  const { data, loading } = useFetch<{
    available: boolean; products: ProductAdRow[]; lineups: LineupRow[]; linkedCount?: number; reason?: string; componentsReady?: boolean;
  }>(`/api/product-ads?from=${from}&to=${to}&brand=${brand}`);

  if (loading) {
    return (
      <Card><CardContent className="p-4">
        <h3 className="font-semibold text-sm mb-3">제품별 광고 성과</h3>
        <div className="h-24 bg-muted/50 rounded animate-pulse" />
      </CardContent></Card>
    );
  }

  // 테이블이 아직 없는 상태(마이그레이션 미실행)를 '데이터 없음'과 구분해서 말한다.
  if (data && data.available === false) {
    return (
      <Card><CardContent className="p-4">
        <h3 className="font-semibold text-sm mb-2">제품별 광고 성과</h3>
        <p className="stamp px-2 py-1.5 rounded border inline-block"
           style={{ color: "var(--sig-warn)", backgroundColor: "var(--sig-warn-surface)", borderColor: "var(--sig-warn-border)" }}>
          준비 중 · {data.reason || "제품 축 테이블 미생성"}
        </p>
      </CardContent></Card>
    );
  }

  const products = data?.products || [];
  const lineups = data?.lineups || [];
  if (products.length === 0) {
    return (
      <Card><CardContent className="p-4">
        <h3 className="font-semibold text-sm mb-3">제품별 광고 성과</h3>
        <p className="text-sm text-muted-foreground py-6 text-center">이 기간 제품별 광고 집행이 없습니다</p>
      </CardContent></Card>
    );
  }

  // 실매출은 그 광고가 손님을 보내는 판매처 판매만이다(네이버 검색·쇼핑·GFA → 스마트스토어, 메타·구글 → 자사몰,
  // 밸런스랩 메타·구글 → 스마트스토어, 쿠팡 광고 → 쿠팡. 공용 규칙 src/lib/ad-store.ts).
  // 밸런스랩 실매출은 공구도 뺀 값이다(공구는 광고와 상관없이 팔린다). 펫은 따로 빼는 공구가 없어 문구를 붙이지 않는다.
  const hasGongguRule = brand === "balancelab" || brand === "all";
  const totalSpend = products.reduce((s, p) => s + p.spend, 0);
  // ★ 신고 전환매출이 아니라 **실매출** 0 을 기준으로 센다. 신고는 부풀어 있어
  //   "신고 0" 이 실제로는 팔린 경우가 있고, 그 반대도 있다.
  const wasted = products.reduce((s, p) => s + (p.actualRevenue === 0 ? p.spend : 0), 0);

  return (
    <Card><CardContent className="p-4">
      <div className="flex items-baseline justify-between gap-2 flex-wrap mb-3">
        <h3 className="font-semibold text-sm">
          제품별 광고 성과 <span className="text-xs text-muted-foreground font-normal">
            {data?.componentsReady ? "기본 품목 단위(묶음·세트는 구성표로 풀어 셈)" : "광고 상품·캠페인 단위"} · 실매출 = 광고 판매처 판매(예: 네이버 광고 → 스마트스토어){hasGongguRule && ", 공구 제외"}
            {typeof data?.linkedCount === "number" && ` · 판매 연결 ${data.linkedCount}/${products.length}종`}
          </span>
        </h3>
        {wasted > 0 && (
          <span className="stamp px-2 py-1 rounded border"
                style={{ color: "var(--sig-danger)", backgroundColor: "var(--sig-danger-surface)", borderColor: "var(--sig-danger-border)" }}>
            실매출 0 제품에 {formatCurrency(wasted)} ({Math.round(wasted / totalSpend * 100)}%)
          </span>
        )}
      </div>

      {/* 라인업 요약 — 밸런스랩 검사 제품만 채워진다(큐모발/큐타액/큐음식물). */}
      {lineups.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-4">
          {lineups.map(l => (
            <div key={l.lineup} className="surface-sunken p-3">
              <p className="text-xs text-muted-foreground truncate" title={l.lineup}>{l.lineup}</p>
              <p className="num font-bold mt-0.5">{formatCurrency(l.spend)}</p>
              <p className="num text-xs mt-0.5" style={{ color: l.roas >= 1 ? "var(--sig-ok)" : "var(--sig-danger)" }}>
                ROAS {l.roas.toFixed(2)}x
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground border-b">
              <th className="text-left py-2 font-medium">제품</th>
              <th className="text-right py-2 font-medium">광고비</th>
              <th className="text-right py-2 font-medium">클릭</th>
              <th className="text-right py-2 font-medium">전환</th>
              <th className="text-right py-2 font-medium">신고 전환매출</th>
              <th className="text-right py-2 font-medium">신고 ROAS</th>
              <th className="text-right py-2 font-medium">실매출</th>
              <th className="text-right py-2 font-medium">실 ROAS</th>
            </tr>
          </thead>
          <tbody>
            {products.slice(0, 20).map(p => (
              <tr key={`${p.brand}-${p.product_id}`} className="border-b last:border-0">
                <td className="py-2 truncate max-w-[280px]" title={(p.adNames && p.adNames.length ? p.adNames : [p.product_name]).join("\n")}>
                  {p.product_name}
                  {p.adNames && p.adNames.length > 1 && (
                    <span className="text-xs text-muted-foreground ml-1">광고 {p.adNames.length}개 합침</span>
                  )}
                </td>
                <td className="py-2 text-right num font-medium">{formatCurrency(p.spend)}</td>
                <td className="py-2 text-right num">{formatNumber(p.clicks)}</td>
                <td className="py-2 text-right num">{formatNumber(p.conversions)}</td>
                <td className="py-2 text-right num">{formatCurrency(p.conversion_value)}</td>
                <td className="py-2 text-right num text-muted-foreground">
                  {p.spend > 0 ? `${p.roas.toFixed(2)}x` : "-"}
                </td>
                {/* 상품번호가 시트에 없으면 '연결 안 됨'(—). 연결됐는데 0이면 진짜 안 팔린 것. */}
                <td className="py-2 text-right num" title={p.actualRevenue !== null && p.salesStores?.length ? `${storeText(p.salesStores)} 판매만` : undefined}>
                  {p.actualRevenue === null
                    ? p.salesProduct && !(p.salesStores && p.salesStores.length)
                      ? <span className="text-muted-foreground" title={`광고 매체(${(p.unmappedChannels || []).join(", ")})가 어느 판매처로 손님을 보내는지 정해 두지 않았습니다`}>판매처 미정</span>
                      : <span className="text-muted-foreground" title="판매와 이을 상품을 찾지 못했습니다. 상품 목록 시트 G열에 상품번호가 없고, 이름도 판매 원장·검사 라인과 맞지 않습니다">미연결</span>
                    : formatCurrency(p.actualRevenue)}
                </td>
                <td className="py-2 text-right num font-medium"
                    style={p.actualRoas === null ? undefined
                      : { color: p.actualRoas >= 1 ? "var(--sig-ok)" : p.actualRevenue === 0 ? "var(--sig-danger)" : "var(--sig-warn)" }}>
                  {p.actualRoas === null ? <span className="text-muted-foreground">-</span>
                    : p.spend > 0 ? `${p.actualRoas.toFixed(2)}x` : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {products.length > 20 && (
          <p className="stamp text-muted-foreground mt-2">상위 20개 · 전체 {products.length}개</p>
        )}
      </div>
    </CardContent></Card>
  );
}
