// "판단용" 그래프 3종의 계산 규칙 (2026-11-03).
//
// 화면 코드와 분리해 둔 순수 함수들이다. 규칙(문턱값)은 전부 여기 상수로 두고,
// 화면은 이 상수로 규칙 문장을 만들어 카드 아래에 그대로 보여 준다. 숫자를 화면에 따로 적지 않는다.
//
//  1) 관리도: 일별 구매 전환율이 평균 ±3σ 밖으로 나간 날만 강조한다.
//  2) 스몰 멀티플: 네이버 검색광고 캠페인별 주간 추이에서 "최근 몇 주가 눈에 띄게 낮아진" 캠페인만 강조한다.
//  3) 채널별 매출 구성: 직전 구간들보다 비중이 가장 크게 움직인 판매처 하나만 강조한다.

/* ───────────────────────── 1. 관리도 ───────────────────────── */

/** 이 날수보다 기준 표본이 적으면 평균·σ 가 흔들려 이탈 판정을 하지 않는다. */
export const CONTROL_MIN_DAYS = 14;
/** 관리 한계 폭(σ 배수). */
export const CONTROL_SIGMA = 3;

export interface ControlDayInput {
  date: string;
  /** 유입(세션). null = 그날 유입 행이 없다(미수집). */
  sessions: number | null;
  /** 같은 원천의 구매(주문) 수. */
  orders: number;
}

export type ControlStatus = "in" | "out" | "excluded";

export interface ControlPoint {
  date: string;
  /** 전환율(%) — 판정에서 뺀 날은 null(점을 그리지 않는다). */
  rate: number | null;
  status: ControlStatus;
  /** 판정에서 뺀 이유. status === "excluded" 일 때만. */
  reason?: "no_sessions" | "sales_pending" | "today";
  sessions: number | null;
  orders: number | null;
}

export interface ControlResult {
  points: ControlPoint[];
  /** 기준 표본 수(판정에 쓴 날). */
  n: number;
  mean: number | null;
  sigma: number | null;
  ucl: number | null;
  /** 0 미만이면 null. 하한이 없으면 "하락 이탈" 판정이 불가능하다는 뜻이다. */
  lcl: number | null;
  /** 표본이 CONTROL_MIN_DAYS 이상이라 한계선을 그릴 수 있는지. */
  enough: boolean;
}

/**
 * 일별 전환율 관리도.
 *
 * ★ 판정에서 빼는 날(점도 안 그린다):
 *   - 유입이 0 이거나 행이 없는 날: 분모가 없어 전환율이 성립하지 않는다.
 *   - 판매 동기화가 아직 안 들어온 날(salesLastDate 이후): 구매가 0 으로 읽혀 전부 −3σ 이탈로 잘못 뜬다.
 *   - 오늘: 하루가 안 끝났다.
 * 축(날짜)은 연속으로 유지하고 그 자리만 비운다.
 */
export function buildControlChart(
  axis: string[],
  days: ControlDayInput[],
  opts: { salesLastDate: string | null; today: string },
): ControlResult {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const base: ControlPoint[] = axis.map((date) => {
    const d = byDate.get(date);
    const sessions = d?.sessions ?? null;
    const orders = d ? d.orders : 0;
    if (date >= opts.today) return { date, rate: null, status: "excluded", reason: "today", sessions, orders: null };
    if (!opts.salesLastDate || date > opts.salesLastDate) {
      return { date, rate: null, status: "excluded", reason: "sales_pending", sessions, orders: null };
    }
    if (!sessions || sessions <= 0) return { date, rate: null, status: "excluded", reason: "no_sessions", sessions, orders };
    return { date, rate: (orders / sessions) * 100, status: "in", sessions, orders };
  });

  const rates = base.filter((p) => p.rate != null).map((p) => p.rate as number);
  const n = rates.length;
  if (n === 0) return { points: base, n, mean: null, sigma: null, ucl: null, lcl: null, enough: false };

  const mean = rates.reduce((s, v) => s + v, 0) / n;
  // 표본 표준편차(n−1). 하루짜리면 σ 를 정할 수 없다.
  const sigma = n > 1 ? Math.sqrt(rates.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : null;
  const enough = n >= CONTROL_MIN_DAYS && sigma != null;
  const ucl = sigma != null ? mean + CONTROL_SIGMA * sigma : null;
  const rawLcl = sigma != null ? mean - CONTROL_SIGMA * sigma : null;
  const lcl = rawLcl != null && rawLcl > 0 ? rawLcl : null;

  const points = base.map((p) => {
    if (!enough || p.rate == null || ucl == null) return p;
    const out = p.rate > ucl || (lcl != null && p.rate < lcl);
    return out ? { ...p, status: "out" as const } : p;
  });
  return { points, n, mean, sigma, ucl, lcl, enough };
}

/* ───────────────────────── 2. 스몰 멀티플 ───────────────────────── */

/** 격자에 그리는 주 수(진행 중인 주 제외, 다 끝난 주만). */
export const MULTIPLE_WEEKS = 12;
/** "최근" 으로 보는 주 수. */
export const MULTIPLE_RECENT_WEEKS = 4;
/** 최근 평균이 전체 평균보다 이 비율(%) 이상 낮으면 하락으로 본다. */
export const MULTIPLE_DROP_PCT = 30;
/** 12주 합계 비용이 이보다 작은 캠페인은 격자에서 뺀다(작은 비용의 비율은 출렁임이 커서 판단 재료가 못 된다). */
export const MULTIPLE_MIN_COST = 50_000;

export type MultipleMetric = "roas" | "cost";

export interface WeekCell {
  /** 그 주 월요일(YYYY-MM-DD). */
  week: string;
  cost: number;
  convValue: number;
}

/** 주별 값. ROAS 는 비용 0 인 주가 null(선이 끊긴다). 비용은 0 그대로. */
export function weekValue(c: WeekCell, metric: MultipleMetric): number | null {
  if (metric === "cost") return c.cost;
  return c.cost > 0 ? c.convValue / c.cost : null;
}

/** 구간 값. ROAS 는 비용 가중(합계 전환값 ÷ 합계 비용), 비용은 주 평균. */
function windowValue(cells: WeekCell[], metric: MultipleMetric): number | null {
  if (!cells.length) return null;
  const cost = cells.reduce((s, c) => s + c.cost, 0);
  if (metric === "cost") return cost / cells.length;
  const cv = cells.reduce((s, c) => s + c.convValue, 0);
  return cost > 0 ? cv / cost : null;
}

export interface MultipleVerdict {
  base: number | null;
  recent: number | null;
  /** 최근 평균이 전체 평균보다 몇 % 낮은지(양수 = 낮아짐). */
  dropPct: number | null;
  lastFell: boolean;
  flagged: boolean;
}

/**
 * 강조 규칙: 최근 MULTIPLE_RECENT_WEEKS 주 평균이 MULTIPLE_WEEKS 주 평균보다 MULTIPLE_DROP_PCT% 이상 낮고,
 * 마지막 주 값이 그 앞주보다 낮다. 둘 중 하나라도 계산할 수 없으면 강조하지 않는다.
 */
export function judgeMultiple(cells: WeekCell[], metric: MultipleMetric): MultipleVerdict {
  const base = windowValue(cells, metric);
  const recent = windowValue(cells.slice(-MULTIPLE_RECENT_WEEKS), metric);
  const last = cells.length >= 1 ? weekValue(cells[cells.length - 1], metric) : null;
  const prev = cells.length >= 2 ? weekValue(cells[cells.length - 2], metric) : null;
  const dropPct = base != null && recent != null && base > 0 ? ((base - recent) / base) * 100 : null;
  const lastFell = last != null && prev != null && last < prev;
  return { base, recent, dropPct, lastFell, flagged: dropPct != null && dropPct >= MULTIPLE_DROP_PCT && lastFell };
}

/* ───────────────────────── 3. 채널별 매출 구성 ───────────────────────── */

/** 비중 비교에 쓰는 직전 구간 수. */
export const SHARE_LOOKBACK = 4;
/** 비중이 이만큼(%p) 이상 움직여야 강조한다. 이보다 작으면 아무 채널도 칠하지 않는다. */
export const SHARE_MIN_SHIFT_PP = 3;

export interface ShareShift {
  channel: string;
  /** 직전 구간 평균 비중 대비 마지막 완료 구간 비중 변화(%p). */
  shiftPp: number;
}

/**
 * 마지막 "완료" 구간의 판매처 비중을 직전 SHARE_LOOKBACK 개 완료 구간의 합계 비중과 비교해
 * 가장 크게 움직인 판매처 하나를 고른다. 완료 구간이 2개 미만이거나 움직임이 SHARE_MIN_SHIFT_PP 미만이면 null.
 */
export function biggestShareShift(
  buckets: { complete: boolean; byChannel: Record<string, number> }[],
): ShareShift | null {
  const done = buckets.filter((b) => b.complete);
  if (done.length < 2) return null;
  const last = done[done.length - 1];
  const prior = done.slice(-1 - SHARE_LOOKBACK, -1);
  const share = (m: Record<string, number>) => {
    const tot = Object.values(m).reduce((s, v) => s + v, 0);
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(m)) out[k] = tot > 0 ? (v / tot) * 100 : 0;
    return out;
  };
  const priorSum: Record<string, number> = {};
  for (const b of prior) for (const [k, v] of Object.entries(b.byChannel)) priorSum[k] = (priorSum[k] || 0) + v;
  const before = share(priorSum);
  const after = share(last.byChannel);
  let best: ShareShift | null = null;
  for (const ch of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const shiftPp = (after[ch] || 0) - (before[ch] || 0);
    if (!best || Math.abs(shiftPp) > Math.abs(best.shiftPp)) best = { channel: ch, shiftPp };
  }
  return best && Math.abs(best.shiftPp) >= SHARE_MIN_SHIFT_PP ? best : null;
}
