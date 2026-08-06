// 일/주/월 버킷 헬퍼. 채널 성과·브랜드 상세 등 여러 화면이 같은 기준을 쓰도록 한 곳에 둔다.
// 주 버킷은 월요일 시작(ISO). 날짜 연산은 UTC 필드로만 해서 로컬 타임존 영향을 받지 않는다.

export type Gran = "day" | "week" | "month";

export const GRAN_LABELS: { key: Gran; label: string }[] = [
  { key: "day", label: "일별" },
  { key: "week", label: "주별" },
  { key: "month", label: "월별" },
];

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

/** 날짜별 레코드를 버킷으로 접어 합산. pick 은 항목별 숫자 맵을 반환. */
export function bucketize<T extends { date: string }>(
  rows: T[],
  gran: Gran,
  pick: (row: T) => Record<string, number>,
): { key: string; label: string; values: Record<string, number> }[] {
  const m = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const k = bucketKey(r.date, gran);
    const acc = m.get(k) || {};
    for (const [field, v] of Object.entries(pick(r))) acc[field] = (acc[field] || 0) + v;
    m.set(k, acc);
  }
  return Array.from(m.keys()).sort().map((k) => ({ key: k, label: bucketLabel(k, gran), values: m.get(k)! }));
}
