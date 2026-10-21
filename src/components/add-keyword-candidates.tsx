"use client";

import { useMemo, type ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useFetch } from "@/hooks/use-dashboard-data";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { SortTable, type SortCol } from "@/components/sort-table";
import {
  SHORT_PERIOD_DAYS, PL_MIN_CLICKS_OTHER, COUPANG_UNCOLLECTED,
  type NaverCandidate, type CoupangCandidate, type CoupangAdTypeSummary,
} from "@/lib/add-keywords";

// 키워드 탭 「추가할 키워드」 칸. 2026-10-20 신설.
// 규칙 정본: Work/PPMI/projects/검색광고-운영/reports/2026-10-20-추가키워드-기준.md (seo-marketer)
// 판정 코드: src/lib/add-keywords.ts · 데이터: /api/keyword-candidates
//
// 표는 자르지 않는다(스크롤 상자 안에 전부). 머리 숫자는 "실행 대상"(보류·등록·노출0 제외)이고
// 기준 문서 4절 검산표의 "실행 대상" 칸과 같은 뜻이다. 보류·노출0 은 접어서 따로 보인다.

const BRAND_LABEL: Record<string, string> = { nutty: "너티", saip: "사입", ironpet: "아이언펫", balancelab: "밸런스랩" };
const BRAND_ORDER = ["nutty", "saip", "ironpet", "balancelab"];
const NO_PURCHASE_BASIS = "없음(네이버 미제공)";

const daysBetween = (from: string, to: string) =>
  Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000) + 1;

/** SortTable 은 name 을 행 키로 쓴다. 같은 표기가 브랜드 둘에 있으면 브랜드를 붙여 가른다. */
function withNames<T extends object>(rows: T[], label: (r: T) => string): (T & { name: string })[] {
  const count = new Map<string, number>();
  for (const r of rows) count.set(label(r), (count.get(label(r)) || 0) + 1);
  return rows.map((r) => {
    const brand = (r as { brand?: string }).brand || "";
    return { ...r, name: (count.get(label(r)) || 0) > 1 ? `${label(r)} (${BRAND_LABEL[brand] || brand || "?"})` : label(r) };
  });
}

function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  return tone === "warn"
    ? <div className="rounded-lg border-l-4 border-amber-500 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-500">{children}</div>
    : <div className="rounded-lg border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">{children}</div>;
}

function Folded({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <details className="rounded border px-3 py-2">
      <summary className="cursor-pointer text-xs text-muted-foreground">{title} {formatNumber(count)}개 (접힘, 눌러서 보기)</summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

// ── 네이버 ─────────────────────────────────────────────────────

type NRow = NaverCandidate & { name: string };
interface NaverResp {
  ready?: boolean; reason?: "sql" | "empty"; account?: string; error?: string;
  registry?: { account: string; seenOn: string; rows: number }[];
  shopping?: NaverCandidate[]; powerlink?: NaverCandidate[];
}

const col = {
  name: (label: string): SortCol<NRow> => ({ key: "name", label, value: (r) => r.name, render: (r) => r.name, left: true }),
  channel: (label: string): SortCol<NRow> => ({ key: "channel", label: "채널", value: () => label, render: () => label, left: true }),
  tier: { key: "order", label: "구분", value: (r: NRow) => r.order, render: (r: NRow) => r.tier, left: true } as SortCol<NRow>,
  brand: { key: "brand", label: "브랜드", value: (r: NRow) => r.brand, render: (r: NRow) => BRAND_LABEL[r.brand] || r.brand, left: true } as SortCol<NRow>,
  state: { key: "state", label: "등록 상태", value: (r: NRow) => r.state, render: (r: NRow) => r.state, left: true } as SortCol<NRow>,
  num: (key: keyof NaverCandidate, label: string, money = false): SortCol<NRow> => ({
    key, label, value: (r) => Number(r[key]) || 0,
    render: (r) => (money ? formatCurrency(Number(r[key]) || 0) : formatNumber(Number(r[key]) || 0)),
  }),
  text: (key: "source" | "action", label: string): SortCol<NRow> => ({ key, label, value: (r) => r[key], render: (r) => r[key], left: true }),
};

const SHOP_COLS: SortCol<NRow>[] = [
  col.name("검색어"), col.channel("네이버 쇼핑검색"), col.tier, col.brand, col.state,
  col.num("impressions", "노출"), col.num("clicks", "클릭"), col.num("cost", "쇼핑 광고비", true),
  col.num("purchases", "구매"), col.num("purchase_value", "구매매출", true),
  { key: "cpa", label: "구매당 광고비", value: (r) => (r.purchases ? r.cost / r.purchases : 0), render: (r) => (r.purchases ? formatCurrency(Math.round(r.cost / r.purchases)) : "-") },
  col.text("source", "들어온 상품"), col.text("action", "권하는 조치"),
];

const PL_COLS: SortCol<NRow>[] = [
  col.name("검색어"), col.channel("네이버 파워링크"), col.tier, col.brand, col.state,
  col.num("impressions", "노출"), col.num("clicks", "클릭"),
  { key: "ctr", label: "CTR", value: (r) => (r.impressions ? r.clicks / r.impressions : 0), render: (r) => `${r.impressions ? ((r.clicks / r.impressions) * 100).toFixed(1) : "0.0"}%` },
  col.num("cost", "광고비", true),
  { key: "basis", label: "구매 근거", value: () => NO_PURCHASE_BASIS, render: () => NO_PURCHASE_BASIS, left: true },
  col.text("source", "들어온 광고그룹"), col.text("action", "권하는 조치"),
];

function brandCounts(rows: NaverCandidate[], brands: string[]): string {
  return brands.map((b) => `${BRAND_LABEL[b] || b} ${formatNumber(rows.filter((r) => r.brand === b).length)}`).join(" · ");
}

function NaverSection({ title, rows, cols, brands, caution, shopping }: {
  title: string; rows: NaverCandidate[]; cols: SortCol<NRow>[]; brands: string[]; caution: string; shopping: boolean;
}) {
  const named = useMemo(() => withNames(rows, (r) => r.query), [rows]);
  const exec = named.filter((r) => r.bucket === "exec");
  const zero = named.filter((r) => r.bucket === "zero");
  const held = named.filter((r) => r.bucket === "held");
  const sum = (k: keyof NaverCandidate) => exec.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  return (
    <div className="space-y-2">
      <h4 className="font-semibold text-sm">
        {title} <span className="text-xs font-normal text-muted-foreground">실행 대상 {formatNumber(exec.length)}개 ({brandCounts(exec, brands)})</span>
      </h4>
      <p className="text-xs text-muted-foreground">
        실행 대상 합계: 노출 {formatNumber(sum("impressions"))} · 클릭 {formatNumber(sum("clicks"))} · 광고비 {formatCurrency(sum("cost"))}
        {shopping && <> · 구매 {formatNumber(sum("purchases"))} · 구매매출 {formatCurrency(sum("purchase_value"))}</>}
      </p>
      <p className="text-xs text-muted-foreground">{caution}</p>
      {exec.length > 0
        ? <SortTable rows={exec} cols={cols} initial="order" maxHeight={420} />
        : <Notice>이 기간·브랜드에는 실행 대상이 없습니다.</Notice>}
      <Folded title="이미 등록·30일 노출 0 (조치 없음)" count={zero.length}>
        <SortTable rows={zero} cols={cols} initial="order" maxHeight={260} />
      </Folded>
      <Folded title="보류 (지난 결정으로 막아 둔 검색어)" count={held.length}>
        <SortTable rows={held} cols={cols} initial="order" maxHeight={260} />
      </Folded>
    </div>
  );
}

export function NaverAddKeywordCard({ brand, from, to }: { brand: string; from: string; to: string }) {
  const { data, loading, error } = useFetch<NaverResp>(`/api/keyword-candidates?channel=naver&brand=${brand}&from=${from}&to=${to}`);
  const brands = useMemo(() => {
    if (brand === "all") return BRAND_ORDER;
    if (brand === "pet") return BRAND_ORDER.filter((b) => b !== "balancelab");
    return [brand];
  }, [brand]);
  const days = daysBetween(from, to);

  return (
    <Card><CardContent className="p-4 space-y-3">
      <div>
        <h3 className="font-semibold text-sm">추가할 검색어 <span className="text-xs font-normal text-muted-foreground">네이버 · 이미 운영 중인 키워드는 뺐습니다</span></h3>
        <p className="text-xs text-muted-foreground mt-1">
          쇼핑검색은 구매가 난 검색어, 파워링크는 클릭이 난 검색어를 올립니다. 이 화면은 계정을 바꾸지 않습니다.
          밸런스랩은 승인 후 직접 조정, 너티·사입은 대행사 지시서로 넘깁니다.
        </p>
      </div>
      {days < SHORT_PERIOD_DAYS && <Notice tone="warn">기간이 짧아 후보가 적게 나옵니다. 기준은 어제까지 30일입니다(지금 {days}일).</Notice>}

      {loading && !data ? <Notice>추가할 검색어 계산 중...</Notice>
        : error || data?.error ? <Notice tone="warn">추가할 검색어 오류: {error || data?.error}</Notice>
        : data && !data.ready ? (
          <Notice tone="warn">
            {data.reason === "sql"
              ? "등록 키워드 표가 아직 DB 에 없어 판정하지 못합니다(SQL 실행 전). docs/sql/2026-10-20-add-keyword-candidates.sql 실행 뒤 수집기가 한 번 돌면 나타납니다."
              : `등록 키워드 목록 수집 전이라 판정하지 못합니다${data.account ? `(${data.account === "main" ? "펫 계정" : "밸런스랩 계정"})` : ""}. 등록 대조 없이 고르면 이미 운영 중인 검색어까지 후보로 나와서 칸을 비워 둡니다.`}
          </Notice>
        ) : data ? (
          <>
            <p className="text-xs text-muted-foreground">
              등록 목록 기준일: {(data.registry || []).map((r) => `${r.account === "main" ? "펫 계정" : "밸런스랩 계정"} ${r.seenOn} (${formatNumber(r.rows)}개)`).join(" · ")}.
              등록 상태의 &quot;30일 노출&quot; 은 이 기준일까지 30일 값이라 위 기간과 다를 수 있습니다.
            </p>
            <NaverSection
              title="쇼핑 구매어 → 파워링크 등록 후보" rows={data.shopping || []} cols={SHOP_COLS} brands={brands} shopping
              caution="네이버 쇼핑 구매는 광고 클릭 뒤 스토어에서 일어난 구매입니다. 광고한 그 상품을 샀다는 보장은 없습니다. 브랜드는 구매가 가장 많은 상품의 이름으로 정합니다(사입 벌크 캠페인이 너티 상품도 광고)."
            />
            <NaverSection
              title="파워링크 클릭어 → 등록 후보" rows={data.powerlink || []} cols={PL_COLS} brands={brands} shopping={false}
              caution={`클릭만 보고 고른 후보입니다(네이버는 파워링크 검색어별 구매를 주지 않습니다). 검색어 뜻이 우리 상품과 다르면 등록이 아니라 제외어로 보냅니다. 판단은 사람이 합니다. 자사 브랜드어는 클릭 1회, 그 외는 ${PL_MIN_CLICKS_OTHER}회부터 올립니다.`}
            />
          </>
        ) : null}
    </CardContent></Card>
  );
}

// ── 쿠팡 ───────────────────────────────────────────────────────

type CRow = CoupangCandidate & { name: string };
interface CoupangResp {
  ready?: boolean; reason?: "sql"; error?: string;
  candidates?: CoupangCandidate[]; dates?: number; latestCollected?: string | null;
  adTypes?: CoupangAdTypeSummary;
  campaigns?: { campaign: string; ad_type: string; rows: number; first_date: string; last_date: string }[] | null;
}

const COUPANG_COLS: SortCol<CRow>[] = [
  { key: "name", label: "키워드", value: (r) => r.name, render: (r) => r.name, left: true },
  { key: "channel", label: "채널", value: () => "쿠팡", render: () => "쿠팡", left: true },
  { key: "order", label: "구분", value: (r) => r.order, render: (r) => r.tier, left: true },
  { key: "state", label: "수동 캠페인", value: (r) => r.state, render: (r) => r.state, left: true },
  { key: "campaign", label: "캠페인", value: (r) => r.campaign, render: (r) => r.campaign, left: true },
  { key: "impressions", label: "노출", value: (r) => r.impressions, render: (r) => formatNumber(r.impressions) },
  { key: "clicks", label: "클릭", value: (r) => r.clicks, render: (r) => formatNumber(r.clicks) },
  { key: "spend", label: "광고비", value: (r) => r.spend, render: (r) => formatCurrency(r.spend) },
  { key: "orders", label: "주문", value: (r) => r.orders, render: (r) => formatNumber(r.orders) },
  { key: "sales", label: "주문매출", value: (r) => r.sales, render: (r) => formatCurrency(r.sales) },
  { key: "roas", label: "ROAS", value: (r) => (r.spend ? r.sales / r.spend : 0), render: (r) => (r.spend ? `${Math.round((r.sales / r.spend) * 100)}%` : "-") },
  { key: "order_days", label: "주문 난 날 수", value: (r) => r.order_days, render: (r) => `${formatNumber(r.order_days)}일` },
  { key: "product", label: "들어온 상품", value: (r) => r.product, render: (r) => r.product, left: true },
  { key: "action", label: "권하는 조치", value: (r) => r.action, render: (r) => r.action, left: true },
];

/** 광고유형 판정 상태 한 줄. ad_type 칸이 없거나 아직 안 채워졌으면 판정하지 않는다. */
function CoupangAdTypeLine({ adTypes }: { adTypes?: CoupangAdTypeSummary }) {
  if (!adTypes?.collected) {
    return <Notice tone="warn">광고유형 미수집이라 수동 캠페인 여부를 못 가립니다. 아래 &quot;수동 캠페인&quot; 칸은 전부 미수집으로 나옵니다.</Notice>;
  }
  const types = Object.entries(adTypes.byType).filter(([k]) => k !== COUPANG_UNCOLLECTED)
    .map(([k, n]) => `${k} ${formatNumber(n)}행`).join(" · ");
  return (
    <Notice>
      이 기간 보고서에 수동 성과형 캠페인 행 {formatNumber(adTypes.manualRows)}건
      {adTypes.manualRows === 0 && <> · 그래서 후보 전부 &quot;수동 캠페인 미등록 후보&quot;입니다</>}.
      광고유형별: {types}
      {adTypes.uncollectedRows > 0 && <> · 광고유형 미수집 {formatNumber(adTypes.uncollectedRows)}행(판정에서 빠짐)</>}
    </Notice>
  );
}

export function CoupangAddKeywordCard({ from, to }: { from: string; to: string }) {
  const { data, loading, error } = useFetch<CoupangResp>(`/api/keyword-candidates?channel=coupang&from=${from}&to=${to}`);
  const rows: CRow[] = useMemo(() => withNames(data?.candidates || [], (r) => r.keyword), [data]);
  const days = daysBetween(from, to);
  const sum = (k: keyof CoupangCandidate) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const own = rows.filter((r) => r.tier === "자사").length;
  const manual = rows.filter((r) => r.manualHit).length;

  return (
    <Card><CardContent className="p-4 space-y-3">
      <div>
        <h3 className="font-semibold text-sm">
          추가할 키워드 <span className="text-xs font-normal text-muted-foreground">쿠팡 검색 영역에서 주문이 난 키워드 · 수동 키워드 후보</span>
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          수동 캠페인 여부는 보고서의 「광고유형」 칸으로 가립니다(매출 최적화가 아닌 행이 있으면 수동). 캠페인 칸은 10-21 전까지
          수집기가 일간 보고서 머리글(「캠페인」)을 못 읽어 비어 있었고, 10-21 고쳐 09-18~10-20 을 다시 넣었습니다.
          주문은 칸 이름이 14일이지만 보고서를 다음 날 한 번만 읽어 사실상 클릭 다음 날까지의 주문입니다.
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          보고서에는 노출이 난 행만 나온다. 수동 캠페인에 등록했지만 노출 0 인 키워드는 여기 안 보인다.
        </p>
      </div>
      {days < SHORT_PERIOD_DAYS && <Notice tone="warn">기간이 짧아 후보가 적게 나옵니다. 기준은 어제까지 30일입니다(지금 {days}일).</Notice>}

      {loading && !data ? <Notice>추가할 키워드 계산 중...</Notice>
        : error || data?.error ? <Notice tone="warn">추가할 키워드 오류: {error || data?.error}</Notice>
        : data && !data.ready ? (
          <Notice tone="warn">쿠팡 후보 계산 함수가 아직 DB 에 없습니다(SQL 실행 전). docs/sql/2026-10-20-add-keyword-candidates.sql 실행 뒤 나타납니다.</Notice>
        ) : data ? (
          <>
            <CoupangAdTypeLine adTypes={data.adTypes} />
            <p className="text-xs text-muted-foreground">
              {formatNumber(rows.length)}개 (자사 {formatNumber(own)} · 일반 {formatNumber(rows.length - own)}
              {data.adTypes?.collected && <> · 수동 캠페인에서 노출된 적 있음 {formatNumber(manual)}</>}) · 노출 {formatNumber(sum("impressions"))} ·
              클릭 {formatNumber(sum("clicks"))} · 광고비 {formatCurrency(sum("spend"))} · 주문 {formatNumber(sum("orders"))} ·
              주문매출 {formatCurrency(sum("sales"))} · 기간 {days}일 중 보고서 있는 날 {formatNumber(data.dates || 0)}일
            </p>
            <p className="text-xs text-muted-foreground">주문 1건짜리는 우연일 수 있습니다. 주문 난 날 수가 2일 이상인 것부터 봅니다. 캠페인 칸은 주문이 가장 많이 난 캠페인입니다.</p>
            {rows.length > 0
              ? <SortTable rows={rows} cols={COUPANG_COLS} initial="order" maxHeight={420} />
              : <Notice>이 기간에는 주문이 난 검색 키워드가 없습니다.</Notice>}
          </>
        ) : null}
    </CardContent></Card>
  );
}
