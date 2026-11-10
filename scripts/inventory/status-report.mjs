// 재고 판정 보고 (2주 나란히 보기용, 2026-11-10).
//
//   node scripts/inventory/status-report.mjs <볼트 원천 폴더> [시트 json]
//     원천 폴더 = H:/내 드라이브/obsidian/Obsidian/settings/collectors/raw (위킵 스냅샷·날짜별·매칭표 초안)
//     시트 json = 「2026 재고·출고 통합관리」 탭별 값({탭이름: [[행]]}). 있으면 시트 판정·원가와 대조
//
// 계산은 화면과 같은 src/lib/inventory.ts 를 그대로 쓴다(숫자가 화면과 어긋나지 않게).
// 원가는 대시보드 DB product_costs 를 읽는다(.env.local 의 공개 읽기 키). 손 입력 재고·발주·메모는 없는 것으로 본다(표 생성 전).
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeInventory, mergeDailyRows, parseWekeepName, nameKey, STATUS_LABEL } from "../../src/lib/inventory.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const RAW = process.argv[2];
const SHEET = process.argv[3];
if (!RAW || !existsSync(RAW)) { console.error("사용법: status-report.mjs <원천 폴더> [시트 json]"); process.exit(2); }

const readJson = (p) => JSON.parse(readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const env = Object.fromEntries(readFileSync(join(ROOT, ".env.local"), "utf8").split(/\r?\n/).filter((l) => l.includes("="))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; }));

async function costs() {
  const url = `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/product_costs?select=product,brand,manufacturing_cost`;
  const res = await fetch(url, { headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}` } });
  if (!res.ok) throw new Error(`product_costs ${res.status}`);
  return res.json();
}

const snapshot = Object.values(readJson(join(RAW, "wekeep-snapshot.json")).items).map((v) => ({
  date: v.date, sku_no: v.skuNo, product_name: v.productName, barcode: v.productManageCode, available_qty: v.availableQty,
  safe_qty: v.safeQty, reserve_qty: v.reserveQty, faulty_qty: v.faultyQty, daily_avg_shipout_qty: v.dailyAvgShipoutQty,
  month_avg_shipout_qty: v.monthAvgShipoutQty, read_at: v.readAt,
}));
const toDaily = (v) => ({ ymd: v.ymd, sku_no: v.skuNo, shipin_qty: v.shipinQty, shipout_qty: v.shipoutQty, return_shipin_qty: v.returnShipinQty,
  faulty_shipin_qty: v.faultyShipinQty, damage_shipin_qty: v.damageShipinQty, center_qty: v.centerQty });
const byKey = new Map();
const bf = join(RAW, "wekeep-backfill");
if (existsSync(bf)) for (const f of readdirSync(bf).filter((x) => x.endsWith(".json"))) for (const r of mergeDailyRows(readJson(join(bf, f)).daily.map(toDaily))) byKey.set(`${r.ymd}|${r.sku_no}`, r);
for (const r of mergeDailyRows(Object.values(readJson(join(RAW, "wekeep-daily.json")).items).map(toDaily))) byKey.set(`${r.ymd}|${r.sku_no}`, r);
const map = readJson(join(RAW, "wekeep-sku-map.draft.json")).rows.map((r) => {
  const codes = r.codes || [];
  const code = codes.find((c) => c.role === "single" && c.confidence === "확실") || codes[0];
  return { sku_no: r.skuNo, component: r.component?.name?.trim() ?? null, brand: r.component?.brand || parseWekeepName(r.productName).brand,
    supplier: parseWekeepName(r.productName).supplier, confidence: r.confidence, product_code: code?.code ?? null, exclude: r.category !== "상품" };
});
const pm = readJson(join(ROOT, "src/lib/product-master.json")).items;
const codeNames = Object.fromEntries(pm.filter((p) => p.code).map((p) => [p.code, p.product]));

const res = computeInventory({ snapshot, daily: [...byKey.values()], map, costs: await costs(), codeNames, window: 28 });
const label = (s) => STATUS_LABEL[s];
const f1 = (n) => (n === null || n === undefined ? "-" : Math.round(n * 10) / 10);

console.log(`# 재고 판정 ${res.as_of} (날짜별 ${res.window_from} ~ ${res.daily_through}, 28일)`);
console.log(Object.entries(res.cards.counts).map(([k, n]) => `${label(k)} ${n}`).join(" · "));
console.log(`재고 가치 ${res.cards.value_total.toLocaleString("ko-KR")}원 (원가 없는 재고 상품 ${res.cards.missing_cost}개 빠짐)`);
console.log(`품절 중 오래 품절(최근 28일 출고도 0, 화면에서 접어 둠) ${res.rows.filter((r) => r.status === "soldout" && r.speed.total === 0).length}개`);

console.log(`\n## 28일 방식 vs 시트 방식(너티 월평균÷30.4 · 사입 위킵 일평균, 같은 기준 일수, 손 입력 재고 없음)`);
const diff = res.rows.filter((r) => r.status !== r.sheet_status);
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
  console.log(`\n## 원가: 시트 vs 대시보드 product_costs(manufacturing_cost)`);
  let m = 0;
  for (const a of actual) {
    if (!a.r || !a.cost) continue;
    if (a.r.unit_cost === null) { m += 1; console.log(`- ${a.name} | 시트 ${a.cost} · 대시보드 원가 없음`); continue; }
    if (a.r.unit_cost !== a.cost) { m += 1; console.log(`- ${a.name} | 시트 ${a.cost} · 대시보드 ${a.r.unit_cost} (${a.r.cost_basis})`); }
  }
  console.log(`(${m}개 다름·없음)`);
}
