// 자동 판매입력 보관의 규칙 (2026-11-26). DB 를 모르는 순수 모듈이라 node 시험(scripts/tests/sales-entry.test.mjs)이
// 그대로 부른다. `@/` 별칭을 import 하지 않는다. 실제 DB 연결은 src/lib/sales-entry.ts 가 넘긴다.
//
// 받는 모양(볼트 settings/collectors/bin/sales_entry_push.py build_payload):
//   { date, basis, generatedAt, sheetHeaders(42칸), sheetRows(42칸 값 배열들),
//     summary{total, revenue, shipping, groups[]}, unmatched[], gaps{}, problems[],
//     matchKeys?(sheetRows 와 같은 길이, 줄마다 매칭열쇠 = 상품명+옵션, 2026-11-26 추가) }
//   matchKeys 는 대시보드 매칭표(src/lib/sales-match-core.ts)에서 코드를 넣을 때 보관된 #N/A 줄을 찾는 열쇠다.
//   없으면(옛 실행기) match_key 칸을 안 쓴다. 칸이 아직 없는 DB(SQL 전)면 칸을 빼고 다시 넣는다.
// 표: docs/sql/2026-11-26-sales-entry.sql (sales_entry_runs · sales_entry_lines)
//
// ★ 고객 개인정보는 저장하지 않는다. 이 DB 는 anon 키로 읽고 쓰고 그 키가 공개 리포에 있다.
//   보내는 쪽이 비워 보내지만, 받는 쪽에서도 수령인·수령인번호·수령인주소·적요 칸을 비운다.
//   적요: 보내는 쪽(sales_entry.py _sheet_row)이 수령인 이름을 넣는다(2026-11-26 확인). 그래서 같이 비운다.
// ★ 매출 원장(product_sales·daily_sales)·통계 시트에는 쓰지 않는다. 보관·조회·다운로드만.
import * as XLSX from "xlsx";

export const RUNS_TABLE = "sales_entry_runs";
export const LINES_TABLE = "sales_entry_lines";

/** 판매정리 2행 머리글 A~AP (볼트 sales_entry.py SHEET_HEADERS 와 같아야 받는다) */
export const SHEET_HEADERS: readonly string[] = [
  "순서", "판매몰", "주문상태", "주문번호", "품목별주문번호", "결제일", "발송일", "수령인", "수령인번호", "수령인주소",
  "상품코드", "상품명", "옵션", "상품가", "수량", "총상품금액", "쿠폰합계", "적립금합계", "실결제금액", "상품총액합계",
  "상품별할인분배", "상품별순매출", "출하창고", "일자", "순번", "거래처코드", "거래처명", "담당자", "출하창고", "거래유형",
  "통화", "환율", "품목코드", "품목명", "규격", "수량", "단가", "외화금액", "공급가액", "부가세",
  "적요", "생산전표생성",
];
export const SHEET_COLS = SHEET_HEADERS.length; // 42

/** 받을 때 비우는 칸(개인정보). 적요 = 보내는 쪽이 수령인 이름을 넣는 칸 */
export const PII_HEADERS: readonly string[] = ["수령인", "수령인번호", "수령인주소", "적요"];

/** 한 요청 최대 줄. 하루 판매정리는 지금 수십 줄이다 */
export const MAX_LINES = 5000;
/** 이보다 이른 날짜는 잘못 보낸 것으로 본다 */
export const MIN_DATE = "2025-01-01";
const CELL_TEXT_MAX = 2000;
/** 매칭열쇠 최대 길이(상품명+옵션) */
const MATCH_KEY_MAX = 2000;
/** summary·unmatched·gaps·problems·basis 를 합친 JSON 최대 길이 */
const META_JSON_MAX = 1_000_000;
const CHUNK = 500;
export const NA = "#N/A";

/** 같은 이름이 둘이면 뒤 칸(이카운트 판매입력 쪽). /api/upload-sales colMap 과 같은 규칙 */
const col = (name: string) => SHEET_HEADERS.lastIndexOf(name);
export const COL = {
  seq: col("순서"),
  mall: col("판매몰"),
  orderNo: col("주문번호"),
  itemOrderNo: col("품목별주문번호"),
  paidAt: col("결제일"),
  shippedAt: col("발송일"),
  productName: col("상품명"),
  date: col("일자"),
  warehouse: col("출하창고"),
  itemCode: col("품목코드"),
  itemName: col("품목명"),
  qty: col("수량"),
  supply: col("공급가액"),
  vat: col("부가세"),
} as const;
const PII_COLS = SHEET_HEADERS.map((h, i) => (PII_HEADERS.includes(h) ? i : -1)).filter((i) => i >= 0);

export type Cell = string | number | boolean | null;

export interface SalesEntryRun {
  date: string;
  basis: unknown;
  summary: SalesEntrySummary;
  unmatched: unknown[];
  gaps: Record<string, unknown>;
  problems: unknown[];
  sheet_headers: string[];
  line_count: number;
  total: number;
  revenue: number | null;
  shipping: number;
  unmatched_count: number;
  gap_count: number;
  problem_count: number;
  generated_at: string | null;
  updated_at?: string;
}

export interface SalesEntryLine {
  date: string;
  seq: number;
  mall: string | null;
  order_no: string | null;
  item_order_no: string | null;
  paid_at: string | null;
  item_code: string | null;
  item_name: string | null;
  qty: number | null;
  supply: number | null;
  vat: number | null;
  amount: number | null;
  warehouse: string | null;
  unmatched: boolean;
  row_values: Cell[];
  /** 매칭열쇠(상품명+옵션). 보내는 쪽이 matchKeys 를 줄 때만 있다 */
  match_key?: string | null;
}

export interface SummaryGroup {
  mall: string;
  qty: number;
  sum: number;
  lines: { name: string; qty: number; sum: number }[];
}
export interface SalesEntrySummary {
  total: number;
  revenue: number | null;
  shipping: number;
  groups: SummaryGroup[];
}

export interface Validated {
  run: SalesEntryRun;
  lines: SalesEntryLine[];
  /** 칸 이름 → 받을 때 비운 줄 수(개인정보 방어) */
  sanitized: Record<string, number>;
}
export type ValidateResult = { ok: true; value: Validated } | { ok: false; error: string; details?: string[] };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function isRealDate(s: unknown): s is string {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** YYYY-MM-DD → YYMMDD (파일명. /api/upload-sales 가 파일명 6자리를 날짜로 읽는다) */
export function salesEntryFileName(date: string): string {
  return `판매입력_${date.slice(2, 4)}${date.slice(5, 7)}${date.slice(8, 10)}.xlsx`;
}

const cellNum = (v: Cell): number | null => (isNum(v) ? v : null);
const cellText = (v: Cell): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

/**
 * 시각 문자열 → KST "YYYY-MM-DD HH:MM:SS". 저장은 +09:00 으로 하지만 DB(timestamptz)는 UTC(+00:00)로 돌려주므로
 * 문자열을 자르지 않고 시각으로 읽어 바꾼다. 못 읽으면 원문 그대로.
 */
export function kstStamp(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = Date.parse(v);
  if (Number.isNaN(t)) return v;
  return new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
}

/** 보내는 쪽 generatedAt("2026-11-26T16:19:25", KST·오프셋 없음) → 오프셋 붙은 ISO. 못 읽으면 null */
export function normalizeGeneratedAt(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) return `${s}+09:00`;
  if (/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$/.test(s) && !Number.isNaN(Date.parse(s))) return s;
  return null;
}

function validateCell(v: unknown): v is Cell {
  if (v === null) return true;
  if (typeof v === "string") return v.length <= CELL_TEXT_MAX;
  if (typeof v === "number") return Number.isFinite(v);
  return typeof v === "boolean";
}

function countGaps(gaps: Record<string, unknown>): number {
  let n = 0;
  for (const g of Object.values(gaps)) {
    if (!isObj(g)) continue;
    for (const k of ["빠짐", "클레임"]) {
      const arr = g[k];
      if (Array.isArray(arr)) n += arr.length;
    }
  }
  return n;
}

function validateSummary(v: unknown): SalesEntrySummary | string {
  if (!isObj(v)) return "summary 가 객체가 아닙니다";
  if (!isNum(v.total)) return "summary.total 이 숫자가 아닙니다";
  if (v.shipping !== undefined && v.shipping !== null && (!isNum(v.shipping) || v.shipping < 0)) return "summary.shipping 이 0 이상 숫자가 아닙니다";
  if (v.revenue !== undefined && v.revenue !== null && !isNum(v.revenue)) return "summary.revenue 가 숫자가 아닙니다";
  const groups = v.groups ?? [];
  if (!Array.isArray(groups)) return "summary.groups 가 배열이 아닙니다";
  const out: SummaryGroup[] = [];
  for (const [i, g] of groups.entries()) {
    if (!isObj(g) || typeof g.mall !== "string" || !isNum(g.qty) || !isNum(g.sum)) return `summary.groups[${i}] 모양이 다릅니다(mall·qty·sum)`;
    const lines = g.lines ?? [];
    if (!Array.isArray(lines)) return `summary.groups[${i}].lines 가 배열이 아닙니다`;
    const ls: SummaryGroup["lines"] = [];
    for (const [j, l] of lines.entries()) {
      if (!isObj(l) || typeof l.name !== "string" || !isNum(l.qty) || !isNum(l.sum)) return `summary.groups[${i}].lines[${j}] 모양이 다릅니다(name·qty·sum)`;
      ls.push({ name: l.name, qty: l.qty, sum: l.sum });
    }
    out.push({ mall: g.mall, qty: g.qty, sum: g.sum, lines: ls });
  }
  return { total: v.total, revenue: isNum(v.revenue) ? v.revenue : null, shipping: isNum(v.shipping) ? v.shipping : 0, groups: out };
}

/** 한 줄(42칸) → 개인정보 칸을 비운 새 배열 + 비운 칸 이름들. 원본 배열은 바꾸지 않는다 */
export function stripPii(row: readonly Cell[]): { row: Cell[]; cleared: string[] } {
  const cleared: string[] = [];
  const out = row.map((v, i) => {
    if (!PII_COLS.includes(i)) return v;
    if (v === null || (typeof v === "string" && v.trim() === "")) return null;
    cleared.push(SHEET_HEADERS[i]);
    return null;
  });
  return { row: out, cleared };
}

export function toLine(date: string, seq: number, row: Cell[], matchKey?: string | null): SalesEntryLine {
  const supply = cellNum(row[COL.supply]);
  const vat = cellNum(row[COL.vat]);
  const code = cellText(row[COL.itemCode]);
  const line: SalesEntryLine = {
    date,
    seq,
    mall: cellText(row[COL.mall]),
    order_no: cellText(row[COL.orderNo]),
    item_order_no: cellText(row[COL.itemOrderNo]),
    paid_at: cellText(row[COL.paidAt]),
    item_code: code,
    // 보내는 쪽은 품목명 칸을 비워 보낸다(이카운트가 품목코드로 채움). 비면 상품명으로 대신한다.
    item_name: cellText(row[COL.itemName]) ?? cellText(row[COL.productName]),
    qty: cellNum(row[COL.qty]),
    supply,
    vat,
    amount: supply !== null && vat !== null ? supply + vat : null,
    warehouse: cellText(row[COL.warehouse]),
    unmatched: !code || code === NA,
    row_values: row,
  };
  return matchKey === undefined ? line : { ...line, match_key: matchKey };
}

/** matchKeys 검사: 없으면 undefined(옛 실행기), 있으면 줄 수와 같은 길이의 문자열·null 배열 */
function validateMatchKeys(v: unknown, rowCount: number): { ok: true; value: (string | null)[] | undefined } | { ok: false; error: string } {
  if (v === undefined || v === null) return { ok: true, value: undefined };
  if (!Array.isArray(v)) return { ok: false, error: "matchKeys 가 배열이 아닙니다" };
  if (v.length !== rowCount) return { ok: false, error: `matchKeys 길이(${v.length})가 sheetRows 줄 수(${rowCount})와 다릅니다` };
  const bad = v.findIndex((k) => !(k === null || (typeof k === "string" && k.length <= MATCH_KEY_MAX)));
  if (bad >= 0) return { ok: false, error: `matchKeys[${bad}] 는 문자열(${MATCH_KEY_MAX}자 이하) 또는 null 이어야 합니다` };
  return { ok: true, value: v.map((k) => (k === "" ? null : (k as string | null))) };
}

/** 받은 JSON 을 검사해 저장할 행으로 바꾼다. 하나라도 걸리면 아무것도 안 쓴다 */
export function validateSalesEntry(body: unknown, today: string): ValidateResult {
  if (!isObj(body)) return { ok: false, error: "JSON 객체가 아닙니다" };
  const date = body.date;
  if (!isRealDate(date)) return { ok: false, error: `date 형식이 다릅니다(YYYY-MM-DD): ${String(date)}` };
  if (date < MIN_DATE || date > today) return { ok: false, error: `date 범위 밖: ${date} (${MIN_DATE} ~ ${today})` };

  const headers = body.sheetHeaders;
  if (!Array.isArray(headers) || headers.length !== SHEET_COLS) {
    return { ok: false, error: `sheetHeaders 가 ${SHEET_COLS}칸이 아닙니다(${Array.isArray(headers) ? headers.length : typeof headers})` };
  }
  const diff = headers.flatMap((h, i) => (h === SHEET_HEADERS[i] ? [] : [`${i + 1}번 칸: 받은 「${String(h)}」 ≠ 「${SHEET_HEADERS[i]}」`]));
  if (diff.length) return { ok: false, error: "sheetHeaders 가 판매정리 머리글과 다릅니다", details: diff.slice(0, 10) };

  const rows = body.sheetRows;
  if (!Array.isArray(rows)) return { ok: false, error: "sheetRows 가 배열이 아닙니다" };
  if (rows.length > MAX_LINES) return { ok: false, error: `줄이 너무 많습니다: ${rows.length} (최대 ${MAX_LINES})` };
  const mk = validateMatchKeys(body.matchKeys, rows.length);
  if (!mk.ok) return { ok: false, error: mk.error };
  const matchKeys = mk.value;

  const errors: string[] = [];
  const sanitized: Record<string, number> = {};
  const lines: SalesEntryLine[] = [];
  rows.forEach((r, i) => {
    const n = i + 1;
    if (!Array.isArray(r) || r.length !== SHEET_COLS) { errors.push(`${n}번째 줄: ${SHEET_COLS}칸 배열이 아닙니다`); return; }
    const bad = r.findIndex((v) => !validateCell(v));
    if (bad >= 0) { errors.push(`${n}번째 줄 ${bad + 1}번 칸(${SHEET_HEADERS[bad]}): 문자열(${CELL_TEXT_MAX}자 이하)·숫자·null 만 받습니다`); return; }
    const dayCell = r[COL.date];
    if (typeof dayCell !== "string" || dayCell.slice(0, 10) !== date) {
      errors.push(`${n}번째 줄 「일자」가 ${date} 가 아닙니다: ${String(dayCell)}`);
      return;
    }
    const { row, cleared } = stripPii(r as Cell[]);
    for (const h of cleared) sanitized[h] = (sanitized[h] ?? 0) + 1;
    lines.push(toLine(date, n, row, matchKeys ? matchKeys[i] : undefined));
  });
  if (errors.length) return { ok: false, error: `잘못된 줄 ${errors.length}개`, details: errors.slice(0, 20) };

  const summary = validateSummary(body.summary);
  if (typeof summary === "string") return { ok: false, error: summary };
  const unmatched = body.unmatched ?? [];
  if (!Array.isArray(unmatched)) return { ok: false, error: "unmatched 가 배열이 아닙니다" };
  const gaps = body.gaps ?? {};
  if (!isObj(gaps)) return { ok: false, error: "gaps 가 객체가 아닙니다" };
  const problems = body.problems ?? [];
  if (!Array.isArray(problems)) return { ok: false, error: "problems 가 배열이 아닙니다" };
  const basis = body.basis ?? null;
  if (basis !== null && !isObj(basis)) return { ok: false, error: "basis 가 객체가 아닙니다" };
  const metaLen = JSON.stringify({ summary, unmatched, gaps, problems, basis }).length;
  if (metaLen > META_JSON_MAX) return { ok: false, error: `요약·누락 정보가 너무 큽니다(${metaLen}자)` };

  const run: SalesEntryRun = {
    date,
    basis,
    summary,
    unmatched,
    gaps,
    problems,
    sheet_headers: [...SHEET_HEADERS],
    line_count: lines.length,
    total: summary.total,
    revenue: summary.revenue,
    shipping: summary.shipping,
    unmatched_count: lines.filter((l) => l.unmatched).length,
    gap_count: countGaps(gaps),
    problem_count: problems.length,
    generated_at: normalizeGeneratedAt(body.generatedAt),
  };
  return { ok: true, value: { run, lines, sanitized } };
}

// ── 저장 ──────────────────────────────────────────────

export interface DbError { code?: string; message: string }
export interface SalesEntryDb {
  deleteByDate(table: string, date: string): Promise<{ error: DbError | null }>;
  insert(table: string, rows: object[]): Promise<{ error: DbError | null }>;
}
export interface IngestResult { status: number; body: Record<string, unknown> }

/** 표가 아직 없을 때(SQL 실행 전) PostgREST·Postgres 가 주는 코드 */
export function isMissingTable(error: { code?: string } | null | undefined): boolean {
  return !!error && (error.code === "PGRST205" || error.code === "42P01");
}
/**
 * 칸이 아직 없을 때(match_key, docs/sql/2026-11-26-sales-match.sql 실행 전). 실제 PostgREST 가 주는 코드를 운영에서 확인하지 못해
 * 오류 문구에 match_key 가 든 경우도 같이 본다(빼고 다시 넣어도 해가 없다. 매일 저장을 지키는 마지막 방어선이라 넓게 잡는다).
 */
export function isMissingColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "PGRST204" || error.code === "42703" || /match_key/.test(error.message ?? "");
}

const withoutMatchKey = (l: SalesEntryLine): SalesEntryLine => {
  const { match_key: _drop, ...rest } = l;
  void _drop;
  return rest;
};
export const SETUP_MESSAGE = "표 없음, SQL 실행 필요: docs/sql/2026-11-26-sales-entry.sql 를 Supabase SQL 편집기에서 실행하세요";

/**
 * 날짜 단위 통째 교체. 순서: 실행 행 삭제 → 줄 삭제 → 줄 삽입 → 실행 행 삽입(맨 마지막 = 완료 표식).
 * 삭제가 하나라도 실패하면 아무것도 넣지 않는다(옛 줄이 남은 채 새 줄이 붙어 두 벌이 되는 사고 방지).
 * 줄 삽입이 중간에 실패하면 실행 행이 없으니 그날은 「저장 불완전」으로 보이고, 같은 날을 다시 보내면 통째로 다시 쓴다.
 */
export async function runSalesEntryIngest(db: SalesEntryDb, v: Validated): Promise<IngestResult> {
  const { run, sanitized } = v;
  let lines = v.lines;
  let matchKeySkipped = false;
  const fail = (step: string, error: DbError): IngestResult => {
    if (isMissingTable(error)) return { status: 503, body: { ok: false, setupNeeded: true, error: SETUP_MESSAGE } };
    return { status: 500, body: { ok: false, step, error: `${step} 실패: ${error.message}` } };
  };
  for (const table of [RUNS_TABLE, LINES_TABLE]) {
    const { error } = await db.deleteByDate(table, run.date);
    if (error) return fail(`${table} 삭제`, error);
  }
  for (let i = 0; i < lines.length; i += CHUNK) {
    let { error } = await db.insert(LINES_TABLE, lines.slice(i, i + CHUNK));
    // match_key 칸이 아직 없는 DB(매칭표 SQL 전): 칸을 빼고 이 덩어리부터 다시 넣는다. 판매입력 보관은 깨지지 않는다
    if (error && isMissingColumn(error) && !matchKeySkipped && lines.some((l) => "match_key" in l)) {
      matchKeySkipped = true;
      lines = lines.map(withoutMatchKey);
      ({ error } = await db.insert(LINES_TABLE, lines.slice(i, i + CHUNK)));
    }
    if (error) {
      const r = fail(`${LINES_TABLE} 저장`, error);
      return { ...r, body: { ...r.body, note: `${run.date} 는 지금 비어 있습니다. 같은 날을 다시 보내면 통째로 다시 저장합니다` } };
    }
  }
  const { error } = await db.insert(RUNS_TABLE, [{ ...run, updated_at: new Date().toISOString() }]);
  if (error) {
    const r = fail(`${RUNS_TABLE} 저장`, error);
    return { ...r, body: { ...r.body, note: `${run.date} 줄은 들어갔지만 완료 표식이 없어 「저장 불완전」으로 보입니다. 같은 날을 다시 보내세요` } };
  }
  return {
    status: 200,
    body: {
      ok: true,
      date: run.date,
      lines: run.line_count,
      total: run.total,
      shipping: run.shipping,
      unmatched: run.unmatched_count,
      gaps: run.gap_count,
      problems: run.problem_count,
      sanitized,
      ...(matchKeySkipped ? { matchKeySkipped: true, warning: "match_key 칸이 없어 매칭열쇠 없이 저장했습니다(docs/sql/2026-11-26-sales-match.sql 실행 필요)" } : {}),
    },
  };
}

/** 실행 행과 실제 줄 수가 맞아야 「저장 완료」 */
export function completeness(run: Pick<SalesEntryRun, "line_count"> | null, lineCount: number): "complete" | "missing" | "incomplete" {
  if (!run) return lineCount > 0 ? "incomplete" : "missing";
  return run.line_count === lineCount ? "complete" : "incomplete";
}

// ── 엑셀 ──────────────────────────────────────────────

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;
const DATE_FMT = "yyyy-mm-dd";
const DATETIME_FMT = "yyyy-mm-dd hh:mm:ss";
const MONEY_FMT = "#,##0";

/**
 * "YYYY-MM-DD" 또는 "YYYY-MM-DD HH:MM:SS" → 엑셀 날짜 일련번호. 서버 시간대와 무관하게 산술로 구한다
 * (Date 객체를 넘기면 SheetJS 가 실행 환경 시간대로 바꿔 하루 밀릴 수 있다).
 */
export function excelSerial(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s.trim());
  if (!m) return null;
  const [, y, mo, d, h = "0", mi = "0", se = "0"] = m;
  if (!isRealDate(`${y}-${mo}-${d}`)) return null;
  const days = (Date.UTC(Number(y), Number(mo) - 1, Number(d)) - EXCEL_EPOCH) / DAY_MS;
  return days + (Number(h) * 3600 + Number(mi) * 60 + Number(se)) / 86400;
}

function cellOf(v: Cell, fmt?: string): XLSX.CellObject | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return fmt ? { t: "n", v, z: fmt } : { t: "n", v };
  if (typeof v === "boolean") return { t: "b", v };
  return { t: "s", v };
}

function dateCell(v: Cell, fmt: string): XLSX.CellObject | null {
  if (typeof v === "string") {
    const serial = excelSerial(v);
    if (serial !== null) return { t: "n", v: serial, z: fmt };
  }
  return cellOf(v);
}

function sheetFrom(rows: (XLSX.CellObject | null)[][], cols?: number[]): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  let maxC = 0;
  rows.forEach((row, r) => row.forEach((c, ci) => {
    if (!c) return;
    ws[XLSX.utils.encode_cell({ r, c: ci })] = c;
    if (ci > maxC) maxC = ci;
  }));
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length - 1, 0), c: maxC } });
  if (cols) ws["!cols"] = cols.map((wch) => ({ wch }));
  return ws;
}

const DATE_COLS = new Map<number, string>([[COL.date, DATE_FMT], [COL.paidAt, DATETIME_FMT], [COL.shippedAt, DATETIME_FMT]]);

/** 「판매정리」 탭: 1행 X1(24번째 칸)에 일자, 2행 머리글, 3행부터 값. 사람 파일과 같은 배치 */
export function salesSheet(date: string, headers: readonly string[], lines: readonly Pick<SalesEntryLine, "seq" | "row_values">[]): XLSX.WorkSheet {
  const first: (XLSX.CellObject | null)[] = Array(SHEET_COLS).fill(null);
  first[COL.date] = dateCell(date, DATE_FMT);
  const head = headers.map((h) => cellOf(h));
  const body = [...lines].sort((a, b) => a.seq - b.seq).map((l) =>
    l.row_values.map((v, i) => (DATE_COLS.has(i) ? dateCell(v, DATE_COLS.get(i)!) : cellOf(v))),
  );
  return sheetFrom([first, head, ...body]);
}

const s = (v: string): XLSX.CellObject => ({ t: "s", v });
const money = (v: number | null | undefined): XLSX.CellObject | null => (isNum(v) ? { t: "n", v, z: MONEY_FMT } : null);

function basisText(basis: unknown): string {
  if (!isObj(basis)) return "스마트스토어 발주확인일, 그 외 결제일";
  return Object.entries(basis).map(([k, v]) => `${k} ${String(v)}`).join(", ");
}

/** 「요약」 탭: 거래처별 품목·수량·합계, 배송비, 총매출(슬랙 보고 표와 같은 내용), 기준 */
export function summarySheet(run: Pick<SalesEntryRun, "date" | "summary" | "basis" | "line_count" | "generated_at">): XLSX.WorkSheet {
  const rows: (XLSX.CellObject | null)[][] = [
    [s("판매입력 요약"), s(run.date)],
    [s("기준"), s(basisText(run.basis))],
    [s("판매정리 줄 수"), { t: "n", v: run.line_count }],
    [s("만든 시각(KST)"), run.generated_at ? s(kstStamp(run.generated_at) ?? "") : null],
    [],
    [s("거래처"), s("품목"), s("수량"), s("합계")],
  ];
  for (const g of run.summary.groups) {
    for (const l of g.lines) rows.push([s(g.mall), s(l.name), { t: "n", v: l.qty }, money(l.sum)]);
    rows.push([s(`${g.mall} 소계`), null, { t: "n", v: g.qty }, money(g.sum)]);
  }
  rows.push([]);
  rows.push([s("배송비"), null, null, money(run.summary.shipping)]);
  if (run.summary.revenue !== null) rows.push([s("상품 매출(공급가액+부가세)"), null, null, money(run.summary.revenue)]);
  rows.push([s("총매출(배송비 포함)"), null, null, money(run.summary.total)]);
  return sheetFrom(rows, [28, 48, 8, 14]);
}

const text = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v));

/** 「미매칭·누락」 탭: 품목코드 못 찾은 상품, 스마트스토어 누락 검사(빠짐·클레임·취소반품), 문제 */
export function issuesSheet(run: Pick<SalesEntryRun, "unmatched" | "gaps" | "problems">): XLSX.WorkSheet {
  const rows: (XLSX.CellObject | null)[][] = [[s("미매칭(품목코드 못 찾음)")], [s("판매몰"), s("매칭열쇠(상품명+옵션)"), s("줄 수")]];
  if (!run.unmatched.length) rows.push([s("없음")]);
  for (const u of run.unmatched) {
    if (isObj(u)) rows.push([s(text(u["판매몰"] ?? "")), s(text(u["매칭열쇠"] ?? "")), isNum(u["줄수"]) ? { t: "n", v: u["줄수"] } : null]);
    else rows.push([s(text(u))]);
  }
  rows.push([], [s("누락 검사(발주확인 목록 ↔ 판매정리)")], [s("스토어"), s("구분"), s("내용")]);
  let gapRows = 0;
  for (const [store, g] of Object.entries(run.gaps)) {
    if (!isObj(g)) { rows.push([s(store), s("검사 못 함")]); gapRows++; continue; }
    rows.push([s(store), s("건수"), s(`발주확인 ${text(g["통합검색"] ?? "?")} · 판매정리 ${text(g["판매정리"] ?? "?")}`)]);
    gapRows++;
    for (const k of ["빠짐", "클레임", "취소반품"]) {
      const arr = g[k];
      if (Array.isArray(arr)) for (const item of arr) { rows.push([s(store), s(k), s(text(item))]); gapRows++; }
    }
  }
  if (!gapRows) rows.push([s("없음")]);
  rows.push([], [s("문제")]);
  if (!run.problems.length) rows.push([s("없음")]);
  for (const p of run.problems) rows.push([s(text(p))]);
  return sheetFrom(rows, [24, 60, 60]);
}

/** 판매입력 엑셀 한 벌. 「판매정리」가 첫 탭(/api/upload-sales 가 이 이름을 찾는다) */
export function buildSalesEntryWorkbook(run: SalesEntryRun, lines: readonly SalesEntryLine[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const headers = Array.isArray(run.sheet_headers) && run.sheet_headers.length === SHEET_COLS ? run.sheet_headers : SHEET_HEADERS;
  XLSX.utils.book_append_sheet(wb, salesSheet(run.date, headers, lines), "판매정리");
  XLSX.utils.book_append_sheet(wb, summarySheet(run), "요약");
  XLSX.utils.book_append_sheet(wb, issuesSheet(run), "미매칭·누락");
  return wb;
}

export function workbookBytes(wb: XLSX.WorkBook): ArrayBuffer {
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
