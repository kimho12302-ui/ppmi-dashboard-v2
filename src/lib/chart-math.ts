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
