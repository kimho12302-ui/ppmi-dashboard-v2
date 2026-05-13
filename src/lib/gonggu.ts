/**
 * 공구(공동구매) 데이터 형식과 헬퍼.
 *
 * product_sales 테이블의 공구 데이터 형식 (혼재):
 *  - (A) channel="smartstore", lineup="셀러명"  → 실제 셀러별 판매 row.
 *        balancelab smartstore daily_sales 합계에 **이미 포함**된다.
 *  - (B) channel="공구_<셀러명>", lineup=null/...  → 구형식. daily_sales smartstore에 미포함.
 *  - (C) channel="공구", product="공구 합계"  → product_sales 집계 row. 모든 계산에서 제외.
 *  - (D) channel="공구", product=실제 제품명, lineup=null  → 신규 단순 형식. daily_sales smartstore에 미포함.
 *
 * "공구 합계" product 행은 product_sales의 집계 row 이므로 반드시 제외.
 *
 * 의미가 다른 두 가지 분류:
 *  1) `isGonggu` — 공구 매출 분류 (categorization). 위 (A)(B)(D) 모두 true.
 *     집계 통계, 셀러별 breakdown, 매출 비중 차트 등에 사용.
 *  2) `isGongguOutOfDailySales` — daily_sales 합계에 미포함되어 별도 가산이 필요한 공구.
 *     (B)(D)만 true. (A)는 false (이미 daily_sales smartstore 에 포함되어 있음).
 *     월별 매출 합계, 일일 리포트 등 daily_sales 기반 매출에 공구를 더할 때 사용.
 */

export interface GongguRow {
  product?: string | null;
  channel?: string | null;
  lineup?: string | null;
}

/** "공구 합계" 집계 행 (product_sales 의 sum row, 모든 계산에서 제외 대상) */
export function isGongguAggregate(row: GongguRow): boolean {
  return row?.product === "공구 합계";
}

/**
 * 공구로 분류되는 row (집계용 categorization).
 *
 * 셀러별 매출 breakdown, gongguSalesTotal 계산, 공구 vs 자체판매 분리 등에 사용.
 * "공구 합계" 집계 행은 false.
 */
export function isGonggu(row: GongguRow): boolean {
  if (!row) return false;
  if (isGongguAggregate(row)) return false;
  if (row.lineup) return true;
  const ch = row.channel || "";
  if (ch.startsWith("공구_")) return true;
  if (ch === "공구") return true;
  return false;
}

/**
 * daily_sales 합계에 미포함되어 별도 가산이 필요한 공구 row.
 *
 * 월별 매출 합계, 일일 리포트 등 daily_sales 기반 매출에 공구를 더할 때 사용.
 * channel="공구_*" 또는 channel="공구" 만 true. channel="smartstore"+lineup 인 셀러 row는
 * daily_sales smartstore 합계에 이미 포함되어 있으므로 별도 가산하면 이중집계 발생.
 */
export function isGongguOutOfDailySales(row: GongguRow): boolean {
  if (!row) return false;
  if (isGongguAggregate(row)) return false;
  const ch = row.channel || "";
  return ch.startsWith("공구_") || ch === "공구";
}

/** 공구 셀러명 추출. lineup 우선, 없으면 channel 접두사에서 파싱 */
export function gongguSeller(row: GongguRow): string {
  if (row?.lineup) return row.lineup;
  const ch = row?.channel || "";
  if (ch.startsWith("공구_")) return ch.slice(3);
  if (ch === "공구") return "기타";
  return "";
}
