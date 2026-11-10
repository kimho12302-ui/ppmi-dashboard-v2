// 위킵 재고 원천을 받아 넣는다 (2026-11-10). 쓰는 쪽: 로컬 수집기 settings/collectors/bin/wekeep-inventory.mjs --push.
//
// 두 길로 들어온다. 둘 다 이 함수 하나를 쓴다.
//   - POST /api/wekeep-ingest  (전용, x-ppmi-key 필수)
//   - POST /api/raw-ingest     (볼트 lib/push.mjs pushRaw 가 부르는 공용 자리. source 가 wekeep-* 면 여기로 넘김)
//
// 받는 모양: { source: "wekeep-snapshot" | "wekeep-daily", rows: [...] } 행 열 이름 = DB 열 이름
//   (docs/sql/2026-11-10-inventory.sql, 볼트 수집기 toDbRows 와 같음).
// 검증에 하나라도 걸리면 아무것도 안 쓰고 400. 같은 키가 한 요청에 두 번 오면 뒤엣것을 쓴다
//   (Postgres 는 한 upsert 안 중복 키를 거부한다).
// 끝나면 sync_heartbeat 에 wekeep-inventory 를 남긴다(대시보드 상태 화면 「자동화 상태」 표).
import { supabase } from "@/lib/supabase";

export const WEKEEP_SOURCES = ["wekeep-snapshot", "wekeep-daily"] as const;
export type WekeepSource = (typeof WEKEEP_SOURCES)[number];
export const isWekeepSource = (s: unknown): s is WekeepSource => typeof s === "string" && (WEKEEP_SOURCES as readonly string[]).includes(s);
export const WEKEEP_HEARTBEAT = "wekeep-inventory";

const TARGET: Record<WekeepSource, { table: string; dateCol: string; onConflict: string; ints: string[] }> = {
  "wekeep-snapshot": {
    table: "raw_wekeep_snapshot", dateCol: "date", onConflict: "date,sku_no",
    ints: ["available_qty", "safe_qty", "reserve_qty", "faulty_qty", "damage_qty", "in_customs_qty", "before_delivery_qty"],
  },
  "wekeep-daily": {
    table: "raw_wekeep_daily", dateCol: "ymd", onConflict: "ymd,sku_no",
    ints: ["shipin_qty", "shipout_qty", "return_shipin_qty", "faulty_shipin_qty", "damage_shipin_qty", "center_qty"],
  },
};
const ALLOWED: Record<WekeepSource, readonly string[]> = {
  "wekeep-snapshot": ["date", "sku_no", "product_name", "variation", "barcode", "supplier_name", "available_qty", "safe_qty", "reserve_qty",
    "faulty_qty", "damage_qty", "in_customs_qty", "before_delivery_qty", "daily_avg_shipout_qty", "month_avg_shipout_qty",
    "sku_turnover", "read_at", "source"],
  "wekeep-daily": ["ymd", "sku_no", "product_name", "barcode", "shipin_qty", "shipout_qty", "return_shipin_qty", "faulty_shipin_qty",
    "damage_shipin_qty", "center_qty", "read_at"],
};
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const CHUNK = 500;
/** 한 요청 최대 행. 백필은 수집기가 달 단위로 나눠 보낸다 */
export const MAX_ROWS = 20000;

export interface IngestResult { status: number; body: Record<string, unknown> }

/** 검증 + 중복 키 정리. 문제 목록(최대 20개)과 정리된 행 */
export function validateWekeepRows(source: WekeepSource, rows: unknown[], today: string): { errors: string[]; clean: Record<string, unknown>[] } {
  const t = TARGET[source];
  const errors: string[] = [];
  const byKey = new Map<string, Record<string, unknown>>();
  rows.forEach((raw, i) => {
    if (!raw || typeof raw !== "object") { errors.push(`${i}번 행이 객체가 아님`); return; }
    const r = raw as Record<string, unknown>;
    const extra = Object.keys(r).filter((k) => !ALLOWED[source].includes(k));
    if (extra.length) { errors.push(`${i}번 행 모르는 칸: ${extra.join(", ")}`); return; }
    const d = r[t.dateCol];
    if (typeof d !== "string" || !ISO.test(d)) { errors.push(`${i}번 행 ${t.dateCol} 형식 이상: ${String(d)}`); return; }
    if (d > today) { errors.push(`${i}번 행 미래 날짜: ${d}`); return; }
    if (typeof r.sku_no !== "string" || !r.sku_no) { errors.push(`${i}번 행 sku_no 없음`); return; }
    if (source === "wekeep-snapshot" && (typeof r.product_name !== "string" || !r.product_name)) { errors.push(`${i}번 행 product_name 없음`); return; }
    for (const f of t.ints) {
      const v = r[f];
      if (v === undefined || v === null) continue;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0) { errors.push(`${i}번 행 ${f} 가 0 이상 정수가 아님: ${String(v)}`); return; }
    }
    byKey.set(`${d}|${r.sku_no}`, r);
  });
  return { errors: errors.slice(0, 20), clean: [...byKey.values()] };
}

async function beat(fields: Record<string, unknown>) {
  const { error } = await supabase.from("sync_heartbeat").upsert({ source: WEKEEP_HEARTBEAT, ...fields }, { onConflict: "source" });
  if (error) console.error("wekeep heartbeat:", error.message);
}

export async function ingestWekeep(source: WekeepSource, rows: unknown, today: string): Promise<IngestResult> {
  if (!Array.isArray(rows)) return { status: 400, body: { error: "rows 가 배열이 아닙니다" } };
  // 0건은 성공이 아니다. 못 읽은 것과 없는 것을 여기서 구분할 수 없다
  if (rows.length === 0) return { status: 400, body: { error: "rows 가 비었습니다" } };
  if (rows.length > MAX_ROWS) return { status: 413, body: { error: `한 번에 ${MAX_ROWS}행까지. 나눠 보내세요`, got: rows.length } };
  const { errors, clean } = validateWekeepRows(source, rows, today);
  if (errors.length) {
    await beat({ last_run: new Date().toISOString(), ok: false, note: `${source} 검증 실패: ${errors[0]}`.slice(0, 300) });
    return { status: 400, body: { error: "검증 실패. 아무것도 쓰지 않았습니다", errors } };
  }

  const t = TARGET[source];
  const now = new Date().toISOString();
  let written = 0;
  try {
    for (let i = 0; i < clean.length; i += CHUNK) {
      const slice = clean.slice(i, i + CHUNK);
      const { error } = await supabase.from(t.table).upsert(slice, { onConflict: t.onConflict });
      if (error) throw new Error(error.message);
      written += slice.length;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await beat({ last_run: now, ok: false, note: `${source} 저장 실패(${written}/${clean.length}행 뒤): ${msg}`.slice(0, 300) });
    return { status: 500, body: { error: "저장 실패", message: msg, table: t.table, written } };
  }
  const latest = clean.reduce<string>((m, r) => (String(r[t.dateCol]) > m ? String(r[t.dateCol]) : m), "");
  // 스냅샷이 화면의 "오늘 재고" 라 신선도(latest_data_date)는 스냅샷 날짜로만 올린다
  await beat({
    last_run: now, last_success: now, ok: true, rows_written: written,
    ...(source === "wekeep-snapshot" ? { latest_data_date: latest } : {}),
    note: `${source} ${written}행 (~${latest})`,
  });
  return { status: 200, body: { ok: true, table: t.table, written, deduped: rows.length - clean.length, latest } };
}
