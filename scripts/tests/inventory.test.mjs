// npm test  (= node --test scripts/tests/*.test.mjs)
// src/lib/inventory.ts 재고 화면 계산 규칙을 그대로 불러 시험한다(node 형 지우기).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseWekeepName, thresholdsFor, mergeDailyRows, shipoutSpeed, fillDailySeries, runwayDays, statusFromRunway,
  computeInventory, forecastLine, dailyThrough, DEFAULT_THRESHOLDS,
} from "../../src/lib/inventory.ts";

const day = (ymd, sku, o = {}) => ({
  ymd, sku_no: sku, shipin_qty: 0, shipout_qty: 0, return_shipin_qty: 0, faulty_shipin_qty: 0, damage_shipin_qty: 0, center_qty: 0, ...o,
});
const snap = (sku, name, available, o = {}) => ({ date: "2026-11-10", sku_no: sku, product_name: name, available_qty: available, ...o });

test("상품명 머리표: 사입·공급처·너티·파손", () => {
  assert.deepEqual(parseWekeepName("[사입][파미나]펌킨 독 멧돼지&사과 100g").brand, "saip");
  assert.equal(parseWekeepName("[사입][파미나]펌킨 독 멧돼지&사과 100g").supplier, "파미나");
  assert.equal(parseWekeepName("[파손][사입][파미나]펌킨 7kg").supplier, "파미나");
  assert.deepEqual(parseWekeepName("[파손][사입][파미나]펌킨 7kg").tags, ["파손", "사입", "파미나"]);
  assert.equal(parseWekeepName("[마케팅용]너티사운드_냠 1본입").brand, "nutty");
  assert.equal(parseWekeepName("너티사운드_바삭").brand, "nutty");
  assert.equal(parseWekeepName("고네이티브 풉백").brand, "other");
});

test("판정 기준: 공급처 > 브랜드 > 기본값", () => {
  const rules = [
    { scope_kind: "brand", scope_key: "saip", warn_days: 14, soon_days: 28, over_days: 90 },
    { scope_kind: "supplier", scope_key: "오리젠", warn_days: 25, soon_days: 40, over_days: 90 },
  ];
  assert.equal(thresholdsFor("saip", "오리젠", rules).warn, 25);
  assert.equal(thresholdsFor("saip", "파미나", rules).warn, 14);
  assert.equal(thresholdsFor("nutty", "너티", []).warn, DEFAULT_THRESHOLDS.nutty.warn);
  assert.equal(thresholdsFor("saip", null, []).warn, 15);
});

test("같은 날 두 행은 더한다", () => {
  const m = mergeDailyRows([day("2026-11-01", "A", { shipout_qty: 3 }), day("2026-11-01", "A", { center_qty: 10 })]);
  assert.equal(m.length, 1);
  assert.equal(m[0].shipout_qty, 3);
  assert.equal(m[0].center_qty, 10);
});

test("하루 출고 = 기간 합 ÷ 기간 일수, 행 없는 날은 0", () => {
  const rows = [day("2026-11-09", "A", { shipout_qty: 14 }), day("2026-10-13", "A", { shipout_qty: 14 }), day("2026-10-12", "A", { shipout_qty: 100 })];
  const s = shipoutSpeed(rows, "2026-11-09", 28);
  assert.equal(s.from, "2026-10-13");
  assert.equal(s.total, 28);
  assert.equal(s.perDay, 1);
});

test("기간 끝은 스냅샷 날(오늘) 전날까지", () => {
  assert.equal(dailyThrough([day("2026-11-10", "A"), day("2026-11-09", "A")], "2026-11-10"), "2026-11-09");
});

test("상세 그래프: 빈 날은 전날 마감을 잇고 입고·출고 0", () => {
  const rows = [day("2026-11-01", "A", { center_qty: 10, shipout_qty: 10 }), day("2026-11-04", "A", { center_qty: 0, shipin_qty: 5 })];
  const s = fillDailySeries(rows, "2026-11-01", "2026-11-05");
  assert.deepEqual(s.map((p) => p.start), [10, 0, 0, 0, 5]);
  assert.deepEqual(s.map((p) => p.shipout), [10, 0, 0, 0, 0]);
  assert.equal(s.length, 5);
  // 기간 앞 마지막 행의 마감을 잇는다
  assert.equal(fillDailySeries([day("2026-10-01", "A", { center_qty: 7 })], "2026-11-01", "2026-11-01")[0].start, 7);
});

test("남은 날과 상태 경계", () => {
  assert.equal(runwayDays(10, 0), null);
  const t = { warn: 15, soon: 30, over: 60 };
  assert.equal(statusFromRunway(15, t), "order");
  assert.equal(statusFromRunway(15.1, t), "soon");
  assert.equal(statusFromRunway(30, t), "soon");
  assert.equal(statusFromRunway(60, t), "ok");
  assert.equal(statusFromRunway(60.1, t), "over");
});

test("판정: 품절·발주 필요·출고 0·과재고·판정 제외·입고 대기", () => {
  const daily = [];
  // 28일 창 = 10-13 ~ 11-09
  for (let i = 0; i < 28; i += 1) {
    const d = new Date(Date.UTC(2026, 9, 13 + i)).toISOString().slice(0, 10);
    daily.push(day(d, "B", { shipout_qty: 1 }), day(d, "C", { shipout_qty: 1 }), day(d, "E", { shipout_qty: 1 }), day(d, "F", { shipout_qty: 1 }));
  }
  const res = computeInventory({
    snapshot: [
      snap("A", "[사입][파미나]a", 0),
      snap("B", "[사입][파미나]b", 10),
      snap("C", "[사입][파미나]c", 100),
      snap("D", "[사입][파미나]d", 5),
      snap("E", "부자재 박스", 50),
      snap("F", "[사입][파미나]f", 3),
    ],
    daily,
    map: [{ sku_no: "E", exclude: true }],
    orders: [{ sku_no: "F", qty: 20, ordered_at: "2026-11-08", expected_at: "2026-11-18", status: "ordered" }],
  });
  const st = Object.fromEntries(res.rows.map((r) => [r.sku_no, r.status]));
  assert.deepEqual(st, { A: "soldout", B: "order", C: "over", D: "nomove", E: "excluded", F: "incoming" });
  assert.equal(res.daily_through, "2026-11-09");
  assert.equal(res.cards.counts.soldout, 1);
  // 묶음 순서: 손댈 것(품절 → 발주 필요 → 입고 대기) → 과재고 → 출고 0 → 제외
  assert.deepEqual(res.rows.map((r) => r.sku_no), ["A", "B", "F", "C", "D", "E"]);
});

test("너티 쿠팡: 미입력이면 위킵만, 입력하면 짧은 쪽", () => {
  const daily = [];
  for (let i = 0; i < 28; i += 1) daily.push(day(new Date(Date.UTC(2026, 9, 13 + i)).toISOString().slice(0, 10), "N", { shipout_qty: 1 }));
  const common = {
    snapshot: [snap("N", "너티사운드_냠", 40)],
    daily,
    map: [{ sku_no: "N", component: "냠 단호박", brand: "nutty" }],
    coupangSales: [{ component: "냠 단호박", qty: 56 }],
    coupangWindow: { from: "2026-10-09", to: "2026-11-05", days: 28 },
  };
  const a = computeInventory(common).rows[0];
  assert.equal(a.coupang, null);
  assert.equal(a.runway, 40);
  assert.equal(a.status, "ok");
  const b = computeInventory({ ...common, stocks: [{ sku_no: "N", location: "coupang", qty: 20, as_of: "2026-11-09" }] }).rows[0];
  assert.equal(b.coupang_per_day, 2);
  assert.equal(b.runway_coupang, 10);
  assert.equal(b.runway, 10);
  assert.equal(b.status, "order");
});

test("재고 가치: 원가 0 원·없음은 빈칸, 합계에서 빠진 건수 셈", () => {
  const res = computeInventory({
    snapshot: [snap("A", "[사입][파미나]a 1kg", 10), snap("B", "[사입][파미나]b", 5)],
    daily: [],
    map: [{ sku_no: "A", component: "a 1kg", brand: "saip" }, { sku_no: "B", component: "b", brand: "saip" }],
    costs: [{ product: "a 1kg", brand: "saip", manufacturing_cost: 1000 }, { product: "b", brand: "saip", manufacturing_cost: 0 }],
  });
  const by = Object.fromEntries(res.rows.map((r) => [r.sku_no, r.value]));
  assert.equal(by.A, 10000);
  assert.equal(by.B, null);
  assert.equal(res.cards.value_total, 10000);
  assert.equal(res.cards.missing_cost, 1);
});

test("예상 소진 점선은 0 에서 멈춘다", () => {
  const f = forecastLine("2026-11-10", 10, 4, 120);
  assert.equal(f[0].value, 10);
  assert.equal(f.at(-1).value, 0);
  assert.equal(f.length, 4);
  assert.deepEqual(forecastLine("2026-11-10", 10, 0, 120), []);
});
