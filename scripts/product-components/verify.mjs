#!/usr/bin/env node
// 판매 상품 구성표 전후 대조 (2026-11-09). 읽기만 한다(anon 키).
//
// 실행: cd C:\Users\harry\projects\ppmi-dashboard-v2 ; node --experimental-strip-types scripts/product-components/verify.mjs
//   구성표는 seed.json(이 폴더)을 메모리로 올려 쓴다. SQL 실행 전에도 숫자를 미리 본다.
//   --from-db 를 주면 seed.json 대신 Supabase product_components 표를 읽는다(SQL 실행 뒤 확인용).
//
// 내는 것
//   1) 브랜드·판매처·달마다 매출·구매자 수 합이 풀기 전후로 같은지 (다르면 exit 1)
//   2) 너티 지정 달의 기본 품목별 수량·매출 (전: 같은 이름 판매 상품만, 후: 구성표로 푼 합)
//   3) 밸런스랩 지정 달 「제품별 광고 성과」 실매출·실 ROAS (뉴트리션·중금속·음식물) 전후
//   4) 밸런스랩 지정 달 「제품별 손익」 자체 판매 수량·매출·재료비 전후
//   5) 밸런스랩 「+ 종이결과지」 판매가 어떻게 나뉘는지

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildComponentIndex, expandSales } from "../../src/lib/product-components.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const MONTHS = (process.argv.find((a) => a.startsWith("--months=")) || "--months=2026-09,2026-10").slice(9).split(",");
const FROM_DB = process.argv.includes("--from-db");

const env = Object.fromEntries(readFileSync(join(ROOT, ".env.local"), "utf8").split(/\r?\n/)
  .filter((l) => l.includes("=") && !l.startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
const URL = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

async function all(table, select, filters = "", order = "id.asc") {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${URL}/rest/v1/${table}?select=${select}${filters}&order=${order}`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Range: `${from}-${from + 999}` },
    });
    if (!r.ok) throw new Error(`${table} ${r.status} ${await r.text()}`);
    const rows = await r.json();
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

const won = (n) => Math.round(n).toLocaleString("en-US");
const pad = (s, n) => String(s).padEnd(n);

// ── 원천 ──
const compRows = FROM_DB
  ? await all("product_components", "brand,sale_product,component,qty,price_share", "", "brand.asc,sale_product.asc,component.asc")
  : JSON.parse(readFileSync(join(HERE, "seed.json"), "utf8")).rows;
const index = buildComponentIndex(compRows);
const sales = await all("product_sales", "date,brand,product,channel,lineup,category,revenue,quantity,buyers", "&date=gte.2025-01-01");
const minM = MONTHS.slice().sort()[0], maxM = MONTHS.slice().sort().at(-1);
const ads = await all("ad_product_performance", "date,brand,product_id,product_name,spend", `&brand=eq.balancelab&date=gte.${minM}-01&date=lte.${maxM}-31`);
console.log(`구성표 ${compRows.length}줄(${FROM_DB ? "DB" : "seed.json"}) · 판매 원장 ${sales.length}행 · 대조 달 ${MONTHS.join(", ")}\n`);

const expanded = expandSales(sales, index);

// ── 1) 합계 불변 ──
{
  const sum = (rows) => {
    const m = new Map();
    for (const r of rows) {
      const k = `${r.brand}|${String(r.date).slice(0, 7)}|${r.channel}`;
      const g = m.get(k) || { rev: 0, buyers: 0 };
      g.rev += Number(r.revenue) || 0; g.buyers += Number(r.buyers) || 0;
      m.set(k, g);
    }
    return m;
  };
  const a = sum(sales), b = sum(expanded);
  let bad = 0;
  for (const [k, v] of a) {
    const w = b.get(k) || { rev: 0, buyers: 0 };
    if (Math.abs(v.rev - w.rev) > 0.5 || Math.abs(v.buyers - w.buyers) > 1e-9) { bad++; console.log(`  어긋남 ${k}: 매출 ${won(v.rev)} → ${won(w.rev)}, 구매자 ${v.buyers} → ${w.buyers}`); }
  }
  const brandTot = (rows, br) => rows.filter((r) => r.brand === br).reduce((s, r) => s + (Number(r.revenue) || 0), 0);
  console.log("1) 매출 합계 전후 (브랜드×달×판매처 묶음 " + a.size + "개)");
  for (const br of ["balancelab", "nutty", "ironpet", "saip"]) {
    for (const mo of MONTHS) {
      const f = (rows) => brandTot(rows.filter((r) => String(r.date).startsWith(mo)), br);
      console.log(`   ${pad(br, 11)} ${mo}  전 ${won(f(sales)).padStart(12)}  후 ${won(f(expanded)).padStart(12)}`);
    }
  }
  console.log(bad ? `   ✗ 어긋난 묶음 ${bad}개` : "   어긋난 묶음 0 (매출·구매자 수 합 그대로)\n");
  if (bad) process.exitCode = 1;
}

// ── 2) 너티 기본 품목별 ──
for (const mo of MONTHS) {
  const inMo = (r) => r.brand === "nutty" && String(r.date).startsWith(mo);
  const before = new Map(), after = new Map();
  for (const r of sales.filter(inMo)) { const g = before.get(r.product) || { q: 0, rev: 0 }; g.q += +r.quantity || 0; g.rev += +r.revenue || 0; before.set(r.product, g); }
  for (const r of expanded.filter(inMo)) { const g = after.get(r.product) || { q: 0, rev: 0, from: new Set() }; g.q += +r.quantity || 0; g.rev += +r.revenue || 0; g.from.add(r.sale_product); after.set(r.product, g); }
  console.log(`2) 너티 ${mo} 기본 품목별 (전 = 같은 이름 판매 상품 한 줄, 후 = 구성표로 푼 합)`);
  console.log(`   ${pad("품목", 16)}${"전 수량".padStart(8)}${"전 매출".padStart(13)}${"후 수량".padStart(8)}${"후 매출".padStart(13)}  들어온 판매 상품`);
  for (const [item, g] of [...after].sort((x, y) => y[1].rev - x[1].rev)) {
    const b = before.get(item) || { q: 0, rev: 0 };
    console.log(`   ${pad(item, 16)}${String(b.q).padStart(8)}${won(b.rev).padStart(13)}${String(g.q).padStart(8)}${won(g.rev).padStart(13)}  ${[...g.from].join(" · ")}`);
  }
  const tb = [...before.values()].reduce((s, g) => s + g.rev, 0), ta = [...after.values()].reduce((s, g) => s + g.rev, 0);
  console.log(`   합계 매출 전 ${won(tb)} / 후 ${won(ta)} · 줄 수 전 ${before.size} / 후 ${after.size}\n`);
}

// ── 3) 밸런스랩 제품별 광고 성과 실매출 ──
// 공구 판정은 src/lib/gonggu.ts isGonggu || isGongguAggregate 와 같다(밸런스랩만)
const isGonggu = (r) => r.product !== "공구 합계" && (!!r.lineup || String(r.channel || "").startsWith("공구"));
const isAgg = (r) => r.product === "공구 합계";
// src/lib/brand-groups.ts BL_TEST_LINES 와 같다. 「큐모발 미네랄 추가열람」은 뉴트리션 라인(김호 2026-11-09)
const line = (p) => (/뉴트리션|미네랄\s*추가열람/.test(p) ? "hair_nutrition" : /중금속/.test(p) ? "hair_metal" : /타액|호르몬/.test(p) ? "saliva"
  : /과민증|지연성|알러지|알레르기|음식물|IgG/i.test(p) ? "food" : /모발/.test(p) ? "hair_etc" : null);
for (const mo of MONTHS) {
  const inMo = (r) => r.brand === "balancelab" && String(r.date).startsWith(mo);
  const self = (rows) => rows.filter((r) => inMo(r) && !isGonggu(r) && !isAgg(r));
  const sumBy = (rows, keyf, valf = (r) => +r.revenue || 0) => { const m = new Map(); for (const r of rows) { const k = keyf(r); if (!k) continue; m.set(k, (m.get(k) || 0) + valf(r)); } return m; };
  const exactBefore = sumBy(self(sales), (r) => r.product);           // 옛 코드: 이름이 같으면 이름 합
  const lineBefore = sumBy(self(sales), (r) => line(r.product));      // 옛 코드: 이름이 없으면 라인 합
  const lineAfter = sumBy(self(expanded), (r) => line(r.product));    // 새 코드: 푼 뒤 라인 합
  const ledgerNames = new Set(sales.filter(inMo).map((r) => r.product));
  const spend = sumBy(ads.filter((r) => String(r.date).startsWith(mo)), (r) => r.product_name, (r) => +r.spend || 0);
  console.log(`3) 밸런스랩 ${mo} 제품별 광고 성과 (실매출은 공구 제외)`);
  console.log(`   ${pad("광고 상품", 18)}${"광고비".padStart(12)}${"실매출 전".padStart(13)}${"실ROAS 전".padStart(10)}${"실매출 후".padStart(13)}${"실ROAS 후".padStart(10)}`);
  for (const ad of ["큐모발검사 뉴트리션", "큐모발검사 중금속", "큐음식물과민증검사"]) {
    const sp = spend.get(ad) || 0;
    const b = ledgerNames.has(ad) ? exactBefore.get(ad) || 0 : lineBefore.get(line(ad)) || 0;
    const a = lineAfter.get(line(ad)) || 0;
    const r = (x) => (sp > 0 ? (x / sp).toFixed(2) + "x" : "-");
    console.log(`   ${pad(ad, 18)}${won(sp).padStart(12)}${won(b).padStart(13)}${r(b).padStart(10)}${won(a).padStart(13)}${r(a).padStart(10)}`);
  }
  const paper = self(expanded).filter((r) => r.product === "종이결과지").reduce((s, r) => s + (+r.revenue || 0), 0);
  console.log(`   종이결과지 몫(라인 밖, 광고와 안 이음) ${won(paper)}\n`);
}

// ── 4) 밸런스랩 제품별 손익 자체 판매 ──
// src/lib/bl-pnl.ts PNL_PRODUCTS 와 같다. 종이결과지 재료비 4,000원(김호 2026-11-09)
const UNIT = { nutrition: 10_000, heavy: 10_000, saliva: 36_650, food: 194_000, supplement: 30_000, paper: 4_000, etc: 10_000 };
// src/lib/bl-pnl.ts isRevenueOnlyProduct 와 같다. 미네랄 추가열람은 매출만 더하고 수량·주문건수 0
const revenueOnly = (p) => String(p ?? "").replace(/\s+/g, "") === "큐모발미네랄추가열람";
const pnlKey = (p, cat) => {
  if (p.replace(/\s+/g, "") === "종이결과지") return "paper";
  if (cat === "하루가꿈" || /메디넥스|하루가꿈/.test(p)) return "supplement";
  if (/영양제/.test(p) && !/검사/.test(p)) return "supplement";
  const l = line(p);
  return l === "hair_nutrition" ? "nutrition" : l === "hair_metal" ? "heavy" : l === "saliva" ? "saliva" : l === "food" ? "food" : "etc";
};
for (const mo of MONTHS) {
  const pick = (rows) => rows.filter((r) => r.brand === "balancelab" && String(r.date).startsWith(mo) && !isAgg(r) && !isGonggu(r));
  const agg = (rows) => { const m = {}; for (const r of pick(rows)) { const k = pnlKey(r.product, r.category); const g = (m[k] ||= { q: 0, rev: 0, o: 0 }); g.rev += +r.revenue || 0; if (revenueOnly(r.product)) continue; g.q += +r.quantity || 0; g.o += +r.buyers || 0; } return m; };
  const b = agg(sales), a = agg(expanded);
  console.log(`4) 밸런스랩 ${mo} 제품별 손익 · 자체 판매 (재료비 = 수량 × 단가)`);
  console.log(`   ${pad("제품", 11)}${"수량 전".padStart(8)}${"수량 후".padStart(8)}${"매출 전".padStart(13)}${"매출 후".padStart(13)}${"재료비 전".padStart(12)}${"재료비 후".padStart(12)}${"주문 전".padStart(8)}${"주문 후".padStart(8)}`);
  for (const k of Object.keys(UNIT)) {
    const x = b[k] || { q: 0, rev: 0, o: 0 }, y = a[k] || { q: 0, rev: 0, o: 0 };
    if (!x.q && !y.q) continue;
    console.log(`   ${pad(k, 11)}${String(x.q).padStart(8)}${String(y.q).padStart(8)}${won(x.rev).padStart(13)}${won(y.rev).padStart(13)}${won(x.q * UNIT[k]).padStart(12)}${won(y.q * UNIT[k]).padStart(12)}${String(x.o).padStart(8)}${String(y.o).padStart(8)}`);
  }
  console.log("");
}

// ── 5) 「+ 종이결과지」 나누기 ──
console.log("5) 밸런스랩 「+」 세트 판매 나누기");
for (const mo of MONTHS) {
  const rows = sales.filter((r) => r.brand === "balancelab" && String(r.date).startsWith(mo) && r.product.includes(" + "));
  for (const r of rows) {
    const parts = expandSales([r], index).map((x) => `${x.product} ${x.quantity}개 ${won(x.revenue)}`).join(" + ");
    console.log(`   ${r.date} ${r.product} ${r.quantity}개 ${won(r.revenue)} → ${parts}`);
  }
}
