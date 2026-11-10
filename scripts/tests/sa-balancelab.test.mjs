// npm test  (= node --test scripts/tests/*.test.mjs)
// src/lib/sa-balancelab.ts 를 그대로 불러 시험한다(node 형 지우기, 22.18+). 새 라우트 3개와 키워드 분석 탭의 판정이 여기 있다.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stalledSources, stalledByPlatform, groupRoutine, routineProducts, keywordState, buildMedinexTest,
  rankLabel, rankDelta, buildRankView, LOCK_LINE_WON,
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
