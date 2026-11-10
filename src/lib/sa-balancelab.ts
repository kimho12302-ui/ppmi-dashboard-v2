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
