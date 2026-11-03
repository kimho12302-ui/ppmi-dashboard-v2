// "판단용" 그래프 3종의 계산 규칙 (2026-11-03).
//
// 화면 코드와 분리해 둔 순수 함수들이다. 규칙(문턱값)은 전부 여기 상수로 두고,
// 화면은 이 상수로 규칙 문장을 만들어 카드 아래에 그대로 보여 준다. 숫자를 화면에 따로 적지 않는다.
//
//  1) 관리도: 일별 구매 전환율이 날짜별 한계(Laney p′) 밖으로 나간 날과, 8일 연속 한쪽에 머문 구간만 강조한다.
//  2) 스몰 멀티플: 네이버 검색광고 캠페인별 주간 추이에서 "최근 몇 주가 눈에 띄게 낮아진" 캠페인만 강조한다.
//  3) 채널별 매출 구성: 직전 구간들보다 비중이 가장 크게 움직인 판매처 하나만 강조한다.

/* ───────────────────────── 1. 관리도 ───────────────────────── */
//
// 방식: Laney p′ 관리도 (2026-11-03 교체).
//   옛 방식(일별 전환율의 평균 ±3σ 수평선)은 원천 4개 모두 −3σ 가 0% 아래라 하락을 하나도 못 잡았다.
//   날마다 유입 수가 달라 유입이 많은 날은 전환율이 덜 흔들리고 적은 날은 더 흔들린다. 그래서 한계선을
//   날마다 다르게 긋는 p-관리도를 쓴다. 다만 실제 전환율은 이항분포보다 넓게 퍼져 있어(σz 실측 1.5~1.8)
//   순수 p-관리도는 정상인 날도 이탈로 잡는다(펫 스마트스토어 90일 중 12일). Laney 보정으로 그 퍼짐을 넣는다.
//     p̄ = 판정 가능한 날의 구매 합 ÷ 유입 합
//     σp_i = √(p̄(1−p̄)/유입_i),  z_i = (p_i − p̄)/σp_i
//     σz = z 의 평균 이동범위 ÷ 1.128
//     한계_i = p̄ ± 3·σp_i·σz
//   2026-08-01~11-03 실측: 하한이 0% 위로 올라오는 날이 펫 스마트스토어 82/90일, 쿠팡 12/33일 생겼다.
//   밸런스랩·펫 카페24 는 하루 구매가 0~2건이라 어느 방식으로도 하한이 생기지 않는다(연속 규칙으로 본다).

/** 이 날수보다 기준 표본이 적으면 p̄·σz 가 흔들려 이탈 판정을 하지 않는다. */
export const CONTROL_MIN_DAYS = 14;
/** 관리 한계 폭(σ 배수). */
export const CONTROL_SIGMA = 3;
/** 이동범위 → 표준편차 환산 상수(d2, 표본 2개). */
const D2 = 1.128;
/**
 * 같은 원천의 유입 대비 구매가 이 비율(%) 이상이면 수집 오류로 보고 판정에서 뺀다.
 * 실측: 쿠팡 2026-09-30 구매 88 ÷ 유입 89 = 98.9%. 이런 날 하나가 한계를 키워 다른 날의 이탈을 다 가렸다.
 */
export const CONTROL_IMPLAUSIBLE_RATE = 50;
/**
 * 연속 규칙: 판정 가능한 날 기준 이만큼 연속으로 중심선(p̄) 한쪽에 있으면 그 구간을 강조한다.
 * 하루하루는 한계 안이어도 꾸준히 낮아진 것(수준 변화)을 잡는다. 제외한 날은 건너뛴다(끊지도 잇지도 않음).
 */
export const CONTROL_RUN_LENGTH = 8;

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
  reason?: "no_sessions" | "sales_pending" | "today" | "implausible";
  sessions: number | null;
  orders: number | null;
  /** 그날의 상한(%). 판정 가능한 날만. */
  ucl: number | null;
  /** 그날의 하한(%). 0% 이하면 null(그날은 하락 이탈을 판정할 수 없다). */
  lcl: number | null;
}

export interface ControlRun {
  side: "below" | "above";
  /** 판정 가능한 첫날·마지막날(사이에 제외한 날이 끼어 있을 수 있다). */
  start: string;
  end: string;
  days: number;
}

export interface ControlResult {
  points: ControlPoint[];
  /** 기준 표본 수(판정에 쓴 날). */
  n: number;
  /** 중심선 p̄(%). */
  center: number | null;
  /** Laney 보정 계수. 1 이면 이항분포만큼 퍼져 있다는 뜻. */
  sigmaZ: number | null;
  /** 하한이 0% 위로 올라온 날 수(하락 이탈을 판정할 수 있는 날). */
  lclDays: number;
  /** 표본이 CONTROL_MIN_DAYS 이상이라 한계선을 그릴 수 있는지. */
  enough: boolean;
  runs: ControlRun[];
}

/**
 * 연속 규칙. 판정 가능한 점만 차례로 보며 같은 쪽이 CONTROL_RUN_LENGTH 번 이상 이어진 구간을 돌려준다.
 * 중심선과 정확히 같은 점은 어느 쪽도 아니라 건너뛴다.
 */
export function findRuns(points: ControlPoint[], center: number): ControlRun[] {
  const runs: ControlRun[] = [];
  let side: ControlRun["side"] | null = null;
  let start = "", end = "", len = 0;
  const close = () => { if (side && len >= CONTROL_RUN_LENGTH) runs.push({ side, start, end, days: len }); };
  for (const p of points) {
    if (p.rate == null || p.rate === center) continue;
    const s: ControlRun["side"] = p.rate < center ? "below" : "above";
    if (s === side) { end = p.date; len++; continue; }
    close();
    side = s; start = p.date; end = p.date; len = 1;
  }
  close();
  return runs;
}

/**
 * 일별 전환율 관리도(Laney p′).
 *
 * ★ 판정에서 빼는 날(점도 안 그린다):
 *   - 유입이 0 이거나 행이 없는 날: 분모가 없어 전환율이 성립하지 않는다.
 *   - 판매 동기화가 아직 안 들어온 날(salesLastDate 이후): 구매가 0 으로 읽혀 전부 하락 이탈로 잘못 뜬다.
 *   - 오늘: 하루가 안 끝났다.
 *   - 전환율이 CONTROL_IMPLAUSIBLE_RATE 이상인 날: 유입과 구매의 수집 단위가 어긋난 날이다.
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
    const skip = (reason: NonNullable<ControlPoint["reason"]>, o: number | null): ControlPoint =>
      ({ date, rate: null, status: "excluded", reason, sessions, orders: o, ucl: null, lcl: null });
    if (date >= opts.today) return skip("today", null);
    if (!opts.salesLastDate || date > opts.salesLastDate) return skip("sales_pending", null);
    if (!sessions || sessions <= 0) return skip("no_sessions", orders);
    const rate = (orders / sessions) * 100;
    if (rate >= CONTROL_IMPLAUSIBLE_RATE) return skip("implausible", orders);
    return { date, rate, status: "in", sessions, orders, ucl: null, lcl: null };
  });

  const judged = base.filter((p) => p.rate != null);
  const n = judged.length;
  const empty = { points: base, n, center: null, sigmaZ: null, lclDays: 0, enough: false, runs: [] };
  if (n === 0) return empty;

  const sumO = judged.reduce((s, p) => s + (p.orders || 0), 0);
  const sumS = judged.reduce((s, p) => s + (p.sessions || 0), 0);
  const pbar = sumO / sumS;
  const center = pbar * 100;
  // p̄ 가 0 또는 1 이면 이항 σ 가 0 이라 한계를 정할 수 없다(구매가 한 건도 없는 원천).
  if (n < 2 || pbar <= 0 || pbar >= 1) return { ...empty, center };

  const sigmaP = (p: ControlPoint) => Math.sqrt((pbar * (1 - pbar)) / (p.sessions as number));
  const z = judged.map((p) => ((p.rate as number) / 100 - pbar) / sigmaP(p));
  let mr = 0;
  for (let i = 1; i < z.length; i++) mr += Math.abs(z[i] - z[i - 1]);
  const sigmaZ = mr / (z.length - 1) / D2;
  const enough = n >= CONTROL_MIN_DAYS;

  let lclDays = 0;
  const points = base.map((p) => {
    if (p.rate == null) return p;
    const w = CONTROL_SIGMA * sigmaP(p) * sigmaZ * 100;
    const ucl = center + w;
    const lcl = center - w > 0 ? center - w : null;
    if (lcl != null) lclDays++;
    const out = enough && (p.rate > ucl || (lcl != null && p.rate < lcl));
    return { ...p, ucl, lcl, status: out ? ("out" as const) : p.status };
  });
  return { points, n, center, sigmaZ, lclDays, enough, runs: enough ? findRuns(points, center) : [] };
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
  /** 직전 구간 합계 비중 대비 마지막 완료 구간 비중 변화(%p). */
  shiftPp: number;
  /** 비교에 실제로 쓴 직전 완료 구간 수(SHARE_LOOKBACK 이하). */
  priorCount: number;
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
    if (!best || Math.abs(shiftPp) > Math.abs(best.shiftPp)) best = { channel: ch, shiftPp, priorCount: prior.length };
  }
  return best && Math.abs(best.shiftPp) >= SHARE_MIN_SHIFT_PP ? best : null;
}
