// 키워드 탭 「추가할 키워드」 판정 규칙. 2026-10-20 신설.
//
// 규칙 정본(기준을 여기서 바꾸지 말 것. 바꾸려면 문서부터):
//   Work/PPMI/projects/검색광고-운영/reports/2026-10-20-추가키워드-기준.md (seo-marketer)
//   1절 채널별 규칙 · 2-1절 등록 상태 · 2-3절 보류 · 2-4절 쇼핑 상품 → 파워링크 그룹 · 4절 검산값
//
// 이 파일은 외부 모듈을 import 하지 않는 순수 함수만 둔다. 라우트(/api/keyword-candidates)가
// DB 에서 읽은 값을 넘기고, 같은 함수를 로컬 검산 스크립트도 그대로 돌릴 수 있게 하기 위해서다.
// 2026-10-20 원천으로 돌려 4-1·4-2 검산값(쇼핑 0/10/76, 파워링크 27/10/21, 쿠팡 70)과 맞췄다.

// ── 문턱값 (기준 문서 1절) ──────────────────────────────────────
export const SHOP_MIN_PURCHASES = 1;     // 쇼핑 구매어: 기간 구매 1건 이상이면 검색량과 무관하게 후보
export const PL_MIN_CLICKS_OWN = 1;      // 파워링크 클릭어: 자사 브랜드어는 클릭 1회부터
export const PL_MIN_CLICKS_OTHER = 3;    // 취급·일반은 클릭 3회부터(1~2회 긴 꼬리는 소음)
export const COUPANG_MIN_ORDERS = 1;     // 쿠팡 주문어: 기간 주문 1건 이상
export const SHORT_PERIOD_DAYS = 14;     // 이보다 짧으면 "기간이 짧아 후보가 적게 나옵니다"

// 밸런스랩 계정에 얹힌 그룹사 캠페인. 검색어 쪽과 등록 목록 쪽 둘 다에서 뺀다(1-1절).
// 등록 목록 쪽은 수집기가 brand='group' 으로 찍어 두므로 브랜드 대조에서 저절로 빠진다.
export const GROUP_CAMPAIGNS = ["와이에스환경기술연구소", "한국반려동물안전인증센터", "S99.벌크", "수은세상"];

export type NaverAccount = "main" | "balancelab";

// 자사 브랜드 토큰(1-1절). 계정마다 다르다. 쿠팡은 펫 토큰을 쓴다.
export const OWN_TOKENS: Record<NaverAccount, string[]> = {
  balancelab: ["밸런스랩", "balancelab", "큐모발", "큐타액", "큐지연성", "큐음식물", "큐알러지", "qha"],
  main: ["아이언펫", "ironpet", "너티", "nutty", "하루루틴", "사운드냠", "사운드바삭", "에너젯", "굿모닝퓨레"],
};
// 취급 브랜드(사입). 파워링크 클릭 문턱은 일반어와 같다. 쿠팡에는 쓰지 않는다.
export const CARRY_TOKENS = ["파미나", "farmina", "닥터레이"];

export type Tier = "자사" | "취급" | "일반";
const TIER_ORDER: Tier[] = ["자사", "취급", "일반"];

/** 소문자 + 공백 제거. settings/search-ads/sa_doctor.norm, 수집기, SQL 함수와 같다. '+' 는 남긴다. */
export function normKeyword(s: string | null | undefined): string {
  return (s || "").trim().toLowerCase().replaceAll(" ", "");
}

function hasToken(norm: string, tokens: string[]): boolean {
  return tokens.some((t) => norm.includes(normKeyword(t)));
}

export function tierOf(account: NaverAccount, norm: string, withCarry = true): Tier {
  if (hasToken(norm, OWN_TOKENS[account])) return "자사";
  if (withCarry && account === "main" && hasToken(norm, CARRY_TOKENS)) return "취급";
  return "일반";
}

/** 기본 정렬 값: 자사 → 취급 → 일반, 묶음 안에서 primary·secondary 내림차순. 클수록 위. */
export function orderValue(tier: Tier, primary: number, secondary: number): number {
  return (3 - TIER_ORDER.indexOf(tier)) * 1e15 + Math.max(0, primary) * 1e9 + Math.min(Math.max(0, secondary), 999_999_999);
}

// ── 등록 상태 (2-1절) ──────────────────────────────────────────
export type RegState =
  | "운영중" | "등록·노출0" | "등록·꺼짐(키워드 잠금)" | "등록·꺼짐(광고그룹 꺼짐)"
  | "등록·꺼짐(캠페인 꺼짐)" | "검수 중" | "검수 반려" | "등록·꺼짐(기타)" | "미등록";
// 위쪽이 이긴다. 같은 키워드 사본이 여러 그룹에 있으면 가장 위 상태로 판정한다.
const STATE_RANK: RegState[] = [
  "운영중", "등록·노출0", "등록·꺼짐(키워드 잠금)", "등록·꺼짐(광고그룹 꺼짐)",
  "등록·꺼짐(캠페인 꺼짐)", "검수 중", "검수 반려", "등록·꺼짐(기타)", "미등록",
];

/** naver_sa_keyword 한 행(파워링크 WEB_SITE, 계정별 최신 seen_on 만). */
export interface RegKeyword {
  account: string; keyword_norm: string; brand: string | null;
  campaign: string | null; adgroup: string | null;
  campaign_status: string | null; adgroup_status: string | null;
  status_reason: string | null; keyword_lock: boolean | null;
  is_live: boolean | null; imp_30d: number | null; bid: number | null;
}

const LIVE = "ELIGIBLE";

function copyState(k: RegKeyword): RegState {
  if (k.is_live) return Number(k.imp_30d) > 0 ? "운영중" : "등록·노출0";
  // 꺼진 사본은 가장 바깥에서 꺼진 이유로 본다(캠페인이 꺼졌으면 키워드 잠금은 부차적이다).
  if (k.campaign_status !== LIVE) return "등록·꺼짐(캠페인 꺼짐)";
  if (k.adgroup_status !== LIVE) return "등록·꺼짐(광고그룹 꺼짐)";
  if (k.keyword_lock) return "등록·꺼짐(키워드 잠금)";
  if (k.status_reason === "KEYWORD_UNDER_REVIEW") return "검수 중";
  if (k.status_reason === "KEYWORD_DISAPPROVED") return "검수 반려";
  return "등록·꺼짐(기타)";
}

export type RegIndex = Map<string, RegKeyword[]>;
const regKey = (account: string, brand: string, norm: string) => `${account}|${brand}|${norm}`;

export function buildRegIndex(rows: RegKeyword[]): RegIndex {
  const m: RegIndex = new Map();
  for (const r of rows) {
    const k = regKey(r.account, r.brand || "", r.keyword_norm);
    const list = m.get(k);
    if (list) list.push(r); else m.set(k, [r]);
  }
  return m;
}

export function registrationOf(idx: RegIndex, account: string, brand: string, norm: string): { state: RegState; copy: RegKeyword | null } {
  let best: { state: RegState; copy: RegKeyword | null } = { state: "미등록", copy: null };
  for (const c of idx.get(regKey(account, brand, norm)) || []) {
    const s = copyState(c);
    if (STATE_RANK.indexOf(s) < STATE_RANK.indexOf(best.state)) best = { state: s, copy: c };
  }
  return best;
}

// ── 보류 (1-1절 보류 · 2-3절) ──────────────────────────────────
export interface HoldRule {
  account: string; brand: string; pattern: string; match: "exact" | "contains" | string;
  reason: string; review_on: string | null;
}
export interface ChangeLogRow {
  account: string; keyword: string; action: string; review_on: string | null; applied_at: string;
}
export type HoldFn = (account: string, brand: string, norm: string) => string | null;

/**
 * 보류 판정 함수. sa_keyword_hold 규칙에 걸리거나, sa_change_log 에서 그 키워드의 마지막 행동이
 * delete·pause 이고 검토일이 오늘 이후(오늘 포함)면 사유를 돌려준다.
 * 보류표의 검토일이 비어 있으면 기한 없이 보류한다.
 */
export function buildHolds(rules: HoldRule[], logs: ChangeLogRow[], today: string): HoldFn {
  const active = rules.filter((r) => !r.review_on || r.review_on >= today);
  const last = new Map<string, ChangeLogRow>();
  for (const l of logs) {
    const k = `${l.account}|${normKeyword(l.keyword)}`;
    const cur = last.get(k);
    if (!cur || l.applied_at > cur.applied_at) last.set(k, l);
  }
  return (account, brand, norm) => {
    for (const r of active) {
      if (r.account !== account || r.brand !== brand) continue;
      const p = normKeyword(r.pattern);
      if (r.match === "exact" ? norm === p : norm.includes(p)) return r.reason;
    }
    const l = last.get(`${account}|${norm}`);
    if (l && (l.action === "delete" || l.action === "pause") && l.review_on && l.review_on >= today) {
      return `${l.action === "delete" ? "삭제" : "중지"} 실험 중(${l.applied_at.slice(0, 10)}, 검토일 ${l.review_on})`;
    }
    return null;
  };
}

// ── 네이버 후보 ────────────────────────────────────────────────
/** naver_search_term_add_source 의 한 줄. */
export interface SourceEntry {
  brand: string | null; campaign: string | null; adgroup: string | null; product: string; query: string;
  impressions: number; clicks: number; cost: number; purchases: number; purchase_value: number;
}

export type Bucket = "exec" | "zero" | "held";
export interface NaverCandidate {
  key: string; channel: "shopping" | "powerlink"; account: NaverAccount; brand: string;
  query: string; norm: string; tier: Tier; state: RegState; holdReason: string | null; bucket: Bucket;
  impressions: number; clicks: number; cost: number; purchases: number; purchase_value: number;
  source: string; action: string; order: number;
}

interface Acc {
  impressions: number; clicks: number; cost: number; purchases: number; purchase_value: number;
  spell: Map<string, number>; src: Map<string, [number, number]>; // 표기별 노출 · 출처별 (구매, 클릭)
}
const newAcc = (): Acc => ({ impressions: 0, clicks: 0, cost: 0, purchases: 0, purchase_value: 0, spell: new Map(), src: new Map() });

function addEntry(a: Acc, e: SourceEntry, src: string) {
  a.impressions += Number(e.impressions) || 0;
  a.clicks += Number(e.clicks) || 0;
  a.cost += Number(e.cost) || 0;
  a.purchases += Number(e.purchases) || 0;
  a.purchase_value += Number(e.purchase_value) || 0;
  a.spell.set(e.query, (a.spell.get(e.query) || 0) + (Number(e.impressions) || 0));
  const s = a.src.get(src) || [0, 0];
  a.src.set(src, [s[0] + (Number(e.purchases) || 0), s[1] + (Number(e.clicks) || 0)]);
}

/** 노출이 가장 많은 원래 표기. 동률이면 가나다 앞. */
function topSpelling(a: Acc): string {
  return [...a.spell.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0], "ko"))[0][0];
}
/** 구매(동률이면 클릭)가 가장 많은 출처. */
function topSource(a: Acc): string {
  return [...a.src.entries()].sort((x, y) => y[1][0] - x[1][0] || y[1][1] - x[1][1] || x[0].localeCompare(y[0], "ko"))[0][0];
}

/** 쇼핑 구매어의 대상 브랜드(1-2절). 행의 brand 칸을 쓰지 않는다(S99.사입_벌크 가 너티 상품도 광고). */
export function shoppingTargetBrand(account: NaverAccount, topProduct: string): string {
  if (account === "balancelab") return "balancelab";
  return topProduct.includes("너티") ? "nutty" : "saip";
}

/** 쇼핑 상품 → 등록할 파워링크 그룹(2-4절). 위에서부터 먼저 맞는 것. null = 등록할 그룹 없음. */
export function shoppingGroupFor(account: NaverAccount, product: string): string | null {
  const p = product.toLowerCase();
  const has = (...ts: string[]) => ts.some((t) => p.includes(t.toLowerCase()));
  if (account === "balancelab") {
    if (has("모발")) return "P01.밸런스랩_큐모발검사";
    if (has("음식물", "IgG", "알러지")) return "P03.밸런스랩_큐지연성알러지검사";
    if (has("타액")) return "P02.밸런스랩_큐타액호르몬검사 (캠페인 꺼짐)";
    return null;
  }
  if (has("너티")) {
    if (has("양갱", "냠", "노견")) return "P04.너티_사운드냠";
    if (has("바삭", "칩")) return "P05.너티_사운드바삭";
    if (has("껌")) return "P01.너티_하루루틴_강아지껌";
    if (has("에너지", "에너젯")) return "P03.너티_에너젯바 (캠페인 꺼짐)";
    return null; // 퓨레·츄르
  }
  if (has("벳라이프")) return "P02.사입 / 03.벳라이프";
  if (has("파미나", "N&D")) return "P02.사입 / 01.파미나";
  if (has("닥터레이")) return "P02.사입 / 02.닥터레이";
  if (has("오리젠")) return "보류 목록(오리젠 최소화)";
  return null;
}

const NO_GROUP = "등록할 파워링크 그룹 없음(그룹을 만들지는 사람 판단)";

/** 등록 상태 → 권하는 조치(2-1절). target = 새로 넣을 자리(없으면 null). */
function actionFor(state: RegState, copy: RegKeyword | null, target: string | null): string {
  const where = copy ? `${copy.campaign || "?"} / ${copy.adgroup || "?"}` : "";
  switch (state) {
    case "미등록": return target ? `파워링크 신규 등록: ${target}` : NO_GROUP;
    case "등록·노출0": return "조치 없음: 이미 등록·30일 노출 0. 입찰 부족인지 검색량 소멸인지는 월간 보고서에서 가른다";
    case "등록·꺼짐(키워드 잠금)": return `키워드 재개 검토: ${where} (보류 목록 먼저 확인)`;
    case "등록·꺼짐(광고그룹 꺼짐)": return `그룹 재개 검토: ${where} (그룹을 일부러 끈 결정이 있는지 먼저 확인)`;
    case "등록·꺼짐(캠페인 꺼짐)":
      return `신규 등록(옛 캠페인 ${copy?.campaign || "?"} 에만 있고 꺼짐): ${target || NO_GROUP}`;
    case "검수 중": return `검수 대기: ${where}`;
    case "검수 반려": return `반려 사유 확인: ${where}`;
    case "등록·꺼짐(기타)": return `상태 확인: ${where}`;
    default: return "";
  }
}

function bucketOf(state: RegState, holdReason: string | null): Bucket {
  if (holdReason) return "held";
  if (state === "등록·노출0") return "zero";
  return "exec";
}

/**
 * 네이버 쇼핑 구매어 → 파워링크 등록 후보(1-2절). 한 계정의 쇼핑 entries 전부를 넘긴다(브랜드로 자르지 않음).
 * 운영중은 빼고 돌려준다. 보류·등록·노출0 도 bucket 으로 표시해 같이 돌려준다(화면이 접어 보인다).
 */
export function buildShopping(account: NaverAccount, entries: SourceEntry[], reg: RegIndex, hold: HoldFn): NaverCandidate[] {
  const by = new Map<string, Acc>();
  for (const e of entries) {
    const n = normKeyword(e.query);
    const a = by.get(n) || newAcc();
    addEntry(a, e, e.product || e.adgroup || "(상품 없음)");
    by.set(n, a);
  }
  const out: NaverCandidate[] = [];
  for (const [n, a] of by) {
    if (a.purchases < SHOP_MIN_PURCHASES) continue;
    const product = topSource(a);
    const brand = shoppingTargetBrand(account, product);
    const { state, copy } = registrationOf(reg, account, brand, n);
    if (state === "운영중") continue;
    const holdReason = hold(account, brand, n);
    const tier = tierOf(account, n);
    out.push({
      key: `shopping|${account}|${n}`, channel: "shopping", account, brand,
      query: topSpelling(a), norm: n, tier, state, holdReason, bucket: bucketOf(state, holdReason),
      impressions: a.impressions, clicks: a.clicks, cost: a.cost, purchases: a.purchases, purchase_value: a.purchase_value,
      source: product,
      action: holdReason ? `보류: ${holdReason}` : actionFor(state, copy, shoppingGroupFor(account, product)),
      order: orderValue(tier, a.purchases, a.purchase_value),
    });
  }
  return out;
}

/**
 * 네이버 파워링크 클릭어 → 등록 후보(1-3절). 묶음 키 (계정, 브랜드, 정규화 검색어).
 * 구매 근거는 없다(네이버가 파워링크 검색어 단위 구매를 주지 않는다).
 */
export function buildPowerlink(account: NaverAccount, entries: SourceEntry[], reg: RegIndex, hold: HoldFn): NaverCandidate[] {
  const by = new Map<string, Acc & { brand: string }>();
  for (const e of entries) {
    const brand = e.brand || "";
    const n = normKeyword(e.query);
    const k = `${brand}|${n}`;
    const a = by.get(k) || { ...newAcc(), brand };
    addEntry(a, e, `${e.campaign || "?"} / ${e.adgroup || "?"}`);
    by.set(k, a);
  }
  const out: NaverCandidate[] = [];
  for (const [k, a] of by) {
    const n = k.slice(a.brand.length + 1);
    const tier = tierOf(account, n);
    if (a.clicks < (tier === "자사" ? PL_MIN_CLICKS_OWN : PL_MIN_CLICKS_OTHER)) continue;
    const { state, copy } = registrationOf(reg, account, a.brand, n);
    if (state === "운영중") continue;
    const holdReason = hold(account, a.brand, n);
    // 출처는 클릭이 가장 많은 (캠페인 / 광고그룹). 새로 넣을 자리는 그 캠페인이다.
    const source = [...a.src.entries()].sort((x, y) => y[1][1] - x[1][1] || x[0].localeCompare(y[0], "ko"))[0][0];
    const targetCampaign = source.split(" / ")[0];
    out.push({
      key: `powerlink|${account}|${k}`, channel: "powerlink", account, brand: a.brand,
      query: topSpelling(a), norm: n, tier, state, holdReason, bucket: bucketOf(state, holdReason),
      impressions: a.impressions, clicks: a.clicks, cost: a.cost, purchases: 0, purchase_value: 0,
      source,
      action: holdReason ? `보류: ${holdReason}` : actionFor(state, copy, targetCampaign),
      order: orderValue(tier, a.clicks, 0),
    });
  }
  return out;
}

// ── 쿠팡 후보 (1-4절) ──────────────────────────────────────────
// 2026-10-21 캠페인·광고유형 판정 추가 (docs/sql/2026-10-21-coupang-ad-type.sql).
//   캠페인 칸이 비어 있던 원인은 수집기였다(일간 보고서 머리글 「캠페인」을 못 읽음). 10-21 고쳐 09-18~10-20 을 다시 넣었다.
//   수동 캠페인 여부는 보고서 「광고유형」으로 가린다. '매출 최적화' 가 아닌 광고유형 행이 있으면 수동으로 본다.
//   ★ 보고서에는 노출이 난 행만 나온다. 수동 캠페인에 등록했지만 노출 0 인 키워드는 안 보인다.
//     그래서 "수동 캠페인 미등록 후보" 는 "수동 캠페인에서 노출된 행이 없음" 이지 "등록 안 됨 확정" 이 아니다.
export const COUPANG_AUTO_AD_TYPE = "매출 최적화";
export const COUPANG_UNCOLLECTED = "(미수집)";

/** coupang_keyword_add_source 의 candidates 한 줄. campaign·ad_types·manual_hit 은 10-21 SQL 이후에만 온다. */
export interface CoupangSource {
  keyword_norm: string; keyword: string; product: string;
  impressions: number; clicks: number; spend: number; orders_1d: number; orders_14d: number;
  conv_sales_14d: number; order_days: number;
  campaign?: string | null; ad_types?: string[] | null; manual_hit?: boolean | null;
}

/** 기간 전체 광고유형 분포로 판정 가능 여부를 정한다. */
export interface CoupangAdTypeSummary {
  collected: boolean;        // 광고유형이 채워진 행이 하나라도 있음
  manualRows: number;        // 매출 최적화가 아닌 광고유형 행 수
  uncollectedRows: number;   // 광고유형이 빈 행 수(칸 생기기 전에 넣고 다시 안 넣은 행)
  byType: Record<string, number>;
}

/** ad_type_rows 가 없으면(10-21 SQL 실행 전) 미수집으로 본다. */
export function summarizeCoupangAdTypes(adTypeRows: Record<string, number> | null | undefined): CoupangAdTypeSummary {
  const byType: Record<string, number> = {};
  for (const [k, v] of Object.entries(adTypeRows || {})) byType[k] = Number(v) || 0;
  const typed = Object.keys(byType).filter((k) => k !== COUPANG_UNCOLLECTED);
  return {
    collected: typed.length > 0,
    manualRows: typed.filter((k) => k !== COUPANG_AUTO_AD_TYPE).reduce((a, k) => a + byType[k], 0),
    uncollectedRows: byType[COUPANG_UNCOLLECTED] || 0,
    byType,
  };
}

export type CoupangState = "광고유형 미수집" | "수동 캠페인에서 노출된 적 있음" | "수동 캠페인 미등록 후보";

export interface CoupangCandidate {
  key: string; keyword: string; norm: string; tier: Tier;
  impressions: number; clicks: number; spend: number; orders: number; orders_1d: number; sales: number;
  order_days: number; product: string; campaign: string; adTypes: string[]; manualHit: boolean;
  state: CoupangState; action: string; order: number;
}

/** 쿠팡 상품명은 "이름,옵션,옵션,..." 꼴이다. 첫 조각만 보인다. */
export function shortCoupangProduct(p: string): string {
  return (p || "").split(",")[0].trim() || "(상품 없음)";
}

function coupangState(collected: boolean, manualHit: boolean): CoupangState {
  if (!collected) return "광고유형 미수집";
  return manualHit ? "수동 캠페인에서 노출된 적 있음" : "수동 캠페인 미등록 후보";
}

function coupangAction(state: CoupangState, orders: number): string {
  const base = state === "광고유형 미수집" ? "수동 키워드 후보(수동 캠페인 여부 미확인)"
    : state === "수동 캠페인에서 노출된 적 있음" ? "수동 캠페인에 이미 있을 수 있음, 광고센터에서 확인"
    : "수동 키워드 후보";
  return orders === 1 ? `${base}, 주문 1건이라 우연 가능` : base;
}

export function buildCoupang(rows: CoupangSource[], adTypes: CoupangAdTypeSummary = summarizeCoupangAdTypes(null)): CoupangCandidate[] {
  return rows
    .filter((r) => Number(r.orders_14d) >= COUPANG_MIN_ORDERS)
    .map((r) => {
      const norm = r.keyword_norm || normKeyword(r.keyword);
      const tier: Tier = hasToken(norm, OWN_TOKENS.main) ? "자사" : "일반";
      const orders = Number(r.orders_14d) || 0;
      const sales = Number(r.conv_sales_14d) || 0;
      const manualHit = adTypes.collected && r.manual_hit === true;
      const state = coupangState(adTypes.collected, manualHit);
      return {
        key: `coupang|${norm}`, keyword: r.keyword, norm, tier,
        impressions: Number(r.impressions) || 0, clicks: Number(r.clicks) || 0, spend: Number(r.spend) || 0,
        orders, orders_1d: Number(r.orders_1d) || 0, sales, order_days: Number(r.order_days) || 0,
        product: shortCoupangProduct(r.product),
        campaign: (r.campaign || "").trim() || "-",
        adTypes: Array.isArray(r.ad_types) ? r.ad_types : [],
        manualHit, state,
        action: coupangAction(state, orders),
        order: orderValue(tier, orders, sales),
      };
    });
}
