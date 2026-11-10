// 위킵 재고 받기의 규칙 (2026-11-10). DB 를 모르는 순수 모듈이라 node 시험(scripts/tests/wekeep-ingest.test.mjs)이 그대로 부른다.
// 실제 DB 연결은 src/lib/wekeep-ingest.ts 가 넘긴다.
//
// 받는 모양: { source: "wekeep-snapshot" | "wekeep-daily", rows: [...] } 행 열 이름 = DB 열 이름
//   (docs/sql/2026-11-10-inventory.sql, 볼트 수집기 toDbRows 와 같음).
// 검증 단계에서 DB 가 거절할 것을 먼저 잡는다(날짜 실제성·범위, NOT NULL 칸, 정수, read_at·상품명 형식).
// 하나라도 걸리면 아무것도 안 쓰고 400. 같은 키가 한 요청에 두 번 오면 뒤엣것을 쓴다(한 upsert 안 중복 키는 DB 가 거부).
// 성공·실패 모두 sync_heartbeat 에 wekeep-inventory 를 남긴다. 심박 쓰기가 실패하면 응답에 heartbeat_error 로 알린다.

export const WEKEEP_SOURCES = ["wekeep-snapshot", "wekeep-daily"] as const;
export type WekeepSource = (typeof WEKEEP_SOURCES)[number];
export const isWekeepSource = (s: unknown): s is WekeepSource => typeof s === "string" && (WEKEEP_SOURCES as readonly string[]).includes(s);
export const WEKEEP_HEARTBEAT = "wekeep-inventory";
/** 한 요청 최대 행. 백필은 수집기가 달 단위로 나눠 보낸다 */
export const MAX_ROWS = 20000;
/** 이보다 이른 날짜는 잘못 읽은 것으로 본다(위킵 이용 시작보다 앞) */
export const MIN_DATE = "2025-01-01";
const CHUNK = 500;
const NAME_MAX = 500;

interface Target { table: string; dateCol: string; onConflict: string; ints: string[]; required: string[]; allowed: readonly string[] }
export const TARGET: Record<WekeepSource, Target> = {
  "wekeep-snapshot": {
    table: "raw_wekeep_snapshot", dateCol: "date", onConflict: "date,sku_no",
    ints: ["available_qty", "safe_qty", "reserve_qty", "faulty_qty", "damage_qty", "in_customs_qty", "before_delivery_qty"],
    required: ["date", "sku_no", "product_name", "available_qty"],
    allowed: ["date", "sku_no", "product_name", "variation", "barcode", "supplier_name", "available_qty", "safe_qty", "reserve_qty",
      "faulty_qty", "damage_qty", "in_customs_qty", "before_delivery_qty", "daily_avg_shipout_qty", "month_avg_shipout_qty",
      "sku_turnover", "read_at", "source"],
  },
  "wekeep-daily": {
    table: "raw_wekeep_daily", dateCol: "ymd", onConflict: "ymd,sku_no",
    ints: ["shipin_qty", "shipout_qty", "return_shipin_qty", "faulty_shipin_qty", "damage_shipin_qty", "center_qty"],
    required: ["ymd", "sku_no", "shipin_qty", "shipout_qty", "return_shipin_qty", "faulty_shipin_qty", "damage_shipin_qty", "center_qty"],
    allowed: ["ymd", "sku_no", "product_name", "barcode", "shipin_qty", "shipout_qty", "return_shipin_qty", "faulty_shipin_qty",
      "damage_shipin_qty", "center_qty", "read_at"],
  },
};

function isRealDate(ymd: unknown): ymd is string {
  if (typeof ymd !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const d = new Date(`${ymd}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === ymd;
}
const isTimestamp = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v));

/** 검증 + 중복 키 정리. 문제 목록(최대 20개)과 정리된 행 */
export function validateWekeepRows(source: WekeepSource, rows: readonly unknown[], today: string): { errors: string[]; clean: Record<string, unknown>[]; deduped: number } {
  const t = TARGET[source];
  const errors: string[] = [];
  const byKey = new Map<string, Record<string, unknown>>();
  rows.forEach((raw, i) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) { errors.push(`${i}번 행이 객체가 아님`); return; }
    const r = raw as Record<string, unknown>;
    const extra = Object.keys(r).filter((k) => !t.allowed.includes(k));
    if (extra.length) { errors.push(`${i}번 행 모르는 칸: ${extra.join(", ")}`); return; }
    const nulls = t.required.filter((k) => r[k] === null || r[k] === undefined || r[k] === "");
    if (nulls.length) { errors.push(`${i}번 행 빈 필수 칸: ${nulls.join(", ")}`); return; }
    const d = r[t.dateCol];
    if (!isRealDate(d)) { errors.push(`${i}번 행 ${t.dateCol} 가 실제 날짜가 아님: ${String(d)}`); return; }
    if (d > today) { errors.push(`${i}번 행 미래 날짜: ${d}`); return; }
    if (d < MIN_DATE) { errors.push(`${i}번 행 너무 이른 날짜(${MIN_DATE} 이전): ${d}`); return; }
    if (typeof r.sku_no !== "string" || !/^[0-9A-Za-z_-]{1,40}$/.test(r.sku_no)) { errors.push(`${i}번 행 sku_no 형식 이상: ${String(r.sku_no)}`); return; }
    if (r.product_name !== undefined && r.product_name !== null && (typeof r.product_name !== "string" || r.product_name.length > NAME_MAX)) {
      errors.push(`${i}번 행 product_name 이 ${NAME_MAX}자 이하 글자가 아님`); return;
    }
    if (r.read_at !== undefined && r.read_at !== null && !isTimestamp(r.read_at)) { errors.push(`${i}번 행 read_at 이 시각 형식이 아님: ${String(r.read_at)}`); return; }
    for (const f of t.ints) {
      const v = r[f];
      if (v === undefined || v === null) continue;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0) { errors.push(`${i}번 행 ${f} 가 0 이상 정수가 아님: ${String(v)}`); return; }
    }
    byKey.set(`${d}|${r.sku_no}`, r);
  });
  return { errors: errors.slice(0, 20), clean: [...byKey.values()], deduped: rows.length - byKey.size };
}

/** DB 에 하는 일 두 가지. 실제는 supabase, 시험은 가짜 */
export interface IngestDb {
  upsert(table: string, rows: Record<string, unknown>[], onConflict: string): PromiseLike<{ error: { message: string } | null }>;
  beat(fields: Record<string, unknown>): PromiseLike<{ error: { message: string } | null }>;
}
export interface IngestResult { status: number; body: Record<string, unknown> }

export async function runWekeepIngest(source: WekeepSource, rows: unknown, today: string, db: IngestDb, now = new Date().toISOString()): Promise<IngestResult> {
  const fail = async (status: number, body: Record<string, unknown>, note: string): Promise<IngestResult> => {
    const hb = await db.beat({ source: WEKEEP_HEARTBEAT, last_run: now, ok: false, note: `${source} ${note}`.slice(0, 300) });
    return { status, body: hb.error ? { ...body, heartbeat_error: hb.error.message } : body };
  };
  if (!Array.isArray(rows)) return fail(400, { error: "rows 가 배열이 아닙니다" }, "rows 가 배열이 아님");
  // 0건은 성공이 아니다. 못 읽은 것과 없는 것을 여기서 구분할 수 없다
  if (rows.length === 0) return fail(400, { error: "rows 가 비었습니다" }, "0행 받음");
  if (rows.length > MAX_ROWS) return fail(413, { error: `한 번에 ${MAX_ROWS}행까지. 나눠 보내세요`, got: rows.length }, `한도 초과 ${rows.length}행`);
  const { errors, clean, deduped } = validateWekeepRows(source, rows, today);
  if (errors.length) return fail(400, { error: "검증 실패. 아무것도 쓰지 않았습니다", errors }, `검증 실패: ${errors[0]}`);

  const t = TARGET[source];
  let written = 0;
  for (let i = 0; i < clean.length; i += CHUNK) {
    const slice = clean.slice(i, i + CHUNK);
    const { error } = await db.upsert(t.table, slice, t.onConflict);
    if (error) {
      // 앞 묶음은 이미 써졌다. 몇 행이 써졌는지 응답과 심박에 남긴다(다시 보내면 자연키라 덧쌓이지 않음)
      return fail(500, { error: "저장 실패(일부만 써짐)", message: error.message, table: t.table, written, total: clean.length },
        `저장 실패: ${clean.length}행 중 ${written}행만 써짐. ${error.message}`);
    }
    written += slice.length;
  }
  const latest = clean.reduce<string>((m, r) => (String(r[t.dateCol]) > m ? String(r[t.dateCol]) : m), "");
  // 스냅샷이 화면의 "오늘 재고" 라 신선도(latest_data_date)는 스냅샷 날짜로만 올린다
  const hb = await db.beat({
    source: WEKEEP_HEARTBEAT, last_run: now, last_success: now, ok: true, rows_written: written,
    ...(source === "wekeep-snapshot" ? { latest_data_date: latest } : {}),
    note: `${source} ${written}행 (~${latest})`,
  });
  const body: Record<string, unknown> = { ok: true, table: t.table, written, deduped, latest };
  if (hb.error) body.heartbeat_error = hb.error.message;
  return { status: 200, body };
}
