// 일/주/월 버킷 헬퍼. 채널 성과·브랜드 상세 등 여러 화면이 같은 기준을 쓰도록 한 곳에 둔다.
// 주 버킷은 월요일 시작(ISO). 날짜 연산은 UTC 필드로만 해서 로컬 타임존 영향을 받지 않는다.
//
// 축 규칙 (2026-10-28): 시계열 축은 "값이 있는 날짜"가 아니라 "선택한 기간 전체"로 만든다.
// 예전 bucketize 는 행이 있는 날만 버킷을 만들어서, 매출이 0 인 날이 축에서 통째로 빠졌다.
// 그 날의 광고비도 같이 사라져 광고비가 실제보다 적어 보였다. 기간 축은 bucketAxis 로 만든다.

import { kstDate } from "@/lib/date";

export type Gran = "day" | "week" | "month";

export const GRAN_LABELS: { key: Gran; label: string }[] = [
  { key: "day", label: "일별" },
  { key: "week", label: "주별" },
  { key: "month", label: "월별" },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// 잘못된 범위(예: from=2020-01-01 일별)로 화면이 멈추지 않게 하는 상한. 약 11년.
const MAX_AXIS_DAYS = 4000;

export function bucketKey(date: string, gran: Gran): string {
  if (gran === "month") return date.slice(0, 7);
  if (gran === "week") {
    const d = new Date(date + "T00:00:00Z");
    if (isNaN(d.getTime())) return date;
    const dow = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1)); // 그 주 월요일
    return d.toISOString().slice(0, 10);
  }
  return date;
}

export function bucketLabel(key: string, gran: Gran): string {
  if (gran === "month") { const [y, m] = key.split("-"); return `${y}.${m}`; }
  const [, m, d] = key.split("-");
  if (gran === "week") return `${Number(m)}/${Number(d)} 주`;
  return `${Number(m)}/${Number(d)}`;
}

/** 축의 끝 날짜. 오늘(KST) 이후는 아직 오지 않은 날이라 축에 넣지 않는다. */
export function axisEnd(to: string, today: string = kstDate()): string {
  return to < today ? to : today;
}

/** from~to (양끝 포함) 의 모든 날짜. UTC 로만 센다. 오늘(KST) 이후는 잘라낸다. */
export function daysBetween(from: string, to: string, today: string = kstDate()): string[] {
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return [];
  const end = axisEnd(to, today);
  if (from > end) return [];
  const out: string[] = [];
  const d = new Date(from + "T00:00:00Z");
  for (let i = 0; i < MAX_AXIS_DAYS; i++) {
    const s = d.toISOString().slice(0, 10);
    if (s > end) break;
    out.push(s);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** 선택 기간 전체의 버킷 키 (정렬됨). 값이 없는 버킷도 빠지지 않는다. */
export function bucketAxis(from: string, to: string, gran: Gran, today?: string): string[] {
  return Array.from(new Set(daysBetween(from, to, today).map((d) => bucketKey(d, gran)))).sort();
}

/** 행 중 가장 늦은 날짜. 행이 없으면 "". 수집 지연 구간(마지막 데이터 이후)을 가르는 데 쓴다. */
export function lastDataDate(rows: { date: string }[]): string {
  let mx = "";
  for (const r of rows) if (r.date > mx) mx = r.date;
  return mx;
}

export interface BucketRange {
  from: string;
  to: string;
  /** 빈 버킷에도 0 으로 채울 항목 이름. 없으면 빈 버킷의 values 는 {} */
  fields?: string[];
}

/**
 * 날짜별 레코드를 버킷으로 접어 합산. pick 은 항목별 숫자 맵을 반환.
 * range 를 주면 축이 기간 전체(오늘까지)가 되고, 값이 없는 버킷은 0 으로 채운다.
 * 기간 밖 행이 들어와도 버리지 않는다(합계가 바뀌지 않게).
 */
export function bucketize<T extends { date: string }>(
  rows: T[],
  gran: Gran,
  pick: (row: T) => Record<string, number>,
  range?: BucketRange,
): { key: string; label: string; values: Record<string, number> }[] {
  const m = new Map<string, Record<string, number>>();
  if (range) {
    const zero = () => Object.fromEntries((range.fields || []).map((f) => [f, 0])) as Record<string, number>;
    for (const k of bucketAxis(range.from, range.to, gran)) m.set(k, zero());
  }
  for (const r of rows) {
    const k = bucketKey(r.date, gran);
    const acc = m.get(k) || {};
    for (const [field, v] of Object.entries(pick(r))) acc[field] = (acc[field] || 0) + v;
    m.set(k, acc);
  }
  return Array.from(m.keys()).sort().map((k) => ({ key: k, label: bucketLabel(k, gran), values: m.get(k)! }));
}

/**
 * 버킷이 마지막 데이터 날짜 이후에 시작하는지. 그 버킷은 "판매 0"이 아니라 "아직 안 들어옴"이라
 * 0 대신 null 로 둔다(판매 동기화는 며칠 늦게 들어온다). 마지막 날짜를 품은 버킷은 부분 합계를 그대로 쓴다.
 */
export function isAfterLastData(bucketStartKey: string, gran: Gran, last: string): boolean {
  if (!last) return true;
  return bucketStartKey > bucketKey(last, gran);
}
