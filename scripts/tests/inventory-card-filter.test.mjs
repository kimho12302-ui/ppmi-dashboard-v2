// npm test  (= node --test scripts/tests/*.test.mjs)
// 재고 화면 카드 눌러 골라 보기(2026-11-26): 카드 숫자 = 카드를 눌렀을 때 남는 행 수. src/lib/inventory.ts 를 그대로 불러 시험한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CARD_KEYS, cardMatches, filterByCard, toggleCardFilter, buildCards, computeInventory, buildBrandTabs, inBrandTab, ownSaipTabs,
} from "../../src/lib/inventory.ts";

// buildCards 가 읽는 칸만 채운 행
const row = (sku, status, o = {}) => ({
  sku_no: sku, status, base_status: status, held: false, brand: "saip", supplier: "파미나", value: 1000, total_stock: 1, ...o,
});

const fixture = [
  row("SOLD", "soldout"),
  row("SOLD_HELD", "soldout", { held: true }),
  row("ORDER", "order"),
  row("ORDER_HELD", "order", { held: true }),
  row("SOON", "soon"),
  row("LATE_SOLD", "late", { base_status: "soldout" }),
  row("LATE_ORDER", "late", { base_status: "order" }),
  row("LATE_SOON", "late", { base_status: "soon" }),
  row("INCOMING", "incoming", { base_status: "order" }),
  row("RESTOCK", "restock", { brand: "nutty", supplier: null }),
  row("OK", "ok"),
  row("OVER", "over"),
  row("NOMOVE", "nomove"),
  row("EXCLUDED", "excluded"),
];
const skus = (rows) => rows.map((r) => r.sku_no).sort();

test("카드별로 걸리는 행: 보류는 빠지고 입고 지연은 밑의 상태 카드에 걸린다", () => {
  assert.deepEqual(skus(filterByCard(fixture, "soldout")), ["LATE_SOLD", "SOLD"]);
  assert.deepEqual(skus(filterByCard(fixture, "order")), ["LATE_ORDER", "LATE_SOON", "ORDER"]);
  assert.deepEqual(skus(filterByCard(fixture, "soon")), ["SOON"]);
  assert.deepEqual(skus(filterByCard(fixture, "restock")), ["RESTOCK"]);
  assert.deepEqual(skus(filterByCard(fixture, "over")), ["OVER"]);
  // 어느 카드에도 안 걸리는 행
  const anywhere = new Set(CARD_KEYS.flatMap((k) => filterByCard(fixture, k).map((r) => r.sku_no)));
  for (const sku of ["SOLD_HELD", "ORDER_HELD", "INCOMING", "OK", "NOMOVE", "EXCLUDED"]) assert.ok(!anywhere.has(sku), sku);
});

test("카드 숫자 = 필터 행 수 (만든 행)", () => {
  const cards = buildCards(fixture);
  for (const k of CARD_KEYS) assert.equal(cards.card[k], filterByCard(fixture, k).length, k);
  assert.equal(cards.card.held_soldout, 1);
  assert.equal(cards.card.held_order, 1);
});

test("카드 숫자 = 필터 행 수 (computeInventory 가 만든 보류·입고 지연·입고 대기)", () => {
  const day = (ymd, sku, o = {}) => ({
    ymd, sku_no: sku, shipin_qty: 0, shipout_qty: 0, return_shipin_qty: 0, faulty_shipin_qty: 0, damage_shipin_qty: 0, center_qty: 0, ...o,
  });
  const d28 = (sku, perDay) => Array.from({ length: 28 }, (_, i) =>
    day(new Date(Date.UTC(2026, 9, 13 + i)).toISOString().slice(0, 10), sku, { shipout_qty: perDay }));
  const snap = (sku, name, available) => ({ date: "2026-11-10", sku_no: sku, product_name: name, available_qty: available });
  const res = computeInventory({
    snapshot: [
      snap("A", "[사입][파미나]a", 0), snap("B", "[사입][파미나]b", 10), snap("C", "[사입][파미나]c", 10), snap("D", "[사입][오리젠]d", 0),
      snap("E", "[사입][파미나]e", 1000), snap("F", "[사입][파미나]f", 40), snap("G", "[사입][오리젠]g", 0),
    ],
    daily: [...d28("A", 5), ...d28("B", 1), ...d28("C", 1), ...d28("E", 1), ...d28("F", 1), day("2026-08-20", "D", { shipout_qty: 1 })],
    map: ["A", "B", "C", "D", "E", "F", "G"].map((k) => ({ sku_no: k, component: k, brand: "saip" })),
    orders: [
      { sku_no: "A", qty: 10, ordered_at: "2026-06-01", expected_at: "2026-06-15", status: "ordered" },
      { sku_no: "C", qty: 10, ordered_at: "2026-11-08", expected_at: "2026-11-20", status: "ordered" },
    ],
    salesScale: { window: { from: "2026-08-08", to: "2026-11-05", days: 90 }, byComponent: [
      { component: "A", revenue: 900000, qty: 90 }, { component: "B", revenue: 50000, qty: 5 }, { component: "E", revenue: 40000, qty: 4 },
      { component: "F", revenue: 9000, qty: 1 }, { component: "C", revenue: 1000, qty: 1 },
    ] },
    today: "2026-11-10",
  });
  const by = Object.fromEntries(res.rows.map((r) => [r.sku_no, r]));
  // 재료가 의도대로 만들어졌는지: 입고 지연(품절) · 입고 대기 · 보류 품절 2개(D 판매 없음, G 판매 없음)
  assert.deepEqual([by.A.status, by.A.base_status], ["late", "soldout"]);
  assert.equal(by.C.status, "incoming");
  assert.ok(by.D.held && by.G.held);
  for (const k of CARD_KEYS) assert.equal(res.cards.card[k], filterByCard(res.rows, k).length, k);
  assert.deepEqual(skus(filterByCard(res.rows, "soldout")), ["A"]);
  assert.ok(!filterByCard(res.rows, "soldout").some((r) => r.held));
  assert.ok(filterByCard(res.rows, "over").every((r) => r.status === "over"));
});

test("브랜드 탭: 탭으로 거른 행 위에서도 카드 숫자 = 필터 행 수, 탭 합은 전체와 같다", () => {
  const rows = [
    ...fixture,
    row("ORI_SOLD", "soldout", { supplier: "오리젠" }), row("ORI_SOLD2", "soldout", { supplier: "오리젠" }), row("ORI_OVER", "over", { supplier: "오리젠" }),
    row("ORI_X", "ok", { supplier: "오리젠" }), row("N_SOLD", "soldout", { brand: "nutty", supplier: null }), row("IP", "order", { brand: "ironpet", supplier: null }),
  ];
  const tabs = buildBrandTabs(rows);
  const own = ownSaipTabs(tabs);
  assert.ok(tabs.length > 2);
  for (const t of tabs) {
    const tabRows = rows.filter((r) => inBrandTab(r, t.key, own));
    const cards = buildCards(tabRows);
    for (const k of CARD_KEYS) {
      const f = filterByCard(tabRows, k);
      assert.equal(cards.card[k], f.length, `${t.key} ${k}`);
      assert.ok(f.every((r) => inBrandTab(r, t.key, own) && cardMatches(k, r)));
    }
  }
  // 전체 탭을 뺀 탭들은 겹치지 않으니 합이 전체와 같다
  for (const k of CARD_KEYS) {
    const sum = tabs.filter((t) => t.key !== "all").reduce((a, t) => a + filterByCard(rows.filter((r) => inBrandTab(r, t.key, own)), k).length, 0);
    assert.equal(sum, filterByCard(rows, k).length, k);
  }
});

test("카드 누르기: 같은 카드 다시 누르면 해제, 다른 카드면 전환", () => {
  assert.equal(toggleCardFilter(null, "soldout"), "soldout");
  assert.equal(toggleCardFilter("soldout", "soldout"), null);
  assert.equal(toggleCardFilter("soldout", "over"), "over");
  // 해제하면 전체 행으로 돌아간다(화면은 필터가 null 이면 rows 를 그대로 쓴다)
  const f = toggleCardFilter("over", "over");
  assert.equal(f, null);
});
