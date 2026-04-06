/**
 * PPMI Dashboard v3 — 데이터 정합성 테스트
 * 실행: node scripts/integrity-test.mjs
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://phcfydxgwkmjiogerqmm.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBoY2Z5ZHhnd2ttamlvZ2VycW1tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1Njg4NjQsImV4cCI6MjA4OTE0NDg2NH0.M0ThTSK0kBvN71rccvzQpr3dQuL52oRs_Tj9MT7VWRg";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const KST_NOW = new Date(Date.now() + 32400000);
const TODAY = KST_NOW.toISOString().slice(0, 10);
const YESTERDAY = new Date(KST_NOW - 86400000).toISOString().slice(0, 10);
const WEEK_AGO = new Date(KST_NOW - 7 * 86400000).toISOString().slice(0, 10);
const MONTH_AGO = new Date(KST_NOW - 30 * 86400000).toISOString().slice(0, 10);

let passed = 0;
let failed = 0;
let warned = 0;

function ok(label, detail = "") {
  console.log(`  ✅ ${label}${detail ? " — " + detail : ""}`);
  passed++;
}
function fail(label, detail = "") {
  console.log(`  ❌ ${label}${detail ? " — " + detail : ""}`);
  failed++;
}
function warn(label, detail = "") {
  console.log(`  ⚠️  ${label}${detail ? " — " + detail : ""}`);
  warned++;
}

async function fetchAll(table, select, filters = {}) {
  let all = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    let q = supabase.from(table).select(select).range(from, from + PAGE - 1);
    for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    all = all.concat(data || []);
    if ((data || []).length < PAGE) break;
    from += PAGE;
  }
  return all;
}

// ── T1. daily_funnel: brand 컬럼에 채널명 없어야 함 ─────────────────────────
async function testFunnelBrandColumn() {
  console.log("\n[T1] daily_funnel brand 컬럼 정합성");
  const bad = ["nutty", "cafe24", "smartstore", "coupang", "balancelab_smartstore"];
  const data = await fetchAll("daily_funnel", "brand");
  const brandSet = new Set(data.map((r) => r.brand));
  const leaked = bad.filter((b) => brandSet.has(b));
  if (leaked.length === 0) {
    ok("brand 컬럼에 채널명 없음", `확인된 brand 값: ${[...brandSet].join(", ")}`);
  } else {
    fail("brand 컬럼에 채널명 존재!", `잔류: ${leaked.join(", ")}`);
  }
}

// ── T2. daily_funnel: channel 컬럼 존재 및 유효값 ───────────────────────────
async function testFunnelChannelColumn() {
  console.log("\n[T2] daily_funnel channel 컬럼");
  const data = await fetchAll("daily_funnel", "channel");
  const channelSet = new Set(data.map((r) => r.channel));
  const validChannels = new Set(["cafe24", "smartstore", "coupang", "all"]);
  const invalid = [...channelSet].filter((c) => !validChannels.has(c));

  if (data.length === 0) {
    warn("daily_funnel 데이터 없음");
    return;
  }
  if (invalid.length === 0) {
    ok(`channel 값 정상 (${data.length}행)`, `값: ${[...channelSet].join(", ")}`);
  } else {
    fail("비정상 channel 값 존재", `예상 외: ${invalid.join(", ")}`);
  }
}

// ── T3. daily_funnel: (date, brand, channel) 중복 없어야 함 ─────────────────
async function testFunnelDuplicates() {
  console.log("\n[T3] daily_funnel 중복 행 검사");
  const data = await fetchAll("daily_funnel", "date,brand,channel");
  const seen = new Map();
  const dupes = [];
  for (const r of data) {
    const key = `${r.date}|${r.brand}|${r.channel}`;
    if (seen.has(key)) dupes.push(key);
    else seen.set(key, true);
  }
  if (dupes.length === 0) {
    ok(`중복 없음 (${data.length}행)`);
  } else {
    fail(`중복 ${dupes.length}건`, dupes.slice(0, 3).join(", "));
  }
}

// ── T4. daily_ad_spend: 미래 날짜 데이터 없어야 함 ──────────────────────────
async function testNoFutureDates() {
  console.log("\n[T4] 미래 날짜 데이터 검사");
  const tables = ["daily_ad_spend", "daily_sales", "daily_funnel", "product_sales"];
  for (const table of tables) {
    const { data } = await supabase
      .from(table)
      .select("date")
      .gt("date", TODAY)
      .limit(5);
    if (!data || data.length === 0) {
      ok(`${table}: 미래 날짜 없음`);
    } else {
      fail(`${table}: 미래 날짜 ${data.length}건`, data.map((r) => r.date).join(", "));
    }
  }
}

// ── T5. daily_ad_spend: GA4 채널이 광고비 집계에 포함되지 않아야 함 ──────────
async function testGA4NotInAdSpend() {
  console.log("\n[T5] GA4 채널 광고비 중복 검사");
  const { data } = await supabase
    .from("daily_ad_spend")
    .select("channel,spend")
    .like("channel", "ga4_%")
    .gt("spend", 0)
    .limit(10);
  if (!data || data.length === 0) {
    ok("GA4 채널에 광고비 없음 (정상 — 퍼널 전용)");
  } else {
    const total = data.reduce((s, r) => s + (r.spend || 0), 0);
    fail(`GA4 채널에 광고비 ${data.length}건 (합계 ${total.toLocaleString()}원)`,
      "GA4는 퍼널 전용, 광고비 0이어야 함");
  }
}

// ── T6. daily_sales: 최근 7일 데이터 연속성 ─────────────────────────────────
async function testSalesRecency() {
  console.log("\n[T6] 판매 데이터 최신성");
  const { data } = await supabase
    .from("daily_sales")
    .select("date")
    .order("date", { ascending: false })
    .limit(1);
  const latest = data?.[0]?.date;
  if (!latest) {
    warn("daily_sales 데이터 없음");
    return;
  }
  const daysOld = Math.floor((Date.now() - new Date(latest).getTime()) / 86400000);
  if (daysOld <= 1) {
    ok(`최신 판매 데이터: ${latest} (${daysOld}일 전)`);
  } else if (daysOld <= 3) {
    warn(`판매 데이터 ${daysOld}일 미갱신 (최신: ${latest})`);
  } else {
    fail(`판매 데이터 ${daysOld}일 미갱신!`, `최신: ${latest}`);
  }
}

// ── T7. 광고 채널별 최신성 ─────────────────────────────────────────────────
async function testAdSpendRecency() {
  console.log("\n[T7] 광고비 채널별 최신성");
  const channels = [
    { id: "meta", label: "Meta" },
    { id: "google_pmax", label: "Google P-Max" },
    { id: "naver_search", label: "Naver 검색" },
    { id: "naver_shopping", label: "Naver 쇼핑" },
    { id: "coupang_ads", label: "쿠팡 광고" },
    { id: "gfa", label: "GFA" },
  ];
  for (const ch of channels) {
    const { data } = await supabase
      .from("daily_ad_spend")
      .select("date")
      .eq("channel", ch.id)
      .order("date", { ascending: false })
      .limit(1);
    const latest = data?.[0]?.date;
    if (!latest) {
      warn(`${ch.label}: 데이터 없음`);
    } else {
      const daysOld = Math.floor((Date.now() - new Date(latest).getTime()) / 86400000);
      if (daysOld <= 1) ok(`${ch.label}: ${latest}`);
      else if (daysOld <= 3) warn(`${ch.label}: ${daysOld}일 미갱신 (${latest})`);
      else fail(`${ch.label}: ${daysOld}일 미갱신!`, latest);
    }
  }
}

// ── T8. 퍼널 채널별 최신성 ────────────────────────────────────────────────
async function testFunnelRecency() {
  console.log("\n[T8] 퍼널 채널별 최신성");
  const sources = [
    { channel: "cafe24", brand: null, label: "카페24 (자사몰)" },
    { channel: "smartstore", brand: "all", label: "스마트스토어 (너티/아이언펫)" },
    { channel: "smartstore", brand: "balancelab", label: "스마트스토어 (밸런스랩)" },
    { channel: "coupang", brand: null, label: "쿠팡 퍼널" },
  ];
  for (const src of sources) {
    let q = supabase.from("daily_funnel").select("date").eq("channel", src.channel);
    if (src.brand) q = q.eq("brand", src.brand);
    const { data } = await q.order("date", { ascending: false }).limit(1);
    const latest = data?.[0]?.date;
    if (!latest) {
      warn(`${src.label}: 데이터 없음`);
    } else {
      const daysOld = Math.floor((Date.now() - new Date(latest).getTime()) / 86400000);
      if (daysOld <= 1) ok(`${src.label}: ${latest}`);
      else if (daysOld <= 3) warn(`${src.label}: ${daysOld}일 미갱신 (${latest})`);
      else fail(`${src.label}: ${daysOld}일 미갱신!`, latest);
    }
  }
}

// ── T9. product_sales: 브랜드별 최근 30일 매출 > 0 ──────────────────────────
async function testProductSalesBrands() {
  console.log("\n[T9] 브랜드별 제품 매출 데이터 존재 여부 (최근 30일)");
  const brands = ["nutty", "ironpet", "saip", "balancelab"];
  for (const brand of brands) {
    const { data } = await supabase
      .from("product_sales")
      .select("revenue")
      .eq("brand", brand)
      .gte("date", MONTH_AGO)
      .limit(1);
    if (data && data.length > 0) {
      ok(`${brand}: 제품 매출 있음`);
    } else {
      warn(`${brand}: 최근 30일 제품 매출 없음`);
    }
  }
}

// ── T10. daily_sales: 브랜드+채널 조합 최근 30일 ───────────────────────────
async function testSalesBrandChannels() {
  console.log("\n[T10] 판매 채널×브랜드 조합 검사 (최근 30일)");
  const { data } = await supabase
    .from("daily_sales")
    .select("brand,channel")
    .gte("date", MONTH_AGO);

  if (!data || data.length === 0) {
    warn("daily_sales 최근 30일 데이터 없음");
    return;
  }

  const combos = new Set(data.map((r) => `${r.brand}|${r.channel}`));
  ok(`${combos.size}개 brand×channel 조합`, [...combos].join(", "));

  // 비어있는 brand 체크
  const emptyBrand = data.filter((r) => !r.brand || r.brand === "");
  if (emptyBrand.length > 0) {
    fail(`brand 없는 행 ${emptyBrand.length}건`);
  }
}

// ── T11. 매출-광고비 ROAS 이상치 검사 ─────────────────────────────────────
async function testRoasAnomalies() {
  console.log("\n[T11] 최근 7일 ROAS 이상치 검사");
  const { data: ads } = await supabase
    .from("daily_ad_spend")
    .select("channel,spend,conversion_value")
    .gte("date", WEEK_AGO)
    .not("channel", "like", "ga4_%");

  if (!ads || ads.length === 0) {
    warn("최근 7일 광고비 데이터 없음");
    return;
  }

  const byChannel = {};
  for (const r of ads) {
    if (!byChannel[r.channel]) byChannel[r.channel] = { spend: 0, conv: 0 };
    byChannel[r.channel].spend += r.spend || 0;
    byChannel[r.channel].conv += r.conversion_value || 0;
  }

  for (const [ch, v] of Object.entries(byChannel)) {
    if (v.spend <= 0) continue;
    const roas = v.conv / v.spend;
    if (roas === 0) {
      warn(`${ch}: ROAS=0 (전환 추적 미연결 가능)`);
    } else if (roas < 1) {
      fail(`${ch}: ROAS ${roas.toFixed(2)}x — 광고비 대비 전환 부족`);
    } else if (roas > 20) {
      warn(`${ch}: ROAS ${roas.toFixed(2)}x — 비정상적으로 높음`);
    } else {
      ok(`${ch}: ROAS ${roas.toFixed(2)}x`);
    }
  }
}

// ── T12. brand_config / channel_config DB 설정 존재 ─────────────────────────
async function testConfigTables() {
  console.log("\n[T12] 설정 테이블 (brand_config / channel_config)");
  const { data: brands } = await supabase.from("brand_config").select("key,label,active");
  const { data: channels } = await supabase.from("channel_config").select("key,label,type,active");

  if (!brands || brands.length === 0) {
    warn("brand_config 비어있음 (하드코딩 fallback 사용 중)");
  } else {
    ok(`brand_config: ${brands.length}개`, brands.filter((b) => b.active).map((b) => b.label).join(", "));
  }

  if (!channels || channels.length === 0) {
    warn("channel_config 비어있음 (하드코딩 fallback 사용 중)");
  } else {
    ok(`channel_config: ${channels.length}개`, channels.filter((c) => c.active).map((c) => c.label).join(", "));
  }
}

// ── T13. marketing_events 테이블 접근 ────────────────────────────────────────
async function testEventsTable() {
  console.log("\n[T13] marketing_events 테이블");
  const { data, error } = await supabase.from("marketing_events").select("id").limit(1);
  if (error) {
    fail("marketing_events 접근 실패", error.message);
  } else {
    ok(`marketing_events 접근 가능 (${data?.length ?? 0}건 샘플)`);
  }
}

// ── 실행 ─────────────────────────────────────────────────────────────────────
console.log("=".repeat(60));
console.log("  PPMI Dashboard v3 — 데이터 정합성 테스트");
console.log(`  기준일: ${TODAY} (KST), 어제: ${YESTERDAY}`);
console.log("=".repeat(60));

try {
  await testFunnelBrandColumn();
  await testFunnelChannelColumn();
  await testFunnelDuplicates();
  await testNoFutureDates();
  await testGA4NotInAdSpend();
  await testSalesRecency();
  await testAdSpendRecency();
  await testFunnelRecency();
  await testProductSalesBrands();
  await testSalesBrandChannels();
  await testRoasAnomalies();
  await testConfigTables();
  await testEventsTable();
} catch (e) {
  console.error("\n❌ 테스트 실행 오류:", e.message);
  process.exit(1);
}

console.log("\n" + "=".repeat(60));
console.log(`  결과: ✅ ${passed}  ⚠️  ${warned}  ❌ ${failed}`);
console.log("=".repeat(60));
process.exit(failed > 0 ? 1 : 0);
