// 새 그래프 6종(2026-11-10)의 계산 부분. 화면 컴포넌트는 그리기만 하고 숫자·판정은 여기서 낸다.
// node --test 가 이 파일을 그대로 불러 시험한다(scripts/tests/chart-math.test.mjs). 그래서 "@/..." 별칭 import 를 쓰지 않는다.

// ── 파레토 ───────────────────────────────────────────────────────────────────
export const PARETO_LINE = 80;
export interface ParetoItem { key: string; label: string; value: number; sub?: string }
export interface ParetoRow extends ParetoItem { rank: number; share: number; /** 표시용(소수 한 자리) */ cum: number; /** 판정용(반올림 전) */ cumRaw: number }

/** 0원·음수는 빼고 큰 순으로 세운 뒤 누적 비중을 붙인다. reachCount = 누적이 처음 80% 이상이 되는 순위(반올림 전 값으로 판정). */
export function buildPareto(items: readonly ParetoItem[]): { rows: ParetoRow[]; total: number; reachCount: number } {
  const sorted = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
  const total = sorted.reduce((s, i) => s + i.value, 0);
  let acc = 0;
  const rows = sorted.map((i, idx) => {
    acc += i.value;
    const cumRaw = total > 0 ? (acc / total) * 100 : 0;
    return { ...i, rank: idx + 1, cumRaw, cum: Math.round(cumRaw * 10) / 10, share: total > 0 ? (i.value / total) * 100 : 0 };
  });
  const reach = rows.find((r) => r.cumRaw >= PARETO_LINE);
  return { rows, total, reachCount: reach ? reach.rank : rows.length };
}

// ── 워터폴 ───────────────────────────────────────────────────────────────────
export interface WaterfallStep {
  key: string;
  label: string;
  /** 금액(원). start = 시작 합계, minus = 빼는 항목(음수면 환입이라 더해진다), result = 남은 값(부호 그대로) */
  amount: number;
  kind: "start" | "minus" | "result";
  note?: string;
}
export type WaterfallTone = "start" | "minus" | "plus" | "loss";
export interface WaterfallRow extends WaterfallStep {
  /** [아래, 위] 범위 막대 */
  range: [number, number];
  /** 이 막대를 지나고 난 높이 */
  end: number;
  /** 매출(시작) 대비 % (매출 0 이면 null) */
  share: number | null;
  tone: WaterfallTone;
  /** 빼는 항목인데 음수라 더해진 칸(환입) */
  added: boolean;
}

export function waterfallRows(steps: readonly WaterfallStep[]): WaterfallRow[] {
  const start = steps.find((s) => s.kind === "start")?.amount || 0;
  let run = 0;
  return steps.map((s) => {
    let end: number;
    if (s.kind === "start") end = s.amount;
    else if (s.kind === "minus") end = run - s.amount;
    else end = s.amount;
    const from = s.kind === "minus" ? run : 0;
    const range: [number, number] = [Math.min(from, end), Math.max(from, end)];
    const added = s.kind === "minus" && s.amount < 0;
    const tone: WaterfallTone = s.kind === "start" ? "start"
      : s.kind === "minus" ? (added ? "plus" : "minus")
      : s.amount >= 0 ? "plus" : "loss";
    run = end;
    return { ...s, range, end, share: start > 0 ? (s.amount / start) * 100 : null, tone, added };
  });
}

/** 막대 위 만 원 라벨. 빼는 항목은 「−2,623만」, 환입은 「+0.5만」, 0 은 「0」 */
export function waterfallLabel(r: Pick<WaterfallRow, "amount" | "kind">): string {
  if (r.amount === 0) return "0";
  const m = Math.abs(r.amount) / 10000;
  const body = `${m >= 100 ? Math.round(m).toLocaleString("ko-KR") : m.toFixed(1)}만`;
  if (r.kind === "minus") return r.amount > 0 ? `−${body}` : `+${body}`;
  return r.amount < 0 ? `−${body}` : body;
}

// ── 달력(캘린더 히트맵) ──────────────────────────────────────────────────────
export function addDays(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
/** 월요일 = 0 ... 일요일 = 6 */
export function weekdayMon(d: string): number {
  return (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
}
/** 기간 날짜(오름차순)를 월요일 시작 주로 묶는다. 기간 밖 칸은 null. */
export function calendarWeeks(dates: readonly string[]): (string | null)[][] {
  if (!dates.length) return [];
  const inRange = new Set(dates);
  const first = dates[0];
  const last = dates[dates.length - 1];
  const out: (string | null)[][] = [];
  for (let s = addDays(first, -weekdayMon(first)); s <= last; s = addDays(s, 7)) {
    out.push(Array.from({ length: 7 }, (_, i) => { const d = addDays(s, i); return inRange.has(d) ? d : null; }));
  }
  return out;
}
/**
 * 빗금(판매 동기화 대기)이 시작되는 날. 기준은 판매 원장 마지막 날(서버 fetchSalesThrough, 고른 기간과 무관).
 *  - through 가 null(원장에 행이 없음) 이면 기간 전체가 대기
 *  - through 이후 날짜가 기간 안에 없으면 null(빗금 없음). 끝난 기간의 판매 없는 날은 0원 칸이다
 */
export function calendarPendingFrom(dates: readonly string[], through: string | null): string | null {
  if (!dates.length) return null;
  if (!through) return dates[0];
  return dates.find((d) => d > through) ?? null;
}

// ── 퍼널 막대 ────────────────────────────────────────────────────────────────
export interface FunnelStage { key: string; label: string; value: number }
export const FUNNEL_MIN_W = 0.6;
export type FunnelModel =
  | { ok: true; rows: { key: string; label: string; value: number; width: number; ofFirst: number; drop: number | null; next: string | null }[] }
  | { ok: false; reason: string };

/** 단계가 앞 단계보다 크면(수집 기준이 어긋남) 그리지 않는다. 폭은 100% 상한, 이탈률은 0 이상. */
export function funnelModel(stages: readonly FunnelStage[]): FunnelModel {
  const first = stages[0]?.value || 0;
  if (stages.length < 2 || first <= 0) return { ok: false, reason: "첫 단계 값이 없어 그리지 않습니다" };
  for (let i = 1; i < stages.length; i++) {
    if (stages[i].value > stages[i - 1].value) {
      return { ok: false, reason: `${stages[i].label}(${stages[i].value.toLocaleString("ko-KR")})이 ${stages[i - 1].label}(${stages[i - 1].value.toLocaleString("ko-KR")})보다 많아 같은 기준으로 센 단계가 아닙니다. 막대를 그리지 않습니다` };
    }
  }
  return {
    ok: true,
    rows: stages.map((s, i) => {
      const next = stages[i + 1];
      const ofFirst = (s.value / first) * 100;
      return {
        key: s.key, label: s.label, value: s.value, ofFirst,
        width: Math.min(100, Math.max(FUNNEL_MIN_W, ofFirst)),
        drop: next && s.value > 0 ? Math.max(0, (1 - next.value / s.value) * 100) : null,
        next: next ? next.label : null,
      };
    }),
  };
}

// ── 판매처 비교(카드 ▲▼ 와 덤벨이 같은 두 점을 쓰게) ───────────────────────
export interface StoreCmp { revenue: number; adSpend: number; roas: number | null; prevRevenue: number; prevAdSpend: number; prevRoas: number | null }

/** 판매 집계일까지·같은 길이로 자른 두 기간 값으로 카드 증감률과 덤벨 두 점을 함께 만든다(/api/channel-groups). */
export function storeCompare(v: { revenueToSales: number; adSpendToSales: number; prevRevCut: number; prevAdCut: number }) {
  const roasToSales = v.adSpendToSales > 0 ? v.revenueToSales / v.adSpendToSales : 0;
  const prevRoasCut = v.prevAdCut > 0 ? v.prevRevCut / v.prevAdCut : 0;
  const cmp: StoreCmp = {
    revenue: v.revenueToSales, adSpend: v.adSpendToSales, roas: v.adSpendToSales > 0 ? roasToSales : null,
    prevRevenue: v.prevRevCut, prevAdSpend: v.prevAdCut, prevRoas: v.prevAdCut > 0 ? prevRoasCut : null,
  };
  return {
    roasToSales,
    revDelta: v.prevRevCut > 0 ? ((v.revenueToSales / v.prevRevCut) - 1) * 100 : null,
    roasDelta: prevRoasCut > 0 && v.adSpendToSales > 0 ? ((roasToSales / prevRoasCut) - 1) * 100 : null,
    cmp,
  };
}

/** 덤벨 ROAS 한 줄: 두 기간 모두 광고비가 minCost 이상일 때만 점을 찍는다. 아니면 사실대로 이유. */
export function dumbbellRoas(c: StoreCmp, minCost: number): { prev: number | null; cur: number | null; missingNote?: string } {
  const won = (n: number) => `${(n / 10000).toLocaleString("ko-KR")}만 원`;
  if (c.prevAdSpend <= 0 && c.adSpend <= 0) return { prev: null, cur: null, missingNote: "광고비 0 (직전·이번)" };
  if (c.adSpend <= 0) return { prev: null, cur: null, missingNote: "광고비 0 (이번)" };
  if (c.prevAdSpend <= 0) return { prev: null, cur: null, missingNote: "광고비 0 (직전)" };
  const smallPrev = c.prevAdSpend < minCost, smallCur = c.adSpend < minCost;
  if (smallPrev || smallCur) {
    const which = smallPrev && smallCur ? "직전·이번" : smallPrev ? "직전" : "이번";
    return { prev: null, cur: null, missingNote: `광고비 ${won(minCost)} 미만 (${which})` };
  }
  return { prev: c.prevRoas, cur: c.roas };
}

// ── 툴팁 합계 · 범례로 골라 보기 (2026-11-12) ─────────────────────────────────
// 김호: "합산 그래프는 마우스오버했을 때 총합도 보이게", "범례 클릭하면 선택해서 보게".
// 그리기는 chart-style.tsx(TotalTooltip · ToggleLegend · useSeriesToggle), 숫자 판단은 여기서 한다.

export const TOTAL_LABEL = "합계";
export const VISIBLE_TOTAL_LABEL = "보이는 항목 합계";

/** 합계에 넣을 수 있는 값만 숫자로. null·undefined·NaN·숫자 아닌 값은 null(0 으로 바꾸지 않는다) */
export function finiteOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export interface SeriesTotal {
  /** 보이는 합산 계열 값의 합. 보이는 계열 값이 전부 null 이면 null(「-」로 찍는다) */
  value: number | null;
  /** 「합계」 또는 「보이는 항목 합계」 */
  label: string;
  /** 합산 대상 가운데 범례로 숨긴 계열 수 */
  hiddenCount: number;
  /** 합에 실제로 들어간(값이 있는) 계열 수 */
  counted: number;
}

/**
 * 한 칸(행)의 툴팁 합계.
 *  - sumKeys: 더해서 뜻이 있는 계열만(화면이 정한다). 비율·다른 단위 계열은 넣지 않는다
 *  - hidden: 범례로 숨긴 계열. sumKeys 밖 계열(예: 매출 막대 위 광고비 선)을 숨겨도 라벨은 「합계」 그대로
 *  - 일부 null 이면 있는 값만 더한다. 전부 null 이면 value=null
 *  - 합산 대상이 없거나 전부 숨겨졌으면 null(합계 줄을 그리지 않는다)
 */
export function seriesTotal(
  row: Readonly<Record<string, unknown>> | null | undefined,
  sumKeys: readonly string[],
  hidden: readonly string[] = [],
  base: string = TOTAL_LABEL,
  visibleBase: string = VISIBLE_TOTAL_LABEL,
): SeriesTotal | null {
  if (!sumKeys.length) return null;
  const hide = new Set(hidden);
  const shown = sumKeys.filter((k) => !hide.has(k));
  if (!shown.length) return null;
  const hiddenCount = sumKeys.length - shown.length;
  let sum = 0;
  let counted = 0;
  for (const k of shown) {
    const v = finiteOrNull(row?.[k]);
    if (v == null) continue;
    sum += v;
    counted += 1;
  }
  return { value: counted > 0 ? sum : null, label: hiddenCount > 0 ? visibleBase : base, hiddenCount, counted };
}

/** 보이는 계열(원래 순서 그대로) */
export function visibleKeys(keys: readonly string[], hidden: readonly string[]): string[] {
  const hide = new Set(hidden);
  return keys.filter((k) => !hide.has(k));
}

/** 쌓은 막대에서 위쪽 모서리를 둥글게 할 계열 = 보이는 것 가운데 맨 위(마지막) */
export function topVisibleKey(keys: readonly string[], hidden: readonly string[]): string | null {
  const v = visibleKeys(keys, hidden);
  return v.length ? v[v.length - 1] : null;
}

/**
 * 범례 한 항목을 눌렀을 때의 새 숨김 목록(원래 배열은 건드리지 않는다).
 *  - 숨긴 것을 누르면 다시 보인다
 *  - 보이는 계열이 그것 하나뿐이면 숨기지 않는다(빈 그래프 방지) → 같은 배열을 그대로 돌려준다
 *  - keys 에 없는 키는 무시한다
 */
export function toggleHidden(hidden: readonly string[], key: string, keys: readonly string[]): readonly string[] {
  if (!keys.includes(key)) return hidden;
  if (hidden.includes(key)) return hidden.filter((k) => k !== key);
  if (visibleKeys(keys, hidden).length <= 1) return hidden;
  return [...hidden, key];
}

/** 이 항목을 눌러도 숨길 수 없나(보이는 마지막 하나) */
export function isLastVisible(hidden: readonly string[], key: string, keys: readonly string[]): boolean {
  const v = visibleKeys(keys, hidden);
  return v.length === 1 && v[0] === key;
}

/**
 * 계열 목록이 바뀌었을 때(브랜드·기간·차원 필터) 숨김 목록 정리: 없는 키는 빼고,
 * 남은 계열이 전부 숨김이면 모두 보이게 되돌린다. 바뀐 게 없으면 같은 배열을 돌려준다(리렌더 방지).
 */
export function pruneHidden(hidden: readonly string[], keys: readonly string[]): readonly string[] {
  if (!hidden.length) return hidden;
  const present = new Set(keys);
  const kept = hidden.filter((k) => present.has(k));
  const next = keys.length > 0 && kept.length >= keys.length ? [] : kept;
  return next.length === hidden.length ? hidden : next;
}
