// npm test  (= node --test scripts/tests/*.test.mjs)
// src/lib/coupang-keyword-range.ts : 쿠팡 광고 키워드 탭 불러오기 판정(2026-11-13)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  coupangRpcFailure, daysInclusive, shortRange, shorterRanges, fallbackAllowed, coupangLoadErrorMessage,
  COUPANG_FALLBACK_MAX_ROWS,
} from "../../src/lib/coupang-keyword-range.ts";

test("요약 함수 오류 가르기: 함수 없음 · 시간 초과(코드 또는 문구) · 그 밖", () => {
  assert.equal(coupangRpcFailure({ code: "PGRST202", message: "Could not find the function" }), "missing");
  assert.equal(coupangRpcFailure({ code: "57014", message: "canceling statement due to statement timeout" }), "timeout");
  assert.equal(coupangRpcFailure({ code: "", message: "canceling statement due to statement timeout" }), "timeout");
  assert.equal(coupangRpcFailure({ code: "08006", message: "connection failure" }), "other");
  assert.equal(coupangRpcFailure(null), "other");
});

test("기간 일수·줄인 기간", () => {
  assert.equal(daysInclusive("2026-10-14", "2026-11-12"), 30);
  assert.equal(daysInclusive("2026-11-06", "2026-11-12"), 7);
  assert.equal(daysInclusive("2026-11-12", "2026-11-06"), 0);
  assert.equal(daysInclusive("", "2026-11-06"), 0);
  assert.deepEqual(shortRange("2026-11-12", 7), { from: "2026-11-06", to: "2026-11-12" });
  assert.deepEqual(shortRange("2026-11-03", 14), { from: "2026-10-21", to: "2026-11-03" });
  assert.deepEqual(shorterRanges("2026-10-14", "2026-11-12"), [7, 14]);
  assert.deepEqual(shorterRanges("2026-11-01", "2026-11-12"), [7]);
  assert.deepEqual(shorterRanges("2026-11-06", "2026-11-12"), []);
});

test("대체 경로 한도: 한도까지는 끌어오고 넘으면 바로 안내", () => {
  assert.equal(fallbackAllowed(0), true);
  assert.equal(fallbackAllowed(COUPANG_FALLBACK_MAX_ROWS), true);
  assert.equal(fallbackAllowed(COUPANG_FALLBACK_MAX_ROWS + 1), false);
  assert.equal(fallbackAllowed(30_000, 50_000), true);
});

test("안내 문구에 기간·행 수가 들어간다", () => {
  assert.match(coupangLoadErrorMessage("timeout", 30), /30일.*7일·14일/);
  assert.match(coupangLoadErrorMessage("too_long", 30, 31000), /30일, 원본 31,000행/);
  assert.match(coupangLoadErrorMessage("too_long", 0), /고른 기간/);
});
