/**
 * 공구(공동구매) 데이터 형식과 헬퍼.
 *
 * product_sales 테이블의 공구 데이터 형식 (혼재):
 *  - (A) channel="smartstore", lineup="셀러명"  → 실제 셀러별 판매 row.
 *        balancelab smartstore daily_sales 합계에 **이미 포함**된다.
 *  - (B) channel="공구_<셀러명>", lineup=null/...  → 구형식. daily_sales smartstore에 미포함.
 *  - (C) channel="공구", product="공구 합계"  → 일별 공구 합계 row (밸런스랩 시트 sync 입력).
 *        셀러별 (A)/(B) row 가 함께 들어오지 않는 운영 형식이라 매출 가산 대상.
 *  - (D) channel="공구", product=실제 제품명, lineup=null  → 신규 단순 형식. daily_sales smartstore에 미포함.
 *
 * 의미가 다른 두 가지 분류:
 *  1) `isGonggu` — 공구 매출 분류 (categorization). 위 (A)(B)(D) 모두 true.
 *     집계 통계, 셀러별 breakdown, 매출 비중 차트 등에 사용. (C)는 셀러 정보가 없으므로 제외.
 *  2) `isGongguOutOfDailySales` — daily_sales 합계에 미포함되어 별도 가산이 필요한 공구.
 *     (B)(C)(D) true. (A)는 false (이미 daily_sales smartstore 에 포함되어 있음).
 *     월별 매출 합계, 일일 리포트 등 daily_sales 기반 매출에 공구를 더할 때 사용.
 *     sync_db_to_datahub.py 가 시트 매출 합계에 channel="공구*" 전체를 가산하는 것과 일치.
 */

export interface GongguRow {
  product?: string | null;
  channel?: string | null;
  lineup?: string | null;
}

/** "공구 합계" product row. 셀러 breakdown(`isGonggu`) 에서는 제외 대상이지만 매출 가산에는 포함됨 */
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
 * channel="공구_*" 또는 channel="공구" 인 모든 row 가 가산 대상.
 * - (B) 구형식, (C) "공구 합계" 일별 row, (D) 신규 단순 형식 모두 포함.
 * - channel="smartstore"+lineup 인 셀러 row(A)는 daily_sales smartstore 합계에 이미 포함되어
 *   있으므로 별도 가산하면 이중집계 발생 → channel 검사로 자연히 제외됨.
 * - sync_db_to_datahub.py:170 (`channel.startswith("공구")`) 와 동일 규칙으로 시트 합계와 정합.
 */
export function isGongguOutOfDailySales(row: GongguRow): boolean {
  if (!row) return false;
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
