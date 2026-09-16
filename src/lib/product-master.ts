import raw from "./product-master.json";

/**
 * 제품 정본. 통계시트 '상품 목록' 탭에서 생성된다
 * (marketing-dashboard/scripts/sync_product_master.py).
 *
 * 스마트스토어 상품번호 하나로 브랜드·라인업·**판매 원장 제품명**이 결정된다.
 * 마지막 게 핵심이다 — 광고 성과(상품번호)와 실제 판매(제품명)를 잇는 유일한 다리다.
 * 광고 상품명과 판매 제품명은 체계가 달라 직접 안 붙는다(70종 중 이름이 같은 건 11종).
 */
export interface MasterItem {
  code: string;
  category: string;
  brand_ko: string;
  brand: string;
  lineup: string;
  product: string;      // 판매 원장(product_sales.product)과 같은 이름
  coupang_pid: string;
}

const byPid = (raw as { by_smartstore_pid: Record<string, MasterItem> }).by_smartstore_pid || {};

/** 상품번호 → 정본. 시트에 번호가 안 적힌 신상품은 null. */
export function masterByPid(productId: string | number | null | undefined): MasterItem | null {
  if (productId === null || productId === undefined) return null;
  return byPid[String(productId).trim()] || null;
}

export const masterPidCount = Object.keys(byPid).length;
