// npm test  (= node --test scripts/tests/*.test.mjs)
// 판매입력 매칭표(src/lib/sales-match-core.ts)와 판매입력 matchKeys(src/lib/sales-entry-core.ts)를 가짜 DB·합성 값으로 시험한다.
// 실제 DB·시트는 안 쓴다.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normKey, validateMatchInput, nextMatchRow, canDelete, validateSeed, onlyNew, parseProductList,
  patchRowValues, planPatch, runMatchPatch, unmatchedFromLines, suggestCodes, baseKey, sortMatches,
  saveMatch, runSeed, SOURCE_SEED, SOURCE_DASHBOARD, NA,
  saveItemWarehouse, warehouseOptions, isBlankWarehouse, validateItemInput, PRODUCT_LIST_URL, STATS_SHEET_ID, PRODUCT_LIST_GID,
} from "../../src/lib/sales-match-core.ts";
import {
  SHEET_HEADERS, SHEET_COLS, LINES_TABLE, RUNS_TABLE, validateSalesEntry, runSalesEntryIngest,
} from "../../src/lib/sales-entry-core.ts";

const NOW = "2026-11-26T08:00:00.000Z";
const idx = (name) => SHEET_HEADERS.indexOf(name);
const last = (name) => SHEET_HEADERS.lastIndexOf(name);

/** 42칸 #N/A 줄. 앞 출하창고·뒤 출하창고·상품코드·품목코드 모두 #N/A */
function naRow(o = {}) {
  const r = Array(SHEET_COLS).fill(null);
  r[idx("판매몰")] = o.mall ?? "PPMI_스마트스토어";
  r[idx("상품코드")] = NA;
  r[idx("상품명")] = o.name ?? "합성 상품";
  r[idx("출하창고")] = NA;
  r[last("출하창고")] = NA;
  r[idx("품목코드")] = NA;
  r[idx("일자")] = o.day ?? "2026-11-25";
  r[idx("공급가액")] = 1000;
  return r;
}
const line = (date, seq, key, o = {}) => ({
  date, seq, mall: o.mall ?? "PPMI_스마트스토어", match_key: key, item_code: NA, row_values: naRow({ ...o, day: date }),
});

test("열쇠 정규화: 대소문자만 안 가린다(공백·trim 은 그대로)", () => {
  assert.equal(normKey("Farmina N&D 퀴노아 CAT0"), "farmina n&d 퀴노아 cat0");
  assert.equal(normKey(" 앞뒤 공백 "), " 앞뒤 공백 ");
  const v = validateMatchInput({ key: "ABC 옵션0", code: " P0001 " });
  assert.equal(v.ok, true);
  assert.equal(v.value.key, "ABC 옵션0");
  assert.equal(v.value.keyNorm, "abc 옵션0");
  assert.equal(v.value.code, "P0001");
  assert.equal(validateMatchInput({ key: "  ", code: "P" }).ok, false);
  assert.equal(validateMatchInput({ key: "a", code: "" }).ok, false);
  assert.equal(validateMatchInput({ key: "a", code: "P", note: 3 }).ok, false);
});

test("row_values: 상품코드·품목코드는 새 코드, 출하창고 두 칸은 새 창고, 원본은 안 바뀜", () => {
  const src = naRow();
  const out = patchRowValues(src, SHEET_HEADERS, "P0001", "PPMI_3PL");
  assert.equal(out[idx("상품코드")], "P0001");
  assert.equal(out[idx("품목코드")], "P0001");
  assert.equal(out[idx("출하창고")], "PPMI_3PL");
  assert.equal(out[last("출하창고")], "PPMI_3PL");
  assert.equal(out[idx("공급가액")], 1000);
  assert.equal(src[idx("품목코드")], NA, "원본 배열을 바꾸면 안 된다");
  const noWh = patchRowValues(src, SHEET_HEADERS, "P0001", null);
  assert.equal(noWh[last("출하창고")], null);
});

test("보관 줄 고치기: 열쇠가 같은(대소문자 무시) 미매칭 줄만, unmatched 목록·건수 다시 셈", () => {
  const cands = [
    line("2026-11-24", 3, "ABC 옵션0"),
    line("2026-11-25", 1, "abc 옵션0", { mall: "YS_스마트스토어" }),
    line("2026-11-25", 4, "다른 상품0"),
    line("2026-11-25", 7, "ABC 옵션0", { mall: "YS_스마트스토어" }),
  ];
  const runs = [
    { date: "2026-11-24", unmatched: [{ 판매몰: "PPMI_스마트스토어", 매칭열쇠: "ABC 옵션0", 줄수: 1 }], unmatched_count: 1 },
    { date: "2026-11-25", unmatched: [{ 판매몰: "YS_스마트스토어", 매칭열쇠: "abc 옵션0", 줄수: 2 }, { 판매몰: "PPMI_스마트스토어", 매칭열쇠: "다른 상품0", 줄수: 1 }], unmatched_count: 3 },
  ];
  const plan = planPatch(cands, runs, normKey("Abc 옵션0"), "P0001", "PPMI_3PL", SHEET_HEADERS);
  assert.deepEqual(plan.lines.map((l) => `${l.date}#${l.seq}`), ["2026-11-24#3", "2026-11-25#1", "2026-11-25#7"]);
  for (const l of plan.lines) {
    assert.equal(l.item_code, "P0001");
    assert.equal(l.warehouse, "PPMI_3PL");
    assert.equal(l.unmatched, false);
    assert.equal(l.row_values[idx("상품코드")], "P0001");
    assert.equal(l.row_values[last("출하창고")], "PPMI_3PL");
  }
  assert.deepEqual(plan.runs, [
    { date: "2026-11-24", unmatched: [], unmatched_count: 0 },
    { date: "2026-11-25", unmatched: [{ 판매몰: "PPMI_스마트스토어", 매칭열쇠: "다른 상품0", 줄수: 1 }], unmatched_count: 1 },
  ]);
  assert.deepEqual(plan.staleDates, []);
});

test("줄만 고쳐지고 실행 행 갱신이 실패한 날도 다시 저장하면 다시 센다", () => {
  // 줄은 이미 고쳐져 후보(미매칭)에 없지만, 실행 행 unmatched 에 열쇠가 남아 있다
  const runs = [{ date: "2026-11-25", unmatched: [{ 판매몰: "P", 매칭열쇠: "ABC 옵션0", 줄수: 1 }], unmatched_count: 1 }];
  const plan = planPatch([], runs, "abc 옵션0", "P0001", null, SHEET_HEADERS);
  assert.deepEqual(plan.lines, []);
  assert.deepEqual(plan.runs, [{ date: "2026-11-25", unmatched: [], unmatched_count: 0 }]);
});

test("매칭열쇠 없이 보관된 날(옛 전송)은 거꾸로 맞추지 않고 다시 보내라고 알린다", async () => {
  const cands = [{ ...line("2026-11-20", 1, null) }];
  const runs = [{ date: "2026-11-20", unmatched: [{ 판매몰: "P", 매칭열쇠: "ABC 옵션0", 줄수: 1 }], unmatched_count: 1 }];
  const plan = planPatch(cands, runs, "abc 옵션0", "P0001", null, SHEET_HEADERS);
  assert.deepEqual(plan.lines, []);
  assert.deepEqual(plan.runs, []);
  assert.deepEqual(plan.staleDates, ["2026-11-20"]);
  const res = await runMatchPatch(fakePatchDb(cands, runs).db, "abc 옵션0", "P0001", null, SHEET_HEADERS);
  assert.equal(res.lines, 0);
  assert.match(res.warnings.join(" "), /2026-11-20.*다시 보내면/);
});

test("unmatched 목록은 판매몰·열쇠별 줄 수, 순서대로", () => {
  assert.deepEqual(unmatchedFromLines([
    { seq: 5, mall: "B", match_key: "y" }, { seq: 1, mall: "A", match_key: "x" }, { seq: 3, mall: "A", match_key: "x" },
  ]), [{ 판매몰: "A", 매칭열쇠: "x", 줄수: 2 }, { 판매몰: "B", 매칭열쇠: "y", 줄수: 1 }]);
});

function fakePatchDb(cands, runs, o = {}) {
  const calls = [];
  const lineUpdates = [];
  const db = {
    listUnmatchedLines: async () => (o.linesError ? { data: [], error: o.linesError } : { data: cands, error: null }),
    listRunsWithUnmatched: async () => ({ data: runs, error: null }),
    updateLine: async (u) => { calls.push(["line", u.date, u.seq, u.item_code]); lineUpdates.push(u); return { error: o.lineError ?? null }; },
    updateRun: async (u) => { calls.push(["run", u.date, u.unmatched_count]); return { error: null }; },
  };
  return { db, calls, lineUpdates };
}

const PRODUCTS = parseProductList([
  ["품목코드", "카테고리", "브랜드명", "라인업", "제품"],
  ["P0001", "검사", "밸런스랩", "큐모발", "큐모발 검사"],
  ["  P0002 ", "사료", "너티", "", "너티 사료"],
  ["P0001", "중복", "다른", "", "나중 줄"],
  ["", "빈", "", "", ""],
]);

function saveDeps(o = {}) {
  const rows = new Map((o.rows ?? []).map((r) => [r.key_norm, r]));
  const fp = fakePatchDb(o.cands ?? [], o.runs ?? []);
  const upserts = [];
  // 출하창고 표(가짜). 기본: P0001=PPMI_3PL, 창고 목록 PPMI_3PL ×2 · YS_내부창고 ×1 + 머리글 찌꺼기
  const items = new Map((o.items ?? [
    { code: "P0001", name: "큐모발 검사", warehouse: "PPMI_3PL" },
    { code: "Q0001", name: "다른", warehouse: "PPMI_3PL" },
    { code: "Q0002", name: "또 다른", warehouse: "YS_내부창고" },
    { code: "제품코드", name: "제품명", warehouse: "출하창고" },
  ]).map((i) => [i.code, i]));
  const itemUpserts = [];
  const staleCalls = [];
  const originals = new Set(o.originals ?? []);
  return {
    upserts, calls: fp.calls, lineUpdates: fp.lineUpdates, rows, items, itemUpserts, staleCalls,
    deps: {
      isSeeded: async () => o.setup ? { setupNeeded: true, error: null } : { setupNeeded: false, error: null, data: o.seeded ?? true },
      readProductCodes: async () => { if (o.sheetFails) throw new Error("시트 권한 없음"); return PRODUCTS; },
      getRow: async (k) => ({ setupNeeded: false, error: null, data: rows.get(k) ?? null }),
      upsert: async (r) => { upserts.push(r); rows.set(r.key_norm, r); return { error: null }; },
      getWarehouse: async (code) => {
        const it = items.get(code);
        return it ? { data: it.warehouse, found: true, error: null } : { data: null, found: false, error: null };
      },
      listItems: async () => ({ data: Array.from(items.values()), error: null }),
      upsertItem: async (r) => { itemUpserts.push(r); items.set(r.code, r); return { error: null }; },
      markOriginalStale: async (dates) => {
        staleCalls.push([...dates]);
        if (o.staleMissing) return { marked: [], missingColumn: true, error: null };
        return { marked: dates.filter((d) => originals.has(d)), missingColumn: false, error: null };
      },
      patchDb: fp.db,
      headers: SHEET_HEADERS,
      now: () => NOW,
    },
  };
}

test("상품 목록: 머리글 줄·빈 코드 건너뜀, trim, 같은 코드는 먼저 나온 줄", () => {
  assert.deepEqual(PRODUCTS.map((p) => [p.code, p.name, p.sheetRow]), [["P0001", "큐모발 검사", 4], ["P0002", "너티 사료", 5]]);
});

test("저장: 상품 목록에 없는 코드는 400, 아무것도 안 쓴다", async () => {
  const s = saveDeps({ cands: [line("2026-11-25", 1, "ABC 옵션0")] });
  const res = await saveMatch(s.deps, { key: "ABC 옵션0", code: "P9999" });
  assert.equal(res.status, 400);
  assert.equal(res.body.notInProductList, true);
  assert.match(res.body.error, /상품 목록에 없는 코드/);
  assert.equal(s.upserts.length, 0);
  assert.equal(s.calls.length, 0);
  // 대소문자가 다른 코드도 없는 코드다(upload-sales 가 대소문자를 가린다)
  assert.equal((await saveMatch(s.deps, { key: "ABC 옵션0", code: "p0001" })).status, 400);
});

test("저장: seed 전이면 409, 시트를 못 읽으면 502, 표가 없으면 503", async () => {
  assert.equal((await saveMatch(saveDeps({ seeded: false }).deps, { key: "a", code: "P0001" })).status, 409);
  const s = saveDeps({ sheetFails: true });
  const r = await saveMatch(s.deps, { key: "a", code: "P0001" });
  assert.equal(r.status, 502);
  assert.equal(s.upserts.length, 0);
  assert.equal((await saveMatch(saveDeps({ setup: true }).deps, { key: "a", code: "P0001" })).status, 503);
});

test("저장 → 보관 줄 고치기 → n일치 m줄", async () => {
  const s = saveDeps({
    cands: [line("2026-11-25", 1, "ABC 옵션0"), line("2026-11-25", 2, "다른0")],
    runs: [{ date: "2026-11-25", unmatched: [{ 판매몰: "PPMI_스마트스토어", 매칭열쇠: "ABC 옵션0", 줄수: 1 }, { 판매몰: "PPMI_스마트스토어", 매칭열쇠: "다른0", 줄수: 1 }], unmatched_count: 2 }],
  });
  const res = await saveMatch(s.deps, { key: "abc 옵션0", code: "P0001" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.patched, { dates: ["2026-11-25"], lines: 1 });
  assert.equal(s.upserts[0].source, SOURCE_DASHBOARD);
  assert.equal(s.upserts[0].key_norm, "abc 옵션0");
  assert.deepEqual(s.calls, [["line", "2026-11-25", 1, "P0001"], ["run", "2026-11-25", 1]]);
  assert.deepEqual(res.body.warnings, []);
  // 출하창고 표에 없는 코드는 빈 창고 + 경고
  const s2 = saveDeps({ cands: [line("2026-11-25", 1, "X0")] });
  const r2 = await saveMatch(s2.deps, { key: "X0", code: "P0002" });
  assert.equal(r2.status, 200);
  assert.match(r2.body.warnings.join(" "), /출하창고 표에 P0002 가 없어/);
});

test("엑셀에서 옮긴 줄의 코드를 바꿔도 출처는 엑셀옮김, 옛 코드는 메모에. 지우기는 대시보드 줄만", () => {
  const seedRow = { key_norm: "abc0", match_key: "ABC0", code: "OLD", source: SOURCE_SEED, note: null };
  const next = nextMatchRow(seedRow, { key: "abc0", keyNorm: "abc0", code: "NEW", note: null }, NOW);
  assert.equal(next.source, SOURCE_SEED);
  assert.equal(next.match_key, "ABC0", "열쇠 원문은 처음 것을 둔다");
  assert.equal(next.code, "NEW");
  assert.match(next.note, /원래 코드 OLD/);
  const again = nextMatchRow(next, { key: "abc0", keyNorm: "abc0", code: "NEW2", note: null }, NOW);
  assert.equal((again.note.match(/원래 코드/g) ?? []).length, 1, "원래 코드 메모는 한 번만");
  assert.match(again.note, /원래 코드 OLD/);
  const withMemo = nextMatchRow(again, { key: "abc0", keyNorm: "abc0", code: "NEW3", note: "사람 메모" }, NOW);
  assert.equal(withMemo.note, "원래 코드 OLD(엑셀옮김) · 사람 메모", "새 메모를 넣어도 원래 코드는 남는다");
  assert.equal(nextMatchRow(withMemo, { key: "abc0", keyNorm: "abc0", code: "NEW4", note: null }, NOW).note, "원래 코드 OLD(엑셀옮김) · 사람 메모");
  assert.equal(canDelete(seedRow), false);
  assert.equal(canDelete({ source: SOURCE_DASHBOARD }), true);
  assert.equal(canDelete(null), false);
});

test("seed: 먼저 나온 줄이 이기고, 빈 열쇠·코드는 건너뛰고, 이미 있는 줄은 안 덮는다", async () => {
  const body = {
    match: [
      ["채널별 상품명", "제품코드"],
      ["ABC 옵션0", "P0001"],
      ["abc 옵션0", "P0002"], // 대소문자만 다른 중복: 먼저 나온 P0001
      [null, "P0003"],
      ["코드 빈 줄", null],
      ["대시보드에서 고친 열쇠", "SEED_CODE"],
      ["새 열쇠", "P0004"],
    ],
    warehouse: [["P0001", "이름", "PPMI_3PL"], ["P0001", "중복", "다른창고"], [null, "x", "y"], ["P0004", null, null]],
  };
  const v = validateSeed(body, NOW);
  assert.equal(v.ok, true);
  assert.deepEqual(v.value.match.map((r) => [r.key_norm, r.code, r.source]), [
    ["abc 옵션0", "P0001", SOURCE_SEED], ["대시보드에서 고친 열쇠", "SEED_CODE", SOURCE_SEED], ["새 열쇠", "P0004", SOURCE_SEED],
  ]);
  assert.deepEqual(v.value.skipped, { matchNullKey: 1, matchNullCode: 1, matchDuplicate: 1, itemNullCode: 1, itemDuplicate: 1, header: 1 });
  assert.deepEqual(v.value.items, [{ code: "P0001", name: "이름", warehouse: "PPMI_3PL" }, { code: "P0004", name: null, warehouse: null }]);

  const inserted = { match: [], items: [] };
  const res = await runSeed({
    existingKeys: async () => ({ data: new Set(["대시보드에서 고친 열쇠"]), error: null }),
    existingCodes: async () => ({ data: new Set(["P0001"]), error: null }),
    insertMatch: async (rows) => { inserted.match.push(...rows); return { error: null }; },
    insertItems: async (rows) => { inserted.items.push(...rows); return { error: null }; },
    now: () => NOW,
  }, body);
  assert.equal(res.status, 200);
  assert.deepEqual(inserted.match.map((r) => r.key_norm), ["abc 옵션0", "새 열쇠"]);
  assert.deepEqual(inserted.items.map((r) => r.code), ["P0004"]);
  assert.deepEqual(res.body.match, { received: 3, inserted: 2, kept: 1 });
  assert.equal(validateSeed({ match: "x" }, NOW).ok, false);
  assert.deepEqual(onlyNew([{ k: "a" }, { k: "b" }], new Set(["a"]), (r) => r.k), [{ k: "b" }]);
});

test("추천: 앞 대괄호 머리표만 다른 기존 매칭의 코드", () => {
  assert.equal(baseKey("[임시]밸런스랩 큐 음식물0"), "밸런스랩 큐 음식물0");
  assert.equal(baseKey("[유통기한 27.01.13] [특가] 파미나 N&D0"), "파미나 n&d0");
  const matches = [
    { key: "밸런스랩 큐 음식물0", code: "YSIET0010" },
    { key: "[이벤트]밸런스랩 큐 음식물0", code: "YSIET0010" },
    { key: "[임시]밸런스랩 큐 음식물0", code: "OWN" }, // 자기 자신은 뺀다
    { key: "전혀 다른 상품", code: "X" },
  ];
  assert.deepEqual(suggestCodes("[임시]밸런스랩 큐 음식물0", matches), ["YSIET0010"]);
  assert.deepEqual(suggestCodes("없는 상품", matches), []);
});

test("정렬: 대시보드 줄 먼저, 그다음 고친 시각 내림차순", () => {
  const out = sortMatches([
    { key: "b", source: SOURCE_SEED, updatedAt: "2026-11-26T01:00:00Z" },
    { key: "a", source: SOURCE_DASHBOARD, updatedAt: "2026-11-25T01:00:00Z" },
    { key: "c", source: SOURCE_DASHBOARD, updatedAt: "2026-11-26T01:00:00Z" },
  ]);
  assert.deepEqual(out.map((r) => r.key), ["c", "a", "b"]);
});

// ── 판매입력 matchKeys ──────────────────────────────────

function entryPayload(o = {}) {
  const rows = o.rows ?? [naRow(), naRow({ name: "둘째" })];
  return {
    date: "2026-11-25",
    sheetHeaders: [...SHEET_HEADERS],
    sheetRows: rows,
    summary: { total: 2000, revenue: 2000, shipping: 0, groups: [] },
    unmatched: [], gaps: {}, problems: [],
    ...(o.matchKeys !== undefined ? { matchKeys: o.matchKeys } : {}),
  };
}

test("matchKeys: 길이가 다르면 400 거절, 문자열·null 만, 없으면 match_key 칸을 안 쓴다", () => {
  const bad = validateSalesEntry(entryPayload({ matchKeys: ["하나만"] }), "2026-11-26");
  assert.equal(bad.ok, false);
  assert.match(bad.error, /matchKeys 길이\(1\).*줄 수\(2\)/);
  assert.equal(validateSalesEntry(entryPayload({ matchKeys: [1, null] }), "2026-11-26").ok, false);
  assert.equal(validateSalesEntry(entryPayload({ matchKeys: "x" }), "2026-11-26").ok, false);
  const good = validateSalesEntry(entryPayload({ matchKeys: ["ABC 옵션0", null] }), "2026-11-26");
  assert.equal(good.ok, true);
  assert.deepEqual(good.value.lines.map((l) => l.match_key), ["ABC 옵션0", null]);
  const old = validateSalesEntry(entryPayload(), "2026-11-26");
  assert.equal(old.ok, true);
  assert.equal("match_key" in old.value.lines[0], false, "옛 실행기 전송은 match_key 칸을 안 보낸다");
});

test("match_key 칸이 없는 DB(SQL 전)면 칸을 빼고 다시 넣어 저장은 성공", async () => {
  const v = validateSalesEntry(entryPayload({ matchKeys: ["ABC 옵션0", "둘째0"] }), "2026-11-26");
  const inserts = [];
  let failedOnce = false;
  const db = {
    deleteByDate: async () => ({ error: null }),
    insert: async (table, rows) => {
      if (table === LINES_TABLE && rows.some((r) => "match_key" in r)) {
        failedOnce = true;
        return { error: { code: "PGRST204", message: "Could not find the 'match_key' column" } };
      }
      inserts.push([table, rows.length, rows.some((r) => "match_key" in r)]);
      return { error: null };
    },
  };
  const res = await runSalesEntryIngest(db, v.value);
  assert.equal(failedOnce, true);
  assert.equal(res.status, 200);
  assert.equal(res.body.matchKeySkipped, true);
  assert.deepEqual(inserts, [[LINES_TABLE, 2, false], [RUNS_TABLE, 1, false]]);
  // 코드가 달라도 문구에 match_key 가 있으면 같은 대체 경로
  let n = 0;
  const db2 = {
    deleteByDate: async () => ({ error: null }),
    insert: async (table, rows) => (table === LINES_TABLE && rows.some((r) => "match_key" in r) && ++n
      ? { error: { code: "XX000", message: "column \"match_key\" of relation \"sales_entry_lines\" does not exist" } }
      : { error: null }),
  };
  const res2 = await runSalesEntryIngest(db2, v.value);
  assert.equal(res2.status, 200);
  assert.equal(n, 1);
});

test("줄 고치기가 중간에 멈춰도 매칭은 저장됐다고 200 + ok:false 로 알린다", async () => {
  const s = saveDeps({ cands: [line("2026-11-25", 1, "ABC 옵션0")] });
  s.deps.patchDb.updateLine = async () => ({ error: { message: "연결 끊김" } });
  const res = await saveMatch(s.deps, { key: "ABC 옵션0", code: "P0001" });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.saved, true);
  assert.match(res.body.error, /보관 줄 고치기가 멈췄습니다/);
  assert.equal(s.upserts.length, 1);
});

// ── 출하창고 고르기 · 상품 목록 바로가기 · 원본 다시 만들기 (2026-11-26) ──

test("상품 목록 URL 상수: 통계 시트 ID + 「상품 목록」 gid", () => {
  assert.equal(STATS_SHEET_ID, "1FzxDCyR9FyAIduf7Q0lfUIOzvSqVlod21eOFqaPrXio");
  assert.equal(PRODUCT_LIST_GID, 1856953194);
  assert.equal(PRODUCT_LIST_URL, "https://docs.google.com/spreadsheets/d/1FzxDCyR9FyAIduf7Q0lfUIOzvSqVlod21eOFqaPrXio/edit#gid=1856953194");
});

test("창고 고르기 목록: 실제로 쓰인 값만, 많이 쓰인 순, 빈 값·머리글 「출하창고」 빼기", () => {
  const items = [
    { warehouse: "YS_내부창고" }, { warehouse: "PPMI_3PL" }, { warehouse: "PPMI_3PL" }, { warehouse: "출하창고" },
    { warehouse: null }, { warehouse: "  " }, { warehouse: "PPMI_내부창고" }, { warehouse: "PPMI_3PL" }, { warehouse: "YS_내부창고" },
  ];
  assert.deepEqual(warehouseOptions(items), ["PPMI_3PL", "YS_내부창고", "PPMI_내부창고"]);
  assert.equal(isBlankWarehouse("출하창고"), true);
  assert.equal(isBlankWarehouse(null), true);
  assert.equal(isBlankWarehouse("PPMI_3PL"), false);
  const v = validateMatchInput({ key: "a", code: "P", warehouse: "" });
  assert.equal(v.value.warehouse, null, "빈 창고는 안 고른 것");
  assert.equal(validateMatchInput({ key: "a", code: "P", warehouse: 3 }).ok, false);
  assert.equal(validateItemInput({ code: "P" }).ok, false);
});

test("코드 넣기 + 창고: 표에 없는 코드는 출하창고 표에 넣고(이름 = 상품 목록 E열) 고친 줄에 그 창고", async () => {
  const s = saveDeps({
    cands: [line("2026-11-25", 1, "X0")],
    runs: [{ date: "2026-11-25", unmatched: [{ 판매몰: "PPMI_스마트스토어", 매칭열쇠: "X0", 줄수: 1 }], unmatched_count: 1 }],
  });
  const r = await saveMatch(s.deps, { key: "X0", code: "P0002", warehouse: "YS_내부창고" });
  assert.equal(r.status, 200);
  assert.deepEqual(s.itemUpserts, [{ code: "P0002", name: "너티 사료", warehouse: "YS_내부창고" }]);
  assert.deepEqual(r.body.warehouse, { code: "P0002", warehouse: "YS_내부창고" });
  assert.equal(s.lineUpdates.length, 1);
  assert.equal(s.lineUpdates[0].warehouse, "YS_내부창고");
  assert.equal(s.lineUpdates[0].row_values[idx("출하창고")], "YS_내부창고");
  assert.equal(s.lineUpdates[0].row_values[last("출하창고")], "YS_내부창고");
  assert.equal(r.body.warnings.some((w) => /출하창고/.test(w)), false, "창고를 고르면 「출하창고 없음」 경고가 안 뜬다");
});

test("창고가 빈 코드(머리글 찌꺼기 포함)는 채우고, 같은 창고는 쓰지 않는다", async () => {
  const s = saveDeps({ items: [{ code: "P0002", name: "옛 이름", warehouse: "" }, { code: "Q", name: "q", warehouse: "PPMI_3PL" }] });
  const r = await saveMatch(s.deps, { key: "X0", code: "P0002", warehouse: "PPMI_3PL" });
  assert.equal(r.status, 200);
  assert.deepEqual(s.itemUpserts, [{ code: "P0002", name: "너티 사료", warehouse: "PPMI_3PL" }]);
  const same = saveDeps();
  const r2 = await saveMatch(same.deps, { key: "Y0", code: "P0001", warehouse: "PPMI_3PL" });
  assert.equal(r2.status, 200);
  assert.equal(same.itemUpserts.length, 0);
  assert.equal(r2.body.warehouse, null);
});

test("이미 창고가 있는 코드에 다른 창고를 보내면 409, 아무것도 안 쓴다", async () => {
  const s = saveDeps({ cands: [line("2026-11-25", 1, "X0")] });
  const r = await saveMatch(s.deps, { key: "X0", code: "P0001", warehouse: "YS_내부창고" });
  assert.equal(r.status, 409);
  assert.equal(r.body.warehouseConflict, true);
  assert.equal(r.body.current, "PPMI_3PL");
  assert.match(r.body.error, /매칭표 보기/);
  assert.equal(s.upserts.length, 0, "매칭도 저장하지 않는다(반쪽 저장 방지)");
  assert.equal(s.itemUpserts.length, 0);
  assert.equal(s.calls.length, 0);
});

test("고르기 목록 밖 창고는 400(직접 입력 안 받음), 아무것도 안 쓴다", async () => {
  const s = saveDeps();
  const r = await saveMatch(s.deps, { key: "X0", code: "P0002", warehouse: "출하창고" });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /고를 수 없는 출하창고/);
  assert.equal(s.upserts.length + s.itemUpserts.length, 0);
});

test("창고를 안 고르고 창고 없는 코드면 「출하창고 없음」 경고는 그대로", async () => {
  const s = saveDeps({ cands: [line("2026-11-25", 1, "X0")] });
  const r = await saveMatch(s.deps, { key: "X0", code: "P0002" });
  assert.match(r.body.warnings.join(" "), /출하창고 표에 P0002 가 없어/);
  assert.equal(s.lineUpdates[0].warehouse, null);
});

test("품목코드별 출하창고 바꾸기: 있는 코드는 창고만, 목록 밖 400, 없는 코드는 상품 목록에 있을 때만", async () => {
  const s = saveDeps();
  const r = await saveItemWarehouse(s.deps, { code: "P0001", warehouse: "YS_내부창고" });
  assert.equal(r.status, 200);
  assert.equal(r.body.previous, "PPMI_3PL");
  assert.deepEqual(s.itemUpserts, [{ code: "P0001", name: "큐모발 검사", warehouse: "YS_내부창고" }]);
  assert.match(r.body.note, /보관된 판매입력 줄의 출하창고는 그대로/);
  const same = await saveItemWarehouse(s.deps, { code: "P0001", warehouse: "YS_내부창고" });
  assert.equal(same.body.unchanged, true);
  assert.equal(s.itemUpserts.length, 1);
  assert.equal((await saveItemWarehouse(s.deps, { code: "P0001", warehouse: "새창고" })).status, 400);
  const added = await saveItemWarehouse(s.deps, { code: "P0002", warehouse: "PPMI_3PL" });
  assert.equal(added.status, 200);
  assert.deepEqual(s.itemUpserts[1], { code: "P0002", name: "너티 사료", warehouse: "PPMI_3PL" });
  const missing = await saveItemWarehouse(s.deps, { code: "Z9999", warehouse: "PPMI_3PL" });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.notInProductList, true);
});

test("원본 다시 만들기: 줄이 실제로 바뀐 날만 표시를 요청, 원본 있는 날만 켜진다", async () => {
  const s = saveDeps({
    cands: [line("2026-11-24", 1, "ABC 옵션0"), line("2026-11-25", 1, "ABC 옵션0"), line("2026-11-25", 2, "다른0")],
    runs: [],
    originals: ["2026-11-25"],
  });
  const r = await saveMatch(s.deps, { key: "ABC 옵션0", code: "P0001" });
  assert.equal(r.status, 200);
  assert.deepEqual(s.staleCalls, [["2026-11-24", "2026-11-25"]]);
  assert.deepEqual(r.body.originalStale, ["2026-11-25"]);
  // 고칠 줄이 없으면 표시 요청도 없다
  const none = saveDeps({ originals: ["2026-11-25"] });
  const r2 = await saveMatch(none.deps, { key: "없는0", code: "P0001" });
  assert.deepEqual(none.staleCalls, []);
  assert.deepEqual(r2.body.originalStale, []);
});

test("원본 다시 만들기: 칸이 없는 DB(SQL 전)면 저장은 그대로, 경고로 알린다. 줄 고치기가 멈춰도 고친 날은 표시", async () => {
  const s = saveDeps({ cands: [line("2026-11-25", 1, "ABC 옵션0")], staleMissing: true });
  const r = await saveMatch(s.deps, { key: "ABC 옵션0", code: "P0001" });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.deepEqual(r.body.originalStale, []);
  assert.match(r.body.warnings.join(" "), /2026-11-26-sales-entry-stale\.sql/);
  // 두 줄 중 두 번째에서 멈춤 → 첫 줄 날짜는 표시
  const p = saveDeps({ cands: [line("2026-11-24", 1, "ABC 옵션0"), line("2026-11-25", 1, "ABC 옵션0")], originals: ["2026-11-24", "2026-11-25"] });
  let n = 0;
  p.deps.patchDb.updateLine = async () => (++n === 2 ? { error: { message: "연결 끊김" } } : { error: null });
  const r3 = await saveMatch(p.deps, { key: "ABC 옵션0", code: "P0001" });
  assert.equal(r3.body.ok, false);
  assert.deepEqual(r3.body.originalStale, ["2026-11-24"]);
});
