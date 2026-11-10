// 재고 판정 보고 (2주 나란히 보기용, 2026-11-10).
//
//   node scripts/inventory/status-report.mjs <볼트 원천 폴더> [시트 json]
//     원천 폴더 = H:/내 드라이브/obsidian/Obsidian/settings/collectors/raw (위킵 스냅샷·날짜별·매칭표 초안)
//     시트 json = 「2026 재고·출고 통합관리」 탭별 값({탭이름: [[행]]}). 있으면 시트 판정·원가와 대조
//
// 계산은 화면과 같은 src/lib/inventory.ts 를 그대로 쓴다(숫자가 화면과 어긋나지 않게).
// 원가는 시트 원가 칸이 정본(2026-11-10 김호): 시트 json 이 있으면 화면과 같은 규칙(extractSheetCosts·matchSheetCosts)으로 SKU 에 붙인다.
// 손 입력 재고·발주·메모는 없는 것으로 본다(표 생성 전).
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeInventory, mergeDailyRows, parseWekeepName, nameKey, STATUS_LABEL, extractSheetCosts, matchSheetCosts, BRAND_LABEL } from "../../src/lib/inventory.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const RAW = process.argv[2];
const SHEET = process.argv[3];
if (!RAW || !existsSync(RAW)) { console.error("사용법: status-report.mjs <원천 폴더> [시트 json]"); process.exit(2); }

const readJson = (p) => JSON.parse(readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const env = Object.fromEntries(readFileSync(join(ROOT, ".env.local"), "utf8").split(/\r?\n/).filter((l) => l.includes("="))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; }));


const snapshot = Object.values(readJson(join(RAW, "wekeep-snapshot.json")).items).map((v) => ({
  date: v.date, sku_no: v.skuNo, product_name: v.productName, barcode: v.productManageCode, available_qty: v.availableQty,
  safe_qty: v.safeQty, reserve_qty: v.reserveQty, faulty_qty: v.faultyQty, daily_avg_shipout_qty: v.dailyAvgShipoutQty,
  month_avg_shipout_qty: v.monthAvgShipoutQty, read_at: v.readAt,
}));
const toDaily = (v) => ({ ymd: v.ymd, sku_no: v.skuNo, shipin_qty: v.shipinQty, shipout_qty: v.shipoutQty, return_shipin_qty: v.returnShipinQty,
  faulty_shipin_qty: v.faultyShipinQty, damage_shipin_qty: v.damageShipinQty, center_qty: v.centerQty });
const byKey = new Map();
const bf = join(RAW, "wekeep-backfill");
if (existsSync(bf)) for (const f of readdirSync(bf).filter((x) => x.endsWith(".json"))) for (const r of mergeDailyRows((readJson(join(bf, f)).daily ?? []).map(toDaily))) byKey.set(`${r.ymd}|${r.sku_no}`, r);
for (const r of mergeDailyRows(Object.values(readJson(join(RAW, "wekeep-daily.json")).items).map(toDaily))) byKey.set(`${r.ymd}|${r.sku_no}`, r);
const map = readJson(join(RAW, "wekeep-sku-map.draft.json")).rows.map((r) => {
  const codes = r.codes || [];
  const code = codes.find((c) => c.role === "single" && c.confidence === "확실") || codes[0];
  return { sku_no: r.skuNo, component: r.component?.name?.trim() ?? null, brand: r.component?.brand || parseWekeepName(r.productName).brand,
    supplier: parseWekeepName(r.productName).supplier, confidence: r.confidence, product_code: code?.code ?? null, exclude: r.category !== "상품" };
});
const sheetTabs = SHEET && existsSync(SHEET) ? readJson(SHEET) : null;
const costMatch = sheetTabs ? matchSheetCosts(extractSheetCosts(sheetTabs), snapshot.filter((s) => s.date === snapshot.reduce((m, v) => (v.date > m ? v.date : m), ""))) : null;

const res = computeInventory({ snapshot, daily: [...byKey.values()], map, skuCosts: costMatch?.matched ?? [], window: 28 });
const label = (s) => STATUS_LABEL[s];
const f1 = (n) => (n === null || n === undefined ? "-" : Math.round(n * 10) / 10);

console.log(`# 재고 판정 ${res.as_of} (날짜별 ${res.window_from} ~ ${res.daily_through}, 28일)`);
console.log(Object.entries(res.cards.counts).map(([k, n]) => `${label(k)} ${n}`).join(" · "));
console.log(`재고 가치 ${res.cards.value_total.toLocaleString("ko-KR")}원 (원가 없는 재고 상품 ${res.cards.missing_cost}개 빠짐)`);
console.log(`  브랜드별: ${Object.entries(res.cards.value_by_brand).map(([b, v]) => `${BRAND_LABEL[b]} ${v.toLocaleString("ko-KR")}원`).join(" · ")}`);
if (costMatch) {
  console.log(`원가 매칭: 시트 원가 줄 ${costMatch.matched.length + costMatch.unmatched.length}개 중 위킵 SKU 에 맞춤 ${costMatch.matched.length}`);
  for (const u of costMatch.unmatched) console.log(`  못 맞춤: ${u.tab}!${u.cell} ${u.name} ${u.cost}원 (${u.reason})`);
}
console.log(`원가 없는 재고 상품(재고 > 0, 판정 제외 아님):`);
for (const r of res.rows.filter((x) => x.status !== "excluded" && x.total_stock > 0 && x.value === null)) console.log(`  - ${r.name} (위킵 ${r.available})`);
console.log(`품절 중 최근 28일 출고도 0 인 것 ${res.rows.filter((r) => r.status === "soldout" && r.speed.total === 0).length}개 (판매 규모 등급·보류 묶음은 판매 원장이 있어야 해서 화면 /api/inventory 에서만 계산)`);

console.log(`\n## 28일 방식 vs 시트 방식(너티 월평균÷30.4 · 사입 위킵 일평균, 같은 기준 일수, 손 입력 재고 없음)`);
// 쿠팡 입고 요청은 시트 방식에 없는 상태라 늘 차이로 잡힌다. 따로 세고 차이 목록에서는 뺀다
const restockRows = res.rows.filter((r) => r.status === "restock");
if (restockRows.length) console.log(`(쿠팡 입고 요청 ${restockRows.length}개는 시트에 없는 상태라 비교에서 뺌: ${restockRows.map((r) => r.bare_name).join(", ")})`);
const diff = res.rows.filter((r) => r.status !== r.sheet_status && r.status !== "restock");
for (const r of diff) {
  console.log(`- ${r.name} | 대시보드 ${label(r.status)}(${f1(r.runway)}일, 하루 ${f1(r.speed.perDay)}) vs 시트 방식 ${label(r.sheet_status)}(${f1(r.sheet_runway)}일, 하루 ${f1(r.sheet_per_day)}) | 가용 ${r.available}`);
}
console.log(`(${diff.length}개 다름)`);

if (SHEET && existsSync(SHEET)) {
  const sheet = readJson(SHEET);
  const MAP = { 품절: "soldout", 주의: "order", 부족: "soon", 정상: "ok" };
  const rowsBy = new Map(res.rows.map((r) => [nameKey(r.name), r]));
  const actual = [];
  for (const [tab, values] of Object.entries(sheet)) {
    if (tab.startsWith("lawdate")) continue;
    const head = values[2] || [];
    const nameCol = tab === "너티" ? 0 : 2;
    const stCol = head.indexOf("재고 상태");
    const overCol = head.indexOf("과재고");
    const costCol = head.indexOf("원가");
    for (const v of values.slice(3)) {
      const name = v[nameCol];
      if (!name) continue;
      const r = rowsBy.get(nameKey(name));
      actual.push({ tab, name, r, st: v[stCol], over: v[overCol], cost: Number(String(v[costCol] ?? "").replace(/,/g, "")) || null });
    }
  }
  console.log(`\n## 시트(11-09 붙여넣기) 판정 vs 대시보드`);
  let n = 0;
  for (const a of actual) {
    if (!a.r) { console.log(`- ${a.tab} ${a.name}: 위킵 SKU 와 이름 짝 없음`); continue; }
    const sheetSt = a.over === "과재고" && a.st === "정상" ? "over" : MAP[a.st] ?? null;
    if (sheetSt && sheetSt !== a.r.status) { n += 1; console.log(`- ${a.name} | 시트 ${a.st}${a.over === "과재고" ? "+과재고" : ""} vs 대시보드 ${label(a.r.status)}(${f1(a.r.runway)}일) | 시트 방식 계산 ${label(a.r.sheet_status)}`); }
  }
  console.log(`(${n}개 다름)`);
}
