// 자동 판매입력 보관 DB 연결 (2026-11-26). 규칙(검증·개인정보 비우기·저장 순서·엑셀)은 src/lib/sales-entry-core.ts.
// 여기는 supabase 를 이어 줄 뿐이다. 표: docs/sql/2026-11-26-sales-entry.sql
//   POST /api/sales-entry        ← 볼트 sales_entry_push.py (x-ppmi-key)
//   GET  /api/sales-entry        → 최근 목록 / ?date= 상세
//   GET  /api/sales-entry/xlsx   → 판매입력 엑셀
import { supabase } from "@/lib/supabase";
import {
  LINES_TABLE, RUNS_TABLE, completeness, isMissingTable, runSalesEntryIngest,
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
export type SalesEntryListItem = Pick<
  SalesEntryRun,
  "date" | "line_count" | "total" | "revenue" | "shipping" | "unmatched_count" | "gap_count" | "problem_count" | "unmatched" | "generated_at" | "updated_at"
>;

export type Loaded<T> = { setupNeeded: true } | { setupNeeded: false; error: DbError } | { setupNeeded: false; error: null; data: T };

function failed<T>(error: DbError): Loaded<T> {
  return isMissingTable(error) ? { setupNeeded: true } : { setupNeeded: false, error };
}

export async function listSalesEntries(from: string): Promise<Loaded<SalesEntryListItem[]>> {
  const { data, error } = await supabase.from(RUNS_TABLE).select(LIST_COLS).gte("date", from).order("date", { ascending: false });
  if (error) return failed(error);
  return { setupNeeded: false, error: null, data: (data ?? []) as unknown as SalesEntryListItem[] };
}

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
