// 화면에 붙이는 「판매 집계일 M/D까지」 라벨(QA 3회차, 2026-11-10). 서버 쪽 정의는 src/lib/sales-through.ts.
// 클라이언트에서도 부르므로 DB 접근이 없는 이 파일에 따로 둔다.

/** "2026-11-08" → "11/8" */
export function md(ymd: string): string {
  return `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
}

/**
 * 비율(ROAS·MER)이 어디까지의 매출·광고비로 나눈 값인지 알리는 라벨.
 *   - through === undefined: 아직 응답 전이거나 옛 응답 → 라벨 없음(null)
 *   - through === null: 기간 안에 판매 원장이 없음 → 「판매 집계 없음」
 *   - through >= to: 기간 끝까지 다 들어옴 → 라벨 없음(null)
 *   - 그 밖: 「판매 집계일 M/D까지」
 */
export function salesThroughLabel(through: string | null | undefined, to: string): string | null {
  if (through === undefined) return null;
  if (!through) return "판매 집계 없음";
  if (through >= to) return null;
  return `판매 집계일 ${md(through)}까지`;
}
