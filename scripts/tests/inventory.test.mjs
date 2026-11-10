// npm test  (= node --test scripts/tests/*.test.mjs)
// src/lib/inventory.ts 재고 화면 계산 규칙을 그대로 불러 시험한다(node 형 지우기).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseWekeepName, thresholdsFor, mergeDailyRows, shipoutSpeed, fillDailySeries, runwayDays, statusFromRunway,
  computeInventory, forecastLine, dailyThrough, DEFAULT_THRESHOLDS, coupangWindowFor, isRealDate, extractSheetCosts, matchSheetCosts,
  gradeByCumulative, buildBrandTabs, inBrandTab, ownSaipTabs, supplierFromName, summarizeCoupangRg,
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

test("재고 가치: 원가 0 원(무상 샘플)은 0 원, 원가 없음은 빈칸, 합계에서 빠진 건수 셈", () => {
  const res = computeInventory({
    snapshot: [snap("A", "[사입][파미나]a 1kg", 10), snap("B", "[사입][파미나]b", 5), snap("C", "[사입][파미나]c", 3)],
    daily: [],
    map: [{ sku_no: "A", component: "a 1kg", brand: "saip" }, { sku_no: "B", component: "b", brand: "saip" }, { sku_no: "C", component: "c", brand: "saip" }],
    // 원가는 SKU 원가 표(시트가 정본)에서만. 0 원은 무상 샘플(2026-11-10 김호), 표에 없으면 원가 없음
    skuCosts: [{ cost_key: "A", sku_no: "A", product_name: "a", cost: 1000, source: "sheet:파미나(독)!R4" }, { cost_key: "B", sku_no: "B", product_name: "b", cost: 0, source: null }],
  });
  const by = Object.fromEntries(res.rows.map((r) => [r.sku_no, r.value]));
  assert.equal(by.A, 10000);
  assert.equal(by.B, 0);
  assert.equal(by.C, null);
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

// ── 2026-11-10 검수 반영 ──
const d28 = (sku, perDay, end = 9) => {
  const out = [];
  for (let i = 0; i < 28; i += 1) out.push(day(new Date(Date.UTC(2026, 9, 13 + i)).toISOString().slice(0, 10), sku, { shipout_qty: perDay }));
  return out;
};

test("입고 예정일이 지난 발주는 입고 대기가 아니라 입고 지연, 카드는 밑의 상태로 셈", () => {
  const res = computeInventory({
    snapshot: [snap("A", "[사입][파미나]a", 0), snap("B", "[사입][파미나]b", 10), snap("C", "[사입][파미나]c", 10)],
    daily: [...d28("A", 5), ...d28("B", 1), ...d28("C", 1)],
    map: [],
    orders: [
      { sku_no: "A", qty: 10, ordered_at: "2026-06-01", expected_at: "2026-06-15", status: "ordered" },
      { sku_no: "B", qty: 10, ordered_at: "2026-11-01", expected_at: "2026-11-09", status: "ordered" },
      { sku_no: "C", qty: 10, ordered_at: "2026-11-08", expected_at: "2026-11-20", status: "ordered" },
    ],
    today: "2026-11-10",
  });
  const st = Object.fromEntries(res.rows.map((r) => [r.sku_no, [r.status, r.base_status]]));
  assert.deepEqual(st.A, ["late", "soldout"]);
  assert.deepEqual(st.B, ["late", "order"]);
  assert.deepEqual(st.C, ["incoming", "order"]);
  assert.equal(res.rows[0].group, "act");
  assert.equal(res.cards.card.soldout, 1);
  assert.equal(res.cards.card.order, 1);
  assert.equal(res.cards.card.late, 2);
  assert.equal(res.cards.card.incoming, 1);
  // 손댈 것 안에서 입고 지연이 맨 위
  assert.equal(res.rows[0].status, "late");
});

test("너티 쿠팡 미입력은 0 이 아님: 위킵 품절(쿠팡 미입력)으로 이유가 갈림", () => {
  const res = computeInventory({
    snapshot: [snap("N", "너티사운드_바삭", 0)],
    daily: d28("N", 2),
    map: [{ sku_no: "N", component: "바삭", brand: "nutty" }],
    coupangSales: [{ component: "바삭", qty: 300 }],
    coupangWindow: { from: "2026-10-09", to: "2026-11-05", days: 28 },
  });
  const r = res.rows[0];
  assert.equal(r.status, "soldout");
  assert.equal(r.coupang_missing, true);
  assert.match(r.reason, /쿠팡 미입력/);
});

test("미래 기준일 손 입력 재고는 쓰지 않는다", () => {
  const res = computeInventory({
    snapshot: [snap("N", "너티사운드_바삭", 50)],
    daily: d28("N", 2),
    map: [{ sku_no: "N", component: "바삭", brand: "nutty" }],
    stocks: [{ sku_no: "N", location: "coupang", qty: 999, as_of: "2027-01-01" }, { sku_no: "N", location: "coupang", qty: 5, as_of: "2026-11-09" }],
    coupangSales: [{ component: "바삭", qty: 28 }],
    coupangWindow: { from: "2026-10-09", to: "2026-11-05", days: 28 },
    today: "2026-11-10",
  });
  assert.equal(res.rows[0].coupang, 5);
  assert.equal(res.rows[0].runway_coupang, 5);
});

test("하루 출고 7·14일 기간", () => {
  const rows = d28("A", 1);
  rows.push(day("2026-11-09", "A", { shipout_qty: 13 }));
  const snapA = [snap("A", "[사입][파미나]a", 70)];
  const w7 = computeInventory({ snapshot: snapA, daily: rows, map: [], window: 7 }).rows[0];
  assert.equal(w7.speed.from, "2026-11-03");
  assert.equal(w7.speed.total, 20);
  const w14 = computeInventory({ snapshot: snapA, daily: rows, map: [], window: 14 }).rows[0];
  assert.equal(w14.speed.total, 27);
  assert.equal(w14.speed.days, 14);
});

test("너티 발주 필요 경계 20일(사입은 15일)", () => {
  const base = { daily: d28("N", 1), map: [{ sku_no: "N", brand: "nutty" }] };
  assert.equal(computeInventory({ ...base, snapshot: [snap("N", "너티사운드_냠", 20)] }).rows[0].status, "order");
  assert.equal(computeInventory({ ...base, snapshot: [snap("N", "너티사운드_냠", 21)] }).rows[0].status, "soon");
  const s = { daily: d28("S", 1), map: [] };
  assert.equal(computeInventory({ ...s, snapshot: [snap("S", "[사입][파미나]s", 16)] }).rows[0].status, "soon");
});

test("쿠팡 판매 기간: 끝 = min(마지막 판매일, 오늘 − 5일)", () => {
  assert.deepEqual(coupangWindowFor("2026-11-09", "2026-11-10"), { from: "2026-10-09", to: "2026-11-05", days: 28 });
  assert.deepEqual(coupangWindowFor("2026-11-01", "2026-11-10"), { from: "2026-10-05", to: "2026-11-01", days: 28 });
  assert.equal(coupangWindowFor(null, "2026-11-10"), null);
});

test("실제 날짜만", () => {
  assert.equal(isRealDate("2026-02-28"), true);
  assert.equal(isRealDate("2026-02-31"), false);
  assert.equal(isRealDate("2026-2-1"), false);
});

test("시트 원가: 탭별 원가 열, 배송비 줄 빼기, 상품명·바코드로 위킵 SKU 매칭", () => {
  const head = ["", "UPC 바코드", "파미나 (강아지)", "", "조치", "", "", "", "", "", "", "", "", "", "", "", "", "원가"];
  const tabs = {
    "파미나(독)": [[], ["조사 일자"], head,
      ["", "8010", "[사입][파미나]펌킨 100g", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "2,500"],
      ["", "9999", "이름이 다른 상품", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "3000"]],
    너티: [[], [], ["", "너티", "", "", "", "", "", "", "", "", "", "", "", "", "", "원가"], ["너티사운드_바삭", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "3500"]],
    닥터레이: [[], ["", "제품명", "공급가"], ["", "CANOPTIC(카놉틱)", "35,000"], ["", "실온 배송비", "3,000"]],
    "lawdate(weekeep)": [["무시"]],
  };
  const rows = extractSheetCosts(tabs);
  assert.deepEqual(rows.map((r) => [r.tab, r.cell, r.cost]), [
    ["파미나(독)", "R4", 2500], ["파미나(독)", "R5", 3000], ["너티", "P4", 3500], ["닥터레이", "C3", 35000],
  ]);
  const snapRows = [
    { sku_no: "1", product_name: "[사입][파미나]펌킨  100g", barcode: "x" },
    { sku_no: "2", product_name: "다른 위킵 이름", barcode: "9999" },
    { sku_no: "3", product_name: "너티사운드_바삭", barcode: null },
  ];
  const { matched, unmatched } = matchSheetCosts(rows, snapRows);
  assert.deepEqual(matched.map((m) => [m.sku_no, m.how, m.source]), [["1", "상품명", "sheet:파미나(독)!R4"], ["2", "바코드", "sheet:파미나(독)!R5"], ["3", "상품명", "sheet:너티!P4"]]);
  assert.deepEqual(unmatched.map((u) => u.name), ["CANOPTIC(카놉틱)"]);
});

// ── 2026-11-10 사입 브랜드 탭 · 판매 규모 등급(ABC) ──
test("깨진 머리표: 앞 탭 문자, 여는 대괄호 빠짐, 머리표 없는 사입 이름", () => {
  const a = parseWekeepName("\t[사입][벳라이프]벳라이프 인테스티널 로우팻 50g");
  assert.equal(a.brand, "saip");
  assert.equal(a.supplier, "벳라이프");
  const b = parseWekeepName("사입][고네이티브]스몰브리드 독 청어 4kg");
  assert.equal(b.brand, "saip");
  assert.equal(b.supplier, "고네이티브");
  assert.equal(b.bare, "스몰브리드 독 청어 4kg");
  assert.equal(parseWekeepName("[사입][테라카니스]퍼피 치킨과 호박 200g\t").bare, "퍼피 치킨과 호박 200g");
  assert.equal(supplierFromName("파미나 N&D 펌킨 멧돼지&사과 12Kg"), "파미나");
  assert.equal(supplierFromName("스몰브리드 독 청어"), null);
  // 매칭표가 사입·공급처 빈칸이면 이름 앞 단어로 브랜드 탭을 정한다
  const res = computeInventory({
    snapshot: [snap("P", "파미나 N&D 펌킨 독 닭고기&석류 미니 100g", 3), snap("G", "사입][고네이티브]스몰브리드 독 청어 4kg", 3)],
    daily: [], map: [{ sku_no: "P", brand: "saip", supplier: null }, { sku_no: "G", brand: "saip", supplier: null }],
  });
  assert.deepEqual(Object.fromEntries(res.rows.map((r) => [r.sku_no, r.supplier])), { P: "파미나", G: "고네이티브" });
});

test("브랜드 탭: 시트 네 브랜드 + SKU 3개 이상 브랜드는 따로, 나머지는 사입 기타", () => {
  const rows = [
    ...["파미나", "파미나", "벳라이프", "고네이티브", "오리젠"].map((s) => ({ brand: "saip", supplier: s })),
    ...["테라카니스", "테라카니스", "테라카니스", "게더", "게더", "나우"].map((s) => ({ brand: "saip", supplier: s })),
    { brand: "nutty", supplier: "너티" }, { brand: "ironpet", supplier: null }, { brand: "other", supplier: null },
  ];
  const tabs = buildBrandTabs(rows);
  assert.deepEqual(tabs.map((t) => [t.label, t.count]), [
    ["전체", 14], ["너티", 1], ["파미나", 2], ["벳라이프", 1], ["고네이티브", 1], ["오리젠", 1], ["테라카니스", 3], ["사입 기타", 3], ["아이언펫·기타", 2],
  ]);
  const own = ownSaipTabs(tabs);
  assert.equal(rows.filter((r) => inBrandTab(r, "saip:*", own)).length, 3);
  // 탭마다 개수 합 = 전체
  assert.equal(tabs.slice(1).reduce((a, t) => a + t.count, 0), 14);
});

test("ABC 경계: 자기 앞 누적 80% 미만 A, 95% 미만 B, 나머지 C, 0 은 판매 없음", () => {
  const g = gradeByCumulative([
    { key: "a", value: 50 }, { key: "b", value: 30 }, { key: "c", value: 15 }, { key: "d", value: 5 }, { key: "z", value: 0 },
  ]);
  // a 앞 0% → A, b 앞 50% → A, c 앞 80%(정확히 경계) → B, d 앞 95%(정확히 경계) → C
  assert.deepEqual(["a", "b", "c", "d", "z"].map((k) => g.get(k).grade), ["A", "A", "B", "C", "none"]);
  // 1등이 혼자 80% 를 넘어도 A(80% 선을 넘기는 그 상품까지 A)
  const solo = gradeByCumulative([{ key: "x", value: 90 }, { key: "y", value: 6 }, { key: "w", value: 4 }]);
  assert.deepEqual(["x", "y", "w"].map((k) => solo.get(k).grade), ["A", "B", "C"]);
  // 80% 를 살짝 못 미치는 앞 누적은 A
  const near = gradeByCumulative([{ key: "p", value: 79 }, { key: "q", value: 16 }, { key: "r", value: 5 }]);
  assert.deepEqual(["p", "q", "r"].map((k) => near.get(k).grade), ["A", "A", "C"]);
  // 같은 값은 같은 등급
  const tie = gradeByCumulative([{ key: "m", value: 40 }, { key: "n", value: 40 }, { key: "o", value: 20 }]);
  assert.equal(tie.get("m").grade, tie.get("n").grade);
});

const W90 = { from: "2026-08-08", to: "2026-11-05", days: 90 };
const scaleCase = (extra = {}) => {
  // 사입: A 큰 매출, B 중간, C 작은 매출(품절), D 판매 0·출고 0(품절), E 매출 없음 → 출고 × 원가(품절)
  const daily = [...d28("A", 1), ...d28("B", 1), day("2026-09-01", "E", { shipout_qty: 10 }), day("2026-09-02", "C", { shipout_qty: 1 })];
  return computeInventory({
    snapshot: [snap("A", "[사입][파미나]a", 5), snap("B", "[사입][파미나]b", 3), snap("C", "[사입][파미나]c", 0), snap("D", "[사입][오리젠]d", 0),
      snap("E", "[사입][파미나]e", 0)],
    daily,
    map: [
      { sku_no: "A", component: "a", brand: "saip" }, { sku_no: "B", component: "b", brand: "saip" },
      { sku_no: "C", component: "c", brand: "saip" }, { sku_no: "D", component: "d", brand: "saip" }, { sku_no: "E", component: "e", brand: "saip" },
    ],
    skuCosts: [{ cost_key: "E", sku_no: "E", product_name: "e", cost: 500, source: null }],
    salesScale: { window: W90, byComponent: [{ component: "a", revenue: 800000, qty: 80 }, { component: "b", revenue: 145000, qty: 10 }, { component: "c", revenue: 50000, qty: 1 }] },
    today: "2026-11-10",
    ...extra,
  });
};

test("판매 규모: 매출 등급, 출고 기준 대체, 판매 없음, C·판매 없음 품절은 보류", () => {
  const res = scaleCase();
  const by = Object.fromEntries(res.rows.map((r) => [r.sku_no, r]));
  assert.equal(by.A.scale.grade, "A");
  assert.equal(by.A.scale.basis, "sales");
  // 출고 기준: 10개 × 원가 500 = 5,000
  assert.equal(by.E.scale.basis, "shipout");
  assert.equal(by.E.scale.value, 5000);
  assert.equal(by.D.scale.grade, "none");
  assert.equal(by.D.scale.basis, "none");
  // 합계 1,000,000: A 앞 0 → A, B 앞 80% → B, C 앞 94.5% → B, E 앞 99.5% → C
  assert.equal(res.scale.pools.saip.total, 1000000);
  assert.equal(by.B.scale.grade, "B");
  assert.equal(by.C.scale.grade, "B");
  assert.equal(by.E.scale.grade, "C");
  // E(C 품절)·D(판매 없음 품절)는 보류, C(B 품절)는 ① 에 남는다
  assert.equal(by.E.group, "hold");
  assert.equal(by.D.group, "hold");
  assert.equal(by.C.group, "act");
  assert.equal(res.cards.card.soldout, 1);
  assert.equal(res.cards.card.held_soldout, 2);
  assert.equal(res.scale.pools.saip.shipout_basis, 1);
  assert.equal(by.E.last_shipout, "2026-09-01");
});

test("판매 규모: A 품절이 C 발주 필요보다 위, 입고 지연은 맨 위, 입고 대기는 맨 아래, 최근 출고 있는 C 는 ① 아래쪽", () => {
  const daily = [...d28("A", 1), ...d28("B", 1), ...d28("C", 1), ...d28("D", 1)];
  const res = computeInventory({
    snapshot: [snap("A", "[사입][파미나]a", 0), snap("B", "[사입][파미나]b", 10), snap("C", "[사입][파미나]c", 3), snap("D", "[사입][파미나]d", 5)],
    daily,
    map: ["A", "B", "C", "D"].map((k) => ({ sku_no: k, component: k, brand: "saip" })),
    orders: [
      { sku_no: "C", qty: 10, ordered_at: "2026-11-01", expected_at: "2026-11-05", status: "ordered" },
      { sku_no: "D", qty: 10, ordered_at: "2026-11-08", expected_at: "2026-11-20", status: "ordered" },
    ],
    salesScale: { window: W90, byComponent: [{ component: "A", revenue: 900, qty: 9 }, { component: "B", revenue: 10, qty: 1 }, { component: "C", revenue: 50, qty: 1 }, { component: "D", revenue: 40, qty: 1 }] },
    today: "2026-11-10",
  });
  // B 는 C 등급 발주 필요지만 최근 30일 출고가 있어 보류가 아니라 ① (등급 순이라 A 아래). 입고 대기는 맨 아래
  assert.deepEqual(res.rows.map((r) => [r.sku_no, r.status, r.scale.grade, r.group]), [
    ["C", "late", "B", "act"], ["A", "soldout", "A", "act"], ["B", "order", "C", "act"], ["D", "incoming", "C", "act"],
  ]);
  assert.equal(res.cards.card.order, 2);
  assert.equal(res.cards.card.held_order, 0);
});

test("판매 규모: 판매 원장을 못 읽으면 등급·보류 없음(판매 없음으로 보지 않음)", () => {
  const res = scaleCase({ salesScale: null });
  assert.equal(res.scale, null);
  assert.ok(res.rows.every((r) => r.scale.grade === null && !r.held));
  assert.equal(res.cards.card.held_soldout, 0);
});

test("판매 규모: 같은 기본 품목 SKU 는 머리표 없는 것끼리 출고 비율로 나눠 합계가 품목 매출과 같다", () => {
  const res = computeInventory({
    snapshot: [snap("N", "너티사운드_냠", 10), snap("M", "[마케팅용]너티사운드_냠 1본입", 10), snap("X", "[사입][파미나]x 12kg", 1), snap("Y", "파미나 N&D x 12Kg", 1)],
    daily: [day("2026-10-01", "N", { shipout_qty: 5 }), day("2026-10-01", "M", { shipout_qty: 50 }), day("2026-10-01", "X", { shipout_qty: 3 }), day("2026-10-01", "Y", { shipout_qty: 1 })],
    map: [{ sku_no: "N", component: "냠 단호박", brand: "nutty" }, { sku_no: "M", component: "냠 단호박", brand: "nutty" },
      { sku_no: "X", component: "x", brand: "saip" }, { sku_no: "Y", component: "x", brand: "saip" }],
    salesScale: { window: W90, byComponent: [{ component: "냠 단호박", revenue: 100000, qty: 50 }, { component: "x", revenue: 40000, qty: 4 }] },
  });
  const by = Object.fromEntries(res.rows.map((r) => [r.sku_no, r.scale]));
  // 마케팅용은 판매 매출을 안 받는다(출고 × 원가 대체, 원가 없으면 등급 없음)
  assert.equal(by.N.revenue, 100000);
  assert.equal(by.M.revenue, 0);
  assert.equal(by.M.basis, "unknown");
  assert.equal(by.M.grade, null);
  // 중복 SKU 는 출고 3:1
  assert.equal(by.X.revenue, 30000);
  assert.equal(by.Y.revenue, 10000);
  assert.equal(by.X.shared_with, 2);
  assert.equal(res.scale.pools.saip.total, 40000);
  assert.equal(res.scale.pools.nutty.total, 100000);
});

test("보류: C·판매 없음·미상이라도 최근 30일 위킵 출고가 있으면 ①, 30일 0 이면 보류(경계 30일)", () => {
  // 날짜별 마지막 날 11-09 → 최근 30일 = 10-11 ~ 11-09
  const res = computeInventory({
    snapshot: [
      snap("BIG", "[사입][파미나]big", 500), snap("IN", "[사입][파미나]in", 0), snap("OUT", "[사입][파미나]out", 0),
      snap("UNK", "[사입][파미나]unk", 0), snap("UNK2", "[사입][파미나]unk2", 0),
    ],
    daily: [
      day("2026-11-09", "BIG", { shipout_qty: 1 }),
      day("2026-10-11", "IN", { shipout_qty: 1 }), day("2026-10-10", "OUT", { shipout_qty: 1 }),
      day("2026-10-20", "UNK", { shipout_qty: 3 }), day("2026-09-20", "UNK2", { shipout_qty: 3 }),
    ],
    map: ["BIG", "IN", "OUT", "UNK", "UNK2"].map((k) => ({ sku_no: k, component: k, brand: "saip" })),
    salesScale: { window: W90, byComponent: [{ component: "BIG", revenue: 1000000, qty: 100 }, { component: "IN", revenue: 100, qty: 1 }, { component: "OUT", revenue: 100, qty: 1 }] },
    today: "2026-11-10",
  });
  const by = Object.fromEntries(res.rows.map((r) => [r.sku_no, r]));
  assert.equal(by.IN.scale.grade, "C");
  assert.equal(by.IN.group, "act");
  assert.equal(by.OUT.scale.grade, "C");
  assert.equal(by.OUT.group, "hold");
  // 미상(출고는 있는데 원가 없음)도 같은 규칙
  assert.equal(by.UNK.scale.grade, null);
  assert.equal(by.UNK.group, "act");
  assert.equal(by.UNK2.group, "hold");
  assert.equal(res.cards.card.soldout, 2);
  assert.equal(res.cards.card.held_soldout, 2);
});

test("보류: 너티는 C·판매 없음 품절이라도 항상 ①", () => {
  const res = computeInventory({
    snapshot: [snap("N1", "너티사운드_바삭", 100), snap("N2", "너티 하루루틴 굿모닝퓨레", 0), snap("N3", "너티 하루루틴 에너젯바", 0)],
    daily: [day("2026-11-09", "N1", { shipout_qty: 1 }), day("2026-08-20", "N2", { shipout_qty: 1 })],
    map: [{ sku_no: "N1", component: "바삭", brand: "nutty" }, { sku_no: "N2", component: "굿모닝퓨레", brand: "nutty" }, { sku_no: "N3", component: "에너젯바", brand: "nutty" }],
    salesScale: { window: W90, byComponent: [{ component: "바삭", revenue: 1000000, qty: 100 }, { component: "굿모닝퓨레", revenue: 100, qty: 1 }] },
    today: "2026-11-10",
  });
  const by = Object.fromEntries(res.rows.map((r) => [r.sku_no, r]));
  assert.equal(by.N2.scale.grade, "C");
  assert.equal(by.N2.group, "act");
  assert.equal(by.N3.scale.grade, "none");
  assert.equal(by.N3.group, "act");
  assert.equal(res.cards.card.held_soldout, 0);
});

// ── 쿠팡 로켓그로스(WING) 재고 (2026-11-10) ──
const rgRow = (vid, o = {}) => ({ date: "2026-11-10", vendor_item_id: vid, product_name: "[2박스] 너티 냠", option_name: "16개 고구마 20g",
  sale_suspended: false, orderable: 0, inbound: 0, sales_7d: 0, sales_30d: 0, ...o });
const rgBase = () => {
  const daily = [];
  for (let i = 0; i < 28; i += 1) daily.push(day(new Date(Date.UTC(2026, 9, 13 + i)).toISOString().slice(0, 10), "N", { shipout_qty: 1 }));
  return {
    snapshot: [snap("N", "너티사운드_냠", 40)],
    daily,
    map: [{ sku_no: "N", component: "냠 단호박", brand: "nutty" }],
    // 판매 원장 쿠팡 판매(판매자배송 섞임). WING 값이 있으면 쓰지 않아야 한다
    coupangSales: [{ component: "냠 단호박", qty: 280 }],
    coupangWindow: { from: "2026-10-09", to: "2026-11-05", days: 28 },
    stocks: [{ sku_no: "N", location: "coupang", qty: 7, as_of: "2026-11-08" }],
    today: "2026-11-10",
  };
};
const rgMap = [{ vendor_item_id: 1, sku_no: "N", qty: 2 }, { vendor_item_id: 2, sku_no: "N", qty: 1 }, { vendor_item_id: 3, sku_no: "N", qty: 1, needs_review: true }];

test("쿠팡 RG: 옵션 묶음을 낱개로 환산해 합치고 출처는 WING, 손 입력보다 우선", () => {
  const rows = [rgRow(1, { orderable: 25, inbound: 10 }), rgRow(2, { orderable: 6 }), rgRow(3, { orderable: 0, sale_suspended: true })];
  const r = computeInventory({ ...rgBase(), coupangRg: { rows, map: rgMap } }).rows[0];
  assert.equal(r.coupang, 56); // 25 × 2 + 6 × 1
  assert.equal(r.coupang_source, "wing");
  assert.equal(r.coupang_as_of, "2026-11-10");
  assert.equal(r.coupang_inbound, 20); // 입고 중 10 묶음 × 2, 남은 날에는 안 넣음
  assert.equal(r.total_stock, 96);
  assert.equal(r.coupang_rg.options.length, 3);
  assert.equal(r.coupang_rg.needs_review, true);
});

test("쿠팡 RG: 판매 속도 = RG 30일 순판매 낱개 ÷ 30 (판매 원장 쿠팡은 안 씀), 입고 중 포함 남은 날은 보조값", () => {
  const rows = [rgRow(1, { orderable: 30, inbound: 15, sales_30d: 45, sales_7d: 14 }), rgRow(2, { orderable: 0, sales_30d: 0 })];
  const r = computeInventory({ ...rgBase(), coupangRg: { rows, map: rgMap } }).rows[0];
  assert.equal(r.coupang_speed_basis, "wing30");
  assert.equal(r.coupang_per_day, 3); // 45 × 2 ÷ 30
  assert.equal(r.runway_coupang, 20); // 60 ÷ 3
  assert.equal(r.runway_coupang_with_inbound, 30); // (60 + 30) ÷ 3
  assert.equal(r.runway, 20);
  assert.equal(r.status, "order");
  assert.match(r.reason, /쿠팡 쪽\(WING 2026-11-10\)/);
  assert.equal(r.coupang_rg.sales_7d, 28);
});

test("쿠팡 RG: 기준일이 하루 넘게 오래되면 손 입력과 판매 원장으로 대체하고 사정을 적음", () => {
  const rows = [rgRow(1, { date: "2026-11-08", orderable: 99, sales_30d: 300 })];
  const res = computeInventory({ ...rgBase(), coupangRg: { rows, map: rgMap } });
  const r = res.rows[0];
  assert.equal(res.coupang_rg.fresh, false);
  assert.equal(r.coupang, 7);
  assert.equal(r.coupang_source, "manual");
  assert.equal(r.coupang_as_of, "2026-11-08");
  assert.equal(r.coupang_speed_basis, "sales");
  assert.equal(r.coupang_per_day, 10); // 280 ÷ 28
  assert.match(r.coupang_note, /오래돼 손 입력/);
  // 어제 기준은 새로운 것으로 본다
  const y = computeInventory({ ...rgBase(), coupangRg: { rows: [rgRow(1, { date: "2026-11-09", orderable: 4 })], map: rgMap } }).rows[0];
  assert.equal(y.coupang_source, "wing");
  assert.equal(y.coupang, 8);
});

test("쿠팡 RG: 원천이 없으면 지금 방식 그대로(손 입력 · 판매 원장)", () => {
  for (const coupangRg of [undefined, null, { rows: [], map: rgMap }]) {
    const r = computeInventory({ ...rgBase(), coupangRg }).rows[0];
    assert.equal(r.coupang_source, "manual");
    assert.equal(r.coupang_per_day, 10);
    assert.equal(r.coupang_note, null);
  }
});

test("쿠팡 RG: 판매중지 옵션뿐이면 지난 30일 판매가 있어도 쿠팡 쪽 판정에서 뺌", () => {
  const rows = [rgRow(1, { orderable: 0, sale_suspended: true, sales_30d: 49 })];
  const r = computeInventory({ ...rgBase(), coupangRg: { rows, map: rgMap } }).rows[0];
  assert.equal(r.coupang, 0);
  assert.equal(r.coupang_per_day, null);
  assert.equal(r.runway_coupang, null);
  assert.equal(r.runway, 40); // 위킵 쪽만
  assert.match(r.coupang_note, /판매중지/);
});

test("쿠팡 RG: 짝 없는 옵션 재고는 경고 목록으로, 짝 없는 너티 SKU 는 미입력이 아님", () => {
  const rows = [rgRow(1, { orderable: 5 }), rgRow(9, { orderable: 3, product_name: "[4세트] 새 옵션" }), rgRow(8, { orderable: 0 })];
  const input = { ...rgBase(), stocks: [], snapshot: [snap("N", "너티사운드_냠", 40), snap("M", "너티 맛보기 샘플 4종", 10)],
    map: [{ sku_no: "N", component: "냠 단호박", brand: "nutty" }, { sku_no: "M", component: "4종 맛보기 세트", brand: "nutty" }], coupangRg: { rows, map: rgMap } };
  const res = computeInventory(input);
  assert.equal(res.coupang_rg.unmapped.length, 2);
  assert.deepEqual(res.coupang_rg.unmapped_with_stock.map((u) => u.vendor_item_id), ["9"]);
  const m = res.rows.find((r) => r.sku_no === "M");
  assert.equal(m.coupang, null);
  assert.equal(m.coupang_missing, false);
  assert.match(m.coupang_note, /옵션 없음/);
  // 옵션 ID 가 문자열로 와도(DB bigint) 짝이 맞는다
  const s = summarizeCoupangRg([rgRow("1", { orderable: 2 })], rgMap, "2026-11-10");
  assert.equal(s.bySku.get("N").orderable, 4);
});
