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
  seriesTotal, TOTAL_LABEL, VISIBLE_TOTAL_LABEL, finiteOrNull,
  toggleHidden, pruneHidden, isLastVisible, visibleKeys, topVisibleKey,
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

// ── 툴팁 합계 (2026-11-12) ───────────────────────────────────────────────────
const KEYS = ["smartstore", "cafe24", "coupang"];

test("합계: 보이는 합산 계열을 다 더하고 라벨은 「합계」", () => {
  const t = seriesTotal({ smartstore: 100, cafe24: 50, coupang: 25 }, KEYS);
  assert.deepEqual(t, { value: 175, label: TOTAL_LABEL, hiddenCount: 0, counted: 3 });
});

test("합계: 계열이 전부 null 이면 0 이 아니라 null(「-」), 판매 동기화 대기 칸", () => {
  const t = seriesTotal({ smartstore: null, cafe24: null, coupang: undefined, __ad: 30000 }, KEYS);
  assert.equal(t.value, null);
  assert.equal(t.counted, 0);
  assert.equal(t.label, TOTAL_LABEL);
});

test("합계: 일부 null 이면 있는 값만 더한다(0 은 값이다)", () => {
  const t = seriesTotal({ smartstore: 0, cafe24: null, coupang: 40 }, KEYS);
  assert.equal(t.value, 40);
  assert.equal(t.counted, 2);
});

test("합계: 숨긴 계열은 빼고 라벨이 「보이는 항목 합계」", () => {
  const t = seriesTotal({ smartstore: 100, cafe24: 50, coupang: 25 }, KEYS, ["cafe24"]);
  assert.equal(t.value, 125);
  assert.equal(t.label, VISIBLE_TOTAL_LABEL);
  assert.equal(t.hiddenCount, 1);
});

test("합계: 합산 대상 밖 계열(광고비 선)을 숨겨도 라벨은 「합계」 그대로", () => {
  const t = seriesTotal({ smartstore: 100, cafe24: 50, coupang: 25, __ad: 999 }, KEYS, ["__ad"]);
  assert.equal(t.value, 175);
  assert.equal(t.label, TOTAL_LABEL);
});

test("합계: 비율 계열(ROAS)은 sumKeys 에 없으면 더하지 않는다", () => {
  const row = { 매출: 500000, 광고비: 100000, ROAS: 5 };
  assert.equal(seriesTotal(row, ["매출"]).value, 500000);
  // 합산 대상이 없는 그래프(비율·다른 단위만)는 합계 줄 자체가 없다
  assert.equal(seriesTotal(row, []), null);
});

test("합계: 합산 대상이 전부 숨겨지면 합계 줄을 그리지 않는다(null)", () => {
  assert.equal(seriesTotal({ smartstore: 1, cafe24: 2, coupang: 3 }, KEYS, KEYS), null);
});

test("합계: 라벨을 화면이 바꿀 수 있다(매출 + 광고비 그래프의 「매출 합계」)", () => {
  const t = seriesTotal({ a: 1, b: 2 }, ["a", "b"], ["b"], "매출 합계", "보이는 매출 합계");
  assert.equal(t.label, "보이는 매출 합계");
  assert.equal(seriesTotal({ a: 1, b: 2 }, ["a", "b"], [], "매출 합계", "보이는 매출 합계").label, "매출 합계");
});

test("합계: 숫자 아닌 값·NaN·Infinity 는 null 취급", () => {
  assert.equal(finiteOrNull("12"), null);
  assert.equal(finiteOrNull(NaN), null);
  assert.equal(finiteOrNull(Infinity), null);
  assert.equal(finiteOrNull(-3), -3);
  assert.equal(seriesTotal({ smartstore: "12", cafe24: NaN, coupang: 5 }, KEYS).value, 5);
});

// ── 범례로 골라 보기 ─────────────────────────────────────────────────────────
test("범례: 누르면 숨기고 다시 누르면 보인다(원래 배열 불변)", () => {
  const h0 = [];
  const h1 = toggleHidden(h0, "cafe24", KEYS);
  assert.deepEqual(h1, ["cafe24"]);
  assert.deepEqual(h0, []);
  assert.deepEqual(toggleHidden(h1, "cafe24", KEYS), []);
});

test("범례: 보이는 마지막 하나는 숨기지 않는다", () => {
  const h = ["smartstore", "cafe24"];
  assert.equal(toggleHidden(h, "coupang", KEYS), h);
  assert.equal(isLastVisible(h, "coupang", KEYS), true);
  assert.equal(isLastVisible(h, "cafe24", KEYS), false);
  assert.equal(isLastVisible([], "cafe24", KEYS), false);
});

test("범례: 목록에 없는 키는 무시", () => {
  const h = [];
  assert.equal(toggleHidden(h, "nope", KEYS), h);
});

test("범례: 계열이 바뀌면 없는 키는 정리하고, 남은 게 전부 숨김이면 모두 보이게", () => {
  assert.deepEqual(pruneHidden(["cafe24", "gone"], KEYS), ["cafe24"]);
  assert.deepEqual(pruneHidden(["coupang"], ["coupang"]), []);
  const same = ["cafe24"];
  assert.equal(pruneHidden(same, KEYS), same);
});

test("범례: 보이는 계열 순서와 쌓은 막대 맨 위(둥근 모서리) 계열", () => {
  assert.deepEqual(visibleKeys(KEYS, ["cafe24"]), ["smartstore", "coupang"]);
  assert.equal(topVisibleKey(KEYS, ["coupang"]), "cafe24");
  assert.equal(topVisibleKey(KEYS, []), "coupang");
});
