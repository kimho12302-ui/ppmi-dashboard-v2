// npm test  (= node --test scripts/tests/*.test.mjs)
// src/lib/sa-balancelab.ts 를 그대로 불러 시험한다(node 형 지우기, 22.18+). 새 라우트 3개와 키워드 분석 탭의 판정이 여기 있다.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stalledSources, stalledByPlatform, groupRoutine, routineProducts, keywordState, buildMedinexTest,
  rankLabel, rankDelta, buildRankView, LOCK_LINE_WON,
  classifyKeywordSources, shoppingNoteBrands, isLegacyCampaignRow, splitLegacyRows, periodNotice,
  trimLegacyName, splitPeriodAtLegacy, mergeKeywordSummaries, legacyExclusionOrFilter, judgeSource,
} from "../../src/lib/sa-balancelab.ts";

test("수집 멈춤: 오늘보다 3일 넘게 앞인 조합만", () => {
  const list = [
    { platform: "naver_search", brand: "balancelab", latest: "2026-11-10" },
    { platform: "naver_shopping", brand: "balancelab", latest: "2026-05-04" },
    { platform: "naver_search", brand: "ironpet", latest: "2026-05-04" },
    { platform: "naver_search", brand: "nutty", latest: "2026-11-07" },
    { platform: "naver_search", brand: "saip", latest: "2026-11-06" },
  ];
  const s = stalledSources(list, "2026-11-10");
  assert.deepEqual(s.map((x) => `${x.platform}/${x.brand}`), ["naver_search/ironpet", "naver_search/saip", "naver_shopping/balancelab"]);
  assert.deepEqual(Object.keys(stalledByPlatform(s)).sort(), ["naver_search", "naver_shopping"]);
});

// ── 키워드 원천 판정(2026-11-13, QA HIGH-1 반영): stalled · gap · adsOff · pending ──
// 실측 기준(11-13): 파워링크 마지막 키워드 밸런스랩·너티·사입 11-13, 아이언펫 05-04. 파워링크(WEB_SITE) 비용 마지막 아이언펫 05-06.
const SRC = [
  { platform: "naver_search", brand: "balancelab", latest: "2026-11-13" },
  { platform: "naver_search", brand: "nutty", latest: "2026-11-13" },
  { platform: "naver_search", brand: "ironpet", latest: "2026-05-04" },
  { platform: "naver_search", brand: "saip", latest: "2026-11-13" },
];
const SPEND = [
  { platform: "naver_search", brand: "balancelab", lastSpend: "2026-11-13" },
  { platform: "naver_search", brand: "nutty", lastSpend: "2026-11-12" },
  { platform: "naver_search", brand: "ironpet", lastSpend: "2026-05-06" },
  { platform: "naver_search", brand: "saip", lastSpend: "2026-11-12" },
];
const EMPTY = { stalled: [], gap: [], adsOff: [], pending: [] };
const nut = (latest) => [{ platform: "naver_search", brand: "nutty", latest }];
const nutSpend = (lastSpend) => [{ platform: "naver_search", brand: "nutty", lastSpend }];
const kinds = (st) => Object.fromEntries(Object.entries(st).map(([k, v]) => [k, v.map((x) => x.brand)]));

test("원천 판정: 지금 상태(11-13)는 멈춤 0, 아이언펫은 광고비 기록도 끊김(05-06 꼬리는 멈춤 아님)", () => {
  const s = classifyKeywordSources(SRC, SPEND, "2026-11-13");
  assert.deepEqual(s.stalled, []);
  assert.deepEqual(s.adsOff, [{ platform: "naver_search", brand: "ironpet", latest: "2026-05-04", lastSpend: "2026-05-06" }]);
  assert.deepEqual(s.gap, []);
  assert.deepEqual(s.pending, []);
});

test("원천 판정: 진짜 멈춤 초기(키워드 11-01 뒤 광고비 매일, 동기화 어제까지)는 광고 끔으로 나오지 않는다", () => {
  // 11-04: 키워드가 3일 안 → 판정 안 함
  assert.deepEqual(classifyKeywordSources(nut("2026-11-01"), nutSpend("2026-11-03"), "2026-11-04"), EMPTY);
  // 11-05: 광고비 11-04 = 키워드+3일 → 아직 가르지 않음(pending), 광고 끔 아님
  assert.deepEqual(kinds(classifyKeywordSources(nut("2026-11-01"), nutSpend("2026-11-04"), "2026-11-05")), { stalled: [], gap: [], adsOff: [], pending: ["nutty"] });
  // 11-06: 광고비 11-05 > 키워드+3일 → 수집 멈춤
  assert.deepEqual(kinds(classifyKeywordSources(nut("2026-11-01"), nutSpend("2026-11-05"), "2026-11-06")), { stalled: ["nutty"], gap: [], adsOff: [], pending: [] });
  assert.deepEqual(kinds(classifyKeywordSources(nut("2026-11-01"), nutSpend("2026-11-06"), "2026-11-07")).stalled, ["nutty"]);
});

test("원천 판정: 광고비 동기화가 이틀 늦어도 멈춤 초기를 광고 끔으로 단정하지 않는다", () => {
  assert.deepEqual(kinds(classifyKeywordSources(nut("2026-11-01"), nutSpend("2026-11-04"), "2026-11-06")).pending, ["nutty"]);
});

test("원천 판정: 광고비가 키워드 뒤로 한참 이어졌다가 지금 끊겼으면 과거 수집 공백", () => {
  const s = classifyKeywordSources(nut("2026-10-01"), nutSpend("2026-11-01"), "2026-11-13");
  assert.deepEqual(s.gap, [{ platform: "naver_search", brand: "nutty", latest: "2026-10-01", lastSpend: "2026-11-01" }]);
  assert.equal(s.adsOff.length + s.stalled.length + s.pending.length, 0);
  // 광고 끔으로 단정하지도, 「아직 수집 전(매일 아침)」이라 하지도 않음(QA 재검수 LOW-1)
  assert.equal(periodNotice(nut("2026-10-01"), s, "2026-10-05"), "ended");
});

test("원천 판정: 광고비가 키워드 뒤로 이어진 적 없고 3일 넘게 끊겼거나 아예 없으면 광고비 기록도 끊김", () => {
  assert.deepEqual(kinds(classifyKeywordSources(nut("2026-10-01"), nutSpend("2026-10-03"), "2026-11-13")).adsOff, ["nutty"]);
  assert.deepEqual(classifyKeywordSources(nut("2026-10-01"), [], "2026-11-13").adsOff.map((x) => x.lastSpend), [null]);
});

test("원천 판정: 광고비는 있는데 키워드 기록이 한 번도 없는 브랜드도 본다", () => {
  assert.deepEqual(classifyKeywordSources([], nutSpend("2026-11-12"), "2026-11-13").stalled,
    [{ platform: "naver_search", brand: "nutty", latest: null, lastSpend: "2026-11-12" }]);
  assert.deepEqual(kinds(classifyKeywordSources([], nutSpend("2026-09-01"), "2026-11-13")).gap, ["nutty"]);
});

test("원천 판정: 구글·메타·GFA·네이버 쇼핑은 키워드 원천이 아니라 어디에도 안 나온다", () => {
  const src = [
    { platform: "google_search", brand: "nutty", latest: "2026-03-12" },
    { platform: "google_display", brand: "nutty", latest: "2026-03-12" },
    { platform: "meta", brand: "nutty", latest: "2026-03-12" },
    { platform: "naver_gfa", brand: "nutty", latest: "2026-03-12" },
    { platform: "naver_shopping", brand: "saip", latest: "2026-05-04" },
  ];
  const spend = [{ platform: "naver_shopping", brand: "saip", lastSpend: "2026-11-12" }, { platform: "meta", brand: "nutty", lastSpend: "2026-11-12" }];
  assert.deepEqual(classifyKeywordSources(src, spend, "2026-11-13"), EMPTY);
});

test("기간 안내: 키워드가 이틀 늦었을 뿐인데 「어제」를 고르면 '아직 수집 전일 수 있음'", () => {
  const src = [{ platform: "naver_search", brand: "balancelab", latest: "2026-11-11" }];
  const st = classifyKeywordSources(src, [{ platform: "naver_search", brand: "balancelab", lastSpend: "2026-11-12" }], "2026-11-13");
  assert.deepEqual(st, EMPTY);
  assert.equal(periodNotice(src, st, "2026-11-12"), "pending");
  assert.equal(periodNotice(src, st, "2026-11-11"), "none");
});

test("기간 안내: 범위 안 원천이 전부 광고비 기록도 끊김일 때만 adsOff, 멈춘 원천이 있으면 stalled", () => {
  const off = [{ platform: "naver_search", brand: "ironpet", latest: "2026-05-04" }];
  const st = classifyKeywordSources(off, [{ platform: "naver_search", brand: "ironpet", lastSpend: "2026-05-06" }], "2026-11-13");
  assert.equal(periodNotice(off, st, "2026-10-14"), "adsOff");
  const mix = [...off, { platform: "naver_search", brand: "nutty", latest: "2026-11-11" }];
  const st2 = classifyKeywordSources(mix, [{ platform: "naver_search", brand: "nutty", lastSpend: "2026-11-12" }], "2026-11-13");
  assert.equal(periodNotice(mix, st2, "2026-11-12"), "pending");
  const stall = [...off, { platform: "naver_search", brand: "nutty", latest: "2026-11-01" }];
  const st3 = classifyKeywordSources(stall, [{ platform: "naver_search", brand: "nutty", lastSpend: "2026-11-12" }], "2026-11-13");
  assert.equal(periodNotice(stall, st3, "2026-11-05"), "stalled");
  assert.equal(periodNotice([], EMPTY, "2026-11-05"), "none");
});

test("쇼핑 안내: 기간 안 쇼핑 광고비가 0보다 큰 브랜드만, 중복 없이 정렬", () => {
  const rows = [
    { brand: "saip", spend: 31890 }, { brand: "nutty", spend: "6943" }, { brand: "saip", spend: 100 },
    { brand: "ironpet", spend: 0 }, { brand: "balancelab", spend: null },
  ];
  assert.deepEqual(shoppingNoteBrands(rows), ["nutty", "saip"]);
  assert.deepEqual(shoppingNoteBrands([]), []);
});

test("옛 캠페인 단위 기록: 파워링크가 아닌 행 전부 + 파워링크는 정확한 이름 3건만(앞뒤 공백 무시)", () => {
  assert.equal(isLegacyCampaignRow("naver_shopping", "사입_벌크"), true);
  assert.equal(isLegacyCampaignRow("meta", "Meta 광고"), true);
  assert.equal(isLegacyCampaignRow("naver_gfa", "GFA"), true);
  assert.equal(isLegacyCampaignRow("google_search", "Google 검색"), true);
  assert.equal(isLegacyCampaignRow("naver_search", "01.아이언펫_파워링크"), true);
  assert.equal(isLegacyCampaignRow("naver_search", " 05. 사입_파미나/닥터레이\t"), true);
  // 진짜 키워드·비슷한 꼴은 남긴다(정규식은 쓰지 않는다, QA LOW)
  for (const k of ["강아지수제간식쇼핑몰", "10kg_개껌", "12.5kg_사료", "01.강아지_간식", "10.너티_", "모발검사"]) {
    assert.equal(isLegacyCampaignRow("naver_search", k), false, k);
  }
  assert.equal(trimLegacyName(" \t가 나\r\n"), "가 나");
  const rows = [
    { platform: "naver_search", keyword: "모발검사", cost: 1 },
    { platform: "naver_shopping", keyword: "04.너티_쇼핑검색", cost: 2 },
    { platform: "naver_search", keyword: "02.너티_파워링크", cost: 3 },
  ];
  const { keywords, legacy } = splitLegacyRows(rows);
  assert.deepEqual(keywords.map((r) => r.keyword), ["모발검사"]);
  assert.deepEqual(legacy.map((r) => r.keyword), ["04.너티_쇼핑검색", "02.너티_파워링크"]);
  assert.equal(rows.length, 3); // 원본은 그대로
});

test("아이언펫 판정은 정리 SQL 실행 여부와 무관: 옛 캠페인 행을 빼면 키워드 03-22 → 과거 수집 공백", () => {
  // 화면·latestBySource 가 옛 캠페인 행(05-04 「01.아이언펫_파워링크」)을 빼므로 마지막 키워드는 03-22
  assert.equal(judgeSource("2026-03-22", "2026-05-06", "2026-11-13"), "gap");
  const src = [{ platform: "naver_search", brand: "ironpet", latest: "2026-03-22" }];
  const st = classifyKeywordSources(src, [{ platform: "naver_search", brand: "ironpet", lastSpend: "2026-05-06" }], "2026-11-13");
  assert.deepEqual(st.gap.map((x) => [x.latest, x.lastSpend]), [["2026-03-22", "2026-05-06"]]);
  assert.equal(periodNotice(src, st, "2026-10-14"), "ended");
  // 공백과 광고비 끊김이 섞여도 ended, 끊김만이면 adsOff
  const mix = [...src, { platform: "naver_search", brand: "nutty", latest: "2026-10-01" }];
  const st2 = classifyKeywordSources(mix, [{ platform: "naver_search", brand: "ironpet", lastSpend: "2026-05-06" }, { platform: "naver_search", brand: "nutty", lastSpend: "2026-10-02" }], "2026-11-13");
  assert.equal(periodNotice(mix, st2, "2026-10-14"), "ended");
});

test("옛 캠페인 행 제외 필터: 05-04 뒤이거나 이름 3건이 아닌 행", () => {
  assert.equal(legacyExclusionOrFilter(),
    'date.gt.2026-05-04,keyword.not.in.("01.아이언펫_파워링크","02.너티_파워링크","05. 사입_파미나/닥터레이")');
  assert.equal(legacyExclusionOrFilter("2026-01-01", ['a"b']), 'date.gt.2026-01-01,keyword.not.in.("ab")');
});

test("옛 기록 기간 나누기: 05-04 까지와 그 뒤", () => {
  assert.deepEqual(splitPeriodAtLegacy("2026-04-01", "2026-05-31"), { early: ["2026-04-01", "2026-05-04"], late: ["2026-05-05", "2026-05-31"] });
  assert.deepEqual(splitPeriodAtLegacy("2026-10-14", "2026-11-12"), { early: null, late: ["2026-10-14", "2026-11-12"] });
  assert.deepEqual(splitPeriodAtLegacy("2026-03-01", "2026-05-04"), { early: ["2026-03-01", "2026-05-04"], late: null });
  assert.deepEqual(splitPeriodAtLegacy("2026-05-05", "2026-05-05"), { early: null, late: ["2026-05-05", "2026-05-05"] });
  assert.deepEqual(splitPeriodAtLegacy("", "2026-05-05"), { early: null, late: null });
});

test("묶음 합치기: (플랫폼, 키워드)로 더하고 전환매출은 둘 다 없으면 null", () => {
  const a = [{ platform: "naver_search", keyword: "x", impressions: 10, clicks: 1, cost: 100, conversions: 0, conversion_value: null, wasted_cost: 100, n: 1 }];
  const b = [
    { platform: "naver_search", keyword: "x", impressions: 5, clicks: 3, cost: 50, conversions: 1, conversion_value: 9000, wasted_cost: 0, n: 2 },
    { platform: "naver_search", keyword: "y", impressions: 1, clicks: 0, cost: 0, conversions: 0, conversion_value: null, wasted_cost: 0, n: 1 },
  ];
  const m = mergeKeywordSummaries(a, b);
  assert.deepEqual(m[0], { platform: "naver_search", keyword: "x", impressions: 15, clicks: 4, cost: 150, conversions: 1, conversion_value: 9000, wasted_cost: 100, n: 3 });
  assert.equal(m[1].conversion_value, null);
  // RPC 와 같은 순서: 클릭 내림차순 → 플랫폼 → 키워드
  const t = (platform, keyword, clicks) => ({ platform, keyword, impressions: 0, clicks, cost: 0, conversions: 0, conversion_value: null, wasted_cost: 0, n: 1 });
  const o = mergeKeywordSummaries([t("naver_search", "나", 5), t("meta", "가", 5), t("naver_search", "가", 5)], [t("naver_search", "다", 9)]);
  assert.deepEqual(o.map((r) => `${r.platform}/${r.keyword}`), ["naver_search/다", "meta/가", "naver_search/가", "naver_search/나"]);
  assert.equal(mergeKeywordSummaries(a, []).length, 1);
});

test("루틴 후보: 결과 순서, 등록·확인 필요만 펼침, 제품 칩 거르기", () => {
  const base = { date: "2026-11-10", source: "A", is_brand: false, stage: "auto", why: "", devices: ["MO"], cost_30d: 0, volume: 0, start_bid: 100, bid_basis: 100 };
  const rows = [
    { ...base, keyword_norm: "a", keyword: "a", product: "P01", result: "차단", clicks_30d: 1 },
    { ...base, keyword_norm: "b", keyword: "b", product: "P03", result: "등록", clicks_30d: 2 },
    { ...base, keyword_norm: "c", keyword: "c", product: "P01", result: "등록", clicks_30d: 9 },
    { ...base, keyword_norm: "d", keyword: "d", product: "P10", result: "확인 필요", clicks_30d: 0 },
    { ...base, keyword_norm: "e", keyword: "e", product: "P10", result: null, clicks_30d: 0 },
  ];
  const g = groupRoutine(rows, null);
  assert.deepEqual(g.map((x) => x.result), ["등록", "확인 필요", "차단", "(결과 없음)"]);
  assert.deepEqual(g.map((x) => x.open), [true, true, false, false]);
  assert.deepEqual(g[0].rows.map((r) => r.keyword), ["c", "b"]);
  assert.deepEqual(groupRoutine(rows, "P01").map((x) => x.result), ["등록", "차단"]);
  assert.deepEqual(routineProducts(rows), ["P01", "P03", "P10"]);
  assert.deepEqual(groupRoutine([], null), []);
});

const snap = (o) => ({
  keyword_id: "k", keyword: "x", adgroup: "01.씨맥스", bid: 300, keyword_lock: false, status_reason: "ELIGIBLE",
  adgroup_status: "ELIGIBLE", adgroup_lock: false, campaign_status: "ELIGIBLE", campaign_lock: false,
  imp_30d: 0, clk_30d: 0, cost_30d: 0, ...o,
});

test("키워드 상태: 잠김이 켜짐보다, 없으면 목록에 없음", () => {
  assert.equal(keywordState(null).label, "목록에 없음");
  assert.equal(keywordState(snap({ keyword_lock: true })).label, "잠김");
  assert.equal(keywordState(snap({ adgroup_status: "PAUSED" })).label, "꺼짐(광고그룹)");
  assert.equal(keywordState(snap({ status_reason: "KEYWORD_UNDER_REVIEW" })).label, "검수 중");
  assert.equal(keywordState(snap({})).label, "켜짐");
});

test("메디넥스 시험: 키워드 id 로 붙이고 그룹 소계·합계·잠금선", () => {
  const adds = [
    { keyword_id: "k1", keyword: "아마씨유", adgroup: "06.그라놀F", bid_after: 300, review_on: "2026-11-19", applied_at: "2026-11-09T11:33:55+00:00" },
    { keyword_id: "k2", keyword: "남자비오틴", adgroup: "05.쿼터백플러스", bid_after: 100, review_on: "2026-11-19", applied_at: "2026-11-09T11:33:55+00:00" },
    { keyword_id: "k3", keyword: "비타민D", adgroup: "05.쿼터백플러스", bid_after: 170, review_on: "2026-11-19", applied_at: "2026-11-08T16:00:00+00:00" },
    { keyword_id: "k2", keyword: "남자비오틴", adgroup: "05.쿼터백플러스", bid_after: 120, review_on: "2026-11-19", applied_at: "2026-11-10T01:00:00+00:00" },
  ];
  const snaps = [
    snap({ keyword_id: "k1", cost_30d: 12000, clk_30d: 30, imp_30d: 900, keyword_lock: true, bid: 280 }),
    snap({ keyword_id: "k2", cost_30d: 2500, clk_30d: 5, imp_30d: 100 }),
  ];
  const t = buildMedinexTest(adds, snaps);
  assert.equal(t.rows.length, 3, "같은 id 두 번 등록은 하나로");
  assert.equal(t.total.cost, 14500);
  assert.equal(t.total.overLine, 1);
  assert.equal(t.total.locked, 1);
  assert.equal(t.missing, 1);
  assert.equal(t.firstAddedOn, "2026-11-09", "16:00Z 는 KST 다음날 01시");
  assert.equal(t.reviewOn, "2026-11-19");
  const q = t.groups.find((g) => g.adgroup === "05.쿼터백플러스");
  assert.equal(q.keywords, 2);
  assert.equal(q.cost, 2500);
  const k1 = t.rows.find((r) => r.keyword_id === "k1");
  assert.equal(k1.bid, 280, "입찰은 계정 현재값 우선");
  assert.equal(k1.progress, 12000 / LOCK_LINE_WON);
  const k3 = t.rows.find((r) => r.keyword_id === "k3");
  assert.equal(k3.bid, 170, "목록에 없으면 등록 때 입찰");
  assert.equal(buildMedinexTest([], []).total.keywords, 0);
});

test("쇼핑 순위: 글자와 변화", () => {
  assert.equal(rankLabel(3, { method: "integrated", seen_up_to: 5, page1: null }), "3위");
  assert.equal(rankLabel(null, { method: "integrated", seen_up_to: 5, page1: null }), "판정 불가");
  assert.equal(rankLabel(null, { method: "openapi", seen_up_to: 40, page1: false }), "40위 밖");
  assert.equal(rankLabel(null, { method: "openapi", seen_up_to: 20, page1: null }), "20위 안에 없음");
  assert.equal(rankDelta(10, 4), 6);
  assert.equal(rankDelta(null, 4), null);
});

test("쇼핑 순위 화면: 목표 검색어만, 제품 순서, 직전 회차 대조", () => {
  const r = (o) => ({ query_group: "golden", is_target: true, method: "integrated", module: "price-compare", our_rank: null, catalog_rank: null,
    catalog_id: null, ad_seen: false, seen_up_to: 5, page1: null, measured_at: "", ...o });
  const rows = [
    r({ measured_on: "2026-11-16", query: "비타민C", product: "씨맥스", catalog_rank: 2 }),
    r({ measured_on: "2026-11-16", query: "칼슘", product: "칼트레이스" }),
    r({ measured_on: "2026-11-16", query: "칼슘", product: "씨맥스", is_target: false }),
    r({ measured_on: "2026-11-09", query: "비타민C", product: "씨맥스", catalog_rank: 3 }),
  ];
  const v = buildRankView(rows, "2026-11-16", "2026-11-09");
  assert.deepEqual(v.products.map((p) => p.product), ["씨맥스", "칼트레이스"]);
  assert.equal(v.targetRows, 2);
  assert.equal(v.latestRows, 3);
  assert.equal(v.shallow, true);
  const c = v.products[0].lines[0];
  assert.equal(c.deltaCatalog, 1);
  assert.equal(c.hadPrev, true);
  assert.equal(v.products[1].lines[0].hadPrev, false);
  assert.equal(v.products[0].ranked, 1);
  const only = buildRankView(rows.filter((x) => x.measured_on === "2026-11-09"), "2026-11-09", null);
  assert.equal(only.previous, null);
  assert.equal(only.products[0].lines[0].deltaCatalog, null);
});

// ── 2026-11-10 독립 리뷰 반영 ──
import { latestAdds, countRoutineResults, isOverLineOpen } from "../../src/lib/sa-balancelab.ts";

test("잠금선 경고: 켜진 것만 세고, 잠금선 미만 수동 잠금이나 꺼진 그룹이 상쇄하지 않음", () => {
  const add = (id, kw) => ({ keyword_id: id, keyword: kw, adgroup: "01.씨맥스", bid_after: 100, review_on: "2026-11-19", applied_at: "2026-11-09T11:00:00Z" });
  const adds = [add("a", "켜진도달"), add("b", "잠금선미만잠김"), add("c", "그룹꺼짐도달"), add("d", "잠긴도달")];
  const snaps = [
    snap({ keyword_id: "a", cost_30d: 11000 }),
    snap({ keyword_id: "b", cost_30d: 3000, keyword_lock: true }),
    snap({ keyword_id: "c", cost_30d: 15000, adgroup_status: "PAUSED" }),
    snap({ keyword_id: "d", cost_30d: 10000, keyword_lock: true }),
  ];
  const t = buildMedinexTest(adds, snaps);
  assert.equal(t.total.overLine, 3);
  assert.equal(t.total.locked, 2);
  assert.equal(t.total.overLineOpen, 1, "예전 계산(overLine - locked = 1)은 우연히 같아도 뜻이 달랐다");
  assert.deepEqual(t.rows.filter(isOverLineOpen).map((r) => r.keyword_id), ["a"]);
  // 수동 잠금 하나 더(잠금선 미만)가 켜진 도달 키워드의 경고를 지우면 안 된다
  const t2 = buildMedinexTest([...adds, add("e", "또미만잠김")], [...snaps, snap({ keyword_id: "e", cost_30d: 100, keyword_lock: true })]);
  assert.equal(t2.total.overLine - t2.total.locked, 0, "옛 계산은 0 으로 경고가 사라졌다");
  assert.equal(t2.total.overLineOpen, 1);
});

test("신규 등록 묶기: 시각 값 비교, id 없는 등록은 광고그룹|키워드로 대조", () => {
  const rows = latestAdds([
    { keyword_id: null, keyword: "x", adgroup: "g", bid_after: 1, review_on: null, applied_at: "2026-11-09T23:00:00+09:00" },
    { keyword_id: "k", keyword: "x", adgroup: "g", bid_after: 2, review_on: null, applied_at: "2026-11-09T13:30:00Z" },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].bid_after, 1, "23:00+09 = 14:00Z 가 13:30Z 보다 늦다(문자열 비교면 반대)");
  const t = buildMedinexTest(
    [{ keyword_id: null, keyword: "옛기록", adgroup: "01.씨맥스", bid_after: 100, review_on: null, applied_at: "2026-11-09T11:00:00Z" }],
    [snap({ keyword_id: "z", keyword: "옛기록", adgroup: "01.씨맥스", cost_30d: 500 })],
  );
  assert.equal(t.missing, 0);
  assert.equal(t.total.cost, 500);
});

test("쇼핑 순위: 측정 방식이 바뀌면 변화를 셈하지 않음", () => {
  const base = { query_group: "golden", is_target: true, module: "price-compare", our_rank: null, catalog_id: null, ad_seen: false, seen_up_to: 40, page1: true, measured_at: "" };
  const v = buildRankView([
    { ...base, measured_on: "2026-11-16", query: "q", product: "씨맥스", method: "openapi", catalog_rank: 10 },
    { ...base, measured_on: "2026-11-09", query: "q", product: "씨맥스", method: "integrated", catalog_rank: 3 },
  ], "2026-11-16", "2026-11-09");
  const l = v.products[0].lines[0];
  assert.equal(l.hadPrev, true);
  assert.equal(l.methodChanged, true);
  assert.equal(l.deltaCatalog, null);
});

test("루틴 결과별 개수", () => {
  assert.deepEqual(countRoutineResults([{ result: "차단" }, { result: "등록" }, { result: null }, { result: "등록" }]),
    [{ result: "등록", count: 2 }, { result: "차단", count: 1 }, { result: "(결과 없음)", count: 1 }]);
});

test("쇼핑 순위: 깊은·얕은 측정이 섞이면 회차 전체를 얕은 측정으로 부르지 않는다", () => {
  const base = { measured_on: "2026-11-10", product: "씨맥스", query_group: "golden", is_target: true, module: null,
    catalog_rank: null, catalog_id: null, ad_seen: false, measured_at: "2026-11-10T10:00:00+09:00" };
  const rows = [
    { ...base, query: "씨맥스", method: "aside", our_rank: 4, seen_up_to: 120, page1: true },
    { ...base, query: "메가도스", method: "aside", our_rank: null, seen_up_to: 120, page1: false },
    { ...base, query: "흡연자영양제", method: "integrated", our_rank: null, seen_up_to: 7, page1: null },
  ];
  const v = buildRankView(rows, "2026-11-10", null);
  assert.equal(v.shallow, false);
  assert.equal(v.deepTargets, 2);
  assert.equal(v.shallowTargets, 1);
  const lines = v.products[0].lines;
  assert.equal(lines.find((l) => l.query === "메가도스").ourLabel, "40위 밖");
  assert.equal(lines.find((l) => l.query === "흡연자영양제").ourLabel, "판정 불가");
  const allShallow = buildRankView([rows[2]], "2026-11-10", null);
  assert.equal(allShallow.shallow, true);
});
