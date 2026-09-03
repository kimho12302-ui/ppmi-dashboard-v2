import { format, subDays, startOfMonth, endOfMonth, subMonths } from "date-fns";

/* ── 포맷 ── */

export function formatNumber(n: number): string {
  if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(1) + "억";
  if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(0) + "만";
  return n.toLocaleString("ko-KR");
}

export function formatCurrency(n: number): string {
  if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(1) + "억원";
  if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(0) + "만원";
  return n.toLocaleString("ko-KR") + "원";
}

export function formatPercent(n: number): string {
  return n.toFixed(1) + "%";
}

/** 전환 추적이 붙지 않은 채널인지. 광고비를 썼는데 전환값이 0이면 '성과 0'이 아니라 '미측정'이다. */
export function isRoasUntracked(roas: number, spend: number): boolean {
  return spend > 0 && !(roas > 0);
}

/**
 * 채널 ROAS 표시. 전환 추적이 없는 채널을 0.00x로 찍으면 "돈 쓰고 성과 없음"으로 읽혀
 * 예산 판단을 왜곡한다(2026-07: GFA·Meta가 이 상태였다). 그런 채널은 '미연동'으로 구분한다.
 */
export function formatRoas(roas: number, spend: number): string {
  if (isRoasUntracked(roas, spend)) return "미연동";
  return `${(roas || 0).toFixed(2)}x`;
}

/** 축약 없이 원 단위 전체 표시 (예: 14,858,470원) */
export function formatWon(n: number): string {
  return Math.round(n).toLocaleString("ko-KR") + "원";
}

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

/* ── 날짜 프리셋 ── */

export type DatePreset =
  | "yesterday"
  | "7d"
  | "14d"
  | "30d"
  | "this_month"
  | "last_month"
  | "this_year"
  | "all";

export interface DateRange {
  from: string;
  to: string;
}

// ★ 기본 종료일 = 어제 (2026-09).
//   오늘 데이터는 아직 집계 중이라 마지막 막대가 항상 뚝 떨어져 보이고, 추세 판단을 흐린다
//   (판매 업로드는 하루 뒤, 광고 API 는 T-1 확정). 그래서 프리셋의 to 를 어제로 끝낸다.
//   오늘까지 보고 싶으면 "직접 입력"으로 지정하면 된다.
export function getDateRangeFromPreset(preset: DatePreset): DateRange {
  const today = new Date();
  const yesterday = subDays(today, 1);
  const fmt = (d: Date) => format(d, "yyyy-MM-dd");
  // from 이 to 를 넘지 않도록 (매월 1일에 "이번 달"을 고르면 to=지난달 말일이 된다).
  const range = (from: Date, to: Date): DateRange =>
    from > to ? { from: fmt(to), to: fmt(to) } : { from: fmt(from), to: fmt(to) };

  switch (preset) {
    case "yesterday":
      return { from: fmt(yesterday), to: fmt(yesterday) };
    case "7d":
      return range(subDays(today, 7), yesterday);
    case "14d":
      return range(subDays(today, 14), yesterday);
    case "30d":
      return range(subDays(today, 30), yesterday);
    case "this_month":
      return range(startOfMonth(today), yesterday);
    case "last_month": {
      const last = subMonths(today, 1);
      return { from: fmt(startOfMonth(last)), to: fmt(endOfMonth(last)) };
    }
    case "this_year":
      return range(new Date(today.getFullYear(), 0, 1), yesterday);
    case "all":
      return { from: "2020-01-01", to: fmt(yesterday) };
    default:
      return range(subDays(today, 30), yesterday);
  }
}

export function getDateRange(days: number): DateRange {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return {
    from: from.toISOString().split("T")[0],
    to: to.toISOString().split("T")[0],
  };
}

/* ── 변화율 계산 ── */

export function calcChange(current: number, previous: number): number | undefined {
  if (previous === 0) return current > 0 ? 100 : undefined;
  return ((current - previous) / previous) * 100;
}
