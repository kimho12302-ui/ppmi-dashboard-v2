// 판매입력 매칭표 DB·시트 연결 (2026-11-26). 규칙은 src/lib/sales-match-core.ts, 표는 docs/sql/2026-11-26-sales-match.sql.
//   GET  /api/sales-match            → 매칭표 전부 + 출하창고 표(볼트 실행기가 매일 받아 계산, 정본)
//   POST /api/sales-match            ← 카드에서 한 줄 넣기·바꾸기 + 보관된 #N/A 줄 고치기
//   DELETE /api/sales-match?key=     ← 대시보드에서 넣은 줄 지우기
//   POST /api/sales-match/seed       ← 볼트 sales_match.json 처음 옮기기(없는 것만)
//   GET  /api/sales-match/products   → 통계 시트 「상품 목록」 코드(선택 상자)
// 통계 시트는 읽기만 한다(readonly 범위). product_sales·daily_sales 는 건드리지 않는다.
import { google } from "googleapis";
import { supabase } from "@/lib/supabase";
import { LINES_TABLE, RUNS_TABLE } from "@/lib/sales-entry-core";
import {
  ITEMS_TABLE, MATCH_TABLE, SOURCE_SEED, isMissingTable, parseProductList,
  type DbError, type ItemCodeRow, type LineUpdate, type MatchPatchDb, type MatchRow, type PatchLine,
  type ProductListItem, type RunLite, type RunUpdate,
} from "@/lib/sales-match-core";

const STATS_SHEET_ID = "1FzxDCyR9FyAIduf7Q0lfUIOzvSqVlod21eOFqaPrXio";
/** /api/upload-sales 와 같은 범위(A 코드, B 카테고리, C 브랜드, D 라인업, E 상품명) */
const PRODUCT_LIST_RANGE = "상품 목록!A3:E1000";
const PAGE = 1000; // PostgREST 기본 최대 행

export type Loaded<T> = { setupNeeded: true } | { setupNeeded: false; error: DbError } | { setupNeeded: false; error: null; data: T };
const failed = <T>(error: DbError): Loaded<T> => (isMissingTable(error) ? { setupNeeded: true } : { setupNeeded: false, error });

type Filter = "unmatchedLines" | "runsWithUnmatched" | null;

/**
 * 1000줄씩 끝까지 읽는다. 정렬 칸은 겹치지 않는 키여야 한다(정렬 없이·겹치는 정렬로 나눠 읽으면 건너뛰거나 겹친다).
 * 거르기는 정해진 두 가지만(열쇠 글자로 DB 를 거르지 않는다: 쉼표·괄호·% 가 든 열쇠는 PostgREST 필터에서 깨진다).
 */
async function readAll<T>(table: string, cols: string, orderBy: readonly string[], filter: Filter = null): Promise<{ data: T[]; error: DbError | null }> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from(table).select(cols);
    if (filter === "unmatchedLines") q = q.eq("unmatched", true);
    if (filter === "runsWithUnmatched") q = q.gt("unmatched_count", 0);
    for (const o of orderBy) q = q.order(o);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) return { data: out, error };
    out.push(...((data ?? []) as unknown as T[]));
    if (!data || data.length < PAGE) return { data: out, error: null };
  }
}

export async function loadMatchTables(): Promise<Loaded<{ match: MatchRow[]; items: ItemCodeRow[] }>> {
  const m = await readAll<MatchRow>(MATCH_TABLE, "key_norm,match_key,code,source,note,updated_at", ["key_norm"]);
  if (m.error) return failed(m.error);
  const i = await readAll<ItemCodeRow>(ITEMS_TABLE, "code,name,warehouse", ["code"]);
  if (i.error) return failed(i.error);
  return { setupNeeded: false, error: null, data: { match: m.data, items: i.data } };
}

/**
 * 엑셀에서 옮긴 줄이 하나라도 있는가(seed 했는가).
 * head 요청(count 만)은 표가 없을 때 오류 없이 빈 값이 와 「옮기기 전」으로 잘못 보인다(2026-11-26 확인). 그래서 한 줄을 읽는다.
 */
export async function isSeeded(): Promise<Loaded<boolean>> {
  const { data, error } = await supabase.from(MATCH_TABLE).select("key_norm").eq("source", SOURCE_SEED).limit(1);
  if (error) return failed(error);
  return { setupNeeded: false, error: null, data: (data ?? []).length > 0 };
}

export async function getMatchRow(keyNorm: string): Promise<Loaded<MatchRow | null>> {
  const { data, error } = await supabase.from(MATCH_TABLE).select("key_norm,match_key,code,source,note,updated_at").eq("key_norm", keyNorm).maybeSingle();
  if (error) return failed(error);
  return { setupNeeded: false, error: null, data: (data ?? null) as MatchRow | null };
}

export async function upsertMatchRow(row: MatchRow): Promise<{ error: DbError | null }> {
  const { error } = await supabase.from(MATCH_TABLE).upsert(row, { onConflict: "key_norm" });
  return { error };
}

export async function deleteMatchRow(keyNorm: string): Promise<{ error: DbError | null }> {
  const { error } = await supabase.from(MATCH_TABLE).delete().eq("key_norm", keyNorm);
  return { error };
}

export async function getWarehouse(code: string): Promise<{ data: string | null; found: boolean; error: DbError | null }> {
  const { data, error } = await supabase.from(ITEMS_TABLE).select("warehouse").eq("code", code).maybeSingle();
  if (error) return { data: null, found: false, error };
  const row = data as { warehouse: string | null } | null;
  return { data: row?.warehouse ?? null, found: !!row, error: null };
}

/** 없는 것만 넣는다(ON CONFLICT DO NOTHING). 이미 있는 열쇠·코드는 건드리지 않는다 */
export async function insertIgnoringExisting(table: string, rows: object[], onConflict: string): Promise<{ error: DbError | null }> {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from(table).upsert(rows.slice(i, i + 500), { onConflict, ignoreDuplicates: true });
    if (error) return { error };
  }
  return { error: null };
}

export async function existingKeys(table: string, col: string): Promise<{ data: Set<string>; error: DbError | null }> {
  const r = await readAll<Record<string, string>>(table, col, [col]);
  return { data: new Set(r.data.map((x) => x[col])), error: r.error };
}

/** 보관된 판매입력 고치기에 쓰는 DB(src/lib/sales-match-core.ts runMatchPatch) */
export const patchDb: MatchPatchDb = {
  listUnmatchedLines: async () => {
    return readAll<PatchLine>(LINES_TABLE, "date,seq,mall,match_key,item_code,row_values", ["date", "seq"], "unmatchedLines");
  },
  listRunsWithUnmatched: async () => {
    return readAll<RunLite>(RUNS_TABLE, "date,unmatched,unmatched_count", ["date"], "runsWithUnmatched");
  },
  updateLine: async (u: LineUpdate) => {
    const { error } = await supabase.from(LINES_TABLE)
      .update({ item_code: u.item_code, warehouse: u.warehouse, unmatched: u.unmatched, row_values: u.row_values })
      .eq("date", u.date).eq("seq", u.seq);
    return { error };
  },
  updateRun: async (u: RunUpdate) => {
    const { error } = await supabase.from(RUNS_TABLE)
      .update({ unmatched: u.unmatched, unmatched_count: u.unmatched_count, updated_at: new Date().toISOString() })
      .eq("date", u.date);
    return { error };
  },
};

/**
 * 서비스 계정 JSON. 로컬 .env.local 처럼 큰따옴표로 감싼 값은 dotenv 가 private_key 의 \n 을 진짜 줄바꿈으로 풀어
 * JSON.parse 가 깨진다. 그때만 줄바꿈을 다시 \n 으로 바꿔 읽는다(한 줄 JSON 이라 문자열 밖에는 줄바꿈이 없다).
 */
function parseServiceAccount(raw: string): object {
  try {
    return JSON.parse(raw);
  } catch (e) {
    try {
      return JSON.parse(raw.replace(/\r?\n/g, "\\n"));
    } catch {
      throw e;
    }
  }
}

/** 통계 시트 「상품 목록」 코드. 캐시 없이 매번 읽는다(방금 시트에 넣은 코드를 바로 고를 수 있게) */
export async function readProductList(): Promise<ProductListItem[]> {
  const saKey = process.env.GOOGLE_SA_KEY;
  if (!saKey) throw new Error("GOOGLE_SA_KEY 가 설정되지 않았습니다");
  const auth = new google.auth.GoogleAuth({
    credentials: parseServiceAccount(saKey),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: STATS_SHEET_ID, range: PRODUCT_LIST_RANGE });
  return parseProductList(res.data.values ?? []);
}
