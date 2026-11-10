// npm test  (= node --test scripts/tests/*.test.mjs)
// 위킵 재고 받는 API 의 규칙(src/lib/wekeep-ingest-core.ts)을 가짜 DB 로 시험한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateWekeepRows, runWekeepIngest, MAX_ROWS, WEKEEP_HEARTBEAT } from "../../src/lib/wekeep-ingest-core.ts";

const TODAY = "2026-11-10";
const snapRow = (o = {}) => ({ date: "2026-11-10", sku_no: "123", product_name: "너티사운드_바삭", available_qty: 5, read_at: "2026-11-10T05:08:13.567Z", ...o });
const dailyRow = (o = {}) => ({
  ymd: "2026-11-09", sku_no: "123", shipin_qty: 0, shipout_qty: 1, return_shipin_qty: 0, faulty_shipin_qty: 0, damage_shipin_qty: 0, center_qty: 10, read_at: null, ...o,
});

function fakeDb({ failAt = -1, beatError = null } = {}) {
  const calls = { upserts: [], beats: [] };
  let n = 0;
  return {
    calls,
    db: {
      upsert: async (table, rows) => {
        const i = n++;
        if (i === failAt) return { error: { message: "boom" } };
        calls.upserts.push({ table, count: rows.length });
        return { error: null };
      },
      beat: async (fields) => { calls.beats.push(fields); return { error: beatError ? { message: beatError } : null }; },
    },
  };
}

test("검증: 음수·미래·이른 날짜·없는 날짜·빈 필수 칸·read_at 형식", () => {
  const cases = [
    [snapRow({ available_qty: -1 }), /0 이상 정수/],
    [snapRow({ date: "2026-11-11" }), /미래/],
    [snapRow({ date: "2024-12-31" }), /너무 이른/],
    [snapRow({ date: "2026-02-31" }), /실제 날짜/],
    [snapRow({ product_name: null }), /빈 필수 칸/],
    [snapRow({ read_at: "어제" }), /read_at/],
    [snapRow({ extra: 1 }), /모르는 칸/],
  ];
  for (const [row, re] of cases) {
    const { errors } = validateWekeepRows("wekeep-snapshot", [row], TODAY);
    assert.equal(errors.length, 1, JSON.stringify(row));
    assert.match(errors[0], re);
  }
  const d = validateWekeepRows("wekeep-daily", [dailyRow({ center_qty: null })], TODAY);
  assert.match(d.errors[0], /빈 필수 칸: center_qty/);
});

test("같은 키가 두 번 오면 뒤엣것 하나만", () => {
  const { errors, clean, deduped } = validateWekeepRows("wekeep-daily", [dailyRow({ shipout_qty: 1 }), dailyRow({ shipout_qty: 9 })], TODAY);
  assert.equal(errors.length, 0);
  assert.equal(clean.length, 1);
  assert.equal(clean[0].shipout_qty, 9);
  assert.equal(deduped, 1);
});

test("성공: 행을 쓰고 스냅샷이면 신선도 날짜까지 심박", async () => {
  const f = fakeDb();
  const res = await runWekeepIngest("wekeep-snapshot", [snapRow(), snapRow({ sku_no: "456" })], TODAY, f.db, "T");
  assert.equal(res.status, 200);
  assert.equal(res.body.written, 2);
  assert.equal(f.calls.beats.length, 1);
  assert.equal(f.calls.beats[0].source, WEKEEP_HEARTBEAT);
  assert.equal(f.calls.beats[0].ok, true);
  assert.equal(f.calls.beats[0].latest_data_date, "2026-11-10");
});

test("0행·상한 초과·검증 실패도 실패 심박을 남기고 아무것도 안 씀", async () => {
  for (const [rows, status] of [[[], 400], [new Array(MAX_ROWS + 1).fill(0), 413], [[snapRow({ available_qty: -3 })], 400]]) {
    const f = fakeDb();
    const res = await runWekeepIngest("wekeep-snapshot", rows, TODAY, f.db, "T");
    assert.equal(res.status, status);
    assert.equal(f.calls.upserts.length, 0);
    assert.equal(f.calls.beats.length, 1);
    assert.equal(f.calls.beats[0].ok, false);
  }
});

test("중간 묶음에서 실패하면 써진 행 수를 응답과 심박에 남김", async () => {
  const rows = Array.from({ length: 700 }, (_, i) => dailyRow({ sku_no: String(1000 + i) }));
  const f = fakeDb({ failAt: 1 });
  const res = await runWekeepIngest("wekeep-daily", rows, TODAY, f.db, "T");
  assert.equal(res.status, 500);
  assert.equal(res.body.written, 500);
  assert.equal(res.body.total, 700);
  assert.match(f.calls.beats[0].note, /700행 중 500행만/);
});

test("심박 쓰기가 실패하면 응답에 heartbeat_error", async () => {
  const f = fakeDb({ beatError: "hb down" });
  const res = await runWekeepIngest("wekeep-daily", [dailyRow()], TODAY, f.db, "T");
  assert.equal(res.status, 200);
  assert.equal(res.body.heartbeat_error, "hb down");
});
