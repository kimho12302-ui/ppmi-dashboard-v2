// npm test  (= node --test scripts/tests/*.test.mjs)
// 판매입력 원본 엑셀 암호화 보관(src/lib/sales-entry-file-core.ts)을 DB·네트워크 없이 시험한다.
// ★ 시트 내용·바이트를 출력하지 않는다(실파일에는 고객정보가 있다). 바이트 비교는 equals·해시로만 한다.
//   열쇠는 시험 안에서 무작위로 만든다(.env.local 을 읽지 않는다).
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import {
  FILE_MAGIC, IV_LEN, TAG_LEN, MAX_UPLOAD_BYTES, SOURCE_HEADER, BROKEN_MESSAGE, FILE_SETUP_MESSAGE,
  parseFileKey, encryptSalesFile, decryptSalesFile, validateSalesFile, fileStoragePath, downloadFileName,
  runSalesFileUpload, serveSalesEntryXlsx, bucketProbeOk, xlsxHeaders,
} from "../../src/lib/sales-entry-file-core.ts";

const DATE = "2026-11-25";
const TODAY = "2026-11-26";
const REAL_FILE = process.env.SALES_ENTRY_REAL_FILE ?? "C:\\Users\\harry\\Downloads\\판매입력\\2026-11-25\\판매입력_261125.xlsx";

const newKey = () => randomBytes(32);
const keyB64 = (k) => k.toString("base64");
const sha = (b) => createHash("sha256").update(b).digest("hex");
/** 바이트가 같은지(실패해도 내용을 찍지 않게 boolean 으로만 본다) */
const sameBytes = (a, b) => Buffer.from(a).equals(Buffer.from(b));

function xlsxWith(sheetNames) {
  const wb = XLSX.utils.book_new();
  for (const n of sheetNames) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["합성"], [1]]), n);
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}
const GOOD = xlsxWith(["판매정리", "제품코드매칭"]);

// ── 열쇠 ──

test("열쇠: base64 32바이트만 받고, 오류 문구에 값을 넣지 않는다", () => {
  const k = newKey();
  const ok = parseFileKey(keyB64(k));
  assert.equal(ok.ok, true);
  assert.ok(ok.key.equals(k));
  assert.deepEqual(parseFileKey(undefined), { ok: false, error: "SALES_FILE_KEY 없음" });
  assert.equal(parseFileKey("   ").ok, false);
  const short = keyB64(randomBytes(16));
  const r16 = parseFileKey(short);
  assert.equal(r16.ok, false);
  assert.ok(!r16.error.includes(short), "오류 문구에 열쇠 값이 들어가면 안 된다");
  assert.match(r16.error, /SALES_FILE_KEY 잘못됨/);
  assert.equal(parseFileKey(keyB64(randomBytes(33))).ok, false);
  assert.equal(parseFileKey("not base64 !!").ok, false);
});

test("암호화: 길이가 32바이트가 아닌 열쇠는 거절", () => {
  assert.throws(() => encryptSalesFile(GOOD, randomBytes(16), DATE));
  assert.equal(decryptSalesFile(encryptSalesFile(GOOD, newKey(), DATE), randomBytes(31), DATE).ok, false);
});

// ── 암호화 왕복 ──

test("암호화→복호화 왕복이 바이트 단위로 같고, 형식은 magic|iv|tag|암호문", () => {
  const k = newKey();
  const blob = encryptSalesFile(GOOD, k, DATE);
  assert.ok(blob.subarray(0, 4).equals(FILE_MAGIC));
  assert.equal(blob.length, 4 + IV_LEN + TAG_LEN + GOOD.length);
  assert.ok(!sameBytes(blob.subarray(4 + IV_LEN + TAG_LEN), GOOD), "암호문이 평문과 같으면 안 된다");
  const back = decryptSalesFile(blob, k, DATE);
  assert.equal(back.ok, true);
  assert.ok(sameBytes(back.bytes, GOOD));
  // iv 는 매번 새로
  assert.ok(!encryptSalesFile(GOOD, k, DATE).subarray(4, 4 + IV_LEN).equals(blob.subarray(4, 4 + IV_LEN)));
});

test("변조·다른 열쇠·다른 날짜·잘린 파일은 복호화 실패(평문을 내주지 않는다)", () => {
  const k = newKey();
  const blob = encryptSalesFile(GOOD, k, DATE);
  const flip = (i) => { const b = Buffer.from(blob); b[i] ^= 0x01; return b; };
  const tagAt = 4 + IV_LEN;
  for (const bad of [flip(tagAt), flip(blob.length - 1), flip(5), flip(0)]) {
    assert.deepEqual(decryptSalesFile(bad, k, DATE), { ok: false, error: BROKEN_MESSAGE });
  }
  assert.equal(decryptSalesFile(blob, newKey(), DATE).ok, false);
  assert.equal(decryptSalesFile(blob, k, "2026-11-24").ok, false, "다른 날 경로로 옮긴 암호문은 열리면 안 된다");
  assert.equal(decryptSalesFile(blob.subarray(0, 20), k, DATE).ok, false);
});

// ── 올리기 검사 ──

test("검사: zip 아닌 본문·빈 본문·너무 큰 본문 거절", () => {
  assert.equal(validateSalesFile(new Uint8Array(0)).ok, false);
  const notZip = validateSalesFile(new TextEncoder().encode("순서,판매몰\n1,스토어\n"));
  assert.equal(notZip.ok, false);
  assert.equal(notZip.status, 400);
  assert.match(notZip.error, /zip/);
  const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
  big.set([0x50, 0x4b, 0x03, 0x04]);
  assert.equal(validateSalesFile(big).status, 413);
  // zip 머리만 있고 xlsx 가 아닌 것
  const fakeZip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5]);
  assert.equal(validateSalesFile(fakeZip).ok, false);
});

test("검사: 「판매정리」 시트가 없는 xlsx 거절, 있으면 통과", () => {
  const r = validateSalesFile(xlsxWith(["요약", "판매정리X"]));
  assert.equal(r.ok, false);
  assert.match(r.error, /판매정리/);
  assert.equal(validateSalesFile(GOOD).ok, true);
});

test("경로·파일 이름", () => {
  assert.equal(fileStoragePath(DATE), "2026-11-25/sales_entry_261125.xlsx.enc");
  assert.equal(downloadFileName(DATE), "판매입력_261125.xlsx");
});

// ── 올리기 흐름 (가짜 Storage·DB) ──

function fakeUpload(o = {}) {
  const calls = { put: [], mark: [], clear: [] };
  const deps = {
    runExists: async () => o.run ?? { exists: true, error: null },
    put: async (path, blob) => { calls.put.push({ path, blob }); return o.put ?? { error: null }; },
    markRun: async (date, cols) => { calls.mark.push({ date, cols }); return o.mark ?? { updated: 1, error: null }; },
    clearStale: async (date) => { calls.clear.push(date); return o.clear ?? { error: null }; },
    now: () => "2026-11-26T09:00:00.000Z",
  };
  return { deps, calls };
}

test("올리기: 정상이면 암호문을 경로에 넣고 실행 행 칸을 갱신, 응답 {ok,date,size,path}", async () => {
  const k = newKey();
  const { deps, calls } = fakeUpload();
  const r = await runSalesFileUpload(deps, DATE, GOOD, keyB64(k), TODAY);
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.size, GOOD.length);
  assert.equal(r.body.path, fileStoragePath(DATE));
  assert.equal(calls.put.length, 1);
  const back = decryptSalesFile(calls.put[0].blob, k, DATE);
  assert.ok(back.ok && sameBytes(back.bytes, GOOD), "넣은 것은 암호문이고 같은 열쇠로 원본이 나와야 한다");
  assert.deepEqual(calls.mark[0].cols, { original_file_path: fileStoragePath(DATE), original_file_size: GOOD.length, original_uploaded_at: "2026-11-26T09:00:00.000Z" });
});

test("올리기: 열쇠 없음·잘못됨은 500, 아무것도 넣지 않는다", async () => {
  for (const raw of [undefined, keyB64(randomBytes(16))]) {
    const { deps, calls } = fakeUpload();
    const r = await runSalesFileUpload(deps, DATE, GOOD, raw, TODAY);
    assert.equal(r.status, 500);
    assert.match(r.body.error, /SALES_FILE_KEY (없음|잘못됨)/);
    assert.equal(calls.put.length, 0);
  }
});

test("올리기: 날짜 형식·범위, 실행 행 없음(409), 버킷 없음(503), 칸 없음(503), 0행 갱신(409)", async () => {
  const key = keyB64(newKey());
  assert.equal((await runSalesFileUpload(fakeUpload().deps, "2026-13-01", GOOD, key, TODAY)).status, 400);
  assert.equal((await runSalesFileUpload(fakeUpload().deps, "2026-11-27", GOOD, key, TODAY)).status, 400);
  const noRun = fakeUpload({ run: { exists: false, error: null } });
  assert.equal((await runSalesFileUpload(noRun.deps, DATE, GOOD, key, TODAY)).status, 409);
  assert.equal(noRun.calls.put.length, 0);
  const noBucket = await runSalesFileUpload(fakeUpload({ put: { error: { message: "Bucket not found", statusCode: "404" } } }).deps, DATE, GOOD, key, TODAY);
  assert.equal(noBucket.status, 503);
  assert.equal(noBucket.body.error, FILE_SETUP_MESSAGE);
  const noCol = await runSalesFileUpload(fakeUpload({ mark: { updated: 0, error: { code: "42703", message: "column original_file_path does not exist" } } }).deps, DATE, GOOD, key, TODAY);
  assert.equal(noCol.status, 503);
  const gone = await runSalesFileUpload(fakeUpload({ mark: { updated: 0, error: null } }).deps, DATE, GOOD, key, TODAY);
  assert.equal(gone.status, 409);
  assert.equal(gone.body.ok, false);
  const notZip = await runSalesFileUpload(fakeUpload().deps, DATE, new TextEncoder().encode("hello"), key, TODAY);
  assert.equal(notZip.status, 400);
});

// ── 내려받기 판정 ──

const genBytes = xlsxWith(["판매정리", "요약", "미매칭·누락"]);
function xlsxInput(o = {}) {
  return {
    run: "run" in o ? o.run : { line_count: 2, original_file_path: null },
    status: o.status ?? "complete",
    lineCount: o.lineCount ?? 2,
    buildGenerated: () => { if (o.noBuild) throw new Error("생성본을 만들면 안 된다"); return genBytes; },
    download: o.download ?? (async () => { throw new Error("원본이 없는데 Storage 를 읽으면 안 된다"); }),
    keyRaw: o.keyRaw,
  };
}

test("받기: 원본 없으면 생성본 + X-Sales-Entry-Source: generated", async () => {
  const r = await serveSalesEntryXlsx(DATE, xlsxInput());
  assert.equal(r.kind, "file");
  assert.equal(r.headers[SOURCE_HEADER], "generated");
  assert.ok(sameBytes(r.bytes, genBytes));
  assert.match(r.headers["Content-Disposition"], /filename\*=UTF-8''%ED%8C%90%EB%A7%A4%EC%9E%85%EB%A0%A5_261125\.xlsx/);
  // SQL 전(칸 자체가 없음)도 생성본
  const noCol = await serveSalesEntryXlsx(DATE, xlsxInput({ run: { line_count: 2 } }));
  assert.equal(noCol.headers[SOURCE_HEADER], "generated");
});

test("받기: 원본 없고 저장 불완전·없음이면 409·404 (지금 동작 유지)", async () => {
  assert.equal((await serveSalesEntryXlsx(DATE, xlsxInput({ status: "incomplete", lineCount: 1 }))).status, 409);
  assert.equal((await serveSalesEntryXlsx(DATE, xlsxInput({ run: null, status: "missing", lineCount: 0 }))).status, 404);
});

test("받기: 원본 있으면 복호화한 원본 그대로 + original (줄 저장이 덜 끝났어도)", async () => {
  const k = newKey();
  const path = fileStoragePath(DATE);
  const blob = encryptSalesFile(GOOD, k, DATE);
  const seen = [];
  const r = await serveSalesEntryXlsx(DATE, xlsxInput({
    run: { line_count: 2, original_file_path: path }, status: "incomplete", lineCount: 1, noBuild: true, keyRaw: keyB64(k),
    download: async (p) => { seen.push(p); return { data: new Uint8Array(blob), error: null }; },
  }));
  assert.equal(r.kind, "file");
  assert.equal(r.headers[SOURCE_HEADER], "original");
  assert.ok(sameBytes(r.bytes, GOOD));
  assert.deepEqual(seen, [path]);
});

test("받기: 원본이 있는데 못 열면 500, 생성본으로 바꾸지 않는다", async () => {
  const k = newKey();
  const path = fileStoragePath(DATE);
  const blob = Buffer.from(encryptSalesFile(GOOD, k, DATE));
  blob[4 + IV_LEN] ^= 0xff; // 태그 변조
  const base = { run: { line_count: 2, original_file_path: path }, noBuild: true };
  const tampered = await serveSalesEntryXlsx(DATE, xlsxInput({ ...base, keyRaw: keyB64(k), download: async () => ({ data: blob, error: null }) }));
  assert.deepEqual([tampered.kind, tampered.status, tampered.body.error], ["json", 500, BROKEN_MESSAGE]);
  const wrongKey = await serveSalesEntryXlsx(DATE, xlsxInput({ ...base, keyRaw: keyB64(newKey()), download: async () => ({ data: encryptSalesFile(GOOD, k, DATE), error: null }) }));
  assert.equal(wrongKey.status, 500);
  const noKey = await serveSalesEntryXlsx(DATE, xlsxInput({ ...base, keyRaw: undefined }));
  assert.equal(noKey.status, 500);
  assert.match(noKey.body.error, /SALES_FILE_KEY 없음/);
  const missing = await serveSalesEntryXlsx(DATE, xlsxInput({ ...base, keyRaw: keyB64(k), download: async () => ({ data: null, error: { message: "Object not found" } }) }));
  assert.equal(missing.status, 500);
});

test("헤더: 원본·생성본 모두 no-store, 출처 헤더", () => {
  for (const src of ["original", "generated"]) {
    const h = xlsxHeaders(DATE, src);
    assert.equal(h["Cache-Control"], "no-store");
    assert.equal(h[SOURCE_HEADER], src);
  }
});

test("점검: 「Object not found」만 버킷 있음으로 본다", () => {
  assert.equal(bucketProbeOk({ data: null, error: { message: "Object not found", statusCode: "404" } }), true);
  assert.equal(bucketProbeOk({ data: null, error: { message: "Bucket not found", statusCode: "404" } }), false);
  assert.equal(bucketProbeOk({ data: null, error: { message: "fetch failed" } }), false);
});

// ── 실제 파일 왕복 (경로가 있을 때만. 내용은 출력하지 않는다) ──

test("실파일: 판매입력_261125.xlsx 검사 통과 + 왕복 바이트 동일", { skip: !existsSync(REAL_FILE) && "실파일 없음(회사 PC 밖)" }, async () => {
  const real = new Uint8Array(readFileSync(REAL_FILE));
  assert.equal(validateSalesFile(real).ok, true, "실파일이 검사를 통과해야 한다");
  const k = newKey();
  const { deps, calls } = fakeUpload();
  const up = await runSalesFileUpload(deps, DATE, real, keyB64(k), TODAY);
  assert.equal(up.status, 200);
  const down = await serveSalesEntryXlsx(DATE, xlsxInput({
    run: { line_count: 1, original_file_path: up.body.path }, noBuild: true, keyRaw: keyB64(k),
    download: async () => ({ data: new Uint8Array(calls.put[0].blob), error: null }),
  }));
  assert.equal(down.kind, "file");
  assert.equal(down.headers[SOURCE_HEADER], "original");
  assert.equal(sha(down.bytes), sha(real), "복호화한 원본의 해시가 실파일과 같아야 한다");
  assert.equal(down.bytes.length, real.length);
});

// ── 원본 다시 만들기 표시 (2026-11-26, docs/sql/2026-11-26-sales-entry-stale.sql) ──

test("원본 올리기가 성공하면 「원본 다시 만들기」 표시를 끈다(원본 칸 갱신과 따로)", async () => {
  const { deps, calls } = fakeUpload();
  const r = await runSalesFileUpload(deps, DATE, GOOD, keyB64(newKey()), TODAY);
  assert.equal(r.status, 200);
  assert.deepEqual(calls.clear, [DATE]);
  assert.equal(Object.keys(calls.mark[0].cols).includes("original_stale"), false, "원본 칸 갱신에 표시 칸을 섞지 않는다(SQL 전 DB 에서 올리기가 깨진다)");
  assert.equal(r.body.warning, undefined);
});

test("표시 칸이 없는 DB(SQL 전)여도 원본 올리기는 200, 다른 실패는 경고만", async () => {
  const key = keyB64(newKey());
  for (const err of [
    { code: "PGRST204", message: "Could not find the 'original_stale' column of 'sales_entry_runs' in the schema cache" },
    { code: "42703", message: "column sales_entry_runs.original_stale does not exist" },
  ]) {
    const r = await runSalesFileUpload(fakeUpload({ clear: { error: err } }).deps, DATE, GOOD, key, TODAY);
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.warning, undefined);
  }
  const other = await runSalesFileUpload(fakeUpload({ clear: { error: { message: "연결 끊김" } } }).deps, DATE, GOOD, key, TODAY);
  assert.equal(other.status, 200);
  assert.match(other.body.warning, /원본 다시 만들기/);
  // 원본 칸 갱신이 실패하면 표시를 건드리지 않는다
  const bad = fakeUpload({ mark: { updated: 0, error: null } });
  await runSalesFileUpload(bad.deps, DATE, GOOD, key, TODAY);
  assert.deepEqual(bad.calls.clear, []);
});
