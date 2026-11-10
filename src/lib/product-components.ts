// 판매 상품 구성표 (2026-11-09, 김호 "냠 = A, 냠 2개 = B 면 2A = B", "뉴트리션 + 종이결과지 = C 는 A + B").
//
// 판매 원장(product_sales.product)은 **판매 상품** 이름이다. 같은 기본 품목이 여러 이름으로 팔린다.
//   - 묶음: 「스트레스제로껌 2개」 = 스트레스제로껌 2개분
//   - 세트: 「큐모발검사 뉴트리션 + 종이결과지」 = 뉴트리션 1 + 종이결과지 1
//   - 옛 이름·쿠팡 긴 이름: 「냠」「너티 냠냠 … 20g 8개 고구마」 = 냠 단호박 1
// 제품 단위로 세는 화면이 판매 상품명 그대로 묶으면 같은 품목이 여러 줄로 갈라져 보인다.
// 이 파일이 판매 행을 **기본 품목** 행으로 푸는 단일 규칙이다. 표는 product_components
// (docs/sql/2026-11-09-product-components.sql, 시드 생성기 scripts/product-components/build.mjs).
//
// 푸는 규칙
//   - 수량 = 판매 수량 × 구성 수량 (냠 2개 3건 → 냠 단호박 6)
//   - 매출 = 판매 매출 × 몫(price_share). 한 품목 묶음은 몫 1 이라 매출 그대로.
//     세트는 품목 정가 비율로 나눈 몫(표에 저장). 몫이 비어 있으면 수량 비율로 나눈다.
//     원 단위로 반올림하고 남는 원은 대표 품목(몫이 가장 큰 품목)에 붙여, 나눈 합이 원래 매출과 정확히 같다.
//   - 구매자 수(buyers)는 대표 품목에만 남긴다. 다른 품목에도 복사하면 주문건수·배송비가 두 번 잡힌다.
//   - 날짜·브랜드·판매처·라인업 등 나머지 칸은 그대로 복사하고, 원래 판매 상품명을 sale_product 에 남긴다.
//   - 표에 없는 이름(「공구 합계」 집계 행, 새 상품 등)은 그대로 통과한다. 표가 아예 없으면(SQL 실행 전)
//     모든 행이 그대로라 화면은 예전과 똑같다.
//
// 이 파일은 다른 모듈을 가져오지 않는다. 화면(클라이언트)·API·검증 스크립트(node --experimental-strip-types)가
// 같이 쓴다.

export const PRODUCT_COMPONENTS_TABLE = "product_components";

/** product_components 한 줄 */
export interface ComponentRow {
  brand: string;
  sale_product: string;
  component: string;
  qty: number;
  price_share?: number | null;
  source?: string | null;
  needs_review?: boolean | null;
  note?: string | null;
}

/** 판매 상품 하나를 푼 결과의 한 조각 */
export interface ComponentPart {
  component: string;
  qty: number;
  share: number;
  primary: boolean;
}

export interface ComponentIndex {
  /** 판매 상품 수 (0 이면 표가 비었거나 없음) */
  readonly size: number;
  /** 판매 상품 → 조각들. 표에 없으면 undefined */
  get(brand: string | null | undefined, product: string | null | undefined): ComponentPart[] | undefined;
}

/** 띄어쓰기만 다른 이름을 같은 상품으로 본다(「스트레스 제로껌 2개」와 「스트레스제로껌 2개」). */
export function productKey(name: string | null | undefined): string {
  return String(name ?? "").replace(/\s+/g, "").toLowerCase();
}

const indexKey = (brand: string | null | undefined, product: string | null | undefined) =>
  `${String(brand ?? "")}|${productKey(product)}`;

export const EMPTY_COMPONENT_INDEX: ComponentIndex = { size: 0, get: () => undefined };

/** 표 줄 → 조회용 색인. 잘못된 줄(수량 0 이하, 이름 빈칸)은 버린다. */
export function buildComponentIndex(rows: readonly ComponentRow[] | null | undefined): ComponentIndex {
  const groups = new Map<string, ComponentRow[]>();
  for (const r of rows || []) {
    const qty = Number(r.qty);
    if (!r.sale_product || !r.component || !(qty > 0)) continue;
    const k = indexKey(r.brand, r.sale_product);
    const g = groups.get(k) || [];
    g.push({ ...r, qty });
    groups.set(k, g);
  }
  const parts = new Map<string, ComponentPart[]>();
  groups.forEach((g, k) => parts.set(k, toParts(g)));
  return {
    size: parts.size,
    get: (brand, product) => parts.get(indexKey(brand, product)),
  };
}

/** 한 판매 상품의 줄들 → 몫(합 1)과 대표 품목 */
function toParts(rows: ComponentRow[]): ComponentPart[] {
  const shares = rows.map((r) => Number(r.price_share));
  const allShares = shares.every((s) => Number.isFinite(s) && s > 0);
  const weights = allShares ? shares : rows.map((r) => r.qty);
  const total = weights.reduce((a, b) => a + b, 0);
  const list = rows.map((r, i) => ({ component: r.component, qty: r.qty, share: weights[i] / total, primary: false }));
  list.sort((a, b) => b.share - a.share || (a.component < b.component ? -1 : a.component > b.component ? 1 : 0));
  list[0].primary = true;
  return list;
}

/** 판매 행에서 쓰는 칸. 나머지 칸은 그대로 복사된다 */
export interface SaleLike {
  brand?: string | null;
  product: string;
  quantity?: number | string | null;
  revenue?: number | string | null;
  buyers?: number | string | null;
}

export type Expanded<T> = T & { sale_product: string };

/**
 * 판매 행 → 기본 품목 행 (새 배열, 원본 불변).
 * brand 칸이 없는 행은 fallbackBrand 로 찾는다(브랜드 하나로 조회한 API 용).
 */
export function expandSales<T extends SaleLike>(
  rows: readonly T[] | null | undefined,
  index: ComponentIndex,
  fallbackBrand?: string,
): Expanded<T>[] {
  const out: Expanded<T>[] = [];
  for (const r of rows || []) {
    const parts = index.size ? index.get(r.brand ?? fallbackBrand, r.product) : undefined;
    if (!parts) {
      out.push({ ...r, sale_product: r.product });
      continue;
    }
    const revenue = Number(r.revenue) || 0;
    const quantity = Number(r.quantity) || 0;
    const shares = parts.map((p) => (p.primary ? 0 : Math.round(revenue * p.share)));
    const rest = revenue - shares.reduce((a, b) => a + b, 0);
    parts.forEach((p, i) => {
      out.push({
        ...r,
        sale_product: r.product,
        product: p.component,
        quantity: quantity * p.qty,
        revenue: p.primary ? rest : shares[i],
        ...("buyers" in r ? { buyers: p.primary ? Number(r.buyers) || 0 : 0 } : {}),
      } as Expanded<T>);
    });
  }
  return out;
}

/** 이 판매 상품이 한 품목 묶음이면 그 품목 이름(「스트레스제로껌 2개」 → 「스트레스제로껌」), 세트·표에 없음이면 null */
export function singleComponentOf(index: ComponentIndex, brand: string | null | undefined, product: string | null | undefined): string | null {
  const parts = index.get(brand, product);
  return parts && parts.length === 1 ? parts[0].component : null;
}

/** 여러 품목으로 나뉘는 세트인지 */
export function isMultiComponent(index: ComponentIndex, brand: string | null | undefined, product: string | null | undefined): boolean {
  const parts = index.get(brand, product);
  return !!parts && parts.length > 1;
}
