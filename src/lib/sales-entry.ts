// 자동 판매입력 보관 DB 연결 (2026-11-26). 규칙(검증·개인정보 비우기·저장 순서·엑셀)은 src/lib/sales-entry-core.ts.
// 여기는 supabase 를 이어 줄 뿐이다. 표: docs/sql/2026-11-26-sales-entry.sql
//   POST /api/sales-entry        ← 볼트 sales_entry_push.py (x-ppmi-key)
//   GET  /api/sales-entry        → 최근 목록 / ?date= 상세
//   GET  /api/sales-entry/xlsx   → 판매입력 엑셀(원본이 있으면 원본, src/lib/sales-entry-file.ts)
import { supabase } from "@/lib/supabase";
import {
  LINES_TABLE, RUNS_TABLE, completeness, isMissingColumn, isMissingTable, runSalesEntryIngest,
  type DbError, type IngestResult, type SalesEntryDb, type SalesEntryLine, type SalesEntryRun, type Validated,
} from "@/lib/sales-entry-core";

const db: SalesEntryDb = {
  deleteByDate: async (table, date) => {
    const { error } = await supabase.from(table).delete().eq("date", date);
    return { error };
  },
  insert: async (table, rows) => {
    const { error } = await supabase.from(table).insert(rows);
    return { error };
  },
};

export function saveSalesEntry(v: Validated): Promise<IngestResult> {
  return runSalesEntryIngest(db, v);
}

/** 목록 칸(무거운 jsonb 중 summary·gaps·problems 는 빼고 unmatched 만 둔다: 카드에서 상품명을 보여 준다) */
const LIST_COLS =
  "date,line_count,total,revenue,shipping,unmatched_count,gap_count,problem_count,unmatched,generated_at,updated_at";
/** 원본 보관 칸(docs/sql/2026-11-26-sales-entry-files.sql). SQL 전이면 빼고 다시 읽는다 */
const ORIGINAL_LIST_COLS = "original_file_path,original_file_size,original_uploaded_at";
/** 「원본 다시 만들기」 표시(docs/sql/2026-11-26-sales-entry-stale.sql). 회사 PC 아침 회차가 이 칸이 true 인 날을 다시 만든다 */
const STALE_LIST_COL = "original_stale";
/** 칸이 없을 때 한 단계씩 줄여 읽는다(표시 칸 SQL 전이 원본 칸까지 지워 전부 「요약본」으로 보이지 않게) */
const LIST_COL_TIERS = [
  `${LIST_COLS},${ORIGINAL_LIST_COLS},${STALE_LIST_COL}`,
  `${LIST_COLS},${ORIGINAL_LIST_COLS}`,
  LIST_COLS,
];
export type SalesEntryListItem = Pick<
  SalesEntryRun,
  "date" | "line_count" | "total" | "revenue" | "shipping" | "unmatched_count" | "gap_count" | "problem_count" | "unmatched" | "generated_at" | "updated_at"
  | "original_file_path" | "original_file_size" | "original_uploaded_at"
> & { original_stale?: boolean };

export type Loaded<T> = { setupNeeded: true } | { setupNeeded: false; error: DbError } | { setupNeeded: false; error: null; data: T };

function failed<T>(error: DbError): Loaded<T> {
  return isMissingTable(error) ? { setupNeeded: true } : { setupNeeded: false, error };
}

export async function listSalesEntries(from: string): Promise<Loaded<SalesEntryListItem[]>> {
  const query = (cols: string) => supabase.from(RUNS_TABLE).select(cols).gte("date", from).order("date", { ascending: false });
  // 칸 SQL 전: 없는 칸을 빼고 다시 읽는다(목록이 통째로 죽지 않게). 원본 칸까지 없으면 카드는 전부 「요약본」으로 보인다
  let { data, error } = await query(LIST_COL_TIERS[0]);
  for (let i = 1; i < LIST_COL_TIERS.length && error && isMissingColumnAny(error) && !isMissingTable(error); i++) {
    ({ data, error } = await query(LIST_COL_TIERS[i]));
  }
  if (error) return failed(error);
  return { setupNeeded: false, error: null, data: (data ?? []) as unknown as SalesEntryListItem[] };
}

/** 읽기(select)에서 칸이 없을 때. sales-entry-core isMissingColumn 은 match_key 문구를 보므로 칸 이름으로도 본다 */
const isMissingColumnAny = (e: DbError) => isMissingColumn(e) || /original_(file|stale|uploaded)/.test(e.message ?? "");

const PAGE = 1000; // PostgREST 기본 최대 행

async function loadLines(date: string): Promise<{ data: SalesEntryLine[]; error: DbError | null }> {
  const out: SalesEntryLine[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(LINES_TABLE).select("*").eq("date", date).order("seq").range(from, from + PAGE - 1);
    if (error) return { data: out, error };
    out.push(...((data ?? []) as SalesEntryLine[]));
    if (!data || data.length < PAGE) return { data: out, error: null };
  }
}

export interface SalesEntryDetail {
  run: SalesEntryRun | null;
  lines: SalesEntryLine[];
  status: ReturnType<typeof completeness>;
}

export async function loadSalesEntry(date: string): Promise<Loaded<SalesEntryDetail>> {
  const runRes = await supabase.from(RUNS_TABLE).select("*").eq("date", date).maybeSingle();
  if (runRes.error) return failed(runRes.error);
  const lineRes = await loadLines(date);
  if (lineRes.error) return failed(lineRes.error);
  const run = (runRes.data ?? null) as SalesEntryRun | null;
  return { setupNeeded: false, error: null, data: { run, lines: lineRes.data, status: completeness(run, lineRes.data.length) } };
}
