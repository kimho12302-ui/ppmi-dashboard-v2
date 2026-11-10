// 재고 화면(/inventory) 계산 규칙 한 벌 (2026-11-10).
//
// 기획: 볼트 Work/PPMI/projects/마케팅-대시보드/재고-화면-기획-2026-11-10.md 「시각화 확정안 v2」.
// 읽는 쪽: /api/inventory (화면), scripts/inventory/status-report.mjs (보고용 개수·시트 대조), scripts/tests/inventory.test.mjs.
// 숫자가 화면과 보고에서 어긋나지 않게 계산은 전부 이 파일에서 한다.
//
// 이 파일은 다른 모듈을 가져오지 않는다(node --experimental-strip-types 로 그대로 시험).
//
// 원천 숫자의 뜻 (1단계 실측, 기획 「1단계 결과」)
//   - 위킵 날짜별 center_qty = 그날 **시작** 재고(전날 시작 + 전날 입고 − 전날 출고). 7~11월 98.6% 일치
//   - 위킵 일평균 = 출고가 있었던 가장 최근 한 주 출고 합 ÷ 5 (기간 평균 아님)
//   - 위킵 월평균 = 08-02~10-31(91일) 출고 합 ÷ 3
//   - 위킵은 재고도 움직임도 없는 날 행을 안 준다. 행이 빈 날은 전날 마감 재고를 이어 쓴다
//     (11-10 실측: 빈 날 185구간 중 181구간이 전날 마감 0, 나머지 4구간은 2026-02-11 위킵 쪽 하루 누락)

// ── 규칙 상수 (화면 한 줄 설명과 매뉴얼이 같은 숫자를 쓴다) ──
/** 하루 출고를 세는 기간(일). 화면에서 바꿀 수 있다 */
export const SPEED_WINDOWS = [7, 14, 28] as const;
export type SpeedWindow = (typeof SPEED_WINDOWS)[number];
export const DEFAULT_SPEED_WINDOW: SpeedWindow = 28;
/** 행마다 그리는 남은 날 막대의 축 끝(일). 넘으면 › 로 표시 */
export const RUNWAY_AXIS_DAYS = 120;
/** 시트 방식(너티) 월평균 → 하루 환산에 쓰는 한 달 일수 */
export const SHEET_MONTH_DAYS = 30.4;
/** 쿠팡 판매 속도 기간(일). 판매 동기화가 늦게 차는 날은 빼고 직전 이 일수 */
export const COUPANG_WINDOW_DAYS = 28;
/**
 * 쿠팡 판매 창 끝을 오늘에서 이만큼 앞으로 당긴다. 판매 동기화가 4~5일 늦게 차서 최근 날 판매가 덜 들어와 있을 수 있다
 * (dashboard-health.ts SALES_NORMAL_LAG_DAYS 와 같은 5일). 창 끝 = min(너티 쿠팡 판매 마지막 날, 오늘 − 5일).
 * 11-10 실측으로는 너티 쿠팡 행이 11-09 까지 평소만큼 차 있었다. 계속 그러면 줄여도 된다.
 */
export const COUPANG_SALES_LAG_DAYS = 5;
/**
 * 쿠팡 로켓그로스(RG) 판매 속도 기간(일). WING 재고현황이 주는 「최근 30일 판매」(RG 창고에서 나간 것만, 순판매)를 ÷ 30.
 * 판매 원장(product_sales) 쿠팡 전체는 판매자배송(위킵에서 나감)이 섞여 위킵 출고와 두 번 셀 수 있어 RG 값이 있으면 이쪽을 쓴다(2026-11-10).
 * 30일 안에 새로 등록된 옵션·품절 구간이 있으면 실제보다 느리게 나온다. 상세에 7일 속도를 같이 보인다.
 */
export const COUPANG_RG_SALES_DAYS = 30;
/** RG 원천 기준일이 오늘에서 이 일수보다 오래되면 쓰지 않고 손 입력·판매 원장으로 대체한다 */
export const COUPANG_RG_MAX_AGE_DAYS = 1;

export interface Thresholds {
  /** 이 일수 이하 = 발주 필요 */
  warn: number;
  /** 이 일수 이하 = 곧 발주 */
  soon: number;
  /** 이 일수 초과 = 과재고 */
  over: number;
}
/** 판정 기준 기본값. 설정 「판정 기준」에서 브랜드·공급처별로 덮어쓴다. 시트: 너티 주의 20일, 사입 15일 */
export const DEFAULT_THRESHOLDS: Record<"nutty" | "saip" | "default", Thresholds> = {
  nutty: { warn: 20, soon: 30, over: 60 },
  saip: { warn: 15, soon: 30, over: 60 },
  default: { warn: 15, soon: 30, over: 60 },
};

export type InvBrand = "nutty" | "saip" | "ironpet" | "other";
export const BRAND_LABEL: Record<InvBrand, string> = { nutty: "너티", saip: "사입", ironpet: "아이언펫", other: "기타" };

export type InvStatus = "soldout" | "order" | "soon" | "late" | "incoming" | "ok" | "over" | "nomove" | "excluded";
export const STATUS_LABEL: Record<InvStatus, string> = {
  soldout: "품절",
  order: "발주 필요",
  soon: "곧 발주",
  late: "입고 지연",
  incoming: "입고 대기",
  ok: "정상",
  over: "과재고",
  nomove: "출고 0",
  excluded: "판정 제외",
};
/**
 * 묶음: ① 지금 손댈 것 · ①′ 보류(안 팔려서 발주를 끊었을 수 있음, ① 안에 접힘) ② 정상 ③ 과재고 ④ 출고 0 ⑤ 판정 제외.
 * 보류 = 사입 품절·발주 필요 중 판매 규모 C·판매 없음·미상이고 최근 30일 위킵 출고도 0 인 것
 *   (2026-11-10 김호 "안 팔려서 더 이상 발주 안한 걸 수도"). 최근에 나간 상품은 C 라도 ① 에 남는다. 너티는 보류 없음.
 */
export type InvGroup = "act" | "hold" | "ok" | "over" | "nomove" | "excluded";
export const GROUP_ORDER: readonly InvGroup[] = ["act", "hold", "ok", "over", "nomove", "excluded"];
export const GROUP_OF: Record<InvStatus, InvGroup> = {
  soldout: "act", order: "act", soon: "act", late: "act", incoming: "act",
  ok: "ok", over: "over", nomove: "nomove", excluded: "excluded",
};
/** 판매 규모 등급 순서(정렬용). 등급 없음(null)은 C 와 판매 없음 사이 */
const GRADE_ORDER: Record<ScaleGrade | "null", number> = { A: 0, B: 1, C: 2, null: 3, none: 4 };
/** 같은 등급·같은 남은 날일 때 상태 순서 */
const ACT_ORDER: Record<InvStatus, number> = { late: 0, soldout: 1, order: 2, soon: 3, incoming: 4, ok: 5, over: 6, nomove: 7, excluded: 8 };
/** 보류로 보내는 상태와 등급(null = 미상: 출고는 있는데 원가가 없어 금액을 못 셈) */
export const HOLD_STATUSES: readonly InvStatus[] = ["soldout", "order"];
export const HOLD_GRADES: readonly (ScaleGrade | null)[] = ["C", "none", null];
/** 보류는 최근 이 일수(날짜별 마지막 날까지) 위킵 출고가 0 인 것만. 그 안에 출고가 있으면 C 라도 ① 에 남는다 */
export const HOLD_QUIET_DAYS = 30;
/** 보류를 쓰는 판매 규모 풀. 너티는 판정 상품이 6개뿐이고 전부 주력이라 쓰지 않는다(2026-11-10) */
export const HOLD_POOLS: readonly ScalePool[] = ["saip"];
/** 최근 HOLD_QUIET_DAYS 일(through 포함) 안에 위킵 출고가 있었나 */
export function shippedRecently(lastShipout: string | null, through: string | null, days = HOLD_QUIET_DAYS): boolean {
  if (!lastShipout || !through) return false;
  return lastShipout >= addDays(through, -(days - 1));
}
export function isHeld(r: Pick<InventoryRow, "status" | "scale" | "last_shipout">, through: string | null): boolean {
  return HOLD_STATUSES.includes(r.status) && r.scale.pool !== null && HOLD_POOLS.includes(r.scale.pool)
    && HOLD_GRADES.includes(r.scale.grade) && !shippedRecently(r.last_shipout, through);
}

// ── 입력 행 (DB 열 이름 그대로) ──
export interface SnapshotRow {
  date: string;
  sku_no: string;
  product_name: string;
  variation?: string | null;
  barcode?: string | null;
  supplier_name?: string | null;
  available_qty: number;
  safe_qty?: number | null;
  reserve_qty?: number | null;
  faulty_qty?: number | null;
  damage_qty?: number | null;
  in_customs_qty?: number | null;
  before_delivery_qty?: number | null;
  daily_avg_shipout_qty?: number | null;
  month_avg_shipout_qty?: number | null;
  sku_turnover?: number | null;
  read_at?: string | null;
}
export interface DailyRow {
  ymd: string;
  sku_no: string;
  shipin_qty: number;
  shipout_qty: number;
  return_shipin_qty: number;
  faulty_shipin_qty: number;
  damage_shipin_qty: number;
  /** 그날 시작 재고 */
  center_qty: number;
}
export type Confidence = "확실" | "추정" | "없음";
export interface SkuMapRow {
  sku_no: string;
  product_name?: string | null;
  barcode?: string | null;
  product_code?: string | null;
  component?: string | null;
  brand?: string | null;
  supplier?: string | null;
  confidence?: Confidence | string | null;
  confirmed?: boolean | null;
  exclude?: boolean | null;
  note?: string | null;
}
export type StockLocation = "coupang" | "transit" | "internal";
export const LOCATION_LABEL: Record<StockLocation, string> = { coupang: "쿠팡", transit: "이동 중", internal: "내부" };
export interface ManualStockRow { sku_no: string; location: StockLocation | string; qty: number; as_of: string; note?: string | null }
export type OrderStatus = "ordered" | "received" | "cancelled";
export interface OrderRow {
  id?: number;
  sku_no: string;
  qty: number;
  ordered_at: string;
  expected_at?: string | null;
  status: OrderStatus | string;
  note?: string | null;
}
export interface NoteRow { sku_no: string; kind?: string | null; note?: string | null; exclude?: boolean | null }
export interface RuleRow { scope_kind: "brand" | "supplier" | string; scope_key: string; warn_days: number; soon_days: number; over_days: number }

// ── 쿠팡 로켓그로스(RG) 재고 (docs/sql/2026-11-10-coupang-rg.sql) ──
/** RG 재고 한 줄(날짜 × 옵션). 수량은 전부 옵션 묶음 단위. sales_* 는 순판매(판매 − 취소), 통계가 없으면 null */
export interface RgInventoryRow {
  date: string;
  vendor_item_id: number | string;
  product_name?: string | null;
  option_name?: string | null;
  sale_suspended: boolean;
  hidden_by_vendor?: boolean | null;
  orderable: number;
  inbound: number;
  days_of_cover?: number | null;
  health_group?: string | null;
  sales_7d?: number | null;
  sales_30d?: number | null;
}
/** 옵션 → 위킵 SKU. qty = 옵션 한 묶음에 든 그 SKU 낱개 수. 한 옵션이 두 SKU 로 나뉠 수 있다(1+1 세트) */
export interface RgMapRow { vendor_item_id: number | string; sku_no: string; qty: number; component?: string | null; needs_review?: boolean | null; note?: string | null }
/** 상세에 보이는 옵션 한 줄(수량은 옵션 묶음 단위, units = 낱개 환산) */
export interface RgOption {
  vendor_item_id: string;
  name: string;
  qty: number;
  sale_suspended: boolean;
  needs_review: boolean;
  orderable: number;
  inbound: number;
  sales_7d: number | null;
  sales_30d: number | null;
}
/** 위킵 SKU 하나에 모인 RG 값(낱개 환산) */
export interface RgSku {
  orderable: number;
  inbound: number;
  sales_7d: number;
  sales_30d: number;
  /** 판매중지 아닌 옵션이 하나라도 있나. 없으면 쿠팡 쪽 판정에서 뺀다(지난 30일 판매만 남은 옵션이 가짜 「발주 필요」를 만들지 않게) */
  active: boolean;
  needs_review: boolean;
  options: RgOption[];
}
export interface RgUnmapped { vendor_item_id: string; name: string; orderable: number; inbound: number; sale_suspended: boolean }
/** 화면 위 한 줄과 경고에 쓰는 RG 요약 */
export interface CoupangRgSummary {
  /** RG 원천 기준일(가장 최근 날짜) */
  date: string;
  /** 기준일이 오늘 − COUPANG_RG_MAX_AGE_DAYS 이후인가. 아니면 손 입력으로 대체 */
  fresh: boolean;
  age_days: number;
  options: number;
  skus: number;
  /** 짝짓기 표에 없는 옵션 전부 */
  unmapped: RgUnmapped[];
  /** 그중 재고(판매 가능 또는 입고 중)가 있는 것. 1 이상이면 화면 경고 */
  unmapped_with_stock: RgUnmapped[];
  /** 「확인 필요」 짝으로 계산한 옵션 수 */
  needs_review: number;
}

const rgName = (r: Pick<RgInventoryRow, "product_name" | "option_name">) => `${r.product_name ?? ""} / ${r.option_name ?? ""}`;

/**
 * RG 원천 최신 날짜의 옵션을 짝짓기 표로 위킵 SKU 에 낱개 환산해 모은다(판매 가능 · 입고 중 · 7일 · 30일 순판매 × 묶음 수).
 * 원천이 없으면 null. 오래된 원천도 요약은 돌려준다(fresh=false, 계산에는 안 씀).
 */
export function summarizeCoupangRg(rows: readonly RgInventoryRow[], map: readonly RgMapRow[], today: string): { summary: CoupangRgSummary; bySku: Map<string, RgSku> } | null {
  const date = rows.reduce<string | null>((m, r) => (!m || r.date > m ? r.date : m), null);
  if (!date) return null;
  const day = rows.filter((r) => r.date === date);
  const pairs = new Map<string, RgMapRow[]>();
  for (const m of map) pairs.set(String(m.vendor_item_id), [...(pairs.get(String(m.vendor_item_id)) ?? []), m]);
  const bySku = new Map<string, RgSku>();
  const unmapped: RgUnmapped[] = [];
  let needsReview = 0;
  for (const r of day) {
    const id = String(r.vendor_item_id);
    const orderable = Number(r.orderable) || 0;
    const inbound = Number(r.inbound) || 0;
    const ps = (pairs.get(id) ?? []).filter((p) => Number(p.qty) > 0);
    if (!ps.length) { unmapped.push({ vendor_item_id: id, name: rgName(r), orderable, inbound, sale_suspended: !!r.sale_suspended }); continue; }
    if (ps.some((p) => p.needs_review)) needsReview += 1;
    const s7 = r.sales_7d ?? null;
    const s30 = r.sales_30d ?? null;
    for (const p of ps) {
      const q = Number(p.qty);
      const prev = bySku.get(p.sku_no) ?? { orderable: 0, inbound: 0, sales_7d: 0, sales_30d: 0, active: false, needs_review: false, options: [] };
      bySku.set(p.sku_no, {
        orderable: prev.orderable + orderable * q,
        inbound: prev.inbound + inbound * q,
        sales_7d: prev.sales_7d + (Number(s7) || 0) * q,
        sales_30d: prev.sales_30d + (Number(s30) || 0) * q,
        active: prev.active || !r.sale_suspended,
        needs_review: prev.needs_review || !!p.needs_review,
        options: [...prev.options, { vendor_item_id: id, name: rgName(r), qty: q, sale_suspended: !!r.sale_suspended, needs_review: !!p.needs_review,
          orderable, inbound, sales_7d: s7, sales_30d: s30 }],
      });
    }
  }
  const age = daysBetween(date, today);
  return {
    summary: {
      date, fresh: age <= COUPANG_RG_MAX_AGE_DAYS, age_days: age, options: day.length, skus: bySku.size,
      unmapped, unmapped_with_stock: unmapped.filter((u) => u.orderable > 0 || u.inbound > 0), needs_review: needsReview,
    },
    bySku,
  };
}

// ── 날짜 ──
export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}
/** 실제로 있는 날짜인지(2026-02-31 은 거절) */
export function isRealDate(ymd: unknown): ymd is string {
  if (typeof ymd !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const d = new Date(`${ymd}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === ymd;
}

export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** 띄어쓰기·대소문자만 다른 이름을 같게 본다(product-components.ts 의 productKey 와 같은 규칙). */
export function nameKey(name: string | null | undefined): string {
  return String(name ?? "").replace(/\s+/g, "").toLowerCase();
}

/**
 * 위킵 상품명 머리표에서 브랜드·공급처를 뽑는다. 위킵 공급처 칸은 전부 「-」라 쓸 수 없다(11-10 실측).
 * 「[사입][파미나]…」 → 사입·파미나, 「[마케팅용]너티…」·「너티…」 → 너티, 「아이언펫…」 → 아이언펫.
 * 「[파손]」「[마케팅용]」 머리표는 tags 로 돌려준다(판매 재고에 합칠지는 사람이 정함).
 */
export function parseWekeepName(name: string): { brand: InvBrand; supplier: string | null; tags: string[]; bare: string } {
  const tags: string[] = [];
  let rest = String(name || "").trim();
  // 맨 앞 여는 대괄호가 빠진 이름(「사입][고네이티브]…」, 11-10 위킵 실측)은 아는 머리표일 때만 머리표로 본다
  const broken = rest.match(/^(사입|파손|마케팅용)\]\s*/);
  if (broken) { tags.push(broken[1]); rest = rest.slice(broken[0].length); }
  for (;;) {
    const m = rest.match(/^\[([^\]]+)\]\s*/);
    if (!m) break;
    tags.push(m[1].trim());
    rest = rest.slice(m[0].length);
  }
  rest = rest.trim();
  const isSaip = tags.includes("사입");
  const supplierTag = isSaip ? tags.find((t) => !["사입", "파손", "마케팅용"].includes(t)) ?? null : null;
  let brand: InvBrand = "other";
  if (isSaip) brand = "saip";
  else if (/^너티/.test(rest)) brand = "nutty";
  else if (/^아이언펫/.test(rest)) brand = "ironpet";
  return { brand, supplier: isSaip ? supplierTag : brand === "nutty" ? "너티" : null, tags, bare: rest };
}

/** 「[파손]」「[마케팅용]」 머리표가 붙은 위킵 상품명(판매 재고가 아닌 따로 둔 재고) */
export function isTaggedName(name: string): boolean {
  return parseWekeepName(name).tags.some((t) => t === "파손" || t === "마케팅용");
}

export function toInvBrand(b: string | null | undefined): InvBrand | null {
  return b === "nutty" || b === "saip" || b === "ironpet" ? b : b === "other" ? "other" : null;
}

// ── 사입 브랜드 탭 (2026-11-10 김호 "사입 브랜드별로 나눠줘") ──
/** 시트 탭 순서 그대로 따로 탭을 주는 사입 브랜드. 파미나(독)·파미나(캣)은 파미나 하나, 벳라이프는 파미나와 별개 */
export const SAIP_TAB_BRANDS = ["파미나", "벳라이프", "고네이티브", "오리젠"] as const;
/** 위 넷이 아닌 사입 브랜드는 위킵 SKU 가 이 개수 이상이면 따로 탭, 모자라면 「사입 기타」로 묶는다 */
export const SAIP_OWN_TAB_MIN = 3;
/** 머리표 없이 이름이 브랜드로 시작하는 위킵 상품(「파미나 N&D 펌킨 …」)의 브랜드를 알아보는 목록 */
const SAIP_NAME_PREFIXES = ["파미나", "벳라이프", "고네이티브", "오리젠", "테라카니스", "게더", "나우"];
export const SAIP_ETC_LABEL = "사입 기타";

/** 머리표가 없는 사입 상품명에서 브랜드를 알아본다(「파미나 N&D …」 → 파미나). 모르면 null */
export function supplierFromName(bare: string): string | null {
  const s = String(bare || "").trim();
  return SAIP_NAME_PREFIXES.find((p) => s.startsWith(p)) ?? null;
}

export interface BrandTab { key: string; label: string; count: number }
/**
 * 브랜드 탭: 전체 · 너티 · 파미나 · 벳라이프 · 고네이티브 · 오리젠 · (SKU 3개 이상인 다른 사입 브랜드) · 사입 기타 · 아이언펫·기타.
 * 탭 키는 행의 brand·supplier(위킵 상품명 [사입][브랜드] 머리표와 매칭표 공급처 칸)에서 나온다. 기본 품목 이름은 쓰지 않는다
 * (「파미나 벳라이프 …」 같은 판매 상품명이 벳라이프를 파미나로 보내기 때문).
 */
export function buildBrandTabs(rows: readonly Pick<InventoryRow, "brand" | "supplier">[]): BrandTab[] {
  const bySupplier = new Map<string, number>();
  for (const r of rows) if (r.brand === "saip") bySupplier.set(r.supplier || "", (bySupplier.get(r.supplier || "") ?? 0) + 1);
  const fixed: string[] = [...SAIP_TAB_BRANDS];
  const extra = [...bySupplier].filter(([s, n]) => s && !fixed.includes(s) && n >= SAIP_OWN_TAB_MIN)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko")).map(([s]) => s);
  const own = [...fixed, ...extra];
  const etc = [...bySupplier].filter(([s]) => !own.includes(s)).reduce((a, [, n]) => a + n, 0);
  const count = (k: string) => rows.filter((r) => inBrandTab(r, k, own)).length;
  return [
    { key: "all", label: "전체", count: rows.length },
    { key: "nutty", label: "너티", count: count("nutty") },
    ...own.map((s) => ({ key: `saip:${s}`, label: s, count: bySupplier.get(s) ?? 0 })),
    ...(etc ? [{ key: "saip:*", label: SAIP_ETC_LABEL, count: etc }] : []),
    { key: "other", label: "아이언펫·기타", count: count("other") },
  ].filter((t) => t.key === "all" || t.count > 0);
}
/** 행이 탭에 드는지. own = 따로 탭을 가진 사입 브랜드(buildBrandTabs 와 같은 목록) */
export function inBrandTab(r: Pick<InventoryRow, "brand" | "supplier">, key: string, own: readonly string[]): boolean {
  if (key === "all") return true;
  if (key === "nutty") return r.brand === "nutty";
  if (key === "other") return r.brand === "ironpet" || r.brand === "other";
  if (r.brand !== "saip") return false;
  if (key === "saip:*") return !own.includes(r.supplier || "");
  return key === `saip:${r.supplier || ""}`;
}
/** buildBrandTabs 결과에서 따로 탭을 가진 사입 브랜드 목록 */
export const ownSaipTabs = (tabs: readonly BrandTab[]) => tabs.filter((t) => t.key.startsWith("saip:") && t.key !== "saip:*").map((t) => t.key.slice(5));

// ── 판매 규모 등급 (ABC 분석, 2026-11-10 김호 "판매량이 높은 거 가중치 줘. 품절이 무조건 중요한 건 아님") ──
/** 판매 규모를 세는 기간(일). 판매 동기화 지연(COUPANG_SALES_LAG_DAYS) 앞에서 끝난다 */
export const SALES_SCALE_DAYS = 90;
/** 누적 비중 경계. 자기 앞 누적이 80% 미만이면 A(80% 선을 넘기는 그 상품까지 A), 95% 미만이면 B, 나머지 C */
export const ABC_A_SHARE = 0.8;
export const ABC_B_SHARE = 0.95;
export type ScaleGrade = "A" | "B" | "C" | "none";
export const SCALE_LABEL: Record<ScaleGrade, string> = { A: "A", B: "B", C: "C", none: "판매 없음" };
/** 등급을 매기는 풀. 사입 전체 · 너티 각각(브랜드 탭 안에서가 아님). 아이언펫·기타는 등급 없음 */
export type ScalePool = "saip" | "nutty";
export const SCALE_POOL_LABEL: Record<ScalePool, string> = { saip: "사입 전체", nutty: "너티" };

/**
 * 누적 비중 등급. 값 큰 순으로 늘어놓고 자기 **앞** 누적 / 합계로 가른다(값이 같으면 같은 등급).
 * 0 이하 값은 「판매 없음」. 비교는 원 단위 정수로(소수 찌꺼기로 경계가 흔들리지 않게).
 */
export function gradeByCumulative(items: readonly { key: string; value: number }[]): Map<string, { grade: ScaleGrade; before: number; share: number; rank: number }> {
  const out = new Map<string, { grade: ScaleGrade; before: number; share: number; rank: number }>();
  const pos = items.map((i) => ({ key: i.key, value: Math.round(i.value) })).filter((i) => i.value > 0)
    .sort((a, b) => b.value - a.value || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const total = pos.reduce((a, i) => a + i.value, 0);
  let before = 0;
  let runBefore = 0;
  let runValue: number | null = null;
  pos.forEach((i, idx) => {
    if (i.value !== runValue) { runBefore = before; runValue = i.value; }
    const grade: ScaleGrade = runBefore < ABC_A_SHARE * total ? "A" : runBefore < ABC_B_SHARE * total ? "B" : "C";
    out.set(i.key, { grade, before: total ? runBefore / total : 0, share: total ? i.value / total : 0, rank: idx + 1 });
    before += i.value;
  });
  for (const i of items) if (!out.has(i.key)) out.set(i.key, { grade: "none", before: 1, share: 0, rank: 0 });
  return out;
}

export interface SalesScale {
  /** 등급을 매긴 풀. null = 등급 대상 아님(아이언펫·기타·판정 제외) 또는 판매 원장을 못 읽음 */
  pool: ScalePool | null;
  /** null = 등급 없음(대상 아님, 못 읽음, 출고는 있는데 원가가 없어 금액을 못 셈) */
  grade: ScaleGrade | null;
  /** sales = 90일 판매 매출, shipout = 판매 매출이 안 붙어 위킵 90일 출고 × 원가로 대신, none = 둘 다 0, unknown = 금액을 못 셈 */
  basis: "sales" | "shipout" | "none" | "unknown";
  /** 등급에 쓴 금액(원). unknown 이면 null */
  value: number | null;
  /** 이 SKU 에 붙은 90일 판매 매출(같은 기본 품목 SKU 가 여럿이면 나눈 몫) */
  revenue: number;
  /** 이 SKU 에 붙은 90일 판매 수량(낱개) */
  sold_qty: number;
  /** 같은 기간 위킵 출고 합 */
  shipout: number;
  /** 같은 기본 품목을 나눈 SKU 수(1 = 혼자) */
  shared_with: number;
  /** 풀 안 순위·앞 누적 비중·자기 비중 */
  rank: number | null;
  before: number | null;
  share: number | null;
}

/** 판정 기준: 공급처 → 브랜드 → 기본값 순으로 찾는다 */
export function thresholdsFor(brand: InvBrand, supplier: string | null, rules: readonly RuleRow[]): Thresholds & { basis: string } {
  const pick = (r: RuleRow | undefined) => r && { warn: Number(r.warn_days), soon: Number(r.soon_days), over: Number(r.over_days) };
  const bySupplier = supplier ? pick(rules.find((r) => r.scope_kind === "supplier" && r.scope_key === supplier)) : null;
  if (bySupplier) return { ...bySupplier, basis: `공급처 ${supplier}` };
  const byBrand = pick(rules.find((r) => r.scope_kind === "brand" && r.scope_key === brand));
  if (byBrand) return { ...byBrand, basis: `브랜드 ${BRAND_LABEL[brand]}` };
  const def = brand === "nutty" || brand === "saip" ? DEFAULT_THRESHOLDS[brand] : DEFAULT_THRESHOLDS.default;
  return { ...def, basis: "기본값" };
}

/** 같은 날 같은 SKU 가 두 행으로 오면(출고 행 + 센터재고 행) 더해서 한 행으로. 새 배열을 돌려준다 */
export function mergeDailyRows(rows: readonly DailyRow[]): DailyRow[] {
  const out = new Map<string, DailyRow>();
  for (const r of rows) {
    const k = `${r.ymd}|${r.sku_no}`;
    const p = out.get(k);
    if (!p) { out.set(k, { ...r }); continue; }
    out.set(k, {
      ...p,
      shipin_qty: p.shipin_qty + r.shipin_qty,
      shipout_qty: p.shipout_qty + r.shipout_qty,
      return_shipin_qty: p.return_shipin_qty + r.return_shipin_qty,
      faulty_shipin_qty: p.faulty_shipin_qty + r.faulty_shipin_qty,
      damage_shipin_qty: p.damage_shipin_qty + r.damage_shipin_qty,
      center_qty: p.center_qty + r.center_qty,
    });
  }
  return [...out.values()];
}

/** 그날 들어온 것 전부(입고 + 반품 + 하자입고 + 파손입고) */
export const inflowOf = (r: DailyRow) => r.shipin_qty + r.return_shipin_qty + r.faulty_shipin_qty + r.damage_shipin_qty;
/** 그날 마감 재고 = 시작 + 들어온 것 − 출고 */
export const endOfDay = (r: DailyRow) => r.center_qty + inflowOf(r) - r.shipout_qty;

export interface SpeedResult { from: string; to: string; days: number; total: number; perDay: number }
/** 하루 출고 = 기간 출고 합 ÷ 기간 일수. 기간 끝은 to(수집된 마지막 완결일), 행 없는 날은 출고 0 */
export function shipoutSpeed(rows: readonly DailyRow[], to: string, days: number): SpeedResult {
  const from = addDays(to, -(days - 1));
  let total = 0;
  for (const r of rows) if (r.ymd >= from && r.ymd <= to) total += r.shipout_qty;
  return { from, to, days, total, perDay: total / days };
}

export interface DayPoint {
  date: string;
  /** 그날 시작 재고. 행이 없으면 전날 마감을 이어 씀 */
  start: number;
  shipin: number;
  shipout: number;
  returned: number;
  faulty: number;
  damage: number;
  /** 위킵이 이 날 행을 줬는지 */
  hasRow: boolean;
}
/** 상세 그래프용: 기간 전체 날짜를 빠짐없이. 움직임 없는 날은 입고·출고 0 */
export function fillDailySeries(rows: readonly DailyRow[], from: string, to: string): DayPoint[] {
  const sorted = [...rows].sort((a, b) => (a.ymd < b.ymd ? -1 : a.ymd > b.ymd ? 1 : 0));
  const byDay = new Map(sorted.map((r) => [r.ymd, r]));
  // from 이전 마지막 행의 마감 재고에서 시작한다
  let carry = 0;
  for (const r of sorted) { if (r.ymd >= from) break; carry = endOfDay(r); }
  const out: DayPoint[] = [];
  for (const d of dateRange(from, to)) {
    const r = byDay.get(d);
    if (r) {
      out.push({ date: d, start: r.center_qty, shipin: r.shipin_qty, shipout: r.shipout_qty, returned: r.return_shipin_qty,
        faulty: r.faulty_shipin_qty, damage: r.damage_shipin_qty, hasRow: true });
      carry = endOfDay(r);
    } else {
      out.push({ date: d, start: carry, shipin: 0, shipout: 0, returned: 0, faulty: 0, damage: 0, hasRow: false });
    }
  }
  return out;
}

/** 남은 날. 속도 0 이면 null(계산 불가) */
export function runwayDays(stock: number, perDay: number): number | null {
  if (!(perDay > 0)) return null;
  return Math.max(0, stock) / perDay;
}

export function statusFromRunway(runway: number, t: Thresholds): "order" | "soon" | "ok" | "over" {
  if (runway <= t.warn) return "order";
  if (runway <= t.soon) return "soon";
  if (runway > t.over) return "over";
  return "ok";
}

// ── 한 SKU 의 판정 ──
export interface InventoryRow {
  sku_no: string;
  name: string;
  bare_name: string;
  tags: string[];
  brand: InvBrand;
  supplier: string | null;
  component: string | null;
  product_code: string | null;
  barcode: string | null;
  confidence: string;
  confirmed: boolean;
  /** 위킵 가용 재고(스냅샷) */
  available: number;
  safe: number;
  reserve: number;
  faulty: number;
  /** 쿠팡 재고(낱개). WING RG 원천이 새로우면 그 값, 아니면 손 입력. null = 둘 다 없음(0 과 다름) */
  coupang: number | null;
  coupang_as_of: string | null;
  /** 쿠팡 재고 출처: wing = WING 로켓그로스 재고현황 자동값, manual = 설정 손 입력, null = 없음 */
  coupang_source: "wing" | "manual" | null;
  /** 쿠팡 입고 중(낱개, WING 값일 때만). 남은 날에는 안 넣는다 */
  coupang_inbound: number | null;
  /** 쿠팡 판매 속도 근거: wing30 = RG 30일 순판매 ÷ 30, sales = 판매 원장 쿠팡(옛 방식), null = 없음 */
  coupang_speed_basis: "wing30" | "sales" | null;
  /** 쿠팡 쪽 한 줄 사정(판매 중인 옵션 없음, WING 값이 오래돼 손 입력을 씀 …). 없으면 null */
  coupang_note: string | null;
  /** WING 값을 쓸 때 옵션별 내역(상세) */
  coupang_rg: RgSku | null;
  /** (쿠팡 재고 + 입고 중) ÷ 쿠팡 하루 판매. 보조값(판정에 안 씀) */
  runway_coupang_with_inbound: number | null;
  transit: number | null;
  internal: number | null;
  other_as_of: string | null;
  /** 위킵 + 쿠팡 + 이동 + 내부 (미입력은 0 으로 더하되 칸에는 미입력으로 보임) */
  total_stock: number;
  incoming: { qty: number; expected_at: string | null; ordered_at: string; id: number | null } | null;
  /** 위킵 하루 출고(최근 window 일) */
  speed: SpeedResult;
  /** 시트 방식 하루 출고(나란히 보기용). 너티 = 위킵 월평균 ÷ 30.4, 그 외 = 위킵 일평균 */
  sheet_per_day: number | null;
  sheet_basis: string;
  /** 쿠팡 하루 판매(낱개 환산). 너티만, 쿠팡 재고가 입력된 SKU 만 쓴다 */
  coupang_per_day: number | null;
  /** (위킵 + 이동 + 내부) ÷ 위킵 하루 출고 */
  runway_wekeep: number | null;
  /** 쿠팡 재고 ÷ 쿠팡 하루 판매 */
  runway_coupang: number | null;
  /** 판정에 쓴 남은 날(둘 중 짧은 쪽) */
  runway: number | null;
  /** 입고 예정 수량까지 더한 남은 날(발주 입력이 있을 때) */
  runway_with_incoming: number | null;
  stockout_date: string | null;
  status: InvStatus;
  /** 발주 입력을 반영하기 전 상태(입고 대기·입고 지연이면 그 밑의 품절·발주 필요·곧 발주) */
  base_status: InvStatus;
  /** 너티인데 쿠팡 재고 미입력 */
  coupang_missing: boolean;
  group: InvGroup;
  /** 판정 이유 한 줄 */
  reason: string;
  thresholds: Thresholds & { basis: string };
  unit_cost: number | null;
  cost_basis: string | null;
  value: number | null;
  note: string | null;
  note_kind: string | null;
  /** 시트 방식으로 판정했을 때(같은 기준 일수) */
  sheet_runway: number | null;
  sheet_status: InvStatus;
  /** 판매 규모 등급(ABC) */
  scale: SalesScale;
  /** 품절·발주 필요인데 판매 규모 C·판매 없음이라 ① 에서 빼 보류 묶음으로 보냄 */
  held: boolean;
  /** 읽은 날짜별 안에서 마지막으로 위킵 출고가 있던 날(보류 행에 같이 보임). 없으면 null */
  last_shipout: string | null;
}

export interface ComputeInput {
  snapshot: readonly SnapshotRow[];
  daily: readonly DailyRow[];
  map: readonly SkuMapRow[];
  stocks?: readonly ManualStockRow[];
  orders?: readonly OrderRow[];
  notes?: readonly NoteRow[];
  rules?: readonly RuleRow[];
  /** SKU 원가(inventory_costs, 시트 원가가 정본). 없으면 그 SKU 는 「원가 없음」 */
  skuCosts?: readonly SkuCostRow[];
  /**
   * 쿠팡 로켓그로스 원천(최신 날짜 행만 넘겨도, 여러 날을 넘겨도 됨)과 옵션 → SKU 짝짓기. 없거나 기준일이 오래되면
   * 손 입력 쿠팡 재고와 판매 원장 쿠팡 판매 속도로 대체한다
   */
  coupangRg?: { rows: readonly RgInventoryRow[]; map: readonly RgMapRow[] } | null;
  /** 너티 쿠팡 판매(기본 품목 낱개 수량, 기간 합). component 이름 그대로 */
  coupangSales?: readonly { component: string; qty: number }[];
  coupangWindow?: { from: string; to: string; days: number } | null;
  /** 판매 구성표에 없어 쿠팡 판매 속도에서 빠진 너티 쿠팡 판매 상품(이름 · 수량 합) */
  coupangUnmapped?: { products: string[]; qty: number } | null;
  /**
   * 판매 규모(ABC) 재료. 너티·사입 판매 원장 90일(판매 동기화 지연 앞)을 기본 품목으로 푼 매출·수량 합(공구 채널 제외).
   * 없거나 null 이면 등급을 매기지 않는다(못 읽은 것을 「판매 없음」으로 보지 않음). daily 는 이 기간을 덮어야 출고 대체값이 맞다
   */
  salesScale?: SalesScaleInput | null;
  window?: number;
  /** 오늘(KST). 입고 예정일이 지났는지, 미래 기준일 손 입력을 거를 때 쓴다. 없으면 스냅샷 날짜 */
  today?: string;
}

export interface SalesScaleInput {
  window: { from: string; to: string; days: number };
  byComponent: readonly { component: string; revenue: number; qty: number }[];
  /** 공구 채널이라 뺀 판매 행(0 이면 뺀 것 없음) */
  gonggu_excluded?: { rows: number; revenue: number };
  /** 판매 구성표에 없어 기본 품목으로 못 푼 판매 상품(등급에서 빠짐) */
  unmapped?: { products: string[]; revenue: number } | null;
}

export interface InventoryCards {
  counts: Record<InvStatus, number>;
  /**
   * 카드 숫자: 입고 지연은 밑의 상태로 품절·발주 필요 카드에 더한다(곧 발주였던 지연은 발주 필요로).
   * 품절·발주 필요는 보류(판매 규모 C·판매 없음)를 빼고 세고, 뺀 개수는 held_* 로 따로 둔다
   */
  card: { soldout: number; order: number; soon: number; over: number; late: number; incoming: number; held_soldout: number; held_order: number };
  value_total: number;
  value_by_brand: Record<InvBrand, number>;
  /** 원가가 없어 재고 가치에서 빠진 SKU 수(재고가 있는 것만) */
  missing_cost: number;
  missing_cost_by_brand: Record<InvBrand, number>;
}

export interface InventoryResult {
  as_of: string | null;
  read_at: string | null;
  daily_through: string | null;
  window: SpeedResult["days"];
  window_from: string | null;
  coupang_window: { from: string; to: string; days: number } | null;
  coupang_unmapped: { products: string[]; qty: number } | null;
  /** 쿠팡 로켓그로스 원천 요약. null = 원천 없음(표가 없거나 아직 안 보냄) */
  coupang_rg: CoupangRgSummary | null;
  /** 판매 규모 등급 기준(화면 한 줄 설명). null = 판매 원장을 못 읽어 등급 없음 */
  scale: {
    window: { from: string; to: string; days: number };
    pools: Record<ScalePool, { total: number; graded: number; counts: Record<ScaleGrade, number>; shipout_basis: number; unknown: number }>;
    gonggu_excluded: { rows: number; revenue: number };
    unmapped: { products: string[]; revenue: number } | null;
    /** 위킵 SKU 에 안 붙은 판매(등급 풀 밖) */
    unattached: UnattachedSales;
  } | null;
  rows: InventoryRow[];
  cards: InventoryCards;
}

function latestBy<T>(rows: readonly T[], key: (r: T) => string, date: (r: T) => string): Map<string, T> {
  const m = new Map<string, T>();
  for (const r of rows) {
    const k = key(r);
    const p = m.get(k);
    if (!p || date(r) > date(p)) m.set(k, r);
  }
  return m;
}

/** 기간 끝: 수집된 날짜별 마지막 날, 단 스냅샷 날(오늘, 출고 진행 중)은 뺀다 */
export function dailyThrough(daily: readonly DailyRow[], snapshotDate: string | null): string | null {
  let max: string | null = null;
  for (const r of daily) {
    if (snapshotDate && r.ymd >= snapshotDate) continue;
    if (!max || r.ymd > max) max = r.ymd;
  }
  return max;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * 쿠팡 판매 기간: 끝 = min(너티 쿠팡 판매 마지막 날, 오늘 − 지연 일수), 길이 = days.
 * 판매 원장이 아예 없으면 null(쿠팡 쪽 계산 안 함).
 */
export function coupangWindowFor(lastSaleDate: string | null, today: string, lagDays = COUPANG_SALES_LAG_DAYS, days = COUPANG_WINDOW_DAYS):
  { from: string; to: string; days: number } | null {
  if (!lastSaleDate) return null;
  const lagEnd = addDays(today, -lagDays);
  const to = lastSaleDate < lagEnd ? lastSaleDate : lagEnd;
  return { from: addDays(to, -(days - 1)), to, days };
}

export function computeInventory(input: ComputeInput): InventoryResult {
  const window = input.window ?? DEFAULT_SPEED_WINDOW;
  const rules = input.rules ?? [];
  const asOf = input.snapshot.reduce<string | null>((m, r) => (!m || r.date > m ? r.date : m), null);
  const snap = input.snapshot.filter((r) => r.date === asOf);
  const today = input.today ?? asOf ?? "9999-12-31";
  const daily = mergeDailyRows(input.daily);
  const through = dailyThrough(daily, asOf);
  const dailyBySku = new Map<string, DailyRow[]>();
  for (const r of daily) {
    const list = dailyBySku.get(r.sku_no) ?? [];
    list.push(r);
    dailyBySku.set(r.sku_no, list);
  }
  const mapBySku = new Map(input.map.map((m) => [m.sku_no, m]));
  // 미래 기준일 손 입력은 쓰지 않는다(오타 한 줄이 최신값을 영원히 덮지 않게)
  const stockBy = latestBy((input.stocks ?? []).filter((s) => s.as_of <= today), (s) => `${s.sku_no}|${s.location}`, (s) => s.as_of);
  const noteBySku = new Map((input.notes ?? []).map((n) => [n.sku_no, n]));
  const openOrders = new Map<string, OrderRow[]>();
  for (const o of input.orders ?? []) {
    if (o.status !== "ordered") continue;
    const list = openOrders.get(o.sku_no) ?? [];
    list.push(o);
    openOrders.set(o.sku_no, list);
  }
  // 원가는 SKU 로만 찾는다. 0 원 이하는 원가 없음
  const costBySku = new Map((input.skuCosts ?? []).filter((c) => c.sku_no && c.cost !== null && c.cost !== undefined && Number(c.cost) >= 0).map((c) => [c.sku_no as string, c]));

  // 쿠팡 판매(기본 품목) → SKU. 같은 품목을 가진 SKU 가 여럿이면(마케팅용·파손 재고) 머리표 없는 것 하나에만 붙인다
  const coupangByComponent = new Map<string, number>();
  for (const s of input.coupangSales ?? []) coupangByComponent.set(nameKey(s.component), (coupangByComponent.get(nameKey(s.component)) ?? 0) + s.qty);
  const owners = new Map<string, { sku: string; tagged: boolean }>();
  for (const r of snap) {
    const m = mapBySku.get(r.sku_no);
    if (!m?.component || m.exclude) continue;
    const k = nameKey(m.component);
    const tagged = parseWekeepName(r.product_name).tags.some((t) => t === "파손" || t === "마케팅용");
    const cur = owners.get(k);
    if (!cur || (cur.tagged && !tagged)) owners.set(k, { sku: r.sku_no, tagged });
  }
  const coupangOwner = new Map([...owners].map(([k, v]) => [k, v.sku]));
  // 쿠팡 로켓그로스: 옵션 → SKU 짝짓기로 낱개 환산. 기준일이 새로울 때만 손 입력·판매 원장 대신 쓴다
  const rg = input.coupangRg ? summarizeCoupangRg(input.coupangRg.rows, input.coupangRg.map, today) : null;
  const rgFresh = !!rg?.summary.fresh;

  const rows0: InventoryRow[] = snap.map((s) => {
    const m = mapBySku.get(s.sku_no);
    const parsed = parseWekeepName(s.product_name);
    const brand = toInvBrand(m?.brand) ?? parsed.brand;
    // 공급처: 매칭표 → 상품명 [사입][브랜드] 머리표 → 머리표 없는 사입 이름의 앞 단어(「파미나 N&D …」)
    const supplier = (m?.supplier && m.supplier.trim()) || parsed.supplier || (brand === "saip" ? supplierFromName(parsed.bare) : null);
    const t = thresholdsFor(brand, supplier, rules);
    const note = noteBySku.get(s.sku_no) ?? null;

    const cp = stockBy.get(`${s.sku_no}|coupang`);
    const tr = stockBy.get(`${s.sku_no}|transit`);
    const it = stockBy.get(`${s.sku_no}|internal`);
    const rgSku = rgFresh ? rg?.bySku.get(s.sku_no) ?? null : null;
    const coupang = rgSku ? rgSku.orderable : cp ? Number(cp.qty) : null;
    const coupangSource: InventoryRow["coupang_source"] = rgSku ? "wing" : cp ? "manual" : null;
    const coupangAsOf = rgSku ? rg?.summary.date ?? null : cp?.as_of ?? null;
    const transit = tr ? Number(tr.qty) : null;
    const internal = it ? Number(it.qty) : null;
    const available = Number(s.available_qty) || 0;
    const wekeepSide = available + (transit ?? 0) + (internal ?? 0);
    const total = wekeepSide + (coupang ?? 0);

    const speed = through ? shipoutSpeed(dailyBySku.get(s.sku_no) ?? [], through, window) : { from: "", to: "", days: window, total: 0, perDay: 0 };
    const sheetPerDay = brand === "nutty"
      ? (s.month_avg_shipout_qty != null ? Number(s.month_avg_shipout_qty) / SHEET_MONTH_DAYS : null)
      : (s.daily_avg_shipout_qty != null ? Number(s.daily_avg_shipout_qty) : null);
    const sheetBasis = brand === "nutty" ? `위킵 월평균 ${s.month_avg_shipout_qty ?? "-"} ÷ ${SHEET_MONTH_DAYS}` : `위킵 일평균 ${s.daily_avg_shipout_qty ?? "-"}`;

    // 쿠팡 하루 판매: WING 값이 있으면 RG 30일 순판매 ÷ 30(판매중지 옵션뿐이면 쿠팡 쪽 판정에서 뺌),
    // 없으면 옛 방식(판매 원장 쿠팡을 기본 품목으로 푼 합 ÷ 기간, 판매자배송이 섞일 수 있음)
    let coupangPerDay: number | null = null;
    let speedBasis: InventoryRow["coupang_speed_basis"] = null;
    let coupangNote: string | null = null;
    if (rgSku) {
      if (rgSku.active) { coupangPerDay = rgSku.sales_30d / COUPANG_RG_SALES_DAYS; speedBasis = "wing30"; }
      else coupangNote = "쿠팡 로켓그로스 옵션이 모두 판매중지라 쿠팡 쪽은 판정에서 뺌";
    } else {
      if (brand === "nutty" && coupang !== null && input.coupangWindow && m?.component && coupangOwner.get(nameKey(m.component)) === s.sku_no) {
        coupangPerDay = (coupangByComponent.get(nameKey(m.component)) ?? 0) / input.coupangWindow.days;
        speedBasis = "sales";
      }
      if (brand === "nutty" && rg && !rgFresh) coupangNote = `WING 로켓그로스 값이 ${rg.summary.date} 기준이라 오래돼 손 입력을 씀`;
      else if (brand === "nutty" && rgFresh && !m?.exclude && !isTaggedName(s.product_name)) coupangNote = "쿠팡 로켓그로스에 이 SKU 옵션 없음(위킵 쪽만 판정)";
    }
    const coupangInbound = rgSku ? rgSku.inbound : null;

    const runwayW = runwayDays(wekeepSide, speed.perDay);
    const runwayC = coupang !== null && coupangPerDay !== null ? runwayDays(coupang, coupangPerDay) : null;
    const runwayCIn = coupang !== null && coupangPerDay !== null ? runwayDays(coupang + (coupangInbound ?? 0), coupangPerDay) : null;
    const candidates = [runwayW, runwayC].filter((x): x is number => x !== null);
    const runway = candidates.length ? Math.min(...candidates) : null;

    const orders = (openOrders.get(s.sku_no) ?? []).sort((a, b) => String(a.expected_at ?? "9").localeCompare(String(b.expected_at ?? "9")));
    const incomingQty = orders.reduce((a, o) => a + (Number(o.qty) || 0), 0);
    const incoming = orders.length
      ? { qty: incomingQty, expected_at: orders[0].expected_at ?? null, ordered_at: orders[0].ordered_at, id: orders[0].id ?? null }
      : null;
    const perDayAll = speed.perDay + (coupangPerDay ?? 0);
    const runwayWithIncoming = incoming && perDayAll > 0 ? (total + incoming.qty) / perDayAll : null;

    const excludedBy = m?.exclude ? "매칭표에서 제외(부자재·판촉물 등)" : note?.exclude ? `메모: ${note.note || note.kind || "판매 중지"}` : null;
    // 너티인데 쿠팡 재고를 안 넣었으면 0 으로 보지 않는다. 판정은 위킵 쪽만이고, 그 사실을 이유에 적는다
    // WING 값이 새로운데 이 SKU 의 RG 옵션이 없으면(맛보기·마케팅용 등) 미입력이 아니라 쿠팡에 없는 것으로 본다
    const coupangMissing = brand === "nutty" && coupang === null && !rgFresh;
    const missingNote = coupangMissing ? " · 쿠팡 재고 미입력(위킵 쪽만 판정)" : coupangNote && coupang !== null ? ` · ${coupangNote}` : "";
    let status: InvStatus;
    let reason: string;
    if (excludedBy) { status = "excluded"; reason = excludedBy; }
    else if (total <= 0) {
      status = "soldout";
      reason = coupangMissing ? "위킵 품절(쿠팡 미입력): 위킵·이동·내부 재고 0, 쿠팡 재고는 입력되지 않아 모름" : "위킵·쿠팡·이동·내부 재고 합 0";
    }
    else if (runway === null) { status = "nomove"; reason = `최근 ${window}일 출고 0. 남은 날을 계산할 수 없음${missingNote}`; }
    else {
      status = statusFromRunway(runway, t);
      const cSide = `쿠팡 쪽(${coupangSource === "wing" ? `WING ${coupangAsOf}` : `손 입력 ${coupangAsOf}`})`;
      const side = runwayC !== null && runwayW !== null ? (runwayC <= runwayW ? cSide : "위킵 쪽") : runwayC !== null ? cSide : "위킵 쪽";
      reason = `${side} 남은 ${r1(runway)}일 (발주 필요 ≤ ${t.warn} · 곧 발주 ≤ ${t.soon} · 과재고 > ${t.over}, ${t.basis})${missingNote}`;
    }
    const baseStatus = status;
    if (incoming && (status === "soldout" || status === "order" || status === "soon")) {
      // 입고 예정일이 지난 발주는 덮지 않는다(기한 없이 품절·발주 필요를 가리면 안 됨) → 입고 지연
      const late = incoming.expected_at !== null && incoming.expected_at < today;
      reason = late
        ? `${STATUS_LABEL[status]}인데 입고 예정일(${incoming.expected_at})이 지났습니다: 발주 ${incoming.qty}개 입고 확인 필요`
        : `${STATUS_LABEL[status]} 상태였으나 발주 입력 있음: ${incoming.qty}개${incoming.expected_at ? ` · ${incoming.expected_at} 입고 예정` : ""}`;
      status = late ? "late" : "incoming";
    }

    // 시트 방식: 너티는 총 재고(위킵+쿠팡+이동+내부) ÷ 월평균 환산, 사입은 위킵 재고 ÷ 위킵 일평균
    const sheetStock = brand === "nutty" ? total : available;
    const sheetRunway = sheetPerDay !== null ? runwayDays(sheetStock, sheetPerDay) : null;
    let sheetStatus: InvStatus = excludedBy ? "excluded" : sheetStock <= 0 ? "soldout" : sheetRunway === null ? "nomove" : statusFromRunway(sheetRunway, t);
    if (incoming && (sheetStatus === "soldout" || sheetStatus === "order" || sheetStatus === "soon")) {
      sheetStatus = incoming.expected_at !== null && incoming.expected_at < today ? "late" : "incoming";
    }

    const costRow = costBySku.get(s.sku_no);
    const cost = costRow ? { cost: Number(costRow.cost), basis: costRow.source ?? "설정 입력" } : null;
    const value = cost ? Math.round(cost.cost * Math.max(0, total)) : null;

    return {
      sku_no: s.sku_no,
      name: s.product_name,
      bare_name: parsed.bare,
      tags: parsed.tags,
      brand,
      supplier,
      component: m?.component ?? null,
      product_code: m?.product_code ?? null,
      barcode: s.barcode ?? m?.barcode ?? null,
      confidence: String(m?.confidence ?? "없음"),
      confirmed: !!m?.confirmed,
      available,
      safe: Number(s.safe_qty) || 0,
      reserve: Number(s.reserve_qty) || 0,
      faulty: Number(s.faulty_qty) || 0,
      coupang,
      coupang_as_of: coupangAsOf,
      coupang_source: coupangSource,
      coupang_inbound: coupangInbound,
      coupang_speed_basis: speedBasis,
      coupang_note: coupangNote,
      coupang_rg: rgSku,
      runway_coupang_with_inbound: runwayCIn,
      transit,
      internal,
      other_as_of: [tr?.as_of, it?.as_of].filter(Boolean).sort().pop() ?? null,
      total_stock: total,
      incoming,
      speed,
      sheet_per_day: sheetPerDay,
      sheet_basis: sheetBasis,
      coupang_per_day: coupangPerDay,
      runway_wekeep: runwayW,
      runway_coupang: runwayC,
      runway,
      runway_with_incoming: runwayWithIncoming,
      stockout_date: runway !== null && asOf ? addDays(asOf, Math.floor(runway)) : null,
      status,
      base_status: baseStatus,
      coupang_missing: coupangMissing,
      group: GROUP_OF[status],
      reason,
      thresholds: t,
      unit_cost: cost?.cost ?? null,
      cost_basis: cost?.basis ?? null,
      value,
      note: note?.note ?? null,
      note_kind: note?.kind ?? null,
      sheet_runway: sheetRunway,
      sheet_status: sheetStatus,
      scale: NO_SCALE,
      held: false,
      last_shipout: lastShipout(dailyBySku.get(s.sku_no) ?? [], through),
    };
  });

  const scaled = attachSalesScale(rows0, input.salesScale ?? null, dailyBySku, mapBySku, through);
  const rows = [...scaled.rows].sort(compareRows);
  return {
    as_of: asOf,
    read_at: snap.reduce<string | null>((m, r) => (r.read_at && (!m || r.read_at > m) ? r.read_at : m), null),
    daily_through: through,
    window,
    window_from: through ? addDays(through, -(window - 1)) : null,
    coupang_window: input.coupangWindow ?? null,
    coupang_unmapped: input.coupangUnmapped ?? null,
    coupang_rg: rg?.summary ?? null,
    scale: scaled.info,
    rows,
    cards: buildCards(rows),
  };
}

/** 정렬에 쓰는 남은 날. 품절은 0(최근 기간 출고가 0 이라 남은 날이 없어도 맨 뒤로 가지 않게) */
const sortRunway = (r: InventoryRow) => (r.base_status === "soldout" ? 0 : r.runway ?? Infinity);

/**
 * 묶음 안 정렬.
 *   ① 지금 손댈 것·보류: 입고 지연 맨 위 → 판매 규모 등급(A → B → C → 등급 없음 → 판매 없음) → 남은 날 짧은 순(품절 = 0)
 *     → 같으면 상태 순 → 최근 하루 출고 큰 순. 입고 대기(발주를 넣은 것)는 맨 아래
 *   ③ 과재고·④ 출고 0·⑤ 판정 제외: 재고 가치 큰 순 · ② 정상: 남은 날 짧은 순
 */
export function compareRows(a: InventoryRow, b: InventoryRow): number {
  const ga = GROUP_ORDER.indexOf(a.group);
  const gb = GROUP_ORDER.indexOf(b.group);
  if (ga !== gb) return ga - gb;
  if (a.group === "act" || a.group === "hold") {
    const tier = (r: InventoryRow) => (r.status === "late" ? 0 : r.status === "incoming" ? 2 : 1);
    if (tier(a) !== tier(b)) return tier(a) - tier(b);
    const gr = GRADE_ORDER[a.scale.grade ?? "null"] - GRADE_ORDER[b.scale.grade ?? "null"];
    if (gr !== 0) return gr;
    const ra = sortRunway(a);
    const rb = sortRunway(b);
    if (ra !== rb) return ra - rb;
    if (a.status !== b.status) return ACT_ORDER[a.status] - ACT_ORDER[b.status];
    if (a.speed.perDay !== b.speed.perDay) return b.speed.perDay - a.speed.perDay;
    return a.name.localeCompare(b.name, "ko");
  }
  if (a.group === "over" || a.group === "nomove" || a.group === "excluded") {
    const v = (b.value ?? -1) - (a.value ?? -1);
    if (v !== 0) return v;
  }
  const ra = a.runway ?? Infinity;
  const rb = b.runway ?? Infinity;
  if (ra !== rb) return ra - rb;
  return a.name.localeCompare(b.name, "ko");
}

const NO_SCALE: SalesScale = {
  pool: null, grade: null, basis: "unknown", value: null, revenue: 0, sold_qty: 0, shipout: 0, shared_with: 1, rank: null, before: null, share: null,
};

/** 읽은 날짜별 안에서 마지막 출고일(to 이하) */
function lastShipout(rows: readonly DailyRow[], to: string | null): string | null {
  let last: string | null = null;
  for (const r of rows) if (r.shipout_qty > 0 && (!to || r.ymd <= to) && (!last || r.ymd > last)) last = r.ymd;
  return last;
}

const isTaggedStock = (r: Pick<InventoryRow, "tags">) => r.tags.some((t) => t === "파손" || t === "마케팅용");
type GradeHit = { grade: ScaleGrade; before: number; share: number; rank: number };
type PoolInfo = NonNullable<InventoryResult["scale"]>["pools"][ScalePool];

/** 기본 품목 매출을 그 품목을 가진 위킵 SKU 에 나눈다. 머리표 없는 SKU 끼리 같은 기간 위킵 출고 비율로(모두 0 이면 똑같이) */
function splitComponentSales(rows: readonly InventoryRow[], scale: SalesScaleInput, mapBySku: ReadonlyMap<string, SkuMapRow>,
  shipOf: (sku: string) => number): { part: Map<string, { revenue: number; qty: number; shared_with: number }>; unattached: UnattachedSales } {
  const sales = new Map<string, { name: string; revenue: number; qty: number }>();
  for (const c of scale.byComponent) {
    const k = nameKey(c.component);
    const p = sales.get(k) ?? { name: c.component, revenue: 0, qty: 0 };
    sales.set(k, { name: p.name, revenue: p.revenue + (Number(c.revenue) || 0), qty: p.qty + (Number(c.qty) || 0) });
  }
  const owners = new Map<string, InventoryRow[]>();
  for (const r of rows) {
    const m = mapBySku.get(r.sku_no);
    if (!m?.component || m.exclude) continue;
    const k = nameKey(m.component);
    owners.set(k, [...(owners.get(k) ?? []), r]);
  }
  const part = new Map<string, { revenue: number; qty: number; shared_with: number }>();
  for (const [k, list] of owners) {
    const sale = sales.get(k);
    if (!sale) continue;
    const untagged = list.filter((r) => !isTaggedStock(r));
    const takers = untagged.length ? untagged : list;
    const ships = takers.map((r) => shipOf(r.sku_no));
    const tot = ships.reduce((a, b) => a + b, 0);
    takers.forEach((r, i) => {
      const w = tot > 0 ? ships[i] / tot : 1 / takers.length;
      part.set(r.sku_no, { revenue: sale.revenue * w, qty: sale.qty * w, shared_with: takers.length });
    });
  }
  // 위킵 SKU 가 없는 기본 품목(닥터레이 영양제처럼 위킵에 안 두는 상품, 매칭표에 기본 품목이 빈 SKU)의 판매는 등급 풀에 안 들어간다
  const loose = [...sales].filter(([k, v]) => !owners.has(k) && v.revenue > 0).map(([, v]) => v).sort((a, b) => b.revenue - a.revenue);
  return {
    part,
    unattached: { components: loose.length, revenue: Math.round(loose.reduce((a, v) => a + v.revenue, 0)), top: loose.slice(0, 8).map((v) => ({ name: v.name, revenue: Math.round(v.revenue) })) },
  };
}
export interface UnattachedSales { components: number; revenue: number; top: { name: string; revenue: number }[] }

/** 한 SKU 의 판매 규모 기준값: 판매 매출 → 없으면 출고 × 원가 → 출고는 있는데 원가 없음(못 셈) → 판매 없음 */
function scaleValueOf(r: InventoryRow, revenue: number, shipout: number): Pick<SalesScale, "basis" | "value"> {
  if (revenue > 0) return { basis: "sales", value: revenue };
  if (shipout > 0 && r.unit_cost !== null) return { basis: "shipout", value: shipout * r.unit_cost };
  if (shipout > 0) return { basis: "unknown", value: null };
  return { basis: "none", value: 0 };
}

/**
 * 판매 규모 등급을 붙인다(새 행을 돌려준다).
 *   기준값 = 90일 판매 매출(기본 품목으로 푼 몫). 같은 기본 품목을 가진 위킵 SKU 가 여럿이면(마케팅용·파손 재고, 맛보기 4종, 중복 SKU)
 *   머리표 없는 SKU 들끼리 같은 기간 위킵 출고 비율로 나눈다. 그래서 풀에 들어간 매출 합 = 그 품목들의 판매 매출 합.
 *   판매 매출이 안 붙는 SKU 는 위킵 출고 × 원가로 대신(basis shipout). 출고는 있는데 원가가 없으면 금액을 못 세 등급 없음(unknown).
 *   둘 다 0 이면 판매 없음. 풀 = 사입 전체 · 너티 각각. 판정 제외·아이언펫·기타는 등급 없음.
 *   scale 이 null(판매 원장을 못 읽음)이면 아무 행도 등급·보류가 붙지 않는다.
 *   보류 = isHeld: 사입 풀 · 품절/발주 필요 · C/판매 없음/미상 · 최근 30일(through 까지) 위킵 출고 0.
 */
export function attachSalesScale(rows: readonly InventoryRow[], scale: SalesScaleInput | null, dailyBySku: ReadonlyMap<string, readonly DailyRow[]>,
  mapBySku: ReadonlyMap<string, SkuMapRow>, through: string | null = null): { rows: InventoryRow[]; info: InventoryResult["scale"] } {
  if (!scale) return { rows: [...rows], info: null };
  const { from, to } = scale.window;
  const shipOf = (sku: string) => (dailyBySku.get(sku) ?? []).reduce((a, r) => (r.ymd >= from && r.ymd <= to ? a + r.shipout_qty : a), 0);
  const { part, unattached } = splitComponentSales(rows, scale, mapBySku, shipOf);
  const base = rows.map((r) => {
    const p = part.get(r.sku_no);
    const revenue = p?.revenue ?? 0;
    const shipout = shipOf(r.sku_no);
    const pool: ScalePool | null = r.status === "excluded" ? null : r.brand === "saip" || r.brand === "nutty" ? r.brand : null;
    const s: SalesScale = { ...NO_SCALE, ...scaleValueOf(r, revenue, shipout), pool, revenue: Math.round(revenue),
      sold_qty: Math.round((p?.qty ?? 0) * 10) / 10, shipout, shared_with: p?.shared_with ?? 1 };
    return { r, s };
  });
  const emptyPool = (): PoolInfo => ({ total: 0, graded: 0, counts: { A: 0, B: 0, C: 0, none: 0 }, shipout_basis: 0, unknown: 0 });
  const pools: Record<ScalePool, PoolInfo> = { saip: emptyPool(), nutty: emptyPool() };
  const grades = new Map<string, GradeHit>();
  for (const pool of ["saip", "nutty"] as const) {
    const items = base.filter((b) => b.s.pool === pool && b.s.value !== null).map((b) => ({ key: b.r.sku_no, value: b.s.value as number }));
    for (const [k, v] of gradeByCumulative(items)) grades.set(k, v);
    pools[pool].total = items.reduce((a, i) => a + Math.max(0, Math.round(i.value)), 0);
  }
  const out = base.map(({ r, s }) => {
    const g = s.pool && s.value !== null ? grades.get(r.sku_no) ?? null : null;
    const scale1: SalesScale = g ? { ...s, grade: g.grade, rank: g.rank || null, before: g.grade === "none" ? null : g.before, share: g.share } : s;
    if (scale1.pool) {
      const P = pools[scale1.pool];
      if (scale1.grade) { P.counts[scale1.grade] += 1; P.graded += 1; }
      if (scale1.basis === "shipout") P.shipout_basis += 1;
      if (scale1.basis === "unknown") P.unknown += 1;
    }
    const held = isHeld({ status: r.status, scale: scale1, last_shipout: r.last_shipout }, through);
    return { ...r, scale: scale1, held, group: held ? ("hold" as const) : r.group };
  });
  return {
    rows: out,
    info: { window: scale.window, pools, gonggu_excluded: scale.gonggu_excluded ?? { rows: 0, revenue: 0 }, unmapped: scale.unmapped ?? null, unattached },
  };
}

const BRANDS: InvBrand[] = ["nutty", "saip", "ironpet", "other"];
export function buildCards(rows: readonly InventoryRow[]): InventoryCards {
  const counts = Object.fromEntries(Object.keys(STATUS_LABEL).map((k) => [k, 0])) as Record<InvStatus, number>;
  const byBrand = Object.fromEntries(BRANDS.map((b) => [b, 0])) as Record<InvBrand, number>;
  const missByBrand = Object.fromEntries(BRANDS.map((b) => [b, 0])) as Record<InvBrand, number>;
  let total = 0;
  let missing = 0;
  for (const r of rows) {
    counts[r.status] += 1;
    if (r.status === "excluded") continue;
    if (r.value !== null) { total += r.value; byBrand[r.brand] += r.value; }
    else if (r.total_stock > 0) { missing += 1; missByBrand[r.brand] += 1; }
  }
  const lateOf = (base: InvStatus[]) => rows.filter((r) => r.status === "late" && base.includes(r.base_status)).length;
  const heldOf = (st: InvStatus) => rows.filter((r) => r.held && r.status === st).length;
  const card = {
    soldout: counts.soldout - heldOf("soldout") + lateOf(["soldout"]),
    order: counts.order - heldOf("order") + lateOf(["order", "soon"]),
    soon: counts.soon,
    over: counts.over,
    late: counts.late,
    incoming: counts.incoming,
    held_soldout: heldOf("soldout"),
    held_order: heldOf("order"),
  };
  return { counts, card, value_total: total, value_by_brand: byBrand, missing_cost: missing, missing_cost_by_brand: missByBrand };
}

/** 예상 소진 점선: 오늘 가용에서 하루 출고만큼 줄어 0 이 되는 날까지(축 끝을 넘으면 축 끝에서 멈춤) */
export function forecastLine(start: string, stock: number, perDay: number, maxDays: number): { date: string; value: number }[] {
  if (!(perDay > 0) || stock <= 0) return [];
  const days = Math.min(Math.ceil(stock / perDay), maxDays);
  const out: { date: string; value: number }[] = [];
  for (let i = 0; i <= days; i += 1) out.push({ date: addDays(start, i), value: Math.max(0, Math.round((stock - perDay * i) * 10) / 10) });
  return out;
}

// ── 원가: 시트 「2026 재고·출고 통합관리」 가 정본 (2026-11-10 김호 결정) ──
// 탭마다 머리글 「원가」 열(사입 탭 R, 너티 탭 P), 닥터레이 탭은 B 제품명 · C 공급가. 배송비 줄은 원가가 아니다.
// 시트 상품명 ↔ 위킵 SKU: 상품명(띄어쓰기·탭 무시) → 바코드(B열) → B열이 위킵 SKU 번호 순으로 맞춘다.
// 맞춘 원가는 DB 표 inventory_costs 에 넣고(docs/sql/2026-11-10-inventory.sql 시드), 시트 은퇴 뒤에는 설정 > 재고 > 원가에서 고친다.
// 이 표에 없으면 「원가 없음」. 대시보드 product_costs 로 대신 채우지 않는다.

export interface SheetCostRow { tab: string; cell: string; name: string; barcode: string | null; cost: number }
export interface SkuCostRow { cost_key: string; sku_no: string | null; product_name: string; cost: number; source: string | null; note?: string | null }

const colLetter = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)));
const parseWon = (v: unknown): number | null => {
  const n = Number(String(v ?? "").replace(/[,\s원]/g, ""));
  return Number.isFinite(n) && String(v ?? "").trim() !== "" ? n : null;
};

/** 시트 탭 값({탭: 행[]}) → 원가 줄. lawdate(위킵 원본) 탭은 건너뛴다 */
export function extractSheetCosts(tabs: Readonly<Record<string, readonly (readonly string[])[]>>): SheetCostRow[] {
  const out: SheetCostRow[] = [];
  for (const [tab, rows] of Object.entries(tabs)) {
    if (tab.startsWith("lawdate")) continue;
    const headIdx = rows.slice(0, 6).findIndex((r) => (r || []).some((c) => c === "원가" || c === "공급가"));
    if (headIdx < 0) continue;
    const head = rows[headIdx];
    const costCol = head.findIndex((c) => c === "원가" || c === "공급가");
    const nameCol = head.indexOf("제품명") >= 0 ? head.indexOf("제품명") : tab === "너티" ? 0 : 2;
    const barcodeCol = tab === "너티" || head.indexOf("제품명") >= 0 ? -1 : 1;
    rows.slice(headIdx + 1).forEach((r, i) => {
      const name = String(r?.[nameCol] ?? "").trim();
      const cost = parseWon(r?.[costCol]);
      if (!name || cost === null || cost < 0 || /배송비/.test(name)) return;
      const bc = barcodeCol >= 0 ? String(r?.[barcodeCol] ?? "").trim() : "";
      out.push({ tab, cell: `${colLetter(costCol)}${headIdx + 2 + i}`, name, barcode: bc || null, cost });
    });
  }
  return out;
}

/** 시트 원가 줄 → 위킵 SKU. 못 맞춘 줄과 같은 SKU 에 두 번 맞은 줄은 unmatched 로 */
export function matchSheetCosts(rows: readonly SheetCostRow[], snapshot: readonly { sku_no: string; product_name: string; barcode?: string | null }[]): {
  matched: (SkuCostRow & { how: string })[];
  unmatched: (SheetCostRow & { reason: string })[];
} {
  const byName = new Map(snapshot.map((s) => [nameKey(s.product_name), s]));
  const byBarcode = new Map<string, typeof snapshot[number]>();
  for (const s of snapshot) if (s.barcode && s.barcode !== "-" && !byBarcode.has(s.barcode)) byBarcode.set(s.barcode, s);
  const bySku = new Map(snapshot.map((s) => [s.sku_no, s]));
  const used = new Set<string>();
  const matched: (SkuCostRow & { how: string })[] = [];
  const unmatched: (SheetCostRow & { reason: string })[] = [];
  for (const r of rows) {
    let hit = byName.get(nameKey(r.name));
    let how = "상품명";
    if (!hit && r.barcode) { hit = byBarcode.get(r.barcode); how = "바코드"; }
    if (!hit && r.barcode) { hit = bySku.get(r.barcode); how = "SKU 번호"; }
    const source = `sheet:${r.tab}!${r.cell}`;
    if (!hit) { unmatched.push({ ...r, reason: "위킵 상품명·바코드와 짝 없음" }); continue; }
    if (used.has(hit.sku_no)) { unmatched.push({ ...r, reason: `같은 위킵 SKU(${hit.product_name})에 이미 다른 줄이 맞음` }); continue; }
    used.add(hit.sku_no);
    matched.push({ cost_key: hit.sku_no, sku_no: hit.sku_no, product_name: hit.product_name, cost: r.cost, source, how,
      note: nameKey(r.name) === nameKey(hit.product_name) ? null : `시트 이름 「${r.name}」` });
  }
  return { matched, unmatched };
}
