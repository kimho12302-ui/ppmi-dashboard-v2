// KST(UTC+9) 날짜 헬퍼.
//
// 배경(2026-08 리뷰): `Date.now() + 32400000` 매직넘버가 16곳에 흩어져 있었고,
// 일부(monthly-summary)는 아예 빠져 있어 Vercel(UTC) 런타임에서 KST 00:00~09:00 사이에
// "오늘"이 전날로 계산됐다. 같은 시간대에 pacing 은 오늘을 포함해, 두 화면의
// 이번 달 매출이 아침마다 하루치씩 어긋났다. → 여기 한 곳에서만 계산한다.

export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 86400000;

/** KST 기준 현재 시각(Date 객체). 필드(getFullYear 등)는 UTC 접근자로 읽을 것. */
export function kstNow(): Date {
  return new Date(Date.now() + KST_OFFSET_MS);
}

/** KST 기준 YYYY-MM-DD. offsetDays 로 상대일(어제=-1) 지정. */
export function kstDate(offsetDays = 0): string {
  return new Date(Date.now() + KST_OFFSET_MS + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

/** KST 기준 YYYY-MM (이번 달). */
export function kstMonth(): string {
  return kstDate().slice(0, 7);
}
