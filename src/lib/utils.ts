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
  | "all";

export interface DateRange {
  from: string;
  to: string;
}

export function getDateRangeFromPreset(preset: DatePreset): DateRange {
  const today = new Date();
  const fmt = (d: Date) => format(d, "yyyy-MM-dd");

  switch (preset) {
    case "yesterday":
      return { from: fmt(subDays(today, 1)), to: fmt(subDays(today, 1)) };
    case "7d":
      return { from: fmt(subDays(today, 7)), to: fmt(today) };
    case "14d":
      return { from: fmt(subDays(today, 14)), to: fmt(today) };
    case "30d":
      return { from: fmt(subDays(today, 30)), to: fmt(today) };
    case "this_month":
      return { from: fmt(startOfMonth(today)), to: fmt(today) };
    case "last_month": {
      const last = subMonths(today, 1);
      return { from: fmt(startOfMonth(last)), to: fmt(endOfMonth(last)) };
    }
    case "all":
      return { from: "2020-01-01", to: fmt(today) };
    default:
      return { from: fmt(subDays(today, 30)), to: fmt(today) };
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
