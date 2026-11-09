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
 *
 * ⚠ **밸런스랩 전용이다.** 형식 (A) 판정이 `lineup` 유무만 보는데, lineup 은 다른 브랜드에서
 *   정규 라인업 컬럼이다(너티 "하루루틴"/"사운드", 사입 "파미나" 등). 브랜드 구분 없이 호출하면
 *   그 브랜드의 정상 매출이 통째로 공구로 분류된다. 호출 전에 brand === "balancelab" 인지 확인할 것.
 *   (2026-08 사고: brand-detail 이 전 브랜드에 적용해 너티 제품 매출 12,029,450원이 0이 됐다.)
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

/**
 * daily_sales 에 일반 채널(smartstore 등)로 섞여 들어간 공구 (형식 A).
 *
 * channel="smartstore" + lineup="셀러명" 인 공구 row 는 daily_sales 에서 channel="smartstore"
 * 로 집계되어 자체매출과 구분이 안 된다. daily_sales 기반 자체매출에서 이 금액만큼을
 * 별도로 빼야 진짜 자체매출이 된다 (channel="공구_*"/"공구" 인 형식 B/C/D 는 channel 필터로
 * 이미 제외되므로 여기서는 제외).
 *
 * 사용: product_sales 를 이 함수로 필터해 날짜별 합을 구한 뒤, 같은 브랜드의 daily_sales 매출에서 차감.
 */
export function isGongguInDailySales(row: GongguRow): boolean {
  if (!isGonggu(row)) return false;
  const ch = row.channel || "";
  return !(ch.startsWith("공구_") || ch === "공구");
}

/** 공구 셀러명 추출. lineup 우선, 없으면 channel 접두사에서 파싱 */
export function gongguSeller(row: GongguRow): string {
  if (row?.lineup) return row.lineup;
  const ch = row?.channel || "";
  if (ch.startsWith("공구_")) return ch.slice(3);
  if (ch === "공구") return "기타";
  return "";
}

// ── 매출 적재 시 lineup 정하기 ─────────────────────────────────
// marketing-dashboard/scripts/sync_sales_auto.py 의 seller_for·resolve_lineup 과 **같은 규칙**이다.
// 셋(업로드 폼·Sales 시트 수집기·전체 재빌드)이 어긋나면 같은 날 같은 상품의 공구·자체가
// 한 행으로 합쳐지거나 공구가 자체로 샌다(2025-12~2026-05 밸런스랩, 2026-10-28 보정).
//  1) 라인업(상품 목록 D열 / Sales 시트 F열) 값이 있으면 그 값
//  2) 비어 있고 밸런스랩 「공동구매」 줄이면 공구 일정표(bl_gonggu_schedule)에서 그날 셀러.
//     겹치면 '·' 로 잇고, 일정에 없거나 표를 못 읽으면 '기타'
//  3) 그 외 빈 문자열
// 공구 줄은 lineup 이 비지 않으므로 isGonggu 가 항상 true 다.

export const GONGGU_LABEL = "공동구매";
export const UNKNOWN_GONGGU_SELLER = "기타";
export const GONGGU_SELLER_JOIN = "·";
export const GONGGU_SCHEDULE_TABLE = "bl_gonggu_schedule";

export interface GongguWindow {
  seller: string;
  start_on: string; // YYYY-MM-DD
  end_on: string;   // YYYY-MM-DD (포함)
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** 그날 걸린 공구 셀러. 여럿이면 '·' 로 잇고(시작일 → 마감일 → 이름 순, sync_sales_auto._window_order 와 같음), 없으면 '기타'. */
export function gongguSellerOn(date: string, schedule: readonly GongguWindow[]): string {
  const hits = [...schedule]
    .map(w => ({ seller: w.seller, start: String(w.start_on).slice(0, 10), end: String(w.end_on).slice(0, 10) }))
    .sort((a, b) => cmp(a.start, b.start) || cmp(a.end, b.end) || cmp(a.seller, b.seller))
    .filter(w => w.start <= date && date <= w.end)
    .map(w => w.seller);
  return hits.length ? hits.join(GONGGU_SELLER_JOIN) : UNKNOWN_GONGGU_SELLER;
}

/** product_sales.lineup 값. 공구면 셀러 이름(비지 않음), 자체·다른 브랜드 빈 라인업은 빈 문자열. */
export function resolveSalesLineup(
  args: { date: string; brand: string; brandLabel?: string | null; lineup?: string | null },
  schedule: readonly GongguWindow[],
): string {
  const lineup = String(args.lineup ?? "").trim();
  if (lineup) return lineup;
  if (args.brand === "balancelab" && String(args.brandLabel ?? "").trim() === GONGGU_LABEL) {
    return gongguSellerOn(args.date, schedule);
  }
  return "";
}

// ── 자체매출에서 형식-A 공구 빼기 (2026-11-09 단일화) ─────────────────
// 밸런스랩 형식-A 공구는 product_sales 에 channel="smartstore"+lineup="셀러명" 으로 들어오고,
// 같은 금액이 daily_sales 의 같은 날짜·같은 판매처 행에 자체매출처럼 섞여 있다.
// 예전엔 화면마다 빼는 방식이 달랐다.
//  - /api/dashboard: 그날 밸런스랩 **모든** daily_sales 행에서 그날 공구 전액을 뺌
//    (판매처 행이 둘 이상인 날은 공구를 두 번 빼게 됨)
//  - /api/channel-groups·insights: 판매처 구분 없이 smartstore 합계에서 뺌
//  - /api/pacing: 날짜 합으로 빼고 0 아래도 허용
// 실측(2025-12~2026-11-09): 형식-A 공구 109행 전부 channel="smartstore", 밸런스랩 daily_sales
// smartstore 합계 = product_sales smartstore 합계(145,791,068원). 그래서 공구 행과 **같은 날짜·
// 같은 판매처**의 밸런스랩 daily_sales 행에서만 뺀다. 판매처를 smartstore 로 박아 두지 않는다
// (다른 판매처로 공구가 들어와도 그 판매처에서 빠지게).

/** 원 단위 오차(0.0000001원 같은 소수 찌꺼기)를 0 으로 본다. 7일치가 304,999.99999 대 305,000 이었다. */
const roundWon = (v: number) => Math.round(v);

export interface FormASource extends GongguRow {
  date: string;
  brand?: string | null;
  revenue: number | string | null;
}

/**
 * product_sales 행 → 형식-A 공구 금액 (키: `날짜|판매처`).
 * brand 칸이 있으면 밸런스랩만 센다(insights 처럼 여러 브랜드가 섞여 들어오는 호출부 대비).
 * brand 칸이 없으면 호출부가 이미 밸런스랩으로 걸렀다고 본다.
 */
export function formAByDateChannel(rows: readonly FormASource[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows || []) {
    if (r.brand != null && r.brand !== "balancelab") continue;
    if (!isGongguInDailySales(r)) continue;
    const k = `${String(r.date).slice(0, 10)}|${r.channel || ""}`;
    m.set(k, (m.get(k) || 0) + Number(r.revenue || 0));
  }
  return m;
}

/** 형식-A 공구 합계(빼야 할 총액). */
export function formATotal(map: ReadonlyMap<string, number>): number {
  let s = 0;
  map.forEach((v) => { s += v; });
  return s;
}

/**
 * daily_sales 행에서 형식-A 공구를 뺀 새 배열(원본은 그대로).
 * 밸런스랩 행 중 공구와 날짜·판매처가 같은 행에서만 빼고, 같은 날짜·판매처 행이 여럿이면
 * 앞 행부터 남은 금액만큼 차례로 뺀다(한 번만 빠지게). 행마다 0 아래로는 내려가지 않는다.
 */
export function subtractFormAGonggu<T extends { brand?: string | null; date: string; channel?: string | null; revenue: number | string | null }>(
  rows: readonly T[],
  map: ReadonlyMap<string, number>,
): T[] {
  if (!map.size) return [...(rows || [])];
  const left = new Map(map);
  return (rows || []).map((r) => {
    if (r.brand !== "balancelab") return r;
    const k = `${String(r.date).slice(0, 10)}|${r.channel || ""}`;
    const g = left.get(k) || 0;
    if (g <= 0) return r;
    const rev = Number(r.revenue || 0);
    const take = Math.min(rev, g);
    left.set(k, g - take);
    return { ...r, revenue: roundWon(rev - take) === 0 ? 0 : rev - take };
  });
}
