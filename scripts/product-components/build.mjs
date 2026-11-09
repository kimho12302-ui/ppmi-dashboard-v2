#!/usr/bin/env node
// 판매 상품 구성표 시드 만들기 (2026-11-09).
//
// 하는 일
//   1) 판매 원장(product_sales, 2025-01 이후)의 브랜드·상품명을 전부 읽는다 (anon 키, 읽기만)
//   2) 아래 규칙으로 판매 상품 → 기본 품목 × 수량을 정한다
//   3) seed.json(이 폴더)과 docs/sql/2026-11-09-product-components.sql 을 쓴다
//
// 실행: cd C:\Users\harry\projects\ppmi-dashboard-v2 ; node scripts/product-components/build.mjs
//   새 상품이 생기면 다시 돌린다. 규칙에 안 걸린 이름은 「그대로(자기 자신 1개)」로 들어가고
//   needs_review 가 켜져 마지막 줄에 이름이 찍힌다. 그 이름을 MANUAL 에 넣고 다시 돌린다.
//   SQL 은 몇 번 실행해도 안전하다(같은 판매 상품의 줄을 지우고 다시 넣는다).
//
// 근거 원천
//   - 통계시트 「상품 목록」(src/lib/product-master.json): 이름·품목코드 가족
//   - 매출보고시트 「거래처코드&품목코드」 원가표: 묶음 원가가 단품 원가의 정수배인지(냠 4개입 18,000 = 4,500×4)
//   - 판매 원장 단가(매출÷수량): 「냠 2개」 단가가 「냠」의 약 2배인지
//   - 정가(세트 매출 나누기용): 판매 원장에서 관측한 단품 최빈 판매가. 단가/마진표 시트는 서비스 계정에
//     권한이 없어(403) 못 읽었다. 출처는 각 줄 note 에 적는다.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const SEED_FILE = join(HERE, "seed.json");
const SQL_FILE = join(ROOT, "docs", "sql", "2026-11-09-product-components.sql");
const SINCE = "2025-01-01";

// ── 기본 품목 정가 (세트 매출을 나눌 때만 쓴다) ──────────────────────────
const PRICE = {
  balancelab: {
    "큐모발검사 뉴트리션": [99_000, "자체판매 단품 최빈가 99,000(109,000 도 있음)"],
    "큐모발검사 중금속": [70_000, "자체판매 단품 최빈가 70,000"],
    "종이결과지": [4_000, "「+ 종이결과지」 상품과 단품의 차이: 뉴트리션 103,000−99,000, 중금속 74,000−70,000, 69,000−65,000"],
    "맞춤영양제": [45_000, "맞춤영양제 단품 45,000, 뉴트리션+영양제 144,000 = 99,000+45,000"],
    "큐타액호르몬검사": [149_000, "단품 판매가 149,000"],
  },
  nutty: {
    // 자사몰(cafe24) 단품 최빈가. 50% 할인 때 9,500·12,500 처럼 반값이 같이 보인다.
    "냠 단호박": [19_000, "자사몰 단품 최빈가 19,000"],
    "바삭 닭가슴살": [17_000, "자사몰 단품 최빈가 17,000"],
    "스트레스제로껌": [19_000, "자사몰 단품 최빈가 19,000"],
    "에너젯바": [25_000, "자사몰 단품 25,000(반값 12,500)"],
    "굿모닝퓨레": [16_000, "자사몰 단품 최빈가 16,000"],
  },
  saip: {
    "펌킨 독 멧돼지&사과 미니알갱이 100g": [3_400, "100g 단품 최빈가"],
    "오션 독 대구&오렌지 미니알갱이 100g": [3_500, "100g 단품 최빈가"],
  },
};

// ── 너티: 이름별로 정한다 (쿠팡 긴 이름은 무게가 팩당 무게라 일반 규칙으로 못 푼다) ──
const N = { yam: "냠 단호박", crisp: "바삭 닭가슴살", gum: "스트레스제로껌", bar: "에너젯바", puree: "굿모닝퓨레" };
const one = (c, qty = 1) => [[c, qty]];

/** [판매 상품명, 구성 [[품목, 수량]...], note, needs_review]: 판단이 들어간 줄(source manual) */
const MANUAL = {
  nutty: [
    ["스트레스 제로 껌", one(N.gum), "2025년 옛 이름"],
    ["냠", one(N.yam), "2025년 옛 이름"],
    ["바삭", one(N.crisp), "2025년 옛 이름"],
    ["굿모닝 퓨레", one(N.puree), "2025년 옛 이름"],
    ["너티 냠냠 강아지 노령견 노견 간식 부드러운 수제 영양간식 20g 8개 고구마", one(N.yam),
      "쿠팡 이름. 20g×8 = 냠 단호박 한 팩, 단가 8,900 = 쿠팡 냠 단호박 최빈가. 「8개」는 팩 안 조각 수"],
    ["단호박 고구마 양갱 부드러운 노견 간식 부드러운 수제 영양간식 고구마+단호박, 640g, 4개", one(N.yam, 4),
      "품목코드 P00000CK_3 = 냠 단호박 4개입(원가 18,000 = 4,500×4), 640g = 160g×4"],
    ["냠 단호박_낱개", one(N.yam, 2),
      "판단: 2개 묶음으로 봄. 원가표 9,000 = 냠 4,500×2, 쿠팡 단가 16,850 = 냠 8,900의 1.9배. 원장에 「냠 단호박 2개」 이름이 따로 없음", true],
    ["너티 강아지 닭가슴살간식 수제간식 바삭칩 개과자 쿠키 80g 1개 닭가슴살", one(N.crisp),
      "쿠팡 이름. 80g 1개 = 바삭 닭가슴살 한 팩(단가 6,550 = 쿠팡 바삭 최빈가)"],
    ["너티 강아지 닭가슴살 수제간식 바삭칩 개과자 쿠키 닭가슴살, 80g, 1개", one(N.crisp), "상품 목록 이름(광고 연결용)"],
    ["바삭! 닭가슴살 * 3개", one(N.crisp, 3),
      "판단: 이름대로 바삭 3개. 단, 상품 목록 품목코드 P00000CK_2 가 원가표에서는 「냠 단호박 3개입」이라 어긋남", true],
    ["바삭! 닭가슴살 * 4개", one(N.crisp, 4), "품목코드 P00000CJ_3 = 바삭 4개입(원가 14,000 = 3,500×4)"],
    ["너티 하루루틴 에너젯바 2개입", one(N.bar, 2), "쿠팡 이름. 매출보고시트 「에너젯바 2개입」"],
    ["너티 강아지 에너지스틱 고단백 저칼로리 수제간식 15p, 3개, 165g, 닭가슴살 (닭가슴살 165g 3개)", one(N.bar, 3),
      "쿠팡 이름. 165g = 11g×15 한 팩, 단가 19,900 = 매출보고시트 에너젯바 3개입"],
    ["너티 반려동물 퓨레 스틱 약먹이기 대용량 짜먹는 간식 15p, 2개, 180g, 연어", one(N.puree, 2),
      "쿠팡 이름. 180g = 12g×15 한 팩, 단가 9,900 = 매출보고시트 굿모닝퓨레 2개입"],
    ["너티 반려동물 퓨레 스틱 약먹이기 대용량 짜먹는 간식 15p, 3개, 180g, 연어 (연어 180g 3개)", one(N.puree, 3),
      "쿠팡 이름. 단가 13,900 = 매출보고시트 굿모닝퓨레 3개입"],
    ["너티 강아지 파우치 퓨레 대용량 짜먹는간식 연어맛 스틱간식 720g, 4개", one(N.puree, 4), "720g = 180g×4"],
    ["너티 강아지 파우치 퓨레 짜먹는간식 연어맛 스틱간식 360g, 2개", one(N.puree, 2), "상품 목록 이름(광고 연결용). 360g = 180g×2"],
    ["너티 강아지 하루루틴 스트레스제로껌, 5개, 225g, 닭고기", one(N.gum, 5), "매출보고시트 「스트레스제로껌 5개」 28,900 과 단가 같음"],
    ["사운드 세트", [[N.yam, 1], [N.crisp, 1]], "2025년 옛 이름. 사운드 라인 = 냠·바삭, 단가 17,900 = 「사운드시리즈 냠+바삭」"],
    ["하루루틴시리즈 3종", [[N.gum, 1], [N.bar, 1], [N.puree, 1]], "하루루틴 라인 3종(상품 목록 라인업 하루루틴 = 껌·에너젯바·퓨레) 1개씩"],
    ["하루루틴 세트", [[N.gum, 1], [N.bar, 1], [N.puree, 1]], "2025년 옛 이름. 하루루틴시리즈 3종과 같다고 봄"],
    ["크리스마스 선물세트", one("크리스마스 선물세트"), "구성 미확인. 풀지 않고 그대로 둠(원가 40,000 이 5종 단품 원가 합과 안 맞음)", true],
    ["크리스마스 패키지", one("크리스마스 선물세트"), "2025년 옛 이름. 구성 미확인, 그대로 둠", true],
    ["설날 선물세트", one("설날 선물세트"), "구성 미확인. 풀지 않고 그대로 둠(원가 30,000)", true],
    ["4종 맛보기 세트", one("4종 맛보기 세트"), "맛보기 샘플(단가 100원 안팎). 품목 수량을 부풀리지 않게 풀지 않음"],
  ],
  balancelab: [
    ["밸런스랩 큐모발검사 뉴트리션 미네랄 중금속 종합영양분석키트", one("큐모발검사 뉴트리션"),
      "상품 목록 YSIET0001_G21(공구 숨꿀) = 뉴트리션. 단가 83,000"],
    ["큐모발검사 미네랄", one("큐모발검사 미네랄"), "1건 27,000. 어느 품목과도 단가가 안 맞아 그대로 둠", true],
  ],
  saip: [
    ["마그네타미니", one("마그네타 미니"), "띄어쓰기만 다름"],
    ["바나퀸조인트", one("바나퀸 조인트"), "띄어쓰기만 다름"],
    ["오션 청어&오렌지 미니알갱이 2.5kg", one("오션 독 청어&오렌지 미니알갱이 2.5kg"), "「독」만 빠진 같은 상품(품목코드 P00000CR)"],
    ["[맛보기샘플] 고네이티브독 연어 치킨 오리 청어 40g 4종", one("[맛보기샘플] 고네이티브독 연어 치킨 오리 청어 40g 4종"),
      "맛보기 샘플. 풀지 않음"],
    ["스몰브리드 독 연어 치킨 오리 청어 40g 4종 세트", one("[맛보기샘플] 고네이티브독 연어 치킨 오리 청어 40g 4종"), "같은 맛보기 샘플의 다른 이름"],
    ["게더 앤드레스 밸리 50g + 비건 프리에이커 치킨 50g 강아지 사료 샘플", one("게더 앤드레스 밸리 50g + 비건 프리에이커 치킨 50g 강아지 사료 샘플"),
      "다른 회사 사료 샘플(단가 100원 안팎). 풀지 않음"],
    ["펌킨 독 멧돼지&사과 미니알갱이 100g 5개", one("펌킨 독 멧돼지&사과 미니알갱이 100g", 5), "단가 16,930 = 100g 단품 3,314×5.1"],
    ["오션 독 청어&오렌지 미니 100g 5개", one("오션 독 청어&오렌지 미니 100g", 5), "단가 약 17,000 = 100g 단품 3,400×5"],
    ["화이트 독 농어&스피룰리나 미니 알갱이 100g 5개 강아지 사료 맛보기", one("화이트 독 농어&스피룰리나 미니 알갱이 100g", 5), "100g 5개 묶음"],
    ["화이트 독 농어&스피룰리나 미니 알갱이 100g", one("화이트 독 농어&스피룰리나 미니 알갱이 100g", 5),
      "판단: 이름은 100g 하나지만 단가 18,000 = 5개 묶음값(다른 100g 단품은 3,400)"],
    ["파미나 N&D 펌킨 독 닭고기 석류 미니 알갱이 100g 5개", one("펌킨 독 닭고기 석류 미니 알갱이 100g", 5), "100g 5개 묶음(원가 12,000)"],
    ["파미나 N&D 퀴노아 독 오리 코코넛 강황 미디움 알갱이 100g 5개 피부 피모 관리",
      one("파미나 N&D 퀴노아 독 오리 코코넛 강황 미디움 알갱이 100g 강아지 피부 피모", 5), "100g 단품 3,700, 5개 묶음 16,800"],
    ["독 오리 브로콜리 미니 100g 5개", one("퀴노아 독 오리 브로콜리 미니 100g", 5), "100g 5개 묶음(원가표 P00000CT_6)"],
    ["퀴노아 캣 오리 브로콜리 아스파라거스 50g 5개 중성화 체중관리", one("퀴노아 캣 오리 브로콜리 아스파라거스 50g", 5),
      "50g 5개 묶음, 단가 약 10,000 = 50g 2,000×5"],
    ["퀴노아 캣 유리너리 오리 50g 5개", one("퀴노아 캣 유리너리 오리 50g"),
      "판단: 이름은 5개지만 단가 2,000 이 50g 단품과 같고 원가표도 단품과 같은 1,400. 1개로 셈"],
    ["앤세스트럴 캣 닭고기 석류 50g", one("앤세스트럴 캣 닭고기 석류 50g", 5),
      "판단: 이름은 50g 하나지만 단가 9,000~9,500 = 50g 1,900×5. 5개 묶음으로 셈"],
    ["오션 독 멧돼지&사과 맛보기 샘플", one("오션 독 멧돼지&사과 미니알갱이 100g"), "단가 2,900 = 100g 단품"],
    ["멧돼지&사과+대구&오렌지 100g", [["펌킨 독 멧돼지&사과 미니알갱이 100g", 1], ["오션 독 대구&오렌지 미니알갱이 100g", 1]],
      "100g 두 종 세트(원가 4,800 = 2,500×2 안팎)"],
  ],
};

// ── 일반 규칙 ─────────────────────────────────────────────────────────
/** 너티 「스트레스제로껌 2개」「바삭 닭가슴살 3개」「스트레스 제로껌 2개」「냠 단호박 2개」「에너젯바 2개」 */
function nuttyPattern(name) {
  const m = name.replace(/\s+/g, "").match(/^(스트레스제로껌|냠단호박|바삭닭가슴살|에너젯바|굿모닝퓨레)(\d+)개(입)?$/);
  if (!m) return null;
  const base = { 스트레스제로껌: N.gum, 냠단호박: N.yam, 바삭닭가슴살: N.crisp, 에너젯바: N.bar, 굿모닝퓨레: N.puree }[m[1]];
  return { parts: [[base, Number(m[2])]], note: `이름 규칙 「${m[2]}개」` };
}
/** 너티 「사운드시리즈 냠2+바삭1」「사운드시리즈 냠+바삭」 */
function nuttySoundSet(name) {
  const m = name.match(/^사운드시리즈 냠(\d*)\+바삭(\d*)$/);
  if (!m) return null;
  return { parts: [[N.yam, Number(m[1] || 1)], [N.crisp, Number(m[2] || 1)]], note: "이름 규칙 「냠N+바삭N」" };
}
/** 밸런스랩 「큐모발검사 뉴트리션 + 종이결과지」「… + 맞춤 영양제 + 종이결과지」 */
function blPlus(name) {
  if (!name.includes(" + ")) return null;
  const norm = (p) => (p.replace(/\s+/g, "") === "맞춤영양제" ? "맞춤영양제" : p.trim());
  return { parts: name.split(" + ").map((p) => [norm(p), 1]), note: "이름 규칙 「+」 로 이은 세트" };
}

function decide(brand, name) {
  const manual = (MANUAL[brand] || []).find((m) => m[0] === name);
  if (manual) return { parts: manual[1], note: manual[2], review: !!manual[3], source: "manual" };
  const rule = brand === "nutty" ? nuttyPattern(name) || nuttySoundSet(name) : brand === "balancelab" ? blPlus(name) : null;
  if (rule) return { ...rule, review: false, source: "auto" };
  return null;
}

const isIdentity = (name, parts) => parts.length === 1 && parts[0][0] === name && parts[0][1] === 1;

function rowsFor(brand, name, d) {
  const prices = PRICE[brand] || {};
  const known = d.parts.every(([c]) => prices[c]);
  const weights = d.parts.map(([c, q]) => (known ? prices[c][0] * q : q));
  const total = weights.reduce((a, b) => a + b, 0);
  const multi = d.parts.length > 1;
  const priceNote = multi
    ? known
      ? ` · 매출 나누기: 정가 비율(${d.parts.map(([c, q]) => `${c} ${prices[c][0].toLocaleString("en-US")}원${q > 1 ? `×${q}` : ""}`).join(", ")}). ${d.parts.map(([c]) => prices[c][1]).join(" / ")}`
      : " · 매출 나누기: 정가 모름, 수량 비율"
    : "";
  return d.parts.map(([component, qty], i) => ({
    brand, sale_product: name, component, qty,
    price_share: Math.round((weights[i] / total) * 1e6) / 1e6,
    source: d.source, needs_review: d.review,
    note: (d.note || "") + priceNote,
  }));
}

// ── 원천 읽기 ─────────────────────────────────────────────────────────
function env() {
  const txt = readFileSync(join(ROOT, ".env.local"), "utf8");
  return Object.fromEntries(txt.split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
}

async function ledgerProducts() {
  const e = env();
  const url = e.NEXT_PUBLIC_SUPABASE_URL, key = e.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error(".env.local 에 Supabase 주소·anon 키가 없습니다");
  const seen = new Map();
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${url}/rest/v1/product_sales?select=brand,product&date=gte.${SINCE}&order=id.asc`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + 999}` },
    });
    if (!r.ok) throw new Error(`product_sales 읽기 실패 ${r.status}: ${await r.text()}`);
    const rows = await r.json();
    for (const x of rows) seen.set(`${x.brand}\t${x.product}`, { brand: x.brand, product: x.product });
    if (rows.length < 1000) break;
  }
  return [...seen.values()];
}

/** 상품 목록에만 있고 원장엔 없는 이름(광고 상품번호 → 상품 목록 이름으로 이어질 때 필요) */
function masterOnly(ledgerKeys) {
  const master = JSON.parse(readFileSync(join(ROOT, "src", "lib", "product-master.json"), "utf8"));
  const items = master.items || [];
  return items
    .filter((i) => i.brand && i.product && !ledgerKeys.has(`${i.brand}\t${i.product.replace(/\s+/g, "")}`))
    .map((i) => ({ brand: i.brand, product: i.product }));
}

// ── SQL ──────────────────────────────────────────────────────────────
const lit = (v) => (v === null || v === undefined ? "null" : typeof v === "number" || typeof v === "boolean" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

function sql(rows, stats) {
  const values = rows.map((r) => `  (${[r.brand, r.sale_product, r.component, r.qty, r.price_share, r.source, r.needs_review, r.note].map(lit).join(", ")})`);
  return `-- ============================================================
-- 2026-11-09  판매 상품 구성표 (product_components)
-- ============================================================
--
--  왜: 판매 원장은 판매 상품 이름으로 쌓인다. 같은 품목이 묶음·세트·옛 이름으로 갈라져
--    제품 단위 화면이 「냠」「냠 2개」를 다른 제품으로 셌다(김호 2026-11-09 "2A = B").
--    이 표가 판매 상품 → 기본 품목 × 수량이다. 세트는 품목마다 한 줄씩.
--
--  읽는 쪽: src/lib/product-components.ts (expandSales). 제품별 광고 성과·상품별 매출 추이·
--    제품별 성과·매출 구성·매출 분석 TOP10·Overview TOP5·밸런스랩 제품별 손익.
--  이 표가 없으면 화면은 예전처럼 판매 상품명 그대로 센다.
--  만든 곳: node scripts/product-components/build.mjs (규칙과 판단 근거가 그 파일에 있다).
--    새 상품이 생기면 그 스크립트를 다시 돌려 이 파일을 새로 만들고 다시 실행한다.
--
--  칸
--    brand         판매 원장 brand (balancelab·nutty·ironpet·saip)
--    sale_product  판매 원장 product 그대로
--    component     기본 품목 이름
--    qty           판매 1개에 든 품목 수 (냠 2개 → 2)
--    price_share   매출 중 이 품목 몫(판매 상품마다 합 1). 세트는 정가 비율, 한 품목 묶음은 1
--    source        auto = 이름 규칙·그대로, manual = 단가·원가표로 판단
--    needs_review  김호 확인이 필요한 줄
--    note          판단 근거
--
--  줄 수: ${stats}
--  몇 번 실행해도 안전하다. 이 파일에 있는 판매 상품의 줄을 지우고 다시 넣는다.
-- ============================================================

create table if not exists product_components (
  brand         text        not null,
  sale_product  text        not null,
  component     text        not null check (length(component) > 0),
  qty           numeric     not null check (qty > 0),
  price_share   numeric     check (price_share is null or (price_share > 0 and price_share <= 1)),
  source        text        not null default 'manual' check (source in ('auto', 'manual')),
  needs_review  boolean     not null default false,
  note          text,
  updated_at    timestamptz not null default now(),
  primary key (brand, sale_product, component)
);

-- 대시보드는 anon 키로 읽는다(다른 손 입력 표와 같은 조건)
grant select, insert, update, delete on product_components to anon, authenticated;

begin;

create temp table _pc_seed (
  brand text, sale_product text, component text, qty numeric, price_share numeric,
  source text, needs_review boolean, note text
) on commit drop;

insert into _pc_seed (brand, sale_product, component, qty, price_share, source, needs_review, note) values
${values.join(",\n")};

delete from product_components p
 using (select distinct brand, sale_product from _pc_seed) s
 where p.brand = s.brand and p.sale_product = s.sale_product;

insert into product_components (brand, sale_product, component, qty, price_share, source, needs_review, note)
select brand, sale_product, component, qty, price_share, source, needs_review, note from _pc_seed;

commit;

-- 확인: 브랜드별 줄 수가 위 「줄 수」와 같고, share_sum_bad(매출 몫 합이 1 이 아닌 판매 상품 수)가 모두 0 이면 정상
with s as (select brand, sale_product, sum(price_share) as share_sum from product_components group by brand, sale_product)
select p.brand, count(*) as rows, count(distinct p.sale_product) as sale_products,
       sum((p.source = 'manual')::int) as manual, sum(p.needs_review::int) as needs_review,
       (select count(*) from s where s.brand = p.brand and abs(s.share_sum - 1) > 0.000002) as share_sum_bad
  from product_components p group by p.brand order by p.brand;
`;
}

// ── main ─────────────────────────────────────────────────────────────
const ledger = await ledgerProducts();
const ledgerKeys = new Set(ledger.map((p) => `${p.brand}\t${p.product.replace(/\s+/g, "")}`));
const out = [];
const unmatched = [];
const skipped = [];
for (const { brand, product } of ledger) {
  if (!product || !product.trim()) { skipped.push(`${brand}: 빈 상품명`); continue; }
  const d = decide(brand, product);
  if (d) { out.push(...rowsFor(brand, product, d)); continue; }
  // 규칙에 안 걸린 것은 그대로(자기 자신 1개). 이름에 「N개」 류가 보이면 확인 표시
  const suspicious = /\d+\s*개(입)?|\+|세트|\*/.test(product) && brand !== "ironpet";
  if (suspicious) unmatched.push(`${brand}: ${product}`);
  out.push(...rowsFor(brand, product, { parts: [[product, 1]], note: suspicious ? "규칙에 안 걸림. 그대로 둠" : "단품, 그대로", review: suspicious, source: "auto" }));
}
// 상품 목록에만 있는 이름은 풀리는 경우만 넣는다(그대로면 넣을 필요가 없다)
for (const { brand, product } of masterOnly(ledgerKeys)) {
  const d = decide(brand, product);
  if (!d || isIdentity(product, d.parts)) continue;
  out.push(...rowsFor(brand, product, { ...d, note: `상품 목록에만 있는 이름(광고 연결용). ${d.note}` }));
}
out.sort((a, b) => a.brand.localeCompare(b.brand) || a.sale_product.localeCompare(b.sale_product) || a.component.localeCompare(b.component));

const by = {};
for (const r of out) {
  const b = (by[r.brand] ||= { rows: 0, products: new Set(), manual: 0, review: new Set() });
  b.rows++; b.products.add(r.sale_product);
  if (r.source === "manual") b.manual++;
  if (r.needs_review) b.review.add(r.sale_product);
}
const stats = Object.entries(by).map(([b, s]) => `${b} ${s.rows}줄(판매 상품 ${s.products.size}, 판단 ${s.manual}, 확인 필요 ${s.review.size})`).join(" · ");

mkdirSync(dirname(SQL_FILE), { recursive: true });
writeFileSync(SEED_FILE, JSON.stringify({ generated_at: new Date().toISOString(), since: SINCE, rows: out }, null, 1) + "\n", "utf8");
writeFileSync(SQL_FILE, sql(out, stats), "utf8");

console.log(stats);
console.log(`seed: ${SEED_FILE}`);
console.log(`sql : ${SQL_FILE}`);
if (skipped.length) console.log(`건너뜀: ${skipped.join(", ")}`);
const review = out.filter((r) => r.needs_review).map((r) => `${r.brand}: ${r.sale_product} → ${r.component}×${r.qty}`);
if (review.length) console.log(`확인 필요 ${review.length}줄:\n  ${review.join("\n  ")}`);
if (unmatched.length) console.log(`규칙에 안 걸린 묶음 의심 ${unmatched.length}건:\n  ${unmatched.join("\n  ")}`);
