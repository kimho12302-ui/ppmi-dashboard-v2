#!/usr/bin/env node
// 밸런스랩 공구 표식 보정 SQL 생성기 (2026-10-28).
//
// 왜: 판매 원장 DB(product_sales)의 2025-12 ~ 2026-05 밸런스랩 행이 공구/자체를 잘못 가르고 있다.
//   1) 1~2월(과 12월)은 Sales 시트에 셀러 이름(F열 라인업)이 비어 있어 DB 에 공구 표식(lineup)이 없다.
//      그래서 공구 매출이 전부 자체로 잡힌다(1월 공구 32,125,500원).
//   2) 3~5월은 07-02 재빌드 뒤 시트에서 공구/자체 표시를 손으로 고쳤는데 DB 는 최근 7일만 다시 읽어 옛 모습이다.
//   ★ 같은 날·같은 상품의 공구 주문과 자체 주문이 DB 에서는 한 행으로 합쳐져 있다(예: 1/19 뉴트리션
//     공구 3,689,500 + 자체 109,000 → 한 행 3,798,500). 그래서 "공구 기간이면 공구"로는 가를 수 없다.
//
// 가르는 기준: Sales 시트 E열 「브랜드명」(공동구매 / 자체판매). 주문 한 줄마다 붙어 있고,
//   6~10월은 이 열로 가른 값이 DB 와 전 칸 일치한다(= 지금 대시보드 판정과 같은 기준).
//   공구 일정표는 판정이 아니라 **셀러 이름 붙이기**에만 쓴다(F열이 빈 공동구매 줄).
//
// 하는 일: 시트(읽기 전용)와 DB(anon, 읽기만)를 읽어 날짜×상품 묶음마다 비교하고,
//   다른 묶음만 "DB 행 id 삭제 + 시트대로 다시 넣기" SQL 을 만든다.
//   묶음 합계(매출·수량·구매자 수)가 시트와 DB 가 같을 때만 바꾼다. 다르면 건너뛰고 보고한다
//   (업로드로만 들어온 DB 행을 지우는 사고를 막는다. rebuild_sales_full --apply 금지 사유와 같다).
//
// 실행: cd C:\Users\harry\projects\ppmi-dashboard-v2 && node scripts/bl-gonggu-fix-sql.mjs [--from=2025-12-01] [--to=2026-05-31] [--json=<예상 행 저장 경로>]
// 결과: docs/sql/2026-10-28-bl-gonggu.sql 을 새로 쓴다. 시트·DB 에는 쓰지 않는다.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(ROOT, "package.json"));
const { google } = require("googleapis");
const { createClient } = require("@supabase/supabase-js");

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^-+/, "").split("=")));
const FROM = args.from || "2025-12-01";
const TO = args.to || "2026-05-31";
const OUT = join(ROOT, "docs", "sql", "2026-10-28-bl-gonggu.sql");

const SALES_SHEET = "1FzxDCyR9FyAIduf7Q0lfUIOzvSqVlod21eOFqaPrXio";
const SA_FILE = join(homedir(), ".naver-searchad", "google-service-account.json");
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

// ── 공구 일정 (김호 2026-10-28 제공 원문). 연도는 적지 않고 요일로 정한다 ──
const SCHEDULE_RAW = [
  ["반짝마미", "", "12.18(목)", "12.22(월)"],
  ["웰씨맘", "", "12.22(월)", "12.27(토)"],
  ["타야", "", "12.28(일)", "12.31(수)"],
  ["심수", "", "01.05(월)", "01.11(일)"],
  ["유유맘", "", "01.12(월)", "01.15(목)"],
  ["우아띵", "", "01.16(금)", "01.20(화)"],
  ["율아맘", "", "01.21(수)", "01.24(토)"],
  ["여울맘", "", "01.26(월)", "01.29(목)"],
  ["엘플랑", "", "02.02(월)", "02.06(금)"],
  ["강산들", "", "03.13(금)", "03.20(금)"],
  ["도다미네", "", "01.26(월)", "02.01(일)"],
  ["신림댁", "", "02.11(수)", "02.14(토)"],
  ["지구의 공간", "", "02.19(목)", "02.22(일)"],
  ["유니맘", "이소현", "02.23(월)", "03.05(목)"],
  ["더에르고 3차", "", "03.09(월)", "03.13(금)"],
  ["조유경", "필라테스조유경", "03.16(월)", "03.19(목)"],
  ["듀얼홀릭", "김진영", "03.19(목)", "03.22(일)"],
  ["리리맘", "김진", "03.23(월)", "03.26(목)"],
  ["율윤이네", "강세라", "03.27(금)", "03.31(화)"],
  ["코루비", "윤혜인", "03.31(화)", "04.05(일)"],
];

const pad = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const weekdayOf = (y, m, d) => WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];

/** "12.18(목)" → 범위 안 연도 중 요일이 맞는 날짜 하나. 0개·2개면 멈춘다 */
function resolveScheduleDate(text, years) {
  const m = text.match(/^(\d{1,2})\.(\d{1,2})\((.)\)$/);
  if (!m) throw new Error(`일정 날짜 형식 오류: ${text}`);
  const [mo, d, wd] = [Number(m[1]), Number(m[2]), m[3]];
  const hits = years.filter((y) => weekdayOf(y, mo, d) === wd);
  if (hits.length !== 1) throw new Error(`일정 ${text}: 요일이 맞는 연도 ${hits.length}개 (${years.join(",")})`);
  return iso(hits[0], mo, d);
}

export function buildSchedule(years) {
  return SCHEDULE_RAW.map(([seller, person, s, e]) => {
    const start = resolveScheduleDate(s, years), end = resolveScheduleDate(e, years);
    if (end < start) throw new Error(`일정 ${seller}: 마감 ${end} 이 시작 ${start} 보다 앞`);
    return { seller, person, start, end };
  });
}

function sellerFor(date, schedule) {
  // 잇는 순서는 시작일 → 마감일 → 이름 (sync_sales_auto.py·src/lib/gonggu.ts 와 같게)
  const hit = schedule.filter((w) => w.start <= date && date <= w.end)
    .sort((x, y) => (x.start < y.start ? -1 : x.start > y.start ? 1 : x.end < y.end ? -1 : x.end > y.end ? 1 : x.seller.localeCompare(y.seller)))
    .map((w) => w.seller);
  return hit.length ? hit.join("·") : "기타";
}

// ── Sales 시트 → 주문 줄 ──
// 열: 월 / 주문일시 / 판매처 / 카테고리 / 브랜드명 / 라인업 / 제품 / 수량 / 구매자 수 / 매출
function parseSheetDate(monthCell, dayCell) {
  const a = String(monthCell).match(/(\d{2})년\s*(\d{1,2})월/);
  const b = String(dayCell).match(/(\d{1,2})월\s*(\d{1,2})일\s*\((.)\)/);
  if (!a || !b) return null;
  const y = 2000 + Number(a[1]), mo = Number(b[1]), d = Number(b[2]);
  if (mo !== Number(a[2])) throw new Error(`월 불일치: ${monthCell} / ${dayCell}`);
  if (weekdayOf(y, mo, d) !== b[3]) throw new Error(`요일 불일치: ${monthCell} ${dayCell} → ${iso(y, mo, d)}`);
  return iso(y, mo, d);
}
const num = (s) => Number(String(s || "0").replace(/,/g, "")) || 0;
function mapChannel(raw) {
  if (raw === "스마트스토어") return "smartstore";
  if (raw.startsWith("공구_")) return raw;
  throw new Error(`이 범위에서 처리하지 않는 판매처: ${raw}`);
}

async function readSheet() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(readFileSync(SA_FILE, "utf8").replace(/^\uFEFF/, "")),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SALES_SHEET, range: "Sales!A3:J" });
  return res.data.values || [];
}

function loadEnv() {
  const txt = readFileSync(join(ROOT, ".env.local"), "utf8");
  return Object.fromEntries(txt.split(/\r?\n/).filter((l) => l.includes("=")).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")];
  }));
}

async function readDb() {
  const env = loadEnv();
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const out = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await sb.from("product_sales").select("id,date,brand,category,product,channel,revenue,quantity,buyers,lineup")
      .eq("brand", "balancelab").gte("date", FROM).lte("date", TO).order("id").range(off, off + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

/** 시트 줄을 DB 키(날짜·판매처·상품·lineup)로 묶는다 */
export function sheetGroups(values, schedule) {
  const groups = new Map();
  for (const r of values) {
    const category = r[3] || "";
    if (!(category === "밸런스랩" || category.includes("하루가꿈"))) continue;
    const date = parseSheetDate(r[0], r[1]);
    if (!date || date < FROM || date > TO) continue;
    const revenue = num(r[9]);
    if (revenue === 0) continue; // 동기화 스크립트와 같은 규칙(매출 0 줄은 안 넣음)
    const channel = mapChannel(r[2]);
    const isGonggu = r[4] === "공동구매";
    if (!isGonggu && r[4] !== "자체판매") throw new Error(`브랜드명 칸이 공동구매/자체판매가 아님: ${date} ${r[4]}`);
    const lineup = r[5] ? r[5] : isGonggu ? sellerFor(date, schedule) : null;
    const product = r[6] || "";
    const key = [date, channel, product, lineup ?? ""].join("|");
    const g = groups.get(key) || { date, channel, product, lineup, category, revenue: 0, quantity: 0, buyers: 0, fromSchedule: !r[5] && isGonggu };
    g.revenue += revenue; g.quantity += num(r[7]); g.buyers += num(r[8]);
    groups.set(key, g);
  }
  return [...groups.values()];
}

const sig = (rows) => rows.map((r) => [r.channel, r.lineup || "", r.revenue, r.quantity, r.buyers].join("|")).sort().join(";");
const tot = (rows) => rows.reduce((a, r) => ({ revenue: a.revenue + Number(r.revenue), quantity: a.quantity + Number(r.quantity), buyers: a.buyers + Number(r.buyers) }), { revenue: 0, quantity: 0, buyers: 0 });

function plan(sheet, db) {
  const byKey = (rows) => {
    const m = new Map();
    for (const r of rows) { const k = `${r.date}|${r.product || ""}`; (m.get(k) || m.set(k, []).get(k)).push(r); }
    return m;
  };
  const S = byKey(sheet), D = byKey(db.map((r) => ({ ...r, revenue: Number(r.revenue), quantity: Number(r.quantity), buyers: Number(r.buyers) })));
  const replace = [], skipped = [], dbOnly = [], sheetOnly = [];
  for (const k of new Set([...S.keys(), ...D.keys()])) {
    const s = S.get(k), d = D.get(k);
    if (!s) { dbOnly.push(...d); continue; }
    if (!d) { sheetOnly.push(...s); continue; }
    if (sig(s) === sig(d)) continue;
    const ts = tot(s), td = tot(d);
    if (ts.revenue === td.revenue && ts.quantity === td.quantity && ts.buyers === td.buyers) replace.push({ key: k, sheet: s, db: d });
    else skipped.push({ key: k, sheet: ts, db: td });
  }
  replace.sort((a, b) => a.key.localeCompare(b.key));
  return { replace, skipped, dbOnly, sheetOnly };
}

const q = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);

function monthTotals(rows) {
  const m = {};
  for (const r of rows) {
    const k = r.date.slice(0, 7);
    const g = r.lineup || String(r.channel).startsWith("공구") ? "gonggu" : "self";
    m[k] = m[k] || { gonggu: 0, self: 0 };
    m[k][g] += Number(r.revenue);
  }
  return m;
}

function renderSql(schedule, p, db) {
  const ids = p.replace.flatMap((x) => x.db.map((r) => r.id)).sort((a, b) => a - b);
  const inserts = p.replace.flatMap((x) => x.sheet);
  const deletedIds = new Set(ids);
  const after = [...db.filter((r) => !deletedIds.has(r.id)), ...inserts];
  const before = monthTotals(db), expected = monthTotals(after);
  const L = [];
  L.push("-- ============================================================");
  L.push("-- 2026-10-28  밸런스랩 공구 표식 보정 (자동 생성: node scripts/bl-gonggu-fix-sql.mjs)");
  L.push("-- ============================================================");
  L.push("--");
  L.push("--  왜: 판매 원장 DB 의 2025-12 ~ 2026-05 밸런스랩 공구/자체가 시트와 다르다.");
  L.push("--    1~2월·12월: 시트에 셀러 이름이 비어 있어 공구 매출이 전부 자체로 잡힘.");
  L.push("--    3~5월: 07-02 재빌드 뒤 시트에서 손으로 고친 공구/자체 표시가 DB 에 안 들어감.");
  L.push("--  기준: Sales 시트 E열 「브랜드명」(공동구매/자체판매). 주문 한 줄마다 붙어 있다.");
  L.push("--    셀러 이름이 빈 공동구매 줄은 아래 공구 일정표의 기간으로 이름을 붙인다.");
  L.push("--    기간이 겹치는 날은 두 이름을 '·' 로 잇고, 일정에 없는 날은 '기타'.");
  L.push("--  바꾸는 범위: 날짜×상품 묶음 중 시트와 DB 가 다르고, 묶음 합계(매출·수량·구매자 수)는 같은 것만.");
  L.push("--    합계가 다른 묶음, DB 에만 있는 행은 건드리지 않는다(아래 「건드리지 않은 것」).");
  L.push("--");
  L.push("--  순서: SQL Editor 에 이 파일 전체를 붙여넣고 한 번 실행.");
  L.push("--    1부(일정표)는 몇 번 돌려도 안전. 2부(원장 보정)는 두 번째 실행에서 스스로 멈춘다.");
  L.push("--    되돌리기: product_sales_bak_20261028 에 지운 행 원본이 있다(맨 아래 주석).");
  L.push("-- ============================================================");
  L.push("");
  L.push("-- ── 1부. 공구 일정표 ──────────────────────────────────────────");
  L.push("-- 판정에 쓰지 않는다. 셀러 이름 출처이고, 손익 화면이 \"공구 기간인데 공구 표식이 하나도 없는 달\"을");
  L.push("-- 찾아 「공구 구분 불가」로 표시하는 데 쓴다. 공구가 새로 잡히면 행을 더한다.");
  L.push("create table if not exists bl_gonggu_schedule (");
  L.push("  seller    text not null,");
  L.push("  person    text,");
  L.push("  start_on  date not null,");
  L.push("  end_on    date not null,");
  L.push("  note      text,");
  L.push("  primary key (seller, start_on),");
  L.push("  check (end_on >= start_on)");
  L.push(");");
  L.push("grant select, insert, update, delete on bl_gonggu_schedule to anon, authenticated;");
  L.push("");
  L.push("insert into bl_gonggu_schedule (seller, person, start_on, end_on, note) values");
  L.push(schedule.map((w, i) => `  (${q(w.seller)}, ${q(w.person || null)}, '${w.start}', '${w.end}', '김호 2026-10-28 제공')${i === schedule.length - 1 ? "" : ","}`).join("\n"));
  L.push("on conflict (seller, start_on) do nothing;");
  L.push("");
  L.push("-- ── 2부. 판매 원장(product_sales) 보정 ──────────────────────────");
  L.push(`-- 지울 행 ${ids.length}개(id 명시), 넣을 행 ${inserts.length}개. 묶음 ${p.replace.length}개.`);
  L.push("begin;");
  L.push("create table if not exists product_sales_bak_20261028 as select * from product_sales where false;");
  L.push("do $$");
  L.push("declare n int;");
  L.push("begin");
  L.push(`  select count(*) into n from product_sales where brand = 'balancelab' and id in (${ids.join(",")});`);
  L.push(`  if n <> ${ids.length} then`);
  L.push(`    raise exception '지울 행이 ${ids.length}개여야 하는데 %개: 이미 실행했거나 원장이 바뀜. 중단(아무것도 안 바뀜)', n;`);
  L.push("  end if;");
  L.push("end $$;");
  L.push(`insert into product_sales_bak_20261028 select * from product_sales where brand = 'balancelab' and id in (${ids.join(",")});`);
  L.push(`delete from product_sales where brand = 'balancelab' and id in (${ids.join(",")});`);
  L.push("insert into product_sales (date, brand, category, product, channel, lineup, revenue, quantity, buyers, avg_price) values");
  L.push(inserts.map((r, i) => {
    const avg = r.buyers > 0 ? Math.floor(r.revenue / r.buyers) : r.revenue;
    const tag = r.fromSchedule ? "  -- 셀러 이름: 일정표" : "";
    return `  ('${r.date}', 'balancelab', ${q(r.category)}, ${q(r.product)}, ${q(r.channel)}, ${q(r.lineup)}, ${r.revenue}, ${r.quantity}, ${r.buyers}, ${avg})${i === inserts.length - 1 ? ";" : ","}${tag}`;
  }).join("\n"));
  L.push("commit;");
  L.push("");
  L.push("-- ── 3부. 결과 확인 ──────────────────────────────────────────");
  L.push("-- 월별 공구/자체 매출. 공구 = lineup 이 있거나 판매처가 '공구' 로 시작(대시보드 isGonggu 와 같은 규칙).");
  L.push("-- 기대값 (실행 전 → 실행 후):");
  for (const m of Object.keys(expected).sort()) {
    const b = before[m] || { gonggu: 0, self: 0 }, e = expected[m];
    L.push(`--   ${m}  공구 ${b.gonggu.toLocaleString("en-US")} → ${e.gonggu.toLocaleString("en-US")}  /  자체 ${b.self.toLocaleString("en-US")} → ${e.self.toLocaleString("en-US")}`);
  }
  L.push("select to_char(date, 'YYYY-MM') as month,");
  L.push("       sum(revenue) filter (where coalesce(lineup, '') <> '' or channel like '공구%') as gonggu,");
  L.push("       sum(revenue) filter (where coalesce(lineup, '') = '' and channel not like '공구%') as self");
  L.push(`from product_sales where brand = 'balancelab' and date between '${FROM}' and '${TO}'`);
  L.push("group by 1 order by 1;");
  L.push("");
  L.push("-- ── 건드리지 않은 것 ──");
  if (!p.skipped.length && !p.dbOnly.length && !p.sheetOnly.length) L.push("--   없음");
  for (const s of p.skipped) L.push(`--   합계 다름(건너뜀) ${s.key}: 시트 ${s.sheet.revenue}/${s.sheet.quantity}/${s.sheet.buyers}, DB ${s.db.revenue}/${s.db.quantity}/${s.db.buyers}`);
  for (const r of p.dbOnly) L.push(`--   DB 에만 있음 id ${r.id} ${r.date} 상품 '${r.product}' ${r.revenue}원 ${r.quantity}개 (시트에 같은 날·상품 줄 없음)`);
  for (const r of p.sheetOnly) L.push(`--   시트에만 있음 ${r.date} '${r.product}' ${r.revenue}원 (DB 에 같은 날·상품 행 없음)`);
  L.push("");
  L.push("-- ── 되돌리기 (필요할 때만) ──");
  L.push("-- begin;");
  L.push(`-- delete from product_sales where brand = 'balancelab' and date between '${FROM}' and '${TO}'`);
  L.push("--   and id not in (select id from product_sales_bak_20261028)");
  L.push(`--   and created_at >= '2026-10-28';  -- 이 파일이 넣은 행`);
  L.push("-- insert into product_sales select * from product_sales_bak_20261028;");
  L.push("-- commit;");
  L.push("");
  return { sql: L.join("\n"), ids, inserts, after };
}

async function main() {
  const years = [...new Set([Number(FROM.slice(0, 4)), Number(TO.slice(0, 4))])];
  const schedule = buildSchedule(years);
  const [values, db] = await Promise.all([readSheet(), readDb()]);
  const sheet = sheetGroups(values, schedule);
  const p = plan(sheet, db);
  const { sql, ids, inserts, after } = renderSql(schedule, p, db);
  writeFileSync(OUT, sql, "utf8");
  if (args.json) writeFileSync(args.json, JSON.stringify(after), "utf8");
  console.log(`일정 ${schedule.length}행: ${schedule.map((w) => `${w.seller} ${w.start}~${w.end}`).join(", ")}`);
  console.log(`바꿀 묶음 ${p.replace.length}개, 지울 행 ${ids.length}, 넣을 행 ${inserts.length}`);
  console.log(`합계 달라 건너뜀 ${p.skipped.length}, DB 에만 ${p.dbOnly.length}, 시트에만 ${p.sheetOnly.length}`);
  for (const s of p.skipped) console.log("  건너뜀", s.key, JSON.stringify(s));
  for (const r of p.dbOnly) console.log("  DB 에만", r.id, r.date, `'${r.product}'`, r.revenue);
  for (const r of p.sheetOnly) console.log("  시트에만", r.date, `'${r.product}'`, r.revenue);
  console.log(`썼음: ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
