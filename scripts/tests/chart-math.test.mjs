// npm test  (= node --test scripts/tests/*.test.mjs)
// 새 그래프 6종(2026-11-10)의 계산 부분 src/lib/chart-math.ts 를 그대로 불러 시험한다(node 형 지우기, 22.18+).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPareto, PARETO_LINE,
  waterfallRows, waterfallLabel,
  calendarWeeks, calendarPendingFrom, weekdayMon,
  funnelModel, FUNNEL_MIN_W,
  storeCompare, dumbbellRoas,
} from "../../src/lib/chart-math.ts";

// ── 파레토 ───────────────────────────────────────────────────────────────────
test("파레토: 0원·음수는 빼고 큰 순으로, 같은 값은 키 순", () => {
  const { rows, total } = buildPareto([
    { key: "c", label: "C", value: 10 }, { key: "a", label: "A", value: 0 },
    { key: "b", label: "B", value: 30 }, { key: "d", label: "D", value: -5 }, { key: "e", label: "E", value: 10 },
  ]);
  assert.deepEqual(rows.map((r) => r.key), ["b", "c", "e"]);
  assert.equal(total, 50);
  assert.deepEqual(rows.map((r) => r.rank), [1, 2, 3]);
  assert.equal(rows[2].cumRaw, 100);
});

test("파레토: 80% 경계는 반올림 전 값으로 판정", () => {
  // 79.96% 는 표시로는 80.0% 이지만 80% 에 닿지 않았다
  const items = [
    { key: "a", label: "a", value: 7996 }, { key: "b", label: "b", value: 2004 },
  ];
  const r = buildPareto(items);
  assert.equal(r.rows[0].cum, 80.0);
  assert.ok(r.rows[0].cumRaw < PARETO_LINE);
  assert.equal(r.reachCount, 2);
  // 정확히 80% 면 그 순위에서 닿는다
  const exact = buildPareto([{ key: "a", label: "a", value: 80 }, { key: "b", label: "b", value: 20 }]);
  assert.equal(exact.reachCount, 1);
});

test("파레토: 비었으면 0개", () => {
  const r = buildPareto([{ key: "a", label: "a", value: 0 }]);
  assert.equal(r.rows.length, 0);
  assert.equal(r.reachCount, 0);
  assert.equal(r.total, 0);
});

// ── 워터폴 ───────────────────────────────────────────────────────────────────
const steps = (profit, extra = []) => [
  { key: "rev", label: "매출", amount: 1000, kind: "start" },
  { key: "cogs", label: "원가", amount: 600, kind: "minus" },
  { key: "ship", label: "배송비", amount: 0, kind: "minus" },
  ...extra,
  { key: "profit", label: "이익", amount: profit, kind: "result" },
];

test("워터폴: 범위가 차례로 내려가고 0원 단계는 높이 0 으로 자리를 지킨다", () => {
  const r = waterfallRows(steps(400));
  assert.deepEqual(r.map((x) => x.range), [[0, 1000], [400, 1000], [400, 400], [0, 400]]);
  assert.deepEqual(r.map((x) => x.end), [1000, 400, 400, 400]);
  assert.equal(r[1].tone, "minus");
  assert.equal(r[3].tone, "plus");
  assert.equal(r[1].share, 60);
  assert.equal(waterfallLabel(r[2]), "0");
});

test("워터폴: 비용이 매출을 넘으면 0 아래로 내려가고 이익은 음수 막대(loss)", () => {
  const r = waterfallRows([
    { key: "rev", label: "매출", amount: 5_000_000, kind: "start" },
    { key: "ad", label: "광고비", amount: 8_000_000, kind: "minus" },
    { key: "profit", label: "이익", amount: -3_000_000, kind: "result" },
  ]);
  assert.deepEqual(r[1].range, [-3_000_000, 5_000_000]);
  assert.deepEqual(r[2].range, [-3_000_000, 0]);
  assert.equal(r[2].tone, "loss");
  assert.equal(waterfallLabel(r[2]), "−300만");
});

test("워터폴: 빼는 항목이 음수(환입)면 더해진 칸으로 위로 올라간다", () => {
  const r = waterfallRows(steps(450, [{ key: "misc", label: "잡비", amount: -5000, kind: "minus" }]).map((s) => (s.key === "profit" ? { ...s, amount: 5400 } : s)));
  const misc = r.find((x) => x.key === "misc");
  assert.equal(misc.added, true);
  assert.equal(misc.tone, "plus");
  assert.deepEqual(misc.range, [400, 5400]);
  assert.equal(waterfallLabel(misc), "+0.5만");
  assert.equal(waterfallLabel({ amount: 26228480, kind: "minus" }), "−2,623만");
});

// ── 달력 ─────────────────────────────────────────────────────────────────────
const range = (from, to) => {
  const out = [];
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
};

test("달력: 월요일 시작, 기간 밖 칸은 비운다", () => {
  assert.equal(weekdayMon("2026-11-09"), 0); // 월
  assert.equal(weekdayMon("2026-11-08"), 6); // 일
  const w = calendarWeeks(range("2026-10-01", "2026-10-12")); // 10/1 = 목
  assert.equal(w.length, 3);
  assert.deepEqual(w[0], [null, null, null, "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
  assert.deepEqual(w[1][0], "2026-10-05");
  assert.deepEqual(w[2], ["2026-10-12", null, null, null, null, null, null]);
  assert.deepEqual(calendarWeeks([]), []);
});

test("달력: 빗금은 원장 마지막 날 뒤만, 끝난 기간의 판매 없는 날은 0원 칸", () => {
  const days = range("2026-10-01", "2026-11-10");
  assert.equal(calendarPendingFrom(days, "2026-11-08"), "2026-11-09");
  // 원장이 기간 끝보다 뒤까지 들어왔으면 빗금 없음(기간 끝 며칠 판매 0 이어도 0원 칸)
  assert.equal(calendarPendingFrom(range("2026-09-01", "2026-09-30"), "2026-11-08"), null);
  // 원장에 행이 하나도 없으면 전부 대기
  assert.equal(calendarPendingFrom(days, null), "2026-10-01");
  assert.equal(calendarPendingFrom([], "2026-11-08"), null);
});

// ── 퍼널 막대 ────────────────────────────────────────────────────────────────
test("퍼널: 폭은 첫 단계 대비, 100% 상한·최소 폭, 이탈률 0 이상", () => {
  const m = funnelModel([
    { key: "s", label: "유입", value: 8680 }, { key: "c", label: "장바구니", value: 1287 }, { key: "o", label: "구매", value: 3 },
  ]);
  assert.equal(m.ok, true);
  assert.equal(m.rows[0].width, 100);
  assert.equal(m.rows[2].width, FUNNEL_MIN_W);
  assert.equal(Math.round(m.rows[0].drop * 10) / 10, 85.2);
  assert.equal(m.rows[2].drop, null);
  assert.ok(m.rows.every((r) => r.width <= 100 && (r.drop == null || r.drop >= 0)));
});

test("퍼널: 뒤 단계가 앞 단계보다 크면 그리지 않고 이유", () => {
  const m = funnelModel([
    { key: "s", label: "유입", value: 100 }, { key: "c", label: "장바구니", value: 150 }, { key: "o", label: "구매", value: 10 },
  ]);
  assert.equal(m.ok, false);
  assert.match(m.reason, /장바구니\(150\)이 유입\(100\)보다 많아/);
  assert.equal(funnelModel([{ key: "s", label: "유입", value: 0 }, { key: "o", label: "구매", value: 0 }]).ok, false);
});

// ── 판매처 비교(카드 ▲▼ = 덤벨 두 점) ───────────────────────────────────────
test("판매처 비교: 덤벨 두 점으로 다시 낸 증감률이 카드 ▲▼ 와 같다", () => {
  const v = { revenueToSales: 53764090, adSpendToSales: 7768948, prevRevCut: 65180090, prevAdCut: 10672661 };
  const r = storeCompare(v);
  assert.equal(r.cmp.revenue, v.revenueToSales);
  assert.equal(r.cmp.prevRevenue, v.prevRevCut);
  assert.equal(((r.cmp.revenue / r.cmp.prevRevenue) - 1) * 100, r.revDelta);
  assert.equal(((r.cmp.roas / r.cmp.prevRoas) - 1) * 100, r.roasDelta);
  assert.equal(r.cmp.roas, r.roasToSales);
  // 광고비 0 이면 ROAS 는 0x 가 아니라 null, 카드 증감률도 null
  const z = storeCompare({ revenueToSales: 828100, adSpendToSales: 0, prevRevCut: 1090250, prevAdCut: 0 });
  assert.equal(z.cmp.roas, null);
  assert.equal(z.cmp.prevRoas, null);
  assert.equal(z.roasDelta, null);
  assert.equal(z.roasToSales, 0);
});

test("덤벨 ROAS: 광고비 0·5만 원 미만은 어느 쪽인지 사실대로", () => {
  const base = { revenue: 1, prevRevenue: 1, roas: 2, prevRoas: 3 };
  assert.equal(dumbbellRoas({ ...base, adSpend: 0, prevAdSpend: 0 }, 50000).missingNote, "광고비 0 (직전·이번)");
  assert.equal(dumbbellRoas({ ...base, adSpend: 0, prevAdSpend: 90000 }, 50000).missingNote, "광고비 0 (이번)");
  assert.equal(dumbbellRoas({ ...base, adSpend: 90000, prevAdSpend: 0 }, 50000).missingNote, "광고비 0 (직전)");
  assert.equal(dumbbellRoas({ ...base, adSpend: 90000, prevAdSpend: 10000 }, 50000).missingNote, "광고비 5만 원 미만 (직전)");
  const ok = dumbbellRoas({ ...base, adSpend: 90000, prevAdSpend: 60000 }, 50000);
  assert.deepEqual([ok.prev, ok.cur, ok.missingNote], [3, 2, undefined]);
});
