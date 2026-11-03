// 매출 화면 전용 일·주·월 키 (sales/page.tsx 에서 옮김, 2026-11-03).
//
// 주는 1월 1일 기준 주차(YYYY-Wnn)라 공용 bucketKey(월요일 시작)와 다르다.
// 화면 라벨이 바뀌지 않게 기존 규칙을 그대로 두고, 축 채우기·완료 판정에서도 같은 함수를 쓴다.
import { daysBetween } from "@/lib/bucket";

export type PeriodMode = "daily" | "weekly" | "monthly";

export function periodKey(date: string, mode: PeriodMode): string {
  if (mode === "monthly") return date.slice(0, 7); // YYYY-MM
  if (mode === "daily") return date.slice(5);
  const d = new Date(date);
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

/** 선택 기간 전체(오늘까지)의 키 → 그 키에 속한 첫날. 첫날은 수집 지연 구간 판정에 쓴다. */
export function periodAxis(from: string, to: string, mode: PeriodMode): Map<string, string> {
  const m = new Map<string, string>();
  for (const d of daysBetween(from, to)) {
    const k = periodKey(d, mode);
    if (!m.has(k)) m.set(k, d);
  }
  return m;
}

const DAY_MS = 86400000;
const shiftDay = (d: string, n: number) => new Date(new Date(d + "T00:00:00Z").getTime() + n * DAY_MS).toISOString().slice(0, 10);

/** 키가 달력에서 차지하는 날 수(기간 필터와 무관). 연초 첫 주처럼 7일이 안 되는 주도 정확히 센다. */
export function periodCalendarDays(key: string, anyDay: string, mode: PeriodMode): number {
  if (mode === "daily") return 1;
  const span = mode === "weekly" ? 7 : 31;
  let n = 0;
  for (let i = -span; i <= span; i++) if (periodKey(shiftDay(anyDay, i), mode) === key) n++;
  return n;
}
