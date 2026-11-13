// 키워드 탭 > 네이버 검색어 > 밸런스랩 검색광고 운영 칸의 판정·집계. 2026-11-10 신설.
//   - 루틴이 본 후보(sa_keyword_candidate)  : 결과별 묶기
//   - 메디넥스 10일 시험(sa_change_log × naver_sa_keyword) : 키워드별 누적 비용·잠금선 진행률
//   - 메디넥스 쇼핑 자연 순위(sa_shopping_rank) : 최신·직전 회차 비교
//   - 키워드 분석 탭 수집 멈춤(keyword_performance 플랫폼×브랜드 마지막 날짜)
//
// ★ 이 파일은 다른 모듈을 import 하지 않는다. scripts/tests/*.test.mjs 가 node --test 로 바로 불러 시험한다
//   (경로 별칭 @/ 를 쓰면 node 가 못 푼다). 형만 쓰는 문법(enum·매개변수 속성 금지)으로 쓴다.

// ── 상수 ───────────────────────────────────────────────────────

export const MEDINEX_CAMPAIGN = "P10.메디넥스";
/** 시험 시작일(KST). 이날 0시 이후 신규(add)로 넣은 키워드가 시험 대상이다. 끝날짜는 조정 기록의 검토일에서 읽는다. */
export const MEDINEX_TEST_FROM = "2026-11-09";
/** 잠금선: 키워드마다 이만큼 쓰고 구매 0이면 잠근다(김호 승인 11-09, 조정 기록 사유 문구와 같음). */
export const LOCK_LINE_WON = 10_000;
/** 시험 캠페인 일예산(설정값). 계정에서 읽지 않으므로 바뀌면 여기를 고친다. */
export const MEDINEX_DAILY_BUDGET_WON = 25_000;
/** 마지막 수집일이 오늘보다 이 일수 넘게 앞이면 「수집 멈춤」으로 본다(매일 수집, 주말·지연 여유 3일). */
export const STALL_DAYS = 3;
/** 네이버 쇼핑 1페이지 = 40위. sa_shopping_rank.page1 의 기준과 같다. */
export const PAGE1_RANK = 40;

/** sa_shopping_rank.product 의 정해진 순서(표 정의 주석 순). 모르는 제품은 뒤에 가나다순. */
export const MEDINEX_PRODUCTS = ["씨맥스", "맥스디", "칼트레이스", "프리텍플러스", "쿼터백플러스", "그라놀F", "프로엠"];

// ── 날짜 ───────────────────────────────────────────────────────

export function addDays(day: string, n: number): string {
  const t = new Date(`${day}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** ISO 시각을 한국 날짜(YYYY-MM-DD)로. */
export function kstDayOf(iso: string): string {
  return new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

// ── 수집 멈춤 ──────────────────────────────────────────────────

export interface SourceLatest { platform: string; brand: string; latest: string }

/** 마지막 수집일이 today 보다 STALL_DAYS 넘게 앞인 (플랫폼, 브랜드). 한 번도 없던 조합은 애초에 목록에 없다. */
export function stalledSources(list: SourceLatest[], today: string, days = STALL_DAYS): SourceLatest[] {
  const cut = addDays(today, -days);
  return list
    .filter((s) => s.latest < cut)
    .sort((a, b) => (a.platform === b.platform ? a.brand.localeCompare(b.brand) : a.platform.localeCompare(b.platform)));
}

/** 플랫폼별로 멈춘 브랜드를 묶는다. 칩 옆 표시용. */
export function stalledByPlatform(stalled: SourceLatest[]): Record<string, SourceLatest[]> {
  const out: Record<string, SourceLatest[]> = {};
  for (const s of stalled) (out[s.platform] ||= []).push(s);
  return out;
}

// ── 키워드 원천 판정(2026-11-13) ───────────────────────────────
// 2026-11-10 띠는 keyword_performance 의 모든 플랫폼을 "마지막 날이 3일 넘게 앞이면 멈춤"으로 봤다.
// 그런데 그 표의 05-04 이전 네이버 쇼핑·메타·GFA·구글 행은 키워드가 아니라 **캠페인 이름**이었고
// (marketing-dashboard scripts/sync_naver_keywords.py 머리 주석: "애초에 키워드 단위였던 적이 없다"),
// 9월 새 수집기는 파워링크(naver_search)만 키워드 단위로 넣는다. 쇼핑검색은 상품 단위라 설계상 없다.
// 또 아이언펫처럼 광고를 끈 원천도 "멈춤"으로 불렀다. 그래서 키워드 원천마다 광고비와 맞대어 넷으로 가른다:
//   stalled  광고비가 키워드 뒤로 이어지고 지금도 나감        → 주황 「수집 멈춤」
//   gap      광고비가 키워드 뒤로 이어졌지만 지금은 끊김       → 회색 「과거 수집 공백」
//   adsOff   광고비가 키워드 뒤로 이어진 적 없고 지금도 끊김   → 회색 「광고비 기록도 끊김」(단정하지 않음)
//   pending  그 밖(광고비는 최근인데 키워드 뒤 꼬리가 3일 안)  → 회색 「확인 중」(멈춤 초기·동기화 지연을 가르지 않음)
// 광고비 원천은 키워드 원천과 같은 범위여야 한다. 파워링크 키워드에는 naver_campaign_daily 의 WEB_SITE 캠페인 비용을 댄다
// (daily_ad_spend.naver_search 는 브랜드검색·파워컨텐츠까지 섞여, 파워링크만 끈 브랜드가 거짓 「멈춤」이 된다).

/** 키워드 단위로 모으는 플랫폼(keyword_performance.platform). 지금은 네이버 파워링크 하나. */
export const KEYWORD_PLATFORMS = ["naver_search"];

/** 키워드 플랫폼 → naver_campaign_daily.campaign_type. 같은 범위의 광고비로 "광고가 돌고 있나"를 본다. */
export const KEYWORD_SPEND_CAMPAIGN_TYPE: Record<string, string> = { naver_search: "WEB_SITE" };

/** 키워드 표에 없는 광고 중 안내를 붙이는 채널(daily_ad_spend.channel). 쇼핑검색은 상품 단위라 실제 검색어가 「네이버 검색어」 탭에 있다. */
export const SHOPPING_SPEND_CHANNEL = "naver_shopping";

/** 광고비가 키워드 뒤로 이어진 원천을 「지금도 나가는 중」(멈춤)으로 볼 최근 일수. 넘으면 「과거 수집 공백」. */
export const ACTIVE_SPEND_DAYS = 7;

/** (플랫폼, 브랜드)의 마지막 광고비(>0) 날짜. platform 은 keyword_performance 쪽 이름이다. */
export interface SpendLatest { platform: string; brand: string; lastSpend: string }

/** latest = null 은 광고비는 있는데 키워드 기록이 한 번도 없는 브랜드 */
export interface SourceVerdict { platform: string; brand: string; latest: string | null; lastSpend: string | null }

export interface KeywordSourceStatus {
  stalled: SourceVerdict[];
  gap: SourceVerdict[];
  adsOff: SourceVerdict[];
  pending: SourceVerdict[];
}

export type SourceKind = keyof KeywordSourceStatus | "ok";

/**
 * 원천 하나 판정. cut = today - STALL_DAYS.
 *   키워드가 cut 이상(3일 안)이면 ok.
 *   광고비가 키워드 + STALL_DAYS 보다 뒤까지 이어졌으면(spendAfter): 광고비가 최근 ACTIVE_SPEND_DAYS 안이면 stalled, 아니면 gap.
 *   이어진 적 없으면: 광고비도 cut 보다 앞(또는 없음)이면 adsOff, 아니면 pending.
 *   키워드 기록이 아예 없으면(latest=null) 광고비가 있는 것 자체가 spendAfter 다.
 */
export function judgeSource(latest: string | null, lastSpend: string | null, today: string,
  opts: { stallDays?: number; activeDays?: number } = {}): SourceKind {
  const stallDays = opts.stallDays ?? STALL_DAYS;
  const activeDays = opts.activeDays ?? ACTIVE_SPEND_DAYS;
  const cut = addDays(today, -stallDays);
  if (latest && latest >= cut) return "ok";
  const spendAfter = !!lastSpend && (!latest || lastSpend > addDays(latest, stallDays));
  if (spendAfter) return lastSpend! >= addDays(today, -activeDays) ? "stalled" : "gap";
  if (!lastSpend || lastSpend < cut) return latest ? "adsOff" : "ok";
  return "pending";
}

/**
 * 키워드 원천을 넷으로 가른다. 키워드 기록이 있는 원천과, 광고비만 있고 키워드 기록이 한 번도 없는 원천을 둘 다 본다.
 * 광고비를 못 읽었으면 판정하지 않는다(호출부가 「수집 상태 모름」으로 띄운다).
 */
export function classifyKeywordSources(
  sources: SourceLatest[], spend: SpendLatest[], today: string,
  opts: { stallDays?: number; activeDays?: number } = {},
): KeywordSourceStatus {
  const out: KeywordSourceStatus = { stalled: [], gap: [], adsOff: [], pending: [] };
  const latestOf = new Map(sources.filter((s) => KEYWORD_PLATFORMS.includes(s.platform)).map((s) => [`${s.platform}|${s.brand}`, s.latest]));
  const spendOf = new Map(spend.filter((s) => KEYWORD_PLATFORMS.includes(s.platform)).map((s) => [`${s.platform}|${s.brand}`, s.lastSpend]));
  const keys = Array.from(new Set([...latestOf.keys(), ...spendOf.keys()])).sort();
  for (const key of keys) {
    const [platform, brand] = key.split("|");
    const latest = latestOf.get(key) ?? null;
    const lastSpend = spendOf.get(key) ?? null;
    const kind = judgeSource(latest, lastSpend, today, opts);
    if (kind !== "ok") out[kind].push({ platform, brand, latest, lastSpend });
  }
  return out;
}

/**
 * 고른 기간 전체가 마지막 키워드 기록일보다 뒤일 때 띠에 무엇을 쓸지.
 *   "stalled" : 멈춘 원천이 있음(주황 목록이 이미 설명한다)
 *   "adsOff"  : 범위 안 키워드 원천이 전부 「광고비 기록도 끊김」 → "광고 기록이 없는 기간"
 *   "pending" : 그 밖(아침 동기화 전에 「어제」를 고름, 키워드가 하루이틀 늦음 등) → "아직 수집 전일 수 있음"
 *   "none"    : 기간 안에 키워드 기록이 있음(띠 문장 없음)
 */
export function periodNotice(sources: SourceLatest[], status: KeywordSourceStatus, from: string): "none" | "stalled" | "adsOff" | "pending" {
  const kw = sources.filter((s) => KEYWORD_PLATFORMS.includes(s.platform));
  const latest = kw.reduce<string | null>((m, s) => (!m || s.latest > m ? s.latest : m), null);
  if (!latest || latest >= from) return "none";
  if (status.stalled.length > 0) return "stalled";
  return kw.length > 0 && status.adsOff.length === kw.length ? "adsOff" : "pending";
}

/** 쇼핑 안내를 붙일 브랜드: 고른 기간에 쇼핑검색 광고비가 있는 브랜드(정렬). */
export function shoppingNoteBrands(spendRows: { brand: string; spend: number | string | null }[]): string[] {
  return Array.from(new Set(spendRows.filter((r) => (Number(r.spend) || 0) > 0).map((r) => r.brand))).sort();
}

// ── 옛 캠페인 단위 기록 ────────────────────────────────────────
/** 캠페인 이름 행이 들어간 마지막 날(2026-11-13 실측). 이 날 이후 행은 판정하지 않는다. */
export const LEGACY_LAST_DATE = "2026-05-04";
/** 05-04 이전 파워링크 자리에 들어간 캠페인 이름(실측 3건, 2026-04-16 ~ 05-04). 정확히 이 이름만 본다. */
export const LEGACY_NAVER_SEARCH_CAMPAIGNS = ["01.아이언펫_파워링크", "02.너티_파워링크", "05. 사입_파미나/닥터레이"];

/** 앞뒤 공백·탭·줄바꿈만 뗀다. SQL 정리 파일의 btrim(keyword, E' \t\r\n') 과 같은 기준. */
export function trimLegacyName(s: string | null | undefined): string {
  return (s || "").replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
}

/**
 * 옛 캠페인 단위 기록인가. **LEGACY_LAST_DATE 이전 기간의 행에만** 쓴다(호출부가 기간을 나눈다, splitPeriodAtLegacy).
 * 키워드 단위 플랫폼이 아니면 전부(쇼핑·메타·GFA·구글), 파워링크면 LEGACY_NAVER_SEARCH_CAMPAIGNS 의 정확한 이름만.
 */
export function isLegacyCampaignRow(platform: string, keyword: string | null | undefined): boolean {
  if (!KEYWORD_PLATFORMS.includes(platform)) return true;
  return LEGACY_NAVER_SEARCH_CAMPAIGNS.includes(trimLegacyName(keyword));
}

/** 키워드 행과 옛 캠페인 단위 행을 나눈다(원본 배열은 바꾸지 않는다). LEGACY_LAST_DATE 이전 기간의 묶음에만 쓴다. */
export function splitLegacyRows<T extends { platform: string; keyword: string | null }>(rows: T[]): { keywords: T[]; legacy: T[] } {
  const keywords: T[] = [];
  const legacy: T[] = [];
  for (const r of rows) (isLegacyCampaignRow(r.platform, r.keyword) ? legacy : keywords).push(r);
  return { keywords, legacy };
}

/** 기간을 LEGACY_LAST_DATE 까지(early)와 그 뒤(late)로 나눈다. 없는 쪽은 null. */
export function splitPeriodAtLegacy(from: string, to: string, last = LEGACY_LAST_DATE): { early: [string, string] | null; late: [string, string] | null } {
  if (!from || !to || to < from) return { early: null, late: null };
  const early: [string, string] | null = from <= last ? [from, to < last ? to : last] : null;
  const lateFrom = addDays(last, 1);
  const late: [string, string] | null = to >= lateFrom ? [from > lateFrom ? from : lateFrom, to] : null;
  return { early, late };
}

/** keyword_summary 묶음 행(같은 모양) 두 덩어리를 (플랫폼, 키워드)로 더한다. conversion_value 는 둘 다 null 이면 null. */
export interface KeywordSummaryRow {
  platform: string; keyword: string; impressions: number; clicks: number; cost: number; conversions: number;
  conversion_value: number | null; wasted_cost: number; n: number;
}
export function mergeKeywordSummaries(...parts: KeywordSummaryRow[][]): KeywordSummaryRow[] {
  const m = new Map<string, KeywordSummaryRow>();
  const num = (v: unknown) => Number(v) || 0;
  for (const part of parts) for (const r of part) {
    const k = JSON.stringify([r.platform, r.keyword]);
    const g = m.get(k);
    if (!g) { m.set(k, { ...r }); continue; }
    const cv = g.conversion_value === null && (r.conversion_value === null || r.conversion_value === undefined)
      ? null : num(g.conversion_value) + num(r.conversion_value);
    m.set(k, {
      ...g,
      impressions: num(g.impressions) + num(r.impressions), clicks: num(g.clicks) + num(r.clicks),
      cost: num(g.cost) + num(r.cost), conversions: num(g.conversions) + num(r.conversions),
      conversion_value: cv, wasted_cost: num(g.wasted_cost) + num(r.wasted_cost), n: num(g.n) + num(r.n),
    });
  }
  return Array.from(m.values()).sort((a, b) => b.clicks - a.clicks);
}
// ── 루틴이 본 후보 ─────────────────────────────────────────────

export interface RoutineCandidate {
  date: string; keyword_norm: string; keyword: string | null; source: string | null; product: string | null;
  is_brand: boolean | null; stage: string | null; result: string | null; why: string | null;
  devices: string[] | null; clicks_30d: number | null; cost_30d: number | null; volume: number | null;
  start_bid: number | null; bid_basis: number | null;
}

/** 표 정의(스펙 7-1)의 result 값 순서. 사람이 먼저 볼 것부터. */
export const ROUTINE_RESULT_ORDER = [
  "등록", "확인 필요", "검토 큐", "상한 밀림", "본전 불가", "제외어 후보", "차단", "제품 무관", "이미 등록", "보류", "목록만",
];
/** 처음부터 펼쳐 두는 결과. 나머지는 접는다. */
export const ROUTINE_OPEN_RESULTS = new Set(["등록", "확인 필요"]);
const NO_RESULT = "(결과 없음)";
/** 루틴 후보 응답에 싣는 최대 행 수. 넘으면 결과별 개수만 보낸다(라우트). */
export const ROUTINE_MAX_ROWS = 2000;

/** 결과별 개수(행이 너무 많을 때 화면이 이것만 보인다). 순서는 ROUTINE_RESULT_ORDER. */
export function countRoutineResults(rows: Pick<RoutineCandidate, "result">[]): { result: string; count: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) { const k = r.result || NO_RESULT; m.set(k, (m.get(k) || 0) + 1); }
  const rank = (k: string) => { const i = ROUTINE_RESULT_ORDER.indexOf(k); return i < 0 ? ROUTINE_RESULT_ORDER.length : i; };
  return Array.from(m.entries()).sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0])).map(([result, count]) => ({ result, count }));
}

export interface RoutineGroup { result: string; open: boolean; rows: RoutineCandidate[] }

export function routineProducts(rows: RoutineCandidate[]): string[] {
  return Array.from(new Set(rows.map((r) => r.product || "").filter(Boolean))).sort();
}

/** 제품(없으면 전체)으로 거른 뒤 결과별로 묶는다. 묶음 안은 30일 클릭 큰 순. */
export function groupRoutine(rows: RoutineCandidate[], product: string | null): RoutineGroup[] {
  const kept = product ? rows.filter((r) => r.product === product) : rows;
  const m = new Map<string, RoutineCandidate[]>();
  for (const r of kept) {
    const k = r.result || NO_RESULT;
    const list = m.get(k) || [];
    list.push(r);
    m.set(k, list);
  }
  const rank = (k: string) => {
    const i = ROUTINE_RESULT_ORDER.indexOf(k);
    return i < 0 ? ROUTINE_RESULT_ORDER.length : i;
  };
  return Array.from(m.entries())
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([result, list]) => ({
      result,
      open: ROUTINE_OPEN_RESULTS.has(result),
      rows: [...list].sort((a, b) => (b.clicks_30d || 0) - (a.clicks_30d || 0) || (b.volume || 0) - (a.volume || 0)),
    }));
}

// ── 메디넥스 10일 시험 ─────────────────────────────────────────

export interface MedinexAdd {
  keyword_id: string | null; keyword: string; adgroup: string | null; bid_after: number | null;
  review_on: string | null; applied_at: string;
}

export interface KeywordSnapshot {
  keyword_id: string; keyword: string; adgroup: string | null; bid: number | null;
  keyword_lock: boolean | null; status_reason: string | null;
  adgroup_status: string | null; adgroup_lock: boolean | null;
  campaign_status: string | null; campaign_lock: boolean | null;
  imp_30d: number | null; clk_30d: number | null; cost_30d: number | null;
}

export type StateTone = "ok" | "locked" | "off" | "warn" | "missing";

export function keywordState(s: KeywordSnapshot | null): { label: string; tone: StateTone } {
  if (!s) return { label: "목록에 없음", tone: "missing" };
  if (s.keyword_lock) return { label: "잠김", tone: "locked" };
  if (s.campaign_lock || s.campaign_status === "PAUSED") return { label: "꺼짐(캠페인)", tone: "off" };
  if (s.adgroup_lock || s.adgroup_status === "PAUSED") return { label: "꺼짐(광고그룹)", tone: "off" };
  if (s.status_reason === "ELIGIBLE") return { label: "켜짐", tone: "ok" };
  if (s.status_reason === "KEYWORD_UNDER_REVIEW") return { label: "검수 중", tone: "warn" };
  if (s.status_reason === "KEYWORD_REJECTED") return { label: "검수 반려", tone: "warn" };
  return { label: s.status_reason || "상태 미상", tone: "warn" };
}

export interface MedinexRow {
  keyword: string; keyword_id: string | null; adgroup: string; bid: number | null;
  impressions: number; clicks: number; cost: number;
  /** 잠금선 대비 누적 비용(0 이상, 1 = 잠금선) */
  progress: number; overLine: boolean;
  state: string; tone: StateTone; reviewOn: string | null; addedOn: string;
}

export interface MedinexTotals {
  keywords: number; impressions: number; clicks: number; cost: number; overLine: number; locked: number; spent: number;
  /** 잠금선 이상이면서 실제로 켜져 있는(상태 「켜짐」) 키워드 수. 경고·빨강 판정은 이 값만 쓴다.
   *  (overLine - locked 로 빼면 잠금선 미만 수동 잠금이 경고를 지우고, 꺼진 캠페인·그룹을 켜짐으로 셌다. 11-10 리뷰) */
  overLineOpen: number;
}
export interface MedinexGroup extends MedinexTotals { adgroup: string }

export interface MedinexTest {
  rows: MedinexRow[]; groups: MedinexGroup[]; total: MedinexTotals;
  /** 실제로 첫 신규 등록이 찍힌 날(KST), 검토일(조정 기록의 가장 늦은 review_on) */
  firstAddedOn: string | null; reviewOn: string | null;
  /** 등록 목록 스냅숏에서 못 찾은 키워드 수 */
  missing: number;
}

const zeroTotals = (): MedinexTotals => ({ keywords: 0, impressions: 0, clicks: 0, cost: 0, overLine: 0, locked: 0, spent: 0, overLineOpen: 0 });

/** 잠금선을 넘었는데 아직 켜진 키워드. 구매가 없으면 잠글 대상이라 화면이 빨갛게 표시한다. */
export const isOverLineOpen = (r: Pick<MedinexRow, "overLine" | "tone">) => r.overLine && r.tone === "ok";

function addRow(t: MedinexTotals, r: MedinexRow): void {
  t.keywords += 1;
  t.impressions += r.impressions;
  t.clicks += r.clicks;
  t.cost += r.cost;
  if (r.overLine) t.overLine += 1;
  if (r.tone === "locked") t.locked += 1;
  if (r.cost > 0) t.spent += 1;
  if (isOverLineOpen(r)) t.overLineOpen += 1;
}

const altKey = (adgroup: string | null | undefined, keyword: string) => `${adgroup || ""}|${keyword}`;
/** 시각 비교는 문자열이 아니라 시각 값으로(오프셋 표기 +00:00 / Z 가 섞여도 맞게). 못 읽으면 가장 이른 것으로 본다. */
const timeOf = (iso: string) => { const t = Date.parse(iso); return Number.isNaN(t) ? -Infinity : t; };

/**
 * 같은 키워드를 두 번 넣었으면 마지막 등록만 쓴다. 키는 keyword_id, 없으면 광고그룹|키워드.
 * id 가 있는 등록과 없는 등록이 같은 광고그룹|키워드면 한 키워드로 본다(대체 키로 한 번 더 대조).
 */
export function latestAdds(adds: MedinexAdd[]): MedinexAdd[] {
  const idOfAlt = new Map<string, string>();
  for (const a of adds) if (a.keyword_id) idOfAlt.set(altKey(a.adgroup, a.keyword), a.keyword_id);
  const m = new Map<string, MedinexAdd>();
  for (const a of adds) {
    const k = a.keyword_id || idOfAlt.get(altKey(a.adgroup, a.keyword)) || altKey(a.adgroup, a.keyword);
    const cur = m.get(k);
    if (!cur || timeOf(a.applied_at) > timeOf(cur.applied_at)) m.set(k, a);
  }
  return Array.from(m.values());
}

export function buildMedinexTest(adds: MedinexAdd[], snaps: KeywordSnapshot[], lockLine = LOCK_LINE_WON): MedinexTest {
  const byId = new Map(snaps.map((s) => [s.keyword_id, s]));
  const byAlt = new Map(snaps.map((s) => [altKey(s.adgroup, s.keyword), s]));
  const rows: MedinexRow[] = latestAdds(adds).map((a) => {
    // keyword_id 가 없거나(옛 기록) 목록에서 못 찾으면 광고그룹|키워드로 한 번 더 찾는다.
    const s = (a.keyword_id ? byId.get(a.keyword_id) : undefined) || byAlt.get(altKey(a.adgroup, a.keyword)) || null;
    const st = keywordState(s);
    const cost = Number(s?.cost_30d) || 0;
    return {
      keyword: a.keyword,
      keyword_id: a.keyword_id,
      adgroup: a.adgroup || s?.adgroup || "(광고그룹 없음)",
      bid: s?.bid ?? a.bid_after ?? null,
      impressions: Number(s?.imp_30d) || 0,
      clicks: Number(s?.clk_30d) || 0,
      cost,
      progress: lockLine > 0 ? cost / lockLine : 0,
      overLine: cost >= lockLine,
      state: st.label,
      tone: st.tone,
      reviewOn: a.review_on,
      addedOn: kstDayOf(a.applied_at),
    };
  });
  rows.sort((a, b) => a.adgroup.localeCompare(b.adgroup) || b.cost - a.cost || a.keyword.localeCompare(b.keyword));

  const groupMap = new Map<string, MedinexGroup>();
  const total = zeroTotals();
  for (const r of rows) {
    const g = groupMap.get(r.adgroup) || { adgroup: r.adgroup, ...zeroTotals() };
    addRow(g, r);
    groupMap.set(r.adgroup, g);
    addRow(total, r);
  }
  const groups = Array.from(groupMap.values()).sort((a, b) => a.adgroup.localeCompare(b.adgroup));
  const days = rows.map((r) => r.addedOn).sort();
  const reviews = rows.map((r) => r.reviewOn).filter((d): d is string => !!d).sort();
  return {
    rows, groups, total,
    firstAddedOn: days[0] ?? null,
    reviewOn: reviews.length ? reviews[reviews.length - 1] : null,
    missing: rows.filter((r) => r.tone === "missing").length,
  };
}

// ── 메디넥스 쇼핑 자연 순위 ────────────────────────────────────

export interface ShoppingRankRow {
  measured_on: string; query: string; product: string; query_group: string | null; is_target: boolean;
  method: string; module: string | null; our_rank: number | null; catalog_rank: number | null;
  catalog_id: string | null; ad_seen: boolean; seen_up_to: number; page1: boolean | null; measured_at: string;
}

/** 순위 칸 글자. 숫자가 없을 때 왜 없는지까지 적는다. */
export function rankLabel(rank: number | null, row: Pick<ShoppingRankRow, "method" | "seen_up_to" | "page1">): string {
  if (rank != null) return `${rank}위`;
  if (row.method === "integrated") return "판정 불가";
  if (row.page1 === false) return `${PAGE1_RANK}위 밖`;
  return `${row.seen_up_to}위 안에 없음`;
}

/** 직전 대비 변화. 양수 = 올라감(숫자가 작아짐). 둘 중 하나라도 없으면 null. */
export function rankDelta(prev: number | null | undefined, cur: number | null | undefined): number | null {
  if (prev == null || cur == null) return null;
  return prev - cur;
}

export interface RankLine {
  query: string; query_group: string | null; method: string; module: string | null;
  our_rank: number | null; catalog_rank: number | null; ad_seen: boolean; seen_up_to: number; page1: boolean | null;
  ourLabel: string; catalogLabel: string;
  prevOur: number | null; prevCatalog: number | null; deltaOur: number | null; deltaCatalog: number | null;
  /** 직전 회차에 같은 (검색어, 제품) 줄이 있었나 */
  hadPrev: boolean;
  /** 직전과 측정 방식(method)이 달라 변화를 계산하지 않았다 */
  methodChanged: boolean;
}

export interface RankProduct { product: string; lines: RankLine[]; ranked: number }

export interface RankView {
  latest: string | null; previous: string | null;
  /** 최신 회차 측정 방식 종류 */
  methods: string[];
  /** 최신 회차의 목표 검색어가 전부 integrated(얕은 측정)인가. 깊은 측정 줄이 하나라도 있으면 false */
  shallow: boolean;
  /** 최신 회차 목표 검색어 중 얕은 측정(integrated) 줄 수 */
  shallowTargets: number;
  /** 최신 회차 목표 검색어 중 깊은 측정(aside·openapi, 1페이지 판정 가능) 줄 수 */
  deepTargets: number;
  products: RankProduct[];
  latestRows: number; targetRows: number;
}

function productRank(p: string): number {
  const i = MEDINEX_PRODUCTS.indexOf(p);
  return i < 0 ? MEDINEX_PRODUCTS.length : i;
}

/** rows 는 최신·직전 두 회차만 들어온다고 본다(라우트가 그렇게 읽는다). 표에는 목표 검색어(is_target)만 싣는다. */
export function buildRankView(rows: ShoppingRankRow[], latest: string | null, previous: string | null): RankView {
  const cur = rows.filter((r) => r.measured_on === latest);
  const prevMap = new Map(rows.filter((r) => previous && r.measured_on === previous).map((r) => [`${r.query}|${r.product}`, r]));
  const target = cur.filter((r) => r.is_target);
  const byProduct = new Map<string, RankLine[]>();
  for (const r of target) {
    const p = prevMap.get(`${r.query}|${r.product}`);
    // 측정 방식이 다르면(얕은 integrated ↔ 깊은 openapi) 순위 숫자의 뜻이 달라 변화를 셈하지 않는다.
    const methodChanged = !!p && p.method !== r.method;
    const comparable = p && !methodChanged ? p : undefined;
    const line: RankLine = {
      query: r.query, query_group: r.query_group, method: r.method, module: r.module,
      our_rank: r.our_rank, catalog_rank: r.catalog_rank, ad_seen: r.ad_seen, seen_up_to: r.seen_up_to, page1: r.page1,
      ourLabel: rankLabel(r.our_rank, r), catalogLabel: rankLabel(r.catalog_rank, r),
      prevOur: p?.our_rank ?? null, prevCatalog: p?.catalog_rank ?? null,
      deltaOur: rankDelta(comparable?.our_rank, r.our_rank), deltaCatalog: rankDelta(comparable?.catalog_rank, r.catalog_rank),
      hadPrev: !!p, methodChanged,
    };
    const list = byProduct.get(r.product) || [];
    list.push(line);
    byProduct.set(r.product, list);
  }
  const best = (l: RankLine) => Math.min(l.our_rank ?? Infinity, l.catalog_rank ?? Infinity);
  const products = Array.from(byProduct.entries())
    .sort((a, b) => productRank(a[0]) - productRank(b[0]) || a[0].localeCompare(b[0]))
    .map(([product, lines]) => ({
      product,
      lines: [...lines].sort((a, b) => best(a) - best(b) || a.query.localeCompare(b.query)),
      ranked: lines.filter((l) => l.our_rank != null || l.catalog_rank != null).length,
    }));
  const methods = Array.from(new Set(cur.map((r) => r.method))).sort();
  // 경고는 줄 단위로 판단한다. 한 회차에 깊은 측정(aside)과 얕은 측정(integrated)이 섞이므로
  // 얕은 줄이 하나 있다고 회차 전체를 「얕은 측정」으로 부르면 깊게 잰 줄의 순위까지 판정 불가로 읽힌다.
  const shallowTargets = target.filter((r) => r.method === "integrated").length;
  const deepTargets = target.length - shallowTargets;
  return {
    latest, previous, methods,
    shallow: target.length > 0 && deepTargets === 0,
    shallowTargets, deepTargets,
    products, latestRows: cur.length, targetRows: target.length,
  };
}
