// 판매입력 매칭표 규칙 (2026-11-26). DB·시트를 모르는 순수 모듈이라 node 시험(scripts/tests/sales-match.test.mjs)과
// 화면(sales-match-editor.tsx)이 그대로 부른다. `@/` 별칭·다른 src 모듈을 import 하지 않는다(node 형 지우기 한계).
// DB 연결은 src/lib/sales-match.ts, 표는 docs/sql/2026-11-26-sales-match.sql.
//
// 두 단계 매칭
//   ① 판매입력: 매칭열쇠(상품명+옵션) → 품목코드. 이 표(sales_match). 엑셀 VLOOKUP 처럼 대소문자 무시·완전일치·먼저 나온 줄
//      (볼트 sales_entry.py build_lookup). 그래서 열쇠는 toLowerCase() 만 한다. 공백 정리·trim 은 하지 않는다(파이썬과 달라진다)
//   ② 대시보드 업로드: 품목코드 → 통계 시트 「상품 목록」(/api/upload-sales). 여기 없는 코드는 업로드가 막힌다.
//      그래서 ①에 넣는 코드는 「상품 목록」 A열에 있는 코드만 받는다(upload-sales 와 같은 읽기: A3:E1000, trim, 대소문자 구분, 먼저 나온 줄).

export const MATCH_TABLE = "sales_match";
/** 통계 시트(「상품 목록」 탭이 든 파일). 화면 단추와 서버 읽기가 같이 쓴다 */
export const STATS_SHEET_ID = "1FzxDCyR9FyAIduf7Q0lfUIOzvSqVlod21eOFqaPrXio";
/** 「상품 목록」 탭 gid (2026-11-26 김호 링크) */
export const PRODUCT_LIST_GID = 1856953194;
/** 「상품 목록 열기」 단추 주소. 새 상품이라 품목코드가 없을 때 바로 가서 맨 아래 줄에 등록한다 */
export const PRODUCT_LIST_URL = `https://docs.google.com/spreadsheets/d/${STATS_SHEET_ID}/edit#gid=${PRODUCT_LIST_GID}`;
export const ITEMS_TABLE = "sales_item_codes";
export const SOURCE_SEED = "엑셀옮김";
export const SOURCE_DASHBOARD = "대시보드";
export type MatchSource = typeof SOURCE_SEED | typeof SOURCE_DASHBOARD;
export const NA = "#N/A";

export const MATCH_SETUP_MESSAGE =
  "표 없음, SQL 실행 필요: docs/sql/2026-11-26-sales-match.sql 를 Supabase SQL 편집기에서 실행하세요";
export const NOT_SEEDED_MESSAGE =
  "매칭표 옮기기 전입니다. 회사 PC 에서 볼트 sales_match.json 을 먼저 옮겨야(seed) 코드를 넣을 수 있습니다. " +
  "한 줄만 든 표를 실행기가 받으면 나머지 상품이 전부 #N/A 가 됩니다";

const KEY_MAX = 2000;
const CODE_MAX = 100;
const NOTE_MAX = 500;
/** seed 한 번에 받는 최대 줄 */
export const SEED_MAX_ROWS = 20000;

export interface DbError { code?: string; message: string }

/** 표가 아직 없을 때(SQL 실행 전) */
export function isMissingTable(error: { code?: string } | null | undefined): boolean {
  return !!error && (error.code === "PGRST205" || error.code === "42P01");
}
/** 칸이 아직 없을 때(SQL 실행 전): PostgREST 스키마 캐시에 없음 / Postgres 칸 없음 */
export function isMissingColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "PGRST204" || error.code === "42703" || /match_key/.test(error.message ?? "");
}

/** 매칭열쇠 → 표 키. 엑셀 VLOOKUP 처럼 대소문자만 안 가린다 */
export const normKey = (key: string): string => key.toLowerCase();

export interface MatchRow {
  key_norm: string;
  match_key: string;
  code: string;
  source: MatchSource;
  note: string | null;
  updated_at?: string | null;
}
export interface ItemCodeRow { code: string; name: string | null; warehouse: string | null }

// ── 출하창고 ──────────────────────────────────────────

/** 엑셀 「제품코드별출하창고」 머리글 찌꺼기(seed 로 들어온 값). 고를 수 있는 창고가 아니다 */
const WAREHOUSE_HEADER_VALUE = "출하창고";

/** 창고가 빈 것으로 보는가(null·빈 글자·머리글 찌꺼기) */
export function isBlankWarehouse(v: string | null | undefined): boolean {
  return v === null || v === undefined || v.trim() === "" || v.trim() === WAREHOUSE_HEADER_VALUE;
}

/**
 * 고를 수 있는 출하창고 = sales_item_codes 에 실제로 쓰인 값, 많이 쓰인 순(같으면 글자 순).
 * 직접 입력은 받지 않는다(오타 창고가 이카운트로 가는 것을 막는다). 원본 배열은 안 바꾼다.
 */
export function warehouseOptions(items: readonly Pick<ItemCodeRow, "warehouse">[]): string[] {
  const count = new Map<string, number>();
  for (const it of items) {
    if (isBlankWarehouse(it.warehouse)) continue;
    const w = it.warehouse as string;
    count.set(w, (count.get(w) ?? 0) + 1);
  }
  return Array.from(count.entries())
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([w]) => w);
}

export const WAREHOUSE_CHANGE_HINT = "이미 창고가 있는 코드입니다. 창고 바꾸기는 「매칭표 보기」의 품목코드별 출하창고에서 하세요";

/** GET /api/sales-match 의 match 한 줄(볼트 실행기 fetch_match 가 key·code 를 읽는다) */
export interface MatchApiRow { key: string; code: string; source: MatchSource; note: string | null; updatedAt: string | null }

export function toApiMatch(r: MatchRow): MatchApiRow {
  return { key: r.match_key, code: r.code, source: r.source, note: r.note ?? null, updatedAt: r.updated_at ?? null };
}

/** 대시보드에서 넣은 줄 먼저, 그다음 고친 시각 내림차순, 같으면 열쇠 순. 원본 배열은 안 바꾼다 */
export function sortMatches<T extends { source: string; updatedAt: string | null; key: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const da = a.source === SOURCE_DASHBOARD ? 0 : 1;
    const db = b.source === SOURCE_DASHBOARD ? 0 : 1;
    if (da !== db) return da - db;
    const ta = a.updatedAt ? Date.parse(a.updatedAt) : 0;
    const tb = b.updatedAt ? Date.parse(b.updatedAt) : 0;
    if (ta !== tb) return tb - ta;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

// ── 「상품 목록」 ───────────────────────────────────────

/** 「상품 목록」 3행 머리글 A칸 글자(2026-11-26 시트 확인). 고를 수 있는 코드가 아니다 */
const PRODUCT_LIST_HEADER = "품목코드";

export interface ProductListItem { code: string; category: string; brand: string; lineup: string; name: string; sheetRow: number }

/** 시트 값(A3:E 부터) → 품목코드 목록. upload-sales 와 같게: trim, 빈 코드 건너뜀, 같은 코드면 먼저 나온 줄 */
export function parseProductList(rows: readonly (readonly unknown[])[], firstRow = 3): ProductListItem[] {
  const seen = new Set<string>();
  const out: ProductListItem[] = [];
  rows.forEach((row, i) => {
    const code = String(row?.[0] ?? "").trim();
    if (!code || code === PRODUCT_LIST_HEADER || seen.has(code)) return; // 3행 머리글(「품목코드」)은 건너뛴다
    seen.add(code);
    const cell = (j: number) => String(row?.[j] ?? "").trim();
    out.push({ code, category: cell(1), brand: cell(2), lineup: cell(3), name: cell(4), sheetRow: firstRow + i });
  });
  return out;
}

// ── 입력 검사 ─────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export interface MatchInput { key: string; keyNorm: string; code: string; note: string | null; warehouse?: string | null }
export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * POST /api/sales-match 몸통 {key, code, note?, warehouse?}. 열쇠는 원문 그대로(공백 포함), 코드는 앞뒤 공백만 뗀다.
 * warehouse 는 고르기 목록 값 그대로(목록에 있는지는 saveMatch 가 DB 로 본다). 빈 글자·null 은 「안 고름」
 */
export function validateMatchInput(body: unknown): Checked<MatchInput> {
  if (!isObj(body)) return { ok: false, error: "JSON 객체가 아닙니다" };
  const { key, code, note, warehouse } = body;
  if (warehouse !== undefined && warehouse !== null && typeof warehouse !== "string") return { ok: false, error: "warehouse 는 문자열이어야 합니다" };
  if (typeof key !== "string" || key.trim() === "") return { ok: false, error: "key(매칭열쇠 = 상품명+옵션)가 비었습니다" };
  if (key.length > KEY_MAX) return { ok: false, error: `key 가 너무 깁니다(${key.length}자, 최대 ${KEY_MAX})` };
  if (typeof code !== "string" || code.trim() === "") return { ok: false, error: "code(품목코드)가 비었습니다" };
  if (code.trim().length > CODE_MAX) return { ok: false, error: `code 가 너무 깁니다(최대 ${CODE_MAX}자)` };
  if (note !== undefined && note !== null && typeof note !== "string") return { ok: false, error: "note 는 문자열이어야 합니다" };
  const n = typeof note === "string" && note.trim() !== "" ? note.trim().slice(0, NOTE_MAX) : null;
  const wh = typeof warehouse === "string" && warehouse.trim() !== "" ? warehouse : null;
  return { ok: true, value: { key, keyNorm: normKey(key), code: code.trim(), note: n, warehouse: wh } };
}

export interface ItemInput { code: string; warehouse: string }

/** POST /api/sales-match/item 몸통 {code, warehouse}. 둘 다 필요 */
export function validateItemInput(body: unknown): Checked<ItemInput> {
  if (!isObj(body)) return { ok: false, error: "JSON 객체가 아닙니다" };
  const { code, warehouse } = body;
  if (typeof code !== "string" || code.trim() === "") return { ok: false, error: "code(품목코드)가 비었습니다" };
  if (code.trim().length > CODE_MAX) return { ok: false, error: `code 가 너무 깁니다(최대 ${CODE_MAX}자)` };
  if (typeof warehouse !== "string" || warehouse.trim() === "") return { ok: false, error: "warehouse(출하창고)가 비었습니다" };
  return { ok: true, value: { code: code.trim(), warehouse } };
}

/**
 * 저장할 행. 처음 들어온 곳(source)은 고정한다: 엑셀에서 옮긴 줄의 코드를 바꿔도 '엑셀옮김' 으로 남고 옛 코드는 note 에 남는다
 * (「지우기는 대시보드에서 넣은 줄만」이 원래 매핑을 잃지 않게). 원래 코드는 처음 바꿀 때 한 번만 적는다.
 */
export function nextMatchRow(existing: MatchRow | null, input: MatchInput, nowIso: string): MatchRow {
  if (!existing) {
    return { key_norm: input.keyNorm, match_key: input.key, code: input.code, source: SOURCE_DASHBOARD, note: input.note, updated_at: nowIso };
  }
  const ORIGIN_RE = /원래 코드 [^·]*\(엑셀옮김\)/;
  const oldNote = existing.note ?? "";
  const kept = ORIGIN_RE.exec(oldNote)?.[0] ?? null;
  const origin = kept ?? (existing.source === SOURCE_SEED && existing.code !== input.code ? `원래 코드 ${existing.code}(엑셀옮김)` : null);
  const rest = input.note ?? (oldNote.replace(ORIGIN_RE, "").replace(/^\s*·\s*|\s*·\s*$/g, "").trim() || null);
  const note = [origin, rest].filter((s): s is string => !!s && s.trim() !== "").join(" · ") || null;
  return {
    key_norm: existing.key_norm,
    match_key: existing.match_key,
    code: input.code,
    source: existing.source,
    note: note ? note.slice(0, NOTE_MAX) : null,
    updated_at: nowIso,
  };
}

/** 지우기는 대시보드에서 넣은 줄만 */
export function canDelete(row: Pick<MatchRow, "source"> | null): boolean {
  return !!row && row.source === SOURCE_DASHBOARD;
}

export interface SeedValue {
  match: MatchRow[];
  items: ItemCodeRow[];
  skipped: { matchNullKey: number; matchNullCode: number; matchDuplicate: number; itemNullCode: number; itemDuplicate: number; header: number };
}

const blank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
const optText = (v: unknown): string | null => (blank(v) ? null : String(v));

/**
 * POST /api/sales-match/seed 몸통 {match:[[열쇠, 코드], ...], warehouse:[[코드, 이름, 출하창고], ...]}.
 * 먼저 나온 줄만 남긴다(엑셀 VLOOKUP). 열쇠·코드가 빈 줄은 건너뛰고 건수를 센다. 머리글 줄이 섞여 와도 건너뛴다.
 * 열쇠가 문자열이 아니면 글자로 바꾼다(지금 볼트 사본에는 문자열 아닌 열쇠가 없다).
 */
export function validateSeed(body: unknown, nowIso: string): Checked<SeedValue> {
  if (!isObj(body)) return { ok: false, error: "JSON 객체가 아닙니다" };
  const match = body.match ?? [];
  const warehouse = body.warehouse ?? [];
  if (!Array.isArray(match) || !Array.isArray(warehouse)) return { ok: false, error: "match·warehouse 는 배열이어야 합니다" };
  if (match.length + warehouse.length > SEED_MAX_ROWS) return { ok: false, error: `줄이 너무 많습니다(최대 ${SEED_MAX_ROWS})` };
  const skipped = { matchNullKey: 0, matchNullCode: 0, matchDuplicate: 0, itemNullCode: 0, itemDuplicate: 0, header: 0 };

  const rows: MatchRow[] = [];
  const keys = new Set<string>();
  for (const [i, r] of match.entries()) {
    if (!Array.isArray(r)) return { ok: false, error: `match[${i}] 가 배열이 아닙니다` };
    const [k, c] = r;
    if (k === "채널별 상품명" && c === "제품코드") { skipped.header++; continue; }
    if (blank(k)) { skipped.matchNullKey++; continue; }
    if (blank(c)) { skipped.matchNullCode++; continue; }
    const key = String(k);
    const code = String(c).trim();
    if (key.length > KEY_MAX || code.length > CODE_MAX) return { ok: false, error: `match[${i}] 열쇠나 코드가 너무 깁니다` };
    const keyNorm = normKey(key);
    if (keys.has(keyNorm)) { skipped.matchDuplicate++; continue; }
    keys.add(keyNorm);
    rows.push({ key_norm: keyNorm, match_key: key, code, source: SOURCE_SEED, note: null, updated_at: nowIso });
  }

  const items: ItemCodeRow[] = [];
  const codes = new Set<string>();
  for (const [i, r] of warehouse.entries()) {
    if (!Array.isArray(r)) return { ok: false, error: `warehouse[${i}] 가 배열이 아닙니다` };
    const [c, name, wh] = r;
    if (blank(c)) { skipped.itemNullCode++; continue; }
    const code = String(c).trim();
    if (codes.has(code)) { skipped.itemDuplicate++; continue; }
    codes.add(code);
    items.push({ code, name: optText(name), warehouse: optText(wh) });
  }
  return { ok: true, value: { match: rows, items, skipped } };
}

/** 이미 있는 것은 빼고 새 것만. 원본 배열은 안 바꾼다 */
export function onlyNew<T>(rows: readonly T[], existing: ReadonlySet<string>, keyOf: (r: T) => string): T[] {
  return rows.filter((r) => !existing.has(keyOf(r)));
}

// ── 보관된 판매입력 줄 고치기 ─────────────────────────────

export type Cell = string | number | boolean | null;

/** 고칠 후보 = unmatched=true 줄 */
export interface PatchLine {
  date: string;
  seq: number;
  mall: string | null;
  match_key: string | null;
  item_code: string | null;
  row_values: Cell[];
}
export interface RunLite { date: string; unmatched: unknown[] | null; unmatched_count: number }
export interface LineUpdate { date: string; seq: number; item_code: string; warehouse: string | null; unmatched: false; row_values: Cell[] }
export interface UnmatchedEntry { 판매몰: string; 매칭열쇠: string; 줄수: number }

/** 고치는 칸: 상품코드·품목코드는 새 코드, 출하창고 두 칸(주문 쪽·이카운트 쪽)은 새 창고 */
const CODE_HEADERS = ["상품코드", "품목코드"];
const WAREHOUSE_HEADER = "출하창고";

function indicesOf(headers: readonly string[], names: readonly string[]): number[] {
  return headers.flatMap((h, i) => (names.includes(h) ? [i] : []));
}

/** 한 줄의 row_values 를 새 코드·창고로 바꾼 새 배열(원본은 안 바꾼다) */
export function patchRowValues(row: readonly Cell[], headers: readonly string[], code: string, warehouse: string | null): Cell[] {
  const codeIdx = indicesOf(headers, CODE_HEADERS);
  const whIdx = indicesOf(headers, [WAREHOUSE_HEADER]);
  return row.map((v, i) => (codeIdx.includes(i) ? code : whIdx.includes(i) ? warehouse : v));
}

/** 이 열쇠로 고칠 줄들. match_key 가 같고(대소문자 무시) 아직 미매칭인 줄만 */
export function planLineUpdates(
  candidates: readonly PatchLine[], keyNorm: string, code: string, warehouse: string | null, headers: readonly string[],
): LineUpdate[] {
  return candidates
    .filter((l) => typeof l.match_key === "string" && normKey(l.match_key) === keyNorm)
    .map((l) => ({
      date: l.date, seq: l.seq, item_code: code, warehouse, unmatched: false as const,
      row_values: patchRowValues(l.row_values, headers, code, warehouse),
    }));
}

const entryKey = (u: unknown): string | null => {
  if (!isObj(u)) return null;
  const k = u["매칭열쇠"];
  return typeof k === "string" ? k : null;
};

/** 남은 미매칭 줄 → 판매입력 unmatched 목록(판매몰·매칭열쇠별 줄 수, 순서대로). 볼트 sales_entry.py unmatched() 와 같은 모양 */
export function unmatchedFromLines(lines: readonly Pick<PatchLine, "seq" | "mall" | "match_key">[]): UnmatchedEntry[] {
  const seen = new Map<string, UnmatchedEntry>();
  for (const l of [...lines].sort((a, b) => a.seq - b.seq)) {
    const mall = l.mall ?? "";
    const key = l.match_key ?? "";
    const id = JSON.stringify([mall, key]);
    const e = seen.get(id);
    if (e) seen.set(id, { ...e, 줄수: e.줄수 + 1 });
    else seen.set(id, { 판매몰: mall, 매칭열쇠: key, 줄수: 1 });
  }
  return Array.from(seen.values());
}

export interface RunUpdate { date: string; unmatched: UnmatchedEntry[]; unmatched_count: number }
export interface PatchPlan { lines: LineUpdate[]; runs: RunUpdate[]; staleDates: string[] }

/**
 * 고칠 줄 + 다시 셀 날짜. 날짜 = 「이번에 고친 줄의 날짜 ∪ 실행 행 unmatched 에 이 열쇠가 남은 날짜」
 * (줄만 고쳐지고 실행 행 갱신이 실패했어도 다시 저장하면 그날을 다시 센다).
 * 그날 남은 미매칭 줄에 match_key 가 없는 줄(칸이 생기기 전에 보낸 날)이 있으면 실행 행을 안 건드리고 staleDates 로 알린다:
 * 열쇠를 상품명+옵션으로 거꾸로 맞추지 않는다(카페24 별칭 때문에 틀린다). 그날은 회사 PC 에서 다시 보내야 고쳐진다.
 */
export function planPatch(
  candidates: readonly PatchLine[], runs: readonly RunLite[], keyNorm: string, code: string, warehouse: string | null, headers: readonly string[],
): PatchPlan {
  const lines = planLineUpdates(candidates, keyNorm, code, warehouse, headers);
  const patched = new Set(lines.map((l) => `${l.date}#${l.seq}`));
  const dates = new Set(lines.map((l) => l.date));
  for (const r of runs) {
    if ((r.unmatched ?? []).some((u) => { const k = entryKey(u); return k !== null && normKey(k) === keyNorm; })) dates.add(r.date);
  }
  const runUpdates: RunUpdate[] = [];
  const staleDates: string[] = [];
  for (const date of Array.from(dates).sort()) {
    const remaining = candidates.filter((l) => l.date === date && !patched.has(`${l.date}#${l.seq}`));
    if (remaining.some((l) => l.match_key === null)) { staleDates.push(date); continue; }
    runUpdates.push({ date, unmatched: unmatchedFromLines(remaining), unmatched_count: remaining.length });
  }
  return { lines, runs: runUpdates, staleDates };
}

export interface MatchPatchDb {
  /** unmatched=true 인 판매입력 줄 전부(모든 날짜) */
  listUnmatchedLines(): Promise<{ data: PatchLine[]; error: DbError | null }>;
  /** 미매칭이 남은(unmatched_count > 0) 실행 행 */
  listRunsWithUnmatched(): Promise<{ data: RunLite[]; error: DbError | null }>;
  updateLine(u: LineUpdate): Promise<{ error: DbError | null }>;
  updateRun(u: RunUpdate): Promise<{ error: DbError | null }>;
}
export interface PatchResult { dates: string[]; lines: number; warnings: string[]; error: string | null }

/** 저장한 매칭으로 보관된 판매입력을 고친다. 실패해도 매칭 저장은 남는다(다시 저장하면 이어서 고친다) */
export async function runMatchPatch(
  db: MatchPatchDb, keyNorm: string, code: string, warehouse: string | null, headers: readonly string[],
): Promise<PatchResult> {
  const warnings: string[] = [];
  const cand = await db.listUnmatchedLines();
  if (cand.error) {
    if (isMissingColumn(cand.error)) return { dates: [], lines: 0, warnings: ["판매입력 줄에 match_key 칸이 없어 보관된 줄은 못 고쳤습니다(SQL 실행 필요)"], error: null };
    if (isMissingTable(cand.error)) return { dates: [], lines: 0, warnings: ["판매입력 보관 표가 없어 고칠 줄이 없습니다"], error: null };
    return { dates: [], lines: 0, warnings, error: `미매칭 줄 읽기 실패: ${cand.error.message}` };
  }
  const runs = await db.listRunsWithUnmatched();
  if (runs.error) return { dates: [], lines: 0, warnings, error: `판매입력 실행 행 읽기 실패: ${runs.error.message}` };
  const plan = planPatch(cand.data, runs.data, keyNorm, code, warehouse, headers);
  let done = 0;
  const doneDates = new Set<string>();
  for (const u of plan.lines) {
    const { error } = await db.updateLine(u);
    if (error) return { dates: Array.from(doneDates).sort(), lines: done, warnings, error: `${u.date} ${u.seq}번 줄 고치기 실패: ${error.message}. 같은 코드를 다시 저장하면 이어서 고칩니다` };
    done++;
    doneDates.add(u.date);
  }
  for (const r of plan.runs) {
    const { error } = await db.updateRun(r);
    if (error) return { dates: Array.from(doneDates).sort(), lines: done, warnings, error: `${r.date} 미매칭 목록 다시 세기 실패: ${error.message}. 같은 코드를 다시 저장하면 다시 셉니다` };
  }
  if (plan.staleDates.length) {
    warnings.push(`${plan.staleDates.join(", ")} 는 매칭열쇠 없이 보관된 날이라 못 고쳤습니다. 회사 PC 에서 그날을 다시 보내면 새 코드로 바뀝니다`);
  }
  return { dates: Array.from(doneDates).sort(), lines: done, warnings, error: null };
}

// ── 추천 ──────────────────────────────────────────────

/** 앞에 붙은 「[임시]」「[유통기한 26.6.20까지]」 같은 대괄호 머리표를 뗀 소문자 열쇠 */
export function baseKey(key: string): string {
  return normKey(key).replace(/^(\s*\[[^\]]*\]\s*)+/, "").trim();
}

/**
 * 미매칭 열쇠와 머리표만 다른 기존 매칭의 코드(추천 1순위). 많이 나온 코드 먼저, 같으면 먼저 본 순서.
 * 원본 배열은 안 바꾼다.
 */
export function suggestCodes(key: string, matches: readonly Pick<MatchApiRow, "key" | "code">[]): string[] {
  const base = baseKey(key);
  if (!base) return [];
  const own = normKey(key);
  const count = new Map<string, number>();
  for (const m of matches) {
    if (normKey(m.key) === own || baseKey(m.key) !== base) continue;
    count.set(m.code, (count.get(m.code) ?? 0) + 1);
  }
  return Array.from(count.entries()).sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

// ── 저장 흐름(라우트가 DB·시트를 넘겨 부른다. 시험은 가짜를 넘긴다) ─────────

export interface ApiResult { status: number; body: Record<string, unknown> }

export interface SaveMatchDeps {
  isSeeded(): Promise<{ setupNeeded: boolean; error: DbError | null; data?: boolean }>;
  /** 「상품 목록」 코드. 못 읽으면 throw */
  readProductCodes(): Promise<ProductListItem[]>;
  getRow(keyNorm: string): Promise<{ setupNeeded: boolean; error: DbError | null; data?: MatchRow | null }>;
  upsert(row: MatchRow): Promise<{ error: DbError | null }>;
  getWarehouse(code: string): Promise<{ data: string | null; found: boolean; error: DbError | null }>;
  /** 출하창고 표 전부(창고를 골랐을 때만 읽는다: 고르기 목록·지금 창고 확인) */
  listItems(): Promise<{ data: ItemCodeRow[]; error: DbError | null }>;
  /** 출하창고 표 한 줄 넣기·바꾸기(code 기준) */
  upsertItem(row: ItemCodeRow): Promise<{ error: DbError | null }>;
  /** 그날들 중 원본 파일이 있는 날에 「원본 다시 만들기」 표시. 표시한 날짜를 돌려준다 */
  markOriginalStale(dates: readonly string[]): Promise<StaleMarkResult>;
  patchDb: MatchPatchDb;
  headers: readonly string[];
  now(): string;
}

/** markOriginalStale 결과. missingColumn = 칸이 아직 없음(SQL 전, docs/sql/2026-11-26-sales-entry-stale.sql) */
export interface StaleMarkResult { marked: string[]; missingColumn: boolean; error: DbError | null }

export const STALE_SQL_PATH = "docs/sql/2026-11-26-sales-entry-stale.sql";

const setupResult = (): ApiResult => ({ status: 503, body: { ok: false, setupNeeded: true, error: MATCH_SETUP_MESSAGE } });
const dbFail = (step: string, e: DbError): ApiResult =>
  isMissingTable(e) ? setupResult() : { status: 500, body: { ok: false, step, error: `${step} 실패: ${e.message}` } };
const badWarehouse = (warehouse: string, options: readonly string[]): ApiResult => ({
  status: 400,
  body: { ok: false, error: `고를 수 없는 출하창고: ${warehouse}. 목록(${options.join(", ") || "없음"}) 중에서 고르세요` },
});

type ItemPlan = { ok: true; write: ItemCodeRow | null } | { ok: false; result: ApiResult };

/**
 * 골라 온 창고 검사(쓰기 전). 목록에 없는 창고 400, 이미 다른 창고가 있는 코드 409, 같은 창고면 쓸 것 없음.
 * 창고가 비었거나 표에 없는 코드면 넣을 줄을 돌려준다(이름 = 「상품 목록」 E열, 비면 표에 있던 이름).
 */
async function planItemWrite(deps: Pick<SaveMatchDeps, "listItems">, code: string, warehouse: string, productName: string | null): Promise<ItemPlan> {
  const items = await deps.listItems();
  if (items.error) return { ok: false, result: dbFail("출하창고 표 읽기", items.error) };
  const options = warehouseOptions(items.data);
  if (!options.includes(warehouse)) return { ok: false, result: badWarehouse(warehouse, options) };
  const item = items.data.find((i) => i.code === code) ?? null;
  if (item && !isBlankWarehouse(item.warehouse)) {
    if (item.warehouse === warehouse) return { ok: true, write: null };
    return {
      ok: false,
      result: {
        status: 409,
        body: { ok: false, warehouseConflict: true, current: item.warehouse, error: `${code} 는 이미 출하창고가 ${item.warehouse} 입니다. ${WAREHOUSE_CHANGE_HINT}` },
      },
    };
  }
  const name = productName && productName.trim() !== "" ? productName : item?.name ?? null;
  return { ok: true, write: { code, name, warehouse } };
}

/** 줄을 고친 날 중 원본이 있는 날에 표시. 실패해도 저장은 그대로이고 경고만 남긴다 */
async function markStale(deps: Pick<SaveMatchDeps, "markOriginalStale">, dates: readonly string[], warnings: string[]): Promise<string[]> {
  if (dates.length === 0) return [];
  const r = await deps.markOriginalStale(dates);
  if (r.missingColumn) {
    warnings.push(`원본 다시 만들기 표시 칸이 아직 없습니다(${STALE_SQL_PATH} 실행 전). 「원본」인 날은 회사 PC 에서 그날을 다시 만들어 보내세요`);
    return [];
  }
  if (r.error) {
    warnings.push(`원본 다시 만들기 표시 실패: ${r.error.message}. 「원본」인 날은 회사 PC 에서 그날을 다시 만들어 보내세요`);
    return [];
  }
  return r.marked;
}

/**
 * POST /api/sales-match: 한 줄 넣기·바꾸기 → (창고를 골랐으면 출하창고 표) → 보관된 #N/A 줄 고치기 → 원본 다시 만들기 표시.
 * 막는 경우(아무것도 안 씀): seed 전(409), 「상품 목록」에 없는 코드(400), 시트를 못 읽음(502),
 * 목록에 없는 창고(400), 이미 다른 창고가 있는 코드(409).
 */
export async function saveMatch(deps: SaveMatchDeps, body: unknown): Promise<ApiResult> {
  const v = validateMatchInput(body);
  if (!v.ok) return { status: 400, body: { ok: false, error: v.error } };
  const input = v.value;

  const seeded = await deps.isSeeded();
  if (seeded.setupNeeded) return setupResult();
  if (seeded.error) return dbFail("매칭표 읽기", seeded.error);
  if (!seeded.data) return { status: 409, body: { ok: false, notSeeded: true, error: NOT_SEEDED_MESSAGE } };

  let products: ProductListItem[];
  try {
    products = await deps.readProductCodes();
  } catch (e) {
    return { status: 502, body: { ok: false, error: `통계 시트 「상품 목록」을 못 읽어 저장하지 않았습니다: ${e instanceof Error ? e.message : String(e)}` } };
  }
  const product = products.find((p) => p.code === input.code);
  if (!product) {
    return { status: 400, body: { ok: false, notInProductList: true, error: `상품 목록에 없는 코드: ${input.code}. 통계 시트 「상품 목록」 탭에 먼저 등록하세요` } };
  }

  // 창고 검사는 쓰기 전에(409 인데 매칭만 저장되는 반쪽 저장을 막는다)
  let itemWrite: ItemCodeRow | null = null;
  if (input.warehouse) {
    const plan = await planItemWrite(deps, product.code, input.warehouse, product.name);
    if (!plan.ok) return plan.result;
    itemWrite = plan.write;
  }

  const existing = await deps.getRow(input.keyNorm);
  if (existing.setupNeeded) return setupResult();
  if (existing.error) return dbFail("매칭표 읽기", existing.error);

  if (itemWrite) {
    const r = await deps.upsertItem(itemWrite);
    if (r.error) return dbFail("출하창고 저장", r.error);
  }
  const row = nextMatchRow(existing.data ?? null, { ...input, code: product.code }, deps.now());
  const up = await deps.upsert(row);
  if (up.error) return dbFail("매칭표 저장", up.error);

  const warnings: string[] = [];
  const wh = await deps.getWarehouse(row.code);
  if (wh.error && !isMissingTable(wh.error)) warnings.push(`출하창고 표를 못 읽어 출하창고를 비웠습니다: ${wh.error.message}`);
  else if (!wh.found) warnings.push(`출하창고 표에 ${row.code} 가 없어 고친 줄의 출하창고를 비웠습니다. 이카운트 올리기 전에 확인하세요`);
  else if (isBlankWarehouse(wh.data)) warnings.push(`${row.code} 의 출하창고가 비어 고친 줄의 출하창고를 비웠습니다. 「매칭표 보기」의 품목코드별 출하창고에서 넣으세요`);
  const whValue = isBlankWarehouse(wh.data) ? null : wh.data;

  const patch = await runMatchPatch(deps.patchDb, row.key_norm, row.code, whValue, deps.headers);
  warnings.push(...patch.warnings);
  // 줄이 실제로 바뀐 날만(멈췄어도 이미 고친 날은 포함)
  const originalStale = await markStale(deps, patch.dates, warnings);
  const changedFrom = existing.data && existing.data.code !== row.code ? existing.data.code : null;
  if (changedFrom) warnings.push(`코드를 ${changedFrom} → ${row.code} 로 바꿨습니다. 이미 ${changedFrom} 로 들어간 보관 줄은 그대로입니다(회사 PC 에서 그날을 다시 보내면 바뀝니다)`);
  // 줄 고치기가 멈춰도 매칭은 저장됐다. 200 으로 돌려 캐시(매칭표·판매입력)를 지우게 하고 ok:false 로 알린다
  return {
    status: 200,
    body: {
      ok: !patch.error,
      saved: true,
      match: toApiMatch(row),
      product: { code: product.code, name: product.name, brand: product.brand },
      warehouse: itemWrite ? { code: itemWrite.code, warehouse: itemWrite.warehouse } : null,
      patched: { dates: patch.dates, lines: patch.lines },
      originalStale,
      warnings,
      ...(patch.error ? { error: `매칭은 저장했지만 보관 줄 고치기가 멈췄습니다: ${patch.error}` } : {}),
    },
  };
}

export interface ItemSaveDeps {
  listItems(): Promise<{ data: ItemCodeRow[]; error: DbError | null }>;
  upsertItem(row: ItemCodeRow): Promise<{ error: DbError | null }>;
  /** 표에 없는 코드를 넣을 때만 부른다. 못 읽으면 throw */
  readProductCodes(): Promise<ProductListItem[]>;
}

/**
 * POST /api/sales-match/item {code, warehouse}: 「매칭표 보기」의 품목코드별 출하창고 보기·바꾸기.
 * 출하창고 표만 바꾼다. 이미 보관된 판매입력 줄은 그대로다(코드 바꾸기와 같은 규칙. 회사 PC 가 그날을 다시 보내면 바뀐다).
 * 표에 없는 코드는 「상품 목록」에 있을 때만 넣는다(이름 = E열).
 */
export async function saveItemWarehouse(deps: ItemSaveDeps, body: unknown): Promise<ApiResult> {
  const v = validateItemInput(body);
  if (!v.ok) return { status: 400, body: { ok: false, error: v.error } };
  const { code, warehouse } = v.value;
  const items = await deps.listItems();
  if (items.error) return dbFail("출하창고 표 읽기", items.error);
  const options = warehouseOptions(items.data);
  if (!options.includes(warehouse)) return badWarehouse(warehouse, options);
  const item = items.data.find((i) => i.code === code) ?? null;
  const previous = item && !isBlankWarehouse(item.warehouse) ? item.warehouse : null;
  let name = item?.name ?? null;
  if (!item) {
    let products: ProductListItem[];
    try {
      products = await deps.readProductCodes();
    } catch (e) {
      return { status: 502, body: { ok: false, error: `통계 시트 「상품 목록」을 못 읽어 저장하지 않았습니다: ${e instanceof Error ? e.message : String(e)}` } };
    }
    const product = products.find((p) => p.code === code);
    if (!product) {
      return { status: 400, body: { ok: false, notInProductList: true, error: `상품 목록에 없는 코드: ${code}. 통계 시트 「상품 목록」 탭에 먼저 등록하세요` } };
    }
    name = product.name || null;
  }
  const note = "이미 보관된 판매입력 줄의 출하창고는 그대로입니다. 회사 PC 가 다음 계산부터 이 창고를 씁니다";
  if (previous === warehouse) return { status: 200, body: { ok: true, unchanged: true, item: { code, name, warehouse }, previous, note } };
  const r = await deps.upsertItem({ code, name, warehouse });
  if (r.error) return dbFail("출하창고 저장", r.error);
  return { status: 200, body: { ok: true, item: { code, name, warehouse }, previous, note } };
}

export interface SeedDeps {
  existingKeys(): Promise<{ data: Set<string>; error: DbError | null }>;
  existingCodes(): Promise<{ data: Set<string>; error: DbError | null }>;
  insertMatch(rows: MatchRow[]): Promise<{ error: DbError | null }>;
  insertItems(rows: ItemCodeRow[]): Promise<{ error: DbError | null }>;
  now(): string;
}

/** POST /api/sales-match/seed: 없는 것만 넣는다. 이미 있는 열쇠·코드는 건드리지 않는다(대시보드에서 고친 것을 엑셀 사본이 덮지 않게) */
export async function runSeed(deps: SeedDeps, body: unknown): Promise<ApiResult> {
  const v = validateSeed(body, deps.now());
  if (!v.ok) return { status: 400, body: { ok: false, error: v.error } };
  const keys = await deps.existingKeys();
  if (keys.error) return dbFail("매칭표 읽기", keys.error);
  const codes = await deps.existingCodes();
  if (codes.error) return dbFail("출하창고 표 읽기", codes.error);
  const newMatch = onlyNew(v.value.match, keys.data, (r) => r.key_norm);
  const newItems = onlyNew(v.value.items, codes.data, (r) => r.code);
  if (newMatch.length) {
    const r = await deps.insertMatch(newMatch);
    if (r.error) return dbFail("매칭표 넣기", r.error);
  }
  if (newItems.length) {
    const r = await deps.insertItems(newItems);
    if (r.error) return dbFail("출하창고 표 넣기", r.error);
  }
  return {
    status: 200,
    body: {
      ok: true,
      match: { received: v.value.match.length, inserted: newMatch.length, kept: v.value.match.length - newMatch.length },
      items: { received: v.value.items.length, inserted: newItems.length, kept: v.value.items.length - newItems.length },
      skipped: v.value.skipped,
    },
  };
}
