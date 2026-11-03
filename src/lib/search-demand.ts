// 키워드 탭 「검색 수요」 계산. 2026-11-03 신설.
// 원천: src/data/search-demand-weekly.json. 네이버 데이터랩 검색어트렌드(웹, 주간)를 사람이 브라우저로
//   한 번 긁어 넣은 파일이다. 자동 수집이 아니다(데이터랩 API 키를 발급하지 않기로 함, 2026-11-03).
// 방법 정본: Work/밸런스랩/docs/2026-10-13-판매부진-진단/검색수요-재측정-2026-11-03.md
//
// ★ 지수 = 원지수(index)를 검색어 자기 기준 기간(2024-10 ~ 2025-09 주, 52주) 평균으로 나눈 값(= 100 기준).
//   기준 기간은 11-03 노트의 전년 비교 구간과 맞춰 고정한다(데이터가 2024-01 부터 있어도 "첫 52주"가 아니다).
//   앵커환산값(anchorScaled = 원지수 ÷ 같은 조회 영양제)으로 지수를 만들면 영양제 자신의 감소가 모든 선에서
//   빠져 "시장 대비 얼마나 줄었나"가 왜곡된다. 원지수는 "그 조회 안 최댓값 = 100" 상대값이라 조회가 다르면
//   직접 이을 수 없다. 그래서 **검색어마다 조회 하나만** 골라 쓴다(pickQuery). 같은 조회 안 같은 검색어끼리
//   나누는 지수·증감률은 앵커 없이도 같다(11-03 노트 2절).
// ★ 비교군 평균 = 구성 검색어 각각의 지수(100 기준)를 주마다 평균. 원지수 평균이 아니다.
// ★ 전년 동기 = 최근 13주 원지수 합 ÷ 52주(364일) 전 같은 13주 합 - 1.
//   비교군의 전년 동기는 구성 검색어 전년 동기의 평균(11-03 노트의 "평균"과 같은 식).
// ★ partial(진행 중인 주) 행은 계산·차트에서 뺀다. 표식을 빠뜨려도 주 끝(시작+6일)이 수집일 이후면 진행 중으로 본다.
// ★ 주 축은 처음~마지막 주 사이 7일 간격 연속 격자다. 빠진 주는 빈칸(null)이라 이동평균·전년비가 그 자리에서
//   계산을 멈춘다. 배열 위치 -52 가 늘 364일 전이 되게 하려는 것이다.

/** 기준 기간: 주 시작일이 이 사이에 드는 주(2024-10-07 ~ 2025-09-29, 52주). */
export const BASELINE_FROM = "2024-10-01";
export const BASELINE_TO = "2025-09-30";
export const MA_WEEKS = 4;
export const YOY_WEEKS = 13;
/** 이 이름의 묶음은 비교군(회색 선). 나머지 묶음은 카테고리 버튼이 된다. */
export const COMPARE_GROUPS = ["건강 일반어", "무관 일반어"];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 파일 형식(다른 작업이 이 형식으로 채운다. 바꾸지 말 것) */
export interface SearchDemandFile {
  collectedAt: string;
  anchor: string;
  source: string;
  groups: Record<string, string[]>;
  /** index 가 null = 데이터랩이 기준 미만이라 뺀 주(0 이 아님). 빈칸으로 다룬다. */
  rows: { week: string; term: string; query: number; index: number | null; anchorScaled: number | null; partial?: boolean }[];
}

export interface TermSeries {
  term: string;
  group: string;
  /** 주별 지수(기준 기간 평균 = 100). weeks 와 같은 길이, 없는 주는 null */
  index: (number | null)[];
  /** 4주 이동평균(직전 4주가 다 있을 때만) */
  ma: (number | null)[];
  /** 최근 13주 전년 동기 대비(소수, -0.71 = -71%). 계산 못 하면 null */
  yoy: number | null;
  /** 쓴 조회 번호 */
  query?: number;
}

export interface GroupInfo { id: string; label: string; kind: "category" | "compare"; terms: string[] }

export interface SearchDemand {
  ready: true;
  collectedAt: string;
  source: string;
  anchor: string;
  weeks: string[];
  latestWeek: string;
  /** 진행 중이라 뺀 주 */
  partialWeeks: string[];
  baseline: { from: string; to: string };
  yoyWindow: { from: string; to: string; priorFrom: string; priorTo: string };
  groups: GroupInfo[];
  terms: TermSeries[];
  compare: TermSeries[];
  /** groups 에 없는데 rows 에 있는 검색어(화면에서 뺐다) */
  ungrouped: string[];
}

export type SearchDemandResult =
  | SearchDemand
  | { ready: false; notice: string; reason: "missing" | "empty" | "invalid"; collectedAt: string | null };

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

export function movingAverage(xs: (number | null)[], n = MA_WEEKS): (number | null)[] {
  return xs.map((_, i) => {
    if (i < n - 1) return null;
    const win = xs.slice(i - n + 1, i + 1);
    return win.every((v) => v !== null) ? (win as number[]).reduce((s, v) => s + v, 0) / n : null;
  });
}

/** 지수: 첫 52개 값(있는 것)의 평균을 100 으로. 평균이 0 이면 전부 null. */
export function toIndex(raw: (number | null)[], baseMask: boolean[]): (number | null)[] {
  const base = mean(raw.filter((v, i): v is number => baseMask[i] && v !== null));
  if (!base) return raw.map(() => null);
  return raw.map((v) => (v === null ? null : (v / base) * 100));
}

/** 최근 13주 합 ÷ 52주 전 같은 13주 합 - 1. 어느 쪽이든 빈 주가 있으면 null(비교가 성립 안 함). */
export function yoyRecent(raw: (number | null)[], weeks = YOY_WEEKS): number | null {
  const startIdx = raw.length - weeks;
  const priorStart = startIdx - 52;
  if (priorStart < 0) return null;
  const cur = raw.slice(startIdx);
  const prior = raw.slice(priorStart, priorStart + weeks);
  if (cur.some((v) => v === null) || prior.some((v) => v === null)) return null;
  const p = (prior as number[]).reduce((s, v) => s + v, 0);
  if (p <= 0) return null;
  return (cur as number[]).reduce((s, v) => s + v, 0) / p - 1;
}

type Row = SearchDemandFile["rows"][number];

/**
 * 한 검색어가 여러 조회에 있으면(앵커 영양제는 모든 조회에, 해상도 확보용 단독 조회 등) 하나만 쓴다.
 * 주가 가장 많은 조회 → 같으면 원지수 최댓값이 큰 조회(작은 값이 덜 눌린 쪽, 해상도가 좋다) → 번호 작은 조회.
 */
export function pickQuery(rows: Row[]): number {
  const by = new Map<number, { n: number; max: number }>();
  for (const r of rows) {
    const s = by.get(r.query) ?? { n: 0, max: 0 };
    by.set(r.query, { n: s.n + 1, max: Math.max(s.max, r.index ?? 0) });
  }
  return [...by].sort((a, b) => b[1].n - a[1].n || b[1].max - a[1].max || a[0] - b[0])[0][0];
}

/** 파일 모양 점검. 틀리면 무엇이 틀렸는지 문장으로. */
export function validateFile(f: unknown): string | null {
  if (!f || typeof f !== "object") return "JSON 객체가 아닙니다";
  const o = f as Partial<SearchDemandFile>;
  if (typeof o.collectedAt !== "string" || !DATE_RE.test(o.collectedAt)) return "collectedAt 은 YYYY-MM-DD";
  if (!o.groups || typeof o.groups !== "object") return "groups 가 없습니다";
  if (!Array.isArray(o.rows)) return "rows 가 배열이 아닙니다";
  const bad = o.rows.findIndex((r) => !r || !DATE_RE.test(String(r.week)) || typeof r.term !== "string"
    || typeof r.query !== "number" || !(r.index === null || (typeof r.index === "number" && Number.isFinite(r.index))));
  if (bad >= 0) return `rows[${bad}] 형식이 틀렸습니다(week·term·query·index)`;
  const notMonday = o.rows.findIndex((r) => new Date(`${r.week}T00:00:00Z`).getUTCDay() !== 1);
  return notMonday >= 0 ? `rows[${notMonday}] week ${o.rows[notMonday].week} 가 월요일(주 시작)이 아닙니다` : null;
}

function averageLines(lines: (number | null)[][], len: number): (number | null)[] {
  return Array.from({ length: len }, (_, i) => mean(lines.map((l) => l[i]).filter((v): v is number => v !== null)));
}

/** 파일 → 화면 데이터. 쓸 행이 없으면 null. 파일 모양은 validateFile 로 먼저 본다. */
export function buildSearchDemand(file: SearchDemandFile): SearchDemand | null {
  const isPartial = (r: Row) => !!r.partial || addDays(r.week, 6) >= file.collectedAt;
  const full = file.rows.filter((r) => !isPartial(r));
  const partialWeeks = [...new Set(file.rows.filter(isPartial).map((r) => r.week))].sort();
  const grouped = new Map<string, string>();
  const groups: GroupInfo[] = [];
  for (const [label, members] of Object.entries(file.groups || {})) {
    const terms = (members || []).filter((t) => !grouped.has(t) && full.some((r) => r.term === t));
    terms.forEach((t) => grouped.set(t, label));
    if (terms.length) groups.push({ id: label, label, kind: COMPARE_GROUPS.includes(label) ? "compare" : "category", terms });
  }
  const ungrouped = [...new Set(full.map((r) => r.term).filter((t) => !grouped.has(t)))].sort();
  const usable = full.filter((r) => grouped.has(r.term));
  if (usable.length === 0) return null;

  const seen = usable.map((r) => r.week).sort();
  const weeks: string[] = [];
  for (let w = seen[0]; w <= seen[seen.length - 1]; w = addDays(w, 7)) weeks.push(w);
  const pos = new Map(weeks.map((w, i) => [w, i]));
  const baseMask = weeks.map((w) => w >= BASELINE_FROM && w <= BASELINE_TO);
  const baseWeeks = weeks.filter((_, i) => baseMask[i]);
  const order = groups.flatMap((g) => g.terms);
  const terms: TermSeries[] = order.map((term) => {
    const mine = usable.filter((r) => r.term === term);
    const query = pickQuery(mine);
    const raw: (number | null)[] = weeks.map(() => null);
    for (const r of mine) if (r.query === query) raw[pos.get(r.week)!] = r.index;
    const index = toIndex(raw, baseMask);
    return { term, group: grouped.get(term)!, query, index, ma: movingAverage(index), yoy: yoyRecent(raw) };
  });

  const compare: TermSeries[] = groups.filter((g) => g.kind === "compare").map((g) => {
    const members = terms.filter((t) => t.group === g.id);
    const index = averageLines(members.map((t) => t.index), weeks.length);
    const yoys = members.map((t) => t.yoy).filter((v): v is number => v !== null);
    return { term: `${g.label} 평균`, group: g.id, index, ma: movingAverage(index), yoy: yoys.length === members.length ? mean(yoys) : null };
  });

  const latestWeek = weeks[weeks.length - 1];
  const yoyFrom = weeks[Math.max(0, weeks.length - YOY_WEEKS)];
  return {
    ready: true,
    collectedAt: file.collectedAt,
    source: file.source || "네이버 데이터랩 검색어트렌드",
    anchor: file.anchor || "",
    weeks,
    latestWeek,
    partialWeeks,
    baseline: { from: baseWeeks[0] ?? BASELINE_FROM, to: baseWeeks[baseWeeks.length - 1] ?? BASELINE_TO },
    yoyWindow: { from: yoyFrom, to: latestWeek, priorFrom: addDays(yoyFrom, -364), priorTo: addDays(latestWeek, -364) },
    groups,
    terms,
    compare,
    ungrouped,
  };
}
