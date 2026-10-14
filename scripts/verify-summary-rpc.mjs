#!/usr/bin/env node
// DB 합산 함수(RPC) 3개가 옛 경로(원본 행을 받아 JS 로 더하기)와 같은 숫자를 내는지 대조한다.
//
// 언제: docs/sql/2026-10-14-summary-rpc.sql 을 Supabase SQL Editor 에서 실행한 뒤.
// 실행: cd C:\Users\harry\projects\ppmi-dashboard-v2 && node scripts/verify-summary-rpc.mjs
// 결과: 마지막 줄에 "불일치 0" 이면 정상, 아니면 어긋난 묶음을 찍고 exit 1.
//
// 대조 단위는 합계 하나가 아니라 **묶음 하나하나**다(키워드별, 날짜×상품별, 월×채널별 …).
// 묶음 수, 묶음마다의 매출·광고비·노출·클릭·수량, 묶인 원본 행 수(n)를 전부 맞춰 본다.
// 기간은 오늘(KST) 기준 이번 달·지난달·올해, 브랜드는 전체·밸런스랩·너티·아이언펫·사입·펫.
//
// 읽기만 한다. anon 키를 쓰고 표에 쓰지 않는다.
//
// 개발용: --pglite=<json 폴더> --pglite-module=<@electric-sql/pglite 경로> 를 주면 Supabase 대신
// 로컬 메모리 Postgres 에 같은 SQL 을 올려 대조한다(SQL 실행 전 사전 시험용).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SQL_FILE = join(ROOT, "docs", "sql", "2026-10-14-summary-rpc.sql");
const TOL = 0.01; // 원 단위 합계의 부동소수 오차 허용(더하는 순서가 달라 생기는 1e-9 수준 차이)
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^-+/, "").split("=")));

// ── 기간: 오늘(KST)에서 파싱으로 만든다. 연도를 코드에 적지 않는다 ──
function kstToday() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
function periods(today) {
  const [y, m] = today.split("-").map(Number);
  const pad = (n) => String(n).padStart(2, "0");
  const lastDay = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
  return [
    { name: "이번 달", from: `${y}-${pad(m)}-01`, to: today },
    { name: "지난달", from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${pad(lastDay(py, pm))}` },
    { name: "올해", from: `${y}-01-01`, to: today },
  ];
}
// src/lib/brand-groups.ts expandBrands 와 같다. null = 전체(필터 없음)
const BRANDS = { all: null, balancelab: ["balancelab"], nutty: ["nutty"], ironpet: ["ironpet"], saip: ["saip"], pet: ["nutty", "ironpet", "saip"] };

// ── 저장소 두 가지: Supabase REST(기본) / pglite(개발용) ──
// 필터는 작은 목록으로 적고 각 저장소가 자기 말로 바꾼다.
//   ["gte", col, v] ["lte", col, v] ["eq", col, v] ["neq", col, v] ["notlike", col, v] ["in", col, [..]]
function loadEnv() {
  const txt = readFileSync(join(ROOT, ".env.local"), "utf8");
  return Object.fromEntries(txt.split(/\r?\n/).map((l) => l.match(/^([A-Z0-9_]+)="?([^"]*)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]));
}

function restStore() {
  const env = { ...loadEnv(), ...process.env };
  const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!U || !K) { console.error("NEXT_PUBLIC_SUPABASE_URL / ANON_KEY 를 .env.local 에서 못 찾음"); process.exit(1); }
  const H = { apikey: K, Authorization: `Bearer ${K}`, "Content-Type": "application/json" };
  const enc = (v) => encodeURIComponent(v);
  const toQs = (filters) => filters.map(([op, c, v]) => {
    if (op === "in") return `${c}=in.(${v.map((x) => `"${x}"`).map(enc).join(",")})`;
    if (op === "notlike") return `${c}=not.like.${enc(v.replace(/%/g, "*"))}`;
    return `${c}=${op}.${enc(v)}`;
  }).join("&");
  return {
    async rows(table, cols, filters) {
      const all = [];
      for (let off = 0; ; off += 1000) {
        const r = await fetch(`${U}/rest/v1/${table}?select=${cols}&${toQs(filters)}&order=id&offset=${off}&limit=1000`, { headers: H });
        if (!r.ok) throw new Error(`${table} ${r.status} ${await r.text()}`);
        const j = await r.json();
        all.push(...j);
        if (j.length < 1000) return all;
      }
    },
    async rpc(name, params) {
      const r = await fetch(`${U}/rest/v1/rpc/${name}`, { method: "POST", headers: H, body: JSON.stringify(params) });
      if (!r.ok) throw new Error(`rpc ${name} ${r.status} ${await r.text()}`);
      return r.json();
    },
  };
}

async function pgliteStore(dir, modPath) {
  const { PGlite } = await import(pathToFileURL(modPath).href);
  const db = new PGlite();
  const DDL = {
    keyword_performance: "id int, date date, brand text, platform text, keyword text, impressions int, clicks int, cost float8, conversions int, conversion_value float8",
    product_sales: "id int, date date, brand text, product text, channel text, lineup text, revenue float8, quantity int",
    daily_sales: "id int, date date, brand text, channel text, revenue float8, orders int",
    daily_ad_spend: "id int, date date, brand text, channel text, spend float8, conversion_value float8, impressions int, clicks int",
  };
  for (const [t, ddl] of Object.entries(DDL)) {
    await db.exec(`create table ${t} (${ddl});`);
    const cols = ddl.split(",").map((s) => s.trim().split(" ")[0]);
    const data = JSON.parse(readFileSync(join(dir, `${t}.json`), "utf8"));
    await db.query(`insert into ${t} select * from json_populate_recordset(null::${t}, $1::json)`, [JSON.stringify(data.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null]))))]);
  }
  await db.exec("create role anon; create role authenticated;");
  await db.exec(readFileSync(SQL_FILE, "utf8"));
  const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
  const toWhere = (filters) => filters.map(([op, c, v]) => {
    if (op === "in") return `${c} in (${v.map(lit).join(",")})`;
    if (op === "notlike") return `not (${c} like ${lit(v)})`;
    const sym = { gte: ">=", lte: "<=", eq: "=", neq: "<>" }[op];
    return `${c} ${sym} ${lit(v)}`;
  }).join(" and ") || "true";
  return {
    async rows(table, cols, filters) {
      const r = await db.query(`select ${cols} from ${table} where ${toWhere(filters)} order by id`);
      return r.rows.map((x) => ({ ...x, date: x.date instanceof Date ? x.date.toISOString().slice(0, 10) : x.date }));
    },
    async rpc(name, p) {
      const r = await db.query(`select ${name}($1::date, $2::date, $3::text[]) as j`, [p.p_from, p.p_to, p.p_brands]);
      return r.rows[0].j;
    },
  };
}

// ── 옛 경로와 같은 필터로 원본을 받아 같은 키로 묶는다 ──
const num = (v) => Number(v) || 0;
function group(rows, keyFn, metrics) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    const g = m.get(k) || { n: 0, ...Object.fromEntries(metrics.map((x) => [x, 0])) };
    g.n += 1;
    for (const x of metrics) g[x] += num(r[x]);
    m.set(k, g);
  }
  return m;
}
const rangeF = (p) => [["gte", "date", p.from], ["lte", "date", p.to]];
const brandF = (b, allExcludesMagic) => (b ? [["in", "brand", b]] : allExcludesMagic ? [["neq", "brand", "all"]] : []);

let mismatches = 0;
let checked = 0;
function compare(label, oldMap, rpcMap, metrics) {
  checked++;
  const bad = [];
  if (oldMap.size !== rpcMap.size) bad.push(`묶음 수 옛 ${oldMap.size} / 함수 ${rpcMap.size}`);
  for (const [k, o] of oldMap) {
    const r = rpcMap.get(k);
    if (!r) { bad.push(`함수에 없음: ${k}`); continue; }
    for (const x of ["n", ...metrics]) if (Math.abs(num(o[x]) - num(r[x])) > TOL) bad.push(`${k} ${x}: 옛 ${o[x]} / 함수 ${r[x]}`);
  }
  for (const k of rpcMap.keys()) if (!oldMap.has(k)) bad.push(`옛 경로에 없음: ${k}`);
  const tot = (m, x) => Array.from(m.values()).reduce((s, g) => s + num(g[x]), 0);
  const sums = ["n", ...metrics].map((x) => `${x}=${Math.round(tot(oldMap, x) * 100) / 100}`).join(" ");
  if (bad.length) { mismatches += bad.length; console.log(`✗ ${label}  ${sums}`); for (const b of bad.slice(0, 10)) console.log(`    ${b}`); }
  else console.log(`✓ ${label}  묶음 ${oldMap.size}  ${sums}`);
}
const rpcMapOf = (arr, keyFn) => new Map((arr || []).map((g) => [keyFn(g), g]));

async function main() {
  const store = args.pglite ? await pgliteStore(args.pglite, args["pglite-module"]) : restStore();
  const today = args.today || kstToday();
  console.log(`기준일 ${today} · 저장소 ${args.pglite ? "pglite(개발용)" : "Supabase"}`);

  for (const p of periods(today)) {
    for (const [bk, b] of Object.entries(BRANDS)) {
      const rp = { p_from: p.from, p_to: p.to, p_brands: b };
      const tag = `${p.name} ${bk}`;

      // 1) 키워드: /api/keywords 옛 경로 = 기간 + (전체면 브랜드 필터 없음)
      const kw = await store.rows("keyword_performance", "id,platform,keyword,impressions,clicks,cost,conversions,conversion_value", [...rangeF(p), ...brandF(b, false)]);
      const kwOld = group(kw, (r) => `${r.platform}|${r.keyword}`, ["impressions", "clicks", "cost", "conversions", "conversion_value"]);
      for (const r of kw) if (num(r.conversion_value) === 0) { const g = kwOld.get(`${r.platform}|${r.keyword}`); g.wasted_cost = (g.wasted_cost || 0) + num(r.cost); }
      for (const g of kwOld.values()) g.wasted_cost = g.wasted_cost || 0;
      compare(`키워드 ${tag}`, kwOld, rpcMapOf(await store.rpc("keyword_summary", rp), (g) => `${g.platform}|${g.keyword}`), ["impressions", "clicks", "cost", "conversions", "conversion_value", "wasted_cost"]);

      // 2) 상품 일별: /api/product-sales 옛 경로 = 기간 + (전체면 필터 없음)
      const ps = await store.rows("product_sales", "id,date,brand,product,revenue,quantity", [...rangeF(p), ...brandF(b, false)]);
      compare(`상품일별 ${tag}`, group(ps, (r) => `${r.date}|${r.brand}|${r.product}`, ["revenue", "quantity"]),
        rpcMapOf(await store.rpc("product_sales_daily", rp), (g) => `${g.date}|${g.brand}|${g.product}`), ["revenue", "quantity"]);

      // 3) 월간: /api/monthly-summary 옛 경로의 네 묶음
      const ms = await store.rpc("monthly_summary_parts", rp);
      const month = (r) => String(r.date).slice(0, 7);
      const sales = await store.rows("daily_sales", "id,date,revenue,orders", [...rangeF(p), ["neq", "channel", "total"], ["notlike", "channel", "공구%"], ...brandF(b, true)]);
      compare(`월매출 ${tag}`, group(sales, month, ["revenue", "orders"]), rpcMapOf(ms.sales, (g) => g.month), ["revenue", "orders"]);
      const ads = await store.rows("daily_ad_spend", "id,date,channel,spend,conversion_value", [...rangeF(p), ["notlike", "channel", "ga4_%"], ...brandF(b, true)]);
      compare(`월광고비 ${tag}`, group(ads, (r) => `${month(r)}|${r.channel}`, ["spend", "conversion_value"]), rpcMapOf(ms.ads, (g) => `${g.month}|${g.channel}`), ["spend", "conversion_value"]);
      const gg = await store.rows("product_sales", "id,date,channel,lineup,product,revenue", [...rangeF(p), ["eq", "brand", "balancelab"]]);
      compare(`월공구원본 ${tag}`, group(gg, (r) => `${month(r)}|${r.channel}|${r.lineup}|${r.product}`, ["revenue"]), rpcMapOf(ms.gonggu, (g) => `${g.month}|${g.channel}|${g.lineup}|${g.product}`), ["revenue"]);
      const cg = await store.rows("product_sales", "id,date,product,brand,channel,lineup,quantity", [...rangeF(p), ...brandF(b, false)]);
      compare(`월원가원본 ${tag}`, group(cg, (r) => `${month(r)}|${r.product}|${r.brand}|${r.channel}|${r.lineup}`, ["quantity"]), rpcMapOf(ms.cogs, (g) => `${g.month}|${g.product}|${g.brand}|${g.channel}|${g.lineup}`), ["quantity"]);
    }
  }
  console.log(`\n대조 ${checked}건 · 불일치 ${mismatches}`);
  process.exit(mismatches === 0 ? 0 : 1);
}

main().catch((e) => { console.error("실패:", e.message || e); process.exit(1); });
