// npm test  (= node --test scripts/tests/*.test.mjs)
// src/lib/dashboard-health.ts coupangDailyLagIssue: 쿠팡 키워드 묶음이 원본보다 늦은 날을 「대시보드 상태」에 주의로 띄운다(2026-11-13)
import { test } from "node:test";
import assert from "node:assert/strict";
import { coupangDailyLagIssue, buildDashboardHealth } from "../../src/lib/dashboard-health.ts";

test("늦은 날이 없거나 점검을 못 했으면 이슈 없음", () => {
  assert.equal(coupangDailyLagIssue(null), null);
  assert.equal(coupangDailyLagIssue(undefined), null);
  assert.equal(coupangDailyLagIssue([]), null);
});

test("늦은 날이 있으면 주의, 날짜 정렬·6일 넘으면 줄여 적고 다시 묶는 SQL 을 안내", () => {
  const i = coupangDailyLagIssue(["2026-11-12", "2026-11-03", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]);
  assert.equal(i.level, "warn");
  assert.equal(i.title, "쿠팡 키워드 묶음이 원본보다 늦은 날 6일");
  assert.equal(i.since, "2026-11-03");
  assert.match(i.cause, /2026-11-03, 2026-11-05, 2026-11-06, 2026-11-07, 2026-11-08 외 1일/);
  assert.match(i.action, /coupang_keyword_daily_refresh\(array\['2026-11-03',.*'2026-11-12'\]::date\[\]\)/);
});

test("buildDashboardHealth 가 이슈로 넣는다", () => {
  const base = { sources: [], collectors: [], referenceDate: "2026-11-12", today: "2026-11-13", heartbeatNotes: [], ops: [], nowMs: Date.parse("2026-11-13T00:00:00Z") };
  const h = buildDashboardHealth({ ...base, coupangDailyLag: ["2026-11-12"] });
  assert.ok(h.issues.some((x) => x.key === "coupang-keyword-daily-lag"));
  assert.ok(!buildDashboardHealth(base).issues.some((x) => x.key === "coupang-keyword-daily-lag"));
});
