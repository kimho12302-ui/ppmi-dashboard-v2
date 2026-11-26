// 판매입력 원본 엑셀 암호화 보관 규칙 (2026-11-26). DB·Storage 를 모르는 순수 모듈이라 node 시험
// (scripts/tests/sales-entry-file.test.mjs)이 그대로 부른다. `@/` 별칭·다른 src 모듈을 import 하지 않는다(node 형 지우기 한계).
// Storage·DB 연결은 src/lib/sales-entry-file.ts, 버킷·칸은 docs/sql/2026-11-26-sales-entry-files.sql.
//
// 왜: 김호는 대시보드에서 받는 엑셀이 회사 PC 파이썬이 만든 판매입력_YYMMDD.xlsx 와 완전히 같기를 원한다
//   (탭 15개, 수령인 이름·연락처·주소 포함). 이 Supabase 는 anon 키로 접근하고 그 키가 공개 리포에 있다.
//   그래서 원본 파일은 서버에서 AES-256-GCM 으로 암호화해 비공개 버킷에 넣는다. 열쇠는 Vercel 환경변수
//   SALES_FILE_KEY(base64 32바이트)에만 있다. anon 키로 파일을 꺼내도 열 수 없다.
//
// 암호문 형식: magic "PSE1"(4) | iv(12) | tag(16) | ciphertext
//   GCM 추가 인증 데이터(AAD) = 날짜 문자열 "YYYY-MM-DD"(UTF-8). 다른 날 암호문으로 바꿔치기하면 복호화가 실패한다.
//   ★ 열쇠·내용·고객정보를 로그나 오류 문구에 넣지 않는다.
//
// 순서 계약(볼트 sales_entry_push.py): JSON(POST /api/sales-entry) 먼저 → 파일(POST /api/sales-entry/file) 나중.
//   JSON 을 다시 보내면 그날 실행 행이 통째로 바뀌어 원본 표시가 지워진다. 그러면 파일도 다시 보낸다
//   (옛 원본이 새 데이터와 어긋난 채 조용히 내려가지 않게 하려는 것).
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import * as XLSX from "xlsx";

export const FILE_BUCKET = "sales-entry-files";
export const FILE_SQL_PATH = "docs/sql/2026-11-26-sales-entry-files.sql";
export const FILE_SETUP_MESSAGE = `원본 보관 준비 안 됨, SQL 실행 필요: ${FILE_SQL_PATH} 를 Supabase SQL 편집기에서 실행하세요`;
export const SOURCE_HEADER = "X-Sales-Entry-Source";
export const FILE_MAGIC = Buffer.from("PSE1", "ascii");
export const IV_LEN = 12;
export const TAG_LEN = 16;
export const KEY_LEN = 32;
/** 코드 상한. 실제로는 Vercel 요청 본문 상한(약 4.5MB)이 먼저 걸린다(라우트에 닿기 전 413) */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const REQUIRED_SHEET = "판매정리";
export const BROKEN_MESSAGE = "원본 파일 손상 또는 열쇠 불일치";
const HEADER_LEN = FILE_MAGIC.length + IV_LEN + TAG_LEN;
const MIN_DATE = "2025-01-01";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** 실행 행의 원본 칸 (docs/sql/2026-11-26-sales-entry-files.sql 의 alter table) */
export const ORIGINAL_COLS = ["original_file_path", "original_file_size", "original_uploaded_at"] as const;
export interface OriginalCols {
  original_file_path?: string | null;
  original_file_size?: number | null;
  original_uploaded_at?: string | null;
}

export function isRealDate(s: unknown): s is string {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

const yymmdd = (date: string) => `${date.slice(2, 4)}${date.slice(5, 7)}${date.slice(8, 10)}`;
/** Storage 안 경로 */
export const fileStoragePath = (date: string) => `${date}/sales_entry_${yymmdd(date)}.xlsx.enc`;
/** 내려받을 파일 이름(사람 파일과 같은 이름) */
export const downloadFileName = (date: string) => `판매입력_${yymmdd(date)}.xlsx`;

// ── 열쇠 ──────────────────────────────────────────────

export type KeyResult = { ok: true; key: Buffer } | { ok: false; error: string };

/** SALES_FILE_KEY → 32바이트 열쇠. 오류 문구에 값은 넣지 않는다 */
export function parseFileKey(raw: string | undefined | null): KeyResult {
  const s = (raw ?? "").trim();
  if (!s) return { ok: false, error: "SALES_FILE_KEY 없음" };
  if (!BASE64_RE.test(s) || s.length % 4 !== 0) return { ok: false, error: "SALES_FILE_KEY 잘못됨(base64 가 아님)" };
  const key = Buffer.from(s, "base64");
  if (key.length !== KEY_LEN) return { ok: false, error: `SALES_FILE_KEY 잘못됨(${KEY_LEN}바이트가 아님)` };
  return { ok: true, key };
}

// ── 암호화·복호화 ─────────────────────────────────────

const aad = (date: string) => Buffer.from(date, "utf8");

/** 평문 → magic | iv | tag | ciphertext. iv 는 부를 때마다 새로 만든다 */
export function encryptSalesFile(plain: Uint8Array, key: Buffer, date: string): Buffer {
  if (key.length !== KEY_LEN) throw new Error(`열쇠 길이가 ${KEY_LEN}바이트가 아닙니다`);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_LEN });
  cipher.setAAD(aad(date));
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([FILE_MAGIC, iv, cipher.getAuthTag(), ct]);
}

export type DecryptResult = { ok: true; bytes: Buffer } | { ok: false; error: string };

/** 암호문 → 평문. 머리·태그가 하나라도 안 맞으면 실패(평문을 일부도 내주지 않는다) */
export function decryptSalesFile(blob: Uint8Array, key: Buffer, date: string): DecryptResult {
  const buf = Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength);
  if (key.length !== KEY_LEN || buf.length < HEADER_LEN || !buf.subarray(0, FILE_MAGIC.length).equals(FILE_MAGIC)) {
    return { ok: false, error: BROKEN_MESSAGE };
  }
  const iv = buf.subarray(FILE_MAGIC.length, FILE_MAGIC.length + IV_LEN);
  const tag = buf.subarray(FILE_MAGIC.length + IV_LEN, HEADER_LEN);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_LEN });
    decipher.setAAD(aad(date));
    decipher.setAuthTag(tag);
    return { ok: true, bytes: Buffer.concat([decipher.update(buf.subarray(HEADER_LEN)), decipher.final()]) };
  } catch {
    return { ok: false, error: BROKEN_MESSAGE };
  }
}

// ── 올리기 검사 ───────────────────────────────────────

export type Check = { ok: true } | { ok: false; status: number; error: string };

/** 크기·zip 머리·「판매정리」 시트(시트 이름만 읽는다, 내용은 열지 않는다) */
export function validateSalesFile(bytes: Uint8Array): Check {
  if (bytes.byteLength === 0) return { ok: false, status: 400, error: "본문이 비었습니다(xlsx 바이트를 보내세요)" };
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    return { ok: false, status: 413, error: `파일이 너무 큽니다: ${bytes.byteLength}바이트 (최대 ${MAX_UPLOAD_BYTES})` };
  }
  if (bytes.byteLength < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
    return { ok: false, status: 400, error: "xlsx(zip) 파일이 아닙니다" };
  }
  let names: string[];
  try {
    names = XLSX.read(bytes, { type: "array", bookSheets: true }).SheetNames ?? [];
  } catch {
    return { ok: false, status: 400, error: "xlsx 를 읽지 못했습니다" };
  }
  if (!names.includes(REQUIRED_SHEET)) return { ok: false, status: 400, error: `「${REQUIRED_SHEET}」 시트가 없습니다` };
  return { ok: true };
}

// ── 올리기 흐름 ───────────────────────────────────────

export interface FileDbError { code?: string; message: string }
export interface StoreError { message: string; statusCode?: string | number; status?: number }

export interface FileUploadDeps {
  /** 그날 실행 행이 있는지 */
  runExists(date: string): Promise<{ exists: boolean; error: FileDbError | null }>;
  /** 같은 경로 덮어쓰기 */
  put(path: string, blob: Buffer): Promise<{ error: StoreError | null }>;
  /** 실행 행의 원본 칸 갱신. 바뀐 행 수 */
  markRun(date: string, cols: Required<OriginalCols>): Promise<{ updated: number; error: FileDbError | null }>;
  /**
   * 「원본 다시 만들기」 표시 끄기(original_stale=false, docs/sql/2026-11-26-sales-entry-stale.sql).
   * 원본 칸 갱신과 따로 부른다: 이 칸이 아직 없는 DB(SQL 전)에서도 원본 올리기는 그대로 성공해야 한다.
   */
  clearStale(date: string): Promise<{ error: FileDbError | null }>;
  now(): string;
}
export interface FileResult { status: number; body: Record<string, unknown> }

const isMissingTable = (e: { code?: string } | null) => !!e && (e.code === "PGRST205" || e.code === "42P01");
const isMissingColumn = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "PGRST204" || e.code === "42703" || /original_file/.test(e.message ?? ""));
const isMissingStaleColumn = (e: { code?: string; message?: string } | null) => !!e && /original_stale/.test(e.message ?? "");
const isMissingBucket = (e: StoreError | null) => !!e && /bucket not found/i.test(e.message);

/** 검사 → 실행 행 확인 → 암호화 → Storage 덮어쓰기 → 실행 행 칸 갱신. 하나라도 실패하면 ok 가 아니다 */
export async function runSalesFileUpload(
  deps: FileUploadDeps, date: string, bytes: Uint8Array, keyRaw: string | undefined, today: string,
): Promise<FileResult> {
  const bad = (status: number, error: string, extra: Record<string, unknown> = {}): FileResult => ({ status, body: { ok: false, error, ...extra } });
  if (!isRealDate(date)) return bad(400, `date 형식이 다릅니다(YYYY-MM-DD): ${String(date)}`);
  if (date < MIN_DATE || date > today) return bad(400, `date 범위 밖: ${date} (${MIN_DATE} ~ ${today})`);
  const key = parseFileKey(keyRaw);
  if (!key.ok) return bad(500, key.error);
  const check = validateSalesFile(bytes);
  if (!check.ok) return bad(check.status, check.error);

  const run = await deps.runExists(date);
  if (run.error) {
    if (isMissingTable(run.error)) return bad(503, "판매입력 표 없음, SQL 실행 필요: docs/sql/2026-11-26-sales-entry.sql", { setupNeeded: true });
    return bad(500, `실행 행 확인 실패: ${run.error.message}`);
  }
  if (!run.exists) return bad(409, `${date} 판매입력(JSON)이 아직 없습니다. POST /api/sales-entry 를 먼저 보낸 뒤 파일을 보내세요`);

  const path = fileStoragePath(date);
  const put = await deps.put(path, encryptSalesFile(bytes, key.key, date));
  if (put.error) {
    if (isMissingBucket(put.error)) return bad(503, FILE_SETUP_MESSAGE, { setupNeeded: true });
    return bad(500, `원본 저장 실패: ${put.error.message}`);
  }

  const uploadedAt = deps.now();
  const mark = await deps.markRun(date, { original_file_path: path, original_file_size: bytes.byteLength, original_uploaded_at: uploadedAt });
  if (mark.error) {
    if (isMissingColumn(mark.error)) return bad(503, FILE_SETUP_MESSAGE, { setupNeeded: true, stored: true });
    return bad(500, `실행 행 갱신 실패: ${mark.error.message}`, { stored: true });
  }
  if (mark.updated === 0) {
    return bad(409, `${date} 실행 행이 그 사이 사라졌습니다(JSON 재전송 중). JSON 이 끝난 뒤 파일을 다시 보내세요`, { stored: true });
  }
  // 새 원본이 들어왔으니 「원본 다시 만들기」 표시를 끈다. 칸이 없으면(SQL 전) 조용히 넘어가고, 그 밖의 실패도 올리기는 성공으로 둔다
  const clear = await deps.clearStale(date);
  const staleWarning = clear.error && !isMissingColumn(clear.error) && !isMissingStaleColumn(clear.error)
    ? { warning: `원본은 저장했지만 「원본 다시 만들기」 표시를 못 껐습니다: ${clear.error.message}` }
    : {};
  return { status: 200, body: { ok: true, date, size: bytes.byteLength, path, uploadedAt, ...staleWarning } };
}

// ── 내려받기 흐름 ─────────────────────────────────────

export type XlsxSource = "original" | "generated";
export type XlsxResult =
  | { kind: "file"; bytes: Uint8Array; headers: Record<string, string> }
  | { kind: "json"; status: number; body: Record<string, unknown> };

export function xlsxHeaders(date: string, source: XlsxSource): Record<string, string> {
  const name = downloadFileName(date);
  const ascii = name.replace("판매입력", "sales_entry");
  return {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    "Cache-Control": "no-store",
    [SOURCE_HEADER]: source,
  };
}

export interface XlsxInput {
  run: (OriginalCols & { line_count: number }) | null;
  status: "complete" | "missing" | "incomplete";
  lineCount: number;
  /** 고객정보 없는 생성본(sales-entry-core buildSalesEntryWorkbook). 원본이 없을 때만 부른다 */
  buildGenerated(): Uint8Array | ArrayBuffer;
  download(path: string): Promise<{ data: Uint8Array | null; error: StoreError | null }>;
  keyRaw: string | undefined;
}

/**
 * 원본 칸이 있으면 복호화한 원본 그대로, 없으면 생성본. 원본이 있는데 못 열면 500(생성본으로 몰래 바꾸지 않는다).
 * 원본은 줄 저장 완료 여부와 상관없이 내준다(그 자체로 완결된 파일이다).
 */
export async function serveSalesEntryXlsx(date: string, input: XlsxInput): Promise<XlsxResult> {
  const json = (status: number, error: string): XlsxResult => ({ kind: "json", status, body: { error } });
  const { run } = input;
  const path = run?.original_file_path ?? null;
  if (path) {
    const key = parseFileKey(input.keyRaw);
    if (!key.ok) return json(500, key.error);
    const got = await input.download(path);
    if (got.error || !got.data) return json(500, `원본 파일을 꺼내지 못했습니다: ${got.error?.message ?? "빈 응답"}`);
    const plain = decryptSalesFile(got.data, key.key, date);
    if (!plain.ok) return json(500, plain.error);
    return { kind: "file", bytes: plain.bytes, headers: xlsxHeaders(date, "original") };
  }
  if (input.status === "missing" || !run) return json(404, `${date} 판매입력이 없습니다`);
  if (input.status === "incomplete") {
    return json(409, `${date} 저장이 덜 끝났습니다(줄 ${input.lineCount}개, 기대 ${run.line_count}개). 회사 PC 에서 그날을 다시 보내세요`);
  }
  const built = input.buildGenerated();
  const bytes = built instanceof Uint8Array ? built : new Uint8Array(built);
  return { kind: "file", bytes, headers: xlsxHeaders(date, "generated") };
}

// ── 점검 ──────────────────────────────────────────────

/**
 * 없는 경로를 받아 본 결과로 버킷이 있는지 판정. 「Object not found」가 와야 true(버킷은 있고 그 파일만 없음).
 * 「Bucket not found」·전송 오류·그 밖은 false. 정책(RLS) 유무는 이것으로 알 수 없다(SQL 끝 확인 select 로 본다).
 */
export function bucketProbeOk(res: { data: unknown; error: StoreError | null }): boolean {
  if (!res.error) return res.data !== null && res.data !== undefined;
  return /object not found/i.test(res.error.message);
}
export const HEALTH_PROBE_PATH = "__health__/probe-does-not-exist.enc";
