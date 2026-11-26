// npm test  (= node --test scripts/tests/*.test.mjs)
// 자동 판매입력 보관(src/lib/sales-entry-core.ts)을 가짜 DB·합성 줄로 시험한다. 실제 주문 파일은 쓰지 않는다(실명·주문번호).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import {
  SHEET_HEADERS, SHEET_COLS, COL, PII_HEADERS, MAX_LINES, RUNS_TABLE, LINES_TABLE, NA,
  validateSalesEntry, runSalesEntryIngest, completeness, buildSalesEntryWorkbook, workbookBytes,
  salesEntryFileName, excelSerial, normalizeGeneratedAt, isMissingTable,
} from "../../src/lib/sales-entry-core.ts";

const TODAY = "2026-11-26";
const DATE = "2026-11-25";
const idx = (name) => SHEET_HEADERS.indexOf(name);

/** 42칸 한 줄. 같은 이름 두 칸(수량·출하창고)은 앞뒤를 일부러 다른 값으로 둬 뒤 칸을 읽는지 본다 */
function row(seq, o = {}) {
  const r = Array(SHEET_COLS).fill(null);
  const supply = o.supply ?? 10000;
  r[idx("순서")] = seq;
  r[idx("판매몰")] = o.mall ?? "PPMI_스마트스토어";
  r[idx("주문번호")] = o.orderNo ?? `20261125000${seq}`;
  r[idx("품목별주문번호")] = `20261125900${seq}`;
  r[idx("결제일")] = "2026-11-25 09:47:28";
  r[idx("발송일")] = "2026-11-25 17:33:09";
  r[idx("수령인")] = o.recipient ?? null;
  r[idx("수령인번호")] = o.phone ?? null;
  r[idx("수령인주소")] = o.address ?? null;
  r[idx("상품코드")] = o.code ?? "P000000S";
  r[idx("상품명")] = o.name ?? "합성 상품";
  r[idx("수량")] = 99; // 앞 칸(주문 쪽). 읽으면 안 된다
  r[idx("출하창고")] = "앞칸창고";
  r[idx("일자")] = o.day ?? DATE;
  r[idx("거래처명")] = o.mall ?? "PPMI_스마트스토어";
  r[idx("담당자")] = "담당";
  r[SHEET_HEADERS.lastIndexOf("출하창고")] = o.code === NA ? NA : "PPMI_3PL";
  r[idx("거래유형")] = 11;
  r[idx("품목코드")] = o.code ?? "P000000S";
  r[SHEET_HEADERS.lastIndexOf("수량")] = o.qty ?? 2;
  r[idx("단가")] = supply * 1.1 / (o.qty ?? 2);
  r[idx("공급가액")] = o.code === NA && o.naMoney ? NA : supply;
  r[idx("부가세")] = o.code === NA && o.naMoney ? NA : supply * 0.1;
  r[idx("적요")] = o.memo ?? null;
  r[idx("생산전표생성")] = "Y";
  return r;
}

function payload(o = {}) {
  const rows = o.rows ?? [
    row(1, { recipient: "홍길동", phone: "010-0000-0000", address: "서울시 어딘가", memo: "홍길동" }),
    row(2, { supply: 20000, qty: 1 }),
    row(3, { code: NA, mall: "YS_스마트스토어", supply: 5000, qty: 1 }),
  ];
  return {
    date: DATE,
    basis: { 스마트스토어: "발주확인일", "그 외": "결제일" },
    generatedAt: "2026-11-26T16:19:25",
    sheetHeaders: [...SHEET_HEADERS],
    sheetRows: rows,
    summary: {
      total: 41500, revenue: 38500, shipping: 3000,
      groups: [
        { mall: "PPMI_스마트스토어", qty: 3, sum: 33000, lines: [{ name: "합성 상품", qty: 3, sum: 33000 }] },
        { mall: "YS_스마트스토어", qty: 1, sum: 5500, lines: [{ name: "합성 상품 (미매칭)", qty: 1, sum: 5500 }] },
      ],
    },
    unmatched: [{ 판매몰: "YS_스마트스토어", 매칭열쇠: "합성 상품옵션", 줄수: 1 }],
    gaps: { PPMI_스마트스토어: { 빠짐: ["1 합성 (발송대기)"], 클레임: [], 취소반품: ["2 합성 (취소)"], 남음: [], 통합검색: 3, 판매정리: 2 }, YS_스마트스토어: null },
    problems: ["카페24 원본 없음"],
    ...o.patch,
  };
}

function fakeDb({ failDelete = null, failInsertAt = -1 } = {}) {
  const calls = [];
  let inserts = 0;
  return {
    calls,
    db: {
      deleteByDate: async (table, date) => {
        calls.push(["delete", table, date]);
        return { error: failDelete === table ? { message: "boom" } : null };
      },
      insert: async (table, rows) => {
        const i = inserts++;
        calls.push(["insert", table, rows.length]);
        return { error: i === failInsertAt ? { message: "boom" } : null };
      },
    },
  };
}

test("머리글 42칸, 같은 이름 두 칸은 뒤 칸", () => {
  assert.equal(SHEET_COLS, 42);
  assert.equal(COL.date, 23);
  assert.equal(COL.qty, 35);
  assert.equal(COL.warehouse, 28);
  assert.equal(COL.itemCode, 32);
  assert.deepEqual([...PII_HEADERS].sort(), ["수령인", "수령인번호", "수령인주소", "적요"].sort());
});

test("개인정보 칸(수령인·연락처·주소·적요)은 비우고 저장한다", () => {
  const p = payload();
  const before = JSON.stringify(p.sheetRows);
  const r = validateSalesEntry(p, TODAY);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.sanitized, { 수령인: 1, 수령인번호: 1, 수령인주소: 1, 적요: 1 });
  const all = JSON.stringify(r.value.lines);
  for (const pii of ["홍길동", "010-0000-0000", "서울시 어딘가"]) assert.ok(!all.includes(pii), `${pii} 가 남음`);
  for (const l of r.value.lines) for (const h of PII_HEADERS) assert.equal(l.row_values[idx(h)], null);
  assert.equal(JSON.stringify(p.sheetRows), before, "받은 배열을 고치면 안 된다");
});

test("줄 값: 뒤 칸 수량, 매출 = 공급가액 + 부가세, 미매칭 표시, 품목명 없으면 상품명", () => {
  const { lines, run } = validateSalesEntry(payload(), TODAY).value;
  assert.equal(lines.length, 3);
  assert.deepEqual(lines.map((l) => l.seq), [1, 2, 3]);
  assert.equal(lines[0].qty, 2);
  assert.equal(lines[0].warehouse, "PPMI_3PL");
  assert.equal(lines[0].amount, 11000);
  assert.equal(lines[1].amount, 22000);
  assert.equal(lines[0].item_name, "합성 상품");
  assert.equal(lines[0].order_no, "202611250001");
  assert.equal(lines[2].unmatched, true);
  assert.equal(lines[0].unmatched, false);
  assert.equal(run.line_count, 3);
  assert.equal(run.unmatched_count, 1);
  assert.equal(run.gap_count, 1);
  assert.equal(run.problem_count, 1);
  assert.equal(run.total, 41500);
  assert.equal(run.shipping, 3000);
  assert.equal(run.generated_at, "2026-11-26T16:19:25+09:00");
});

test("#N/A 금액 줄은 매출 null", () => {
  const p = payload({ rows: [row(1, { code: NA, naMoney: true })] });
  const { lines } = validateSalesEntry(p, TODAY).value;
  assert.equal(lines[0].supply, null);
  assert.equal(lines[0].amount, null);
});

test("검증: 날짜 형식·범위, 머리글, 칸 수, 일자 불일치, 줄 수 상한", () => {
  const bad = (patch) => validateSalesEntry(payload({ patch }), TODAY);
  assert.equal(bad({ date: "2026-11-31" }).ok, false);
  assert.equal(bad({ date: "20261125" }).ok, false);
  assert.equal(bad({ date: "2026-11-27" }).ok, false, "미래 날짜");
  assert.equal(bad({ date: "2024-12-31" }).ok, false, "너무 이른 날짜");
  const h = [...SHEET_HEADERS]; h[23] = "날짜";
  const rh = bad({ sheetHeaders: h });
  assert.equal(rh.ok, false);
  assert.match(rh.details[0], /24번 칸/);
  assert.equal(bad({ sheetHeaders: SHEET_HEADERS.slice(0, 41) }).ok, false);
  assert.equal(validateSalesEntry(payload({ rows: [row(1).slice(0, 41)] }), TODAY).ok, false);
  assert.equal(validateSalesEntry(payload({ rows: [row(1, { day: "2026-11-24" })] }), TODAY).ok, false);
  const objCell = row(1); objCell[5] = { x: 1 };
  assert.equal(validateSalesEntry(payload({ rows: [objCell] }), TODAY).ok, false);
  const many = Array.from({ length: MAX_LINES + 1 }, (_, i) => row(i + 1));
  assert.equal(validateSalesEntry(payload({ rows: many }), TODAY).ok, false);
  assert.equal(bad({ summary: { total: "1" } }).ok, false);
  assert.equal(bad({ gaps: [] }).ok, false);
  assert.equal(validateSalesEntry(null, TODAY).ok, false);
  assert.equal(validateSalesEntry(payload({ rows: [] }), TODAY).ok, true, "판매 없는 날도 받는다");
});

test("저장 순서: 실행 행 삭제 → 줄 삭제 → 줄 삽입 → 실행 행 삽입(마지막)", async () => {
  const { db, calls } = fakeDb();
  const res = await runSalesEntryIngest(db, validateSalesEntry(payload(), TODAY).value);
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(calls, [
    ["delete", RUNS_TABLE, DATE], ["delete", LINES_TABLE, DATE], ["insert", LINES_TABLE, 3], ["insert", RUNS_TABLE, 1],
  ]);
  assert.deepEqual(res.body.sanitized, { 수령인: 1, 수령인번호: 1, 수령인주소: 1, 적요: 1 });
});

test("삭제 실패면 아무것도 넣지 않는다", async () => {
  for (const table of [RUNS_TABLE, LINES_TABLE]) {
    const { db, calls } = fakeDb({ failDelete: table });
    const res = await runSalesEntryIngest(db, validateSalesEntry(payload(), TODAY).value);
    assert.equal(res.status, 500);
    assert.equal(calls.filter((c) => c[0] === "insert").length, 0);
  }
});

test("줄 삽입 중간 실패면 완료 표식(실행 행)을 넣지 않는다", async () => {
  const rows = Array.from({ length: 1200 }, (_, i) => row(i + 1));
  const { db, calls } = fakeDb({ failInsertAt: 1 });
  const res = await runSalesEntryIngest(db, validateSalesEntry(payload({ rows }), TODAY).value);
  assert.equal(res.status, 500);
  assert.ok(!calls.some((c) => c[0] === "insert" && c[1] === RUNS_TABLE));
  assert.match(res.body.note, /다시 보내면/);
});

test("표 없음(SQL 실행 전)은 503 + setupNeeded", async () => {
  const db = { deleteByDate: async () => ({ error: { code: "PGRST205", message: "no table" } }), insert: async () => ({ error: null }) };
  const res = await runSalesEntryIngest(db, validateSalesEntry(payload(), TODAY).value);
  assert.equal(res.status, 503);
  assert.equal(res.body.setupNeeded, true);
  assert.ok(isMissingTable({ code: "42P01" }));
  assert.ok(!isMissingTable({ code: "23505" }));
});

test("완료 판정: 실행 행이 있고 줄 수가 같아야 complete", () => {
  assert.equal(completeness({ line_count: 3 }, 3), "complete");
  assert.equal(completeness({ line_count: 3 }, 2), "incomplete");
  assert.equal(completeness(null, 2), "incomplete");
  assert.equal(completeness(null, 0), "missing");
});

test("파일명·엑셀 일련번호·생성 시각", () => {
  assert.equal(salesEntryFileName("2026-11-25"), "판매입력_261125.xlsx");
  assert.equal(excelSerial("2026-11-25"), 46351);
  assert.equal(excelSerial("1900-03-01"), 61);
  assert.equal(excelSerial("2026-11-25 12:00:00"), 46351.5);
  assert.equal(excelSerial("2026-02-30"), null);
  assert.equal(normalizeGeneratedAt("2026-11-26T16:19:25Z"), "2026-11-26T16:19:25Z");
  assert.equal(normalizeGeneratedAt("어제"), null);
});

function workbookFor(p) {
  const v = validateSalesEntry(p, TODAY).value;
  return { v, wb: buildSalesEntryWorkbook({ ...v.run }, v.lines) };
}

test("엑셀 배치: 판매정리 첫 탭, X1 일자, 2행 머리글, 3행부터 값, 요약·미매칭 탭", () => {
  const { wb } = workbookFor(payload());
  assert.deepEqual(wb.SheetNames, ["판매정리", "요약", "미매칭·누락"]);
  const ws = wb.Sheets["판매정리"];
  assert.equal(ws.X1.t, "n");
  assert.equal(ws.X1.v, 46351);
  assert.equal(ws.X1.z, "yyyy-mm-dd");
  assert.equal(ws.A2.v, "순서");
  assert.equal(ws.AP2.v, "생산전표생성");
  assert.equal(ws.X3.v, 46351);
  assert.equal(ws.A3.v, 1);
  assert.equal(ws.H3, undefined, "수령인 칸은 비어야 한다");
  assert.equal(ws.AO3, undefined, "적요 칸은 비어야 한다");
  assert.equal(ws["!ref"], "A1:AP5");
  const sum = XLSX.utils.sheet_to_json(wb.Sheets["요약"], { header: 1 });
  assert.ok(sum.some((r) => r[0] === "총매출(배송비 포함)" && r[3] === 41500));
  assert.ok(sum.some((r) => r[0] === "배송비" && r[3] === 3000));
  const iss = XLSX.utils.sheet_to_json(wb.Sheets["미매칭·누락"], { header: 1 });
  assert.ok(iss.some((r) => r[1] === "합성 상품옵션"));
  assert.ok(iss.some((r) => r[1] === "빠짐"));
  assert.ok(iss.some((r) => r[0] === "카페24 원본 없음"));
});

test("만든 엑셀을 /api/upload-sales 읽기 로직(TZ=UTC, Vercel 과 같은 조건)에 넣으면 전 줄이 통과", () => {
  const p = payload();
  const { v, wb } = workbookFor(p);
  const dir = mkdtempSync(join(tmpdir(), "sales-entry-"));
  try {
    const name = salesEntryFileName(DATE);
    const path = join(dir, name);
    writeFileSync(path, new Uint8Array(workbookBytes(wb)));
    const child = fileURLToPath(new URL("./lib/upload-sales-parse.mjs", import.meta.url));
    const out = spawnSync(process.execPath, [child, path, name], { env: { ...process.env, TZ: "UTC" }, encoding: "utf8" });
    assert.equal(out.status, 0, out.stderr);
    const r = JSON.parse(out.stdout);
    assert.equal(r.tzOffset, 0, "자식 프로세스가 UTC 로 뜨지 않았다(이 결과로는 판정 불가)");
    assert.equal(r.error, undefined);
    assert.equal(r.fileDate, DATE);
    assert.equal(r.headerRowIdx, 1);
    assert.deepEqual(r.cols, { dateCol: 23, clientCol: 26, productCodeCol: 32, qtyCol: 35, supplyCol: 38, taxCol: 39 });
    assert.equal(r.rows.length, v.lines.length);
    assert.equal(r.dateFiltered, 0);
    assert.equal(r.skipped, 0);
    assert.ok(r.rows.every((x) => x.date === DATE));
    assert.equal(r.rows.reduce((a, x) => a + x.qty, 0), v.lines.reduce((a, l) => a + l.qty, 0));
    const money = (rs, f) => Math.round(rs.reduce((a, x) => a + f(x), 0));
    assert.equal(money(r.rows, (x) => x.supply + x.tax), money(v.lines, (l) => l.amount ?? 0));
    assert.equal(money(r.rows, (x) => x.supply + x.tax), 38500);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
