// 수집기 원천 받기의 규칙 (2026-11-10). DB 를 모르는 순수 모듈이라 node 시험(scripts/tests/wekeep-ingest.test.mjs)이 그대로 부른다.
// 실제 DB 연결은 src/lib/wekeep-ingest.ts 가 넘긴다.
//
// 처음엔 위킵 재고(wekeep-snapshot · wekeep-daily)만 받았다. 같은 날 쿠팡 로켓그로스 재고(coupang-rg-inventory ·
// coupang-rg-sku-map)를 같은 검증 수준으로 받으려고 소스마다 표·키 열·심박을 고르게 넓혔다. 위킵 쪽 규칙은 그대로다.
//
// 받는 모양: { source, rows: [...] } 행 열 이름 = DB 열 이름
//   위킵: docs/sql/2026-11-10-inventory.sql, 볼트 수집기 wekeep-inventory.mjs toDbRows
//   쿠팡 RG: docs/sql/2026-11-10-coupang-rg.sql, 볼트 수집기 coupang-rg-inventory.mjs toDbRows
// 검증 단계에서 DB 가 거절할 것을 먼저 잡는다(날짜 실제성·범위, NOT NULL 칸, 0 이상 정수, 키 형식, read_at·이름 형식).
// 하나라도 걸리면 아무것도 안 쓰고 400. 같은 키가 한 요청에 두 번 오면 뒤엣것을 쓴다(한 upsert 안 중복 키는 DB 가 거부).
// 성공·실패 모두 sync_heartbeat 에 소스의 심박(wekeep-inventory · coupang-rg-inventory)을 남긴다.
// 심박 쓰기가 실패하면 응답에 heartbeat_error 로 알린다.

export const WEKEEP_SOURCES = ["wekeep-snapshot", "wekeep-daily"] as const;
export type WekeepSource = (typeof WEKEEP_SOURCES)[number];
export const isWekeepSource = (s: unknown): s is WekeepSource => typeof s === "string" && (WEKEEP_SOURCES as readonly string[]).includes(s);
export const WEKEEP_HEARTBEAT = "wekeep-inventory";

export const COUPANG_RG_SOURCES = ["coupang-rg-inventory", "coupang-rg-sku-map"] as const;
export const COUPANG_RG_HEARTBEAT = "coupang-rg-inventory";

/** 이 모듈이 받는 수집기 원천 전부. x-ppmi-key(수집기 키)가 있어야 받는다 */
export const COLLECTOR_SOURCES = [...WEKEEP_SOURCES, ...COUPANG_RG_SOURCES] as const;
export type CollectorSource = (typeof COLLECTOR_SOURCES)[number];
export const isCollectorSource = (s: unknown): s is CollectorSource => typeof s === "string" && (COLLECTOR_SOURCES as readonly string[]).includes(s);

/** 한 요청 최대 행. 백필은 수집기가 달 단위로 나눠 보낸다 */
export const MAX_ROWS = 20000;
/** 이보다 이른 날짜는 잘못 읽은 것으로 본다(위킵 이용 시작보다 앞) */
export const MIN_DATE = "2025-01-01";
const CHUNK = 500;
const NAME_MAX = 500;

const SKU_RE = /^[0-9A-Za-z_-]{1,40}$/;
const isSku = (v: unknown) => typeof v === "string" && SKU_RE.test(v);
/** 쿠팡 옵션 ID(vendorItemId). int4 를 넘는 수(96117368113)라 DB 는 bigint */
const isVendorItemId = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

interface Target {
  table: string;
  /** 날짜 열. null = 날짜 없는 표(짝짓기 표) */
  dateCol: string | null;
  onConflict: string;
  /** 한 요청 안 중복을 가르는 키 열(onConflict 와 같은 열) */
  keyCols: string[];
  /** 키 열 형식 검사 */
  keyChecks: Record<string, (v: unknown) => boolean>;
  /** 0 이상 정수(없으면 null 허용) */
  ints: string[];
  /** 1 이상 정수(필수) */
  positiveInts?: string[];
  bools?: string[];
  /** 배열(jsonb) */
  arrays?: string[];
  required: string[];
  allowed: readonly string[];
  heartbeat: string;
  /** 성공하면 심박 latest_data_date 를 이 소스의 마지막 날짜로 올린다(화면의 「오늘 재고」인 소스만) */
  freshness: boolean;
}

export const TARGET: Record<CollectorSource, Target> = {
  "wekeep-snapshot": {
    table: "raw_wekeep_snapshot", dateCol: "date", onConflict: "date,sku_no", keyCols: ["date", "sku_no"], keyChecks: { sku_no: isSku },
    ints: ["available_qty", "safe_qty", "reserve_qty", "faulty_qty", "damage_qty", "in_customs_qty", "before_delivery_qty"],
    required: ["date", "sku_no", "product_name", "available_qty"],
    allowed: ["date", "sku_no", "product_name", "variation", "barcode", "supplier_name", "available_qty", "safe_qty", "reserve_qty",
      "faulty_qty", "damage_qty", "in_customs_qty", "before_delivery_qty", "daily_avg_shipout_qty", "month_avg_shipout_qty",
      "sku_turnover", "read_at", "source"],
    heartbeat: WEKEEP_HEARTBEAT, freshness: true,
  },
  "wekeep-daily": {
    table: "raw_wekeep_daily", dateCol: "ymd", onConflict: "ymd,sku_no", keyCols: ["ymd", "sku_no"], keyChecks: { sku_no: isSku },
    ints: ["shipin_qty", "shipout_qty", "return_shipin_qty", "faulty_shipin_qty", "damage_shipin_qty", "center_qty"],
    required: ["ymd", "sku_no", "shipin_qty", "shipout_qty", "return_shipin_qty", "faulty_shipin_qty", "damage_shipin_qty", "center_qty"],
    allowed: ["ymd", "sku_no", "product_name", "barcode", "shipin_qty", "shipout_qty", "return_shipin_qty", "faulty_shipin_qty",
      "damage_shipin_qty", "center_qty", "read_at"],
    heartbeat: WEKEEP_HEARTBEAT, freshness: false,
  },
  // 쿠팡 로켓그로스 창고 재고(옵션 묶음 단위). sales_* 는 순판매(판매 − 취소), cancelled_30d 는 취소 수량(쿠팡은 음수로 주지만 양수로 바꿔 받음)
  "coupang-rg-inventory": {
    table: "raw_coupang_rg_inventory", dateCol: "date", onConflict: "date,vendor_item_id", keyCols: ["date", "vendor_item_id"],
    keyChecks: { vendor_item_id: isVendorItemId },
    ints: ["orderable", "inbound", "days_of_cover", "sales_7d", "sales_30d", "cancelled_30d"],
    bools: ["sale_suspended", "hidden_by_vendor"],
    arrays: ["inbounds"],
    required: ["date", "vendor_item_id", "orderable", "inbound", "sale_suspended"],
    allowed: ["date", "vendor_item_id", "product_name", "option_name", "sale_suspended", "hidden_by_vendor", "orderable", "inbound",
      "inbounds", "days_of_cover", "health_group", "sales_7d", "sales_30d", "cancelled_30d", "read_at"],
    heartbeat: COUPANG_RG_HEARTBEAT, freshness: true,
  },
  // 옵션 → 위킵 SKU 짝짓기(볼트 raw/coupang-rg/coupang-rg-sku-map.draft.json 이 정본, 수집기가 매번 통째로 다시 보냄)
  "coupang-rg-sku-map": {
    table: "coupang_rg_sku_map", dateCol: null, onConflict: "vendor_item_id,sku_no", keyCols: ["vendor_item_id", "sku_no"],
    keyChecks: { vendor_item_id: isVendorItemId, sku_no: isSku },
    ints: [], positiveInts: ["qty"], bools: ["needs_review"],
    required: ["vendor_item_id", "sku_no", "qty"],
    allowed: ["vendor_item_id", "sku_no", "qty", "component", "needs_review", "note"],
    heartbeat: COUPANG_RG_HEARTBEAT, freshness: false,
  },
};

function isRealDate(ymd: unknown): ymd is string {
  if (typeof ymd !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const d = new Date(`${ymd}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === ymd;
}
const isTimestamp = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v));
const isText = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.length <= NAME_MAX);
const TEXT_COLS = ["product_name", "option_name", "component", "note", "health_group"];

/** 한 행 검사. 문제가 있으면 사유, 없으면 null */
function rowProblem(t: Target, r: Record<string, unknown>, today: string): string | null {
  const extra = Object.keys(r).filter((k) => !t.allowed.includes(k));
  if (extra.length) return `모르는 칸: ${extra.join(", ")}`;
  const nulls = t.required.filter((k) => r[k] === null || r[k] === undefined || r[k] === "");
  if (nulls.length) return `빈 필수 칸: ${nulls.join(", ")}`;
  if (t.dateCol) {
    const d = r[t.dateCol];
    if (!isRealDate(d)) return `${t.dateCol} 가 실제 날짜가 아님: ${String(d)}`;
    if (d > today) return `미래 날짜: ${d}`;
    if (d < MIN_DATE) return `너무 이른 날짜(${MIN_DATE} 이전): ${d}`;
  }
  for (const [k, ok] of Object.entries(t.keyChecks)) if (!ok(r[k])) return `${k} 형식 이상: ${String(r[k])}`;
  for (const k of TEXT_COLS) if (k in r && !isText(r[k])) return `${k} 이 ${NAME_MAX}자 이하 글자가 아님`;
  if (r.read_at !== undefined && r.read_at !== null && !isTimestamp(r.read_at)) return `read_at 이 시각 형식이 아님: ${String(r.read_at)}`;
  for (const f of t.ints) {
    const v = r[f];
    if (v === undefined || v === null) continue;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) return `${f} 가 0 이상 정수가 아님: ${String(v)}`;
  }
  for (const f of t.positiveInts ?? []) {
    const v = r[f];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1) return `${f} 가 1 이상 정수가 아님: ${String(v)}`;
  }
  for (const f of t.bools ?? []) if (r[f] !== undefined && r[f] !== null && typeof r[f] !== "boolean") return `${f} 가 참/거짓이 아님: ${String(r[f])}`;
  for (const f of t.arrays ?? []) if (r[f] !== undefined && r[f] !== null && !Array.isArray(r[f])) return `${f} 가 배열이 아님`;
  return null;
}

/** 검증 + 중복 키 정리. 문제 목록(최대 20개)과 정리된 행 */
export function validateCollectorRows(source: CollectorSource, rows: readonly unknown[], today: string): { errors: string[]; clean: Record<string, unknown>[]; deduped: number } {
  const t = TARGET[source];
  const errors: string[] = [];
  const byKey = new Map<string, Record<string, unknown>>();
  rows.forEach((raw, i) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) { errors.push(`${i}번 행이 객체가 아님`); return; }
    const r = raw as Record<string, unknown>;
    const why = rowProblem(t, r, today);
    if (why) { errors.push(`${i}번 행 ${why}`); return; }
    byKey.set(t.keyCols.map((k) => String(r[k])).join("|"), r);
  });
  return { errors: errors.slice(0, 20), clean: [...byKey.values()], deduped: rows.length - byKey.size };
}
/** 옛 이름(위킵 시험이 부름) */
export const validateWekeepRows = validateCollectorRows;

/** DB 에 하는 일 두 가지. 실제는 supabase, 시험은 가짜 */
export interface IngestDb {
  upsert(table: string, rows: Record<string, unknown>[], onConflict: string): PromiseLike<{ error: { message: string } | null }>;
  beat(fields: Record<string, unknown>): PromiseLike<{ error: { message: string } | null }>;
}
export interface IngestResult { status: number; body: Record<string, unknown> }

export async function runCollectorIngest(source: CollectorSource, rows: unknown, today: string, db: IngestDb, now = new Date().toISOString()): Promise<IngestResult> {
  const t = TARGET[source];
  const fail = async (status: number, body: Record<string, unknown>, note: string): Promise<IngestResult> => {
    const hb = await db.beat({ source: t.heartbeat, last_run: now, ok: false, note: `${source} ${note}`.slice(0, 300) });
    return { status, body: hb.error ? { ...body, heartbeat_error: hb.error.message } : body };
  };
  if (!Array.isArray(rows)) return fail(400, { error: "rows 가 배열이 아닙니다" }, "rows 가 배열이 아님");
  // 0건은 성공이 아니다. 못 읽은 것과 없는 것을 여기서 구분할 수 없다
  if (rows.length === 0) return fail(400, { error: "rows 가 비었습니다" }, "0행 받음");
  if (rows.length > MAX_ROWS) return fail(413, { error: `한 번에 ${MAX_ROWS}행까지. 나눠 보내세요`, got: rows.length }, `한도 초과 ${rows.length}행`);
  const { errors, clean, deduped } = validateCollectorRows(source, rows, today);
  if (errors.length) return fail(400, { error: "검증 실패. 아무것도 쓰지 않았습니다", errors }, `검증 실패: ${errors[0]}`);

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
  const dateCol = t.dateCol;
  const latest = dateCol ? clean.reduce<string>((m, r) => (String(r[dateCol]) > m ? String(r[dateCol]) : m), "") : "";
  // 화면의 「오늘 재고」인 소스(위킵 스냅샷·RG 재고)만 신선도(latest_data_date)를 올린다
  const hb = await db.beat({
    source: t.heartbeat, last_run: now, last_success: now, ok: true, rows_written: written,
    ...(t.freshness && latest ? { latest_data_date: latest } : {}),
    note: `${source} ${written}행${latest ? ` (~${latest})` : ""}`,
  });
  const body: Record<string, unknown> = { ok: true, table: t.table, written, deduped, ...(dateCol ? { latest } : {}) };
  if (hb.error) body.heartbeat_error = hb.error.message;
  return { status: 200, body };
}
/** 옛 이름(위킵 시험·/api/wekeep-ingest 가 부름) */
export const runWekeepIngest = runCollectorIngest;
