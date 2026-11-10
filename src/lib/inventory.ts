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

export type InvStatus = "soldout" | "order" | "soon" | "incoming" | "ok" | "over" | "nomove" | "excluded";
export const STATUS_LABEL: Record<InvStatus, string> = {
  soldout: "품절",
  order: "발주 필요",
  soon: "곧 발주",
  incoming: "입고 대기",
  ok: "정상",
  over: "과재고",
  nomove: "출고 0",
  excluded: "판정 제외",
};
/** 묶음: ① 지금 손댈 것 ② 정상 ③ 과재고 ④ 출고 0 ⑤ 판정 제외 */
export type InvGroup = "act" | "ok" | "over" | "nomove" | "excluded";
export const GROUP_OF: Record<InvStatus, InvGroup> = {
  soldout: "act", order: "act", soon: "act", incoming: "act",
  ok: "ok", over: "over", nomove: "nomove", excluded: "excluded",
};
/** 「지금 손댈 것」 안의 순서: 품절 → 발주 필요 → 곧 발주 → 입고 대기, 같은 상태는 남은 날 짧은 순 */
const ACT_ORDER: Record<InvStatus, number> = { soldout: 0, order: 1, soon: 2, incoming: 3, ok: 4, over: 5, nomove: 6, excluded: 7 };

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
export interface CostRow { product: string; brand: string; manufacturing_cost: number | null }

// ── 날짜 ──
export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
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
  for (;;) {
    const m = rest.match(/^\[([^\]]+)\]\s*/);
    if (!m) break;
    tags.push(m[1].trim());
    rest = rest.slice(m[0].length);
  }
  const isSaip = tags.includes("사입");
  const supplierTag = isSaip ? tags.find((t) => !["사입", "파손", "마케팅용"].includes(t)) ?? null : null;
  let brand: InvBrand = "other";
  if (isSaip) brand = "saip";
  else if (/^너티/.test(rest)) brand = "nutty";
  else if (/^아이언펫/.test(rest)) brand = "ironpet";
  return { brand, supplier: isSaip ? supplierTag : brand === "nutty" ? "너티" : null, tags, bare: rest };
}

export function toInvBrand(b: string | null | undefined): InvBrand | null {
  return b === "nutty" || b === "saip" || b === "ironpet" ? b : b === "other" ? "other" : null;
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
  /** 손 입력 재고. null = 미입력(0 과 다름) */
  coupang: number | null;
  coupang_as_of: string | null;
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
}

export interface ComputeInput {
  snapshot: readonly SnapshotRow[];
  daily: readonly DailyRow[];
  map: readonly SkuMapRow[];
  stocks?: readonly ManualStockRow[];
  orders?: readonly OrderRow[];
  notes?: readonly NoteRow[];
  rules?: readonly RuleRow[];
  costs?: readonly CostRow[];
  /** 너티 쿠팡 판매(기본 품목 낱개 수량, 기간 합). component 이름 그대로 */
  coupangSales?: readonly { component: string; qty: number }[];
  coupangWindow?: { from: string; to: string; days: number } | null;
  window?: number;
  /** 대시보드 상품 코드 → 상품 이름(src/lib/product-master.json). 원가를 이 이름으로도 찾는다 */
  codeNames?: Readonly<Record<string, string>>;
}

export interface InventoryCards {
  counts: Record<InvStatus, number>;
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

/** 원가 찾기: 기본 품목 이름 → 대시보드 상품 코드의 이름 → 위킵 상품명(머리표 뗀 것) 순. 0 원은 원가 없음으로 본다(묶음 원가를 낱개에 붙이지 않음) */
function makeCostLookup(costs: readonly CostRow[]) {
  const m = new Map<string, number>();
  for (const c of costs) {
    const v = Number(c.manufacturing_cost);
    if (!(v > 0)) continue;
    m.set(`${c.brand}|${nameKey(c.product)}`, v);
  }
  return (brand: InvBrand, names: (string | null | undefined)[]): { cost: number; basis: string } | null => {
    for (const n of names) {
      if (!n) continue;
      const v = m.get(`${brand}|${nameKey(n)}`);
      if (v) return { cost: v, basis: n };
    }
    return null;
  };
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

export function computeInventory(input: ComputeInput): InventoryResult {
  const window = input.window ?? DEFAULT_SPEED_WINDOW;
  const rules = input.rules ?? [];
  const asOf = input.snapshot.reduce<string | null>((m, r) => (!m || r.date > m ? r.date : m), null);
  const snap = input.snapshot.filter((r) => r.date === asOf);
  const daily = mergeDailyRows(input.daily);
  const through = dailyThrough(daily, asOf);
  const dailyBySku = new Map<string, DailyRow[]>();
  for (const r of daily) {
    const list = dailyBySku.get(r.sku_no) ?? [];
    list.push(r);
    dailyBySku.set(r.sku_no, list);
  }
  const mapBySku = new Map(input.map.map((m) => [m.sku_no, m]));
  const stockBy = latestBy(input.stocks ?? [], (s) => `${s.sku_no}|${s.location}`, (s) => s.as_of);
  const noteBySku = new Map((input.notes ?? []).map((n) => [n.sku_no, n]));
  const openOrders = new Map<string, OrderRow[]>();
  for (const o of input.orders ?? []) {
    if (o.status !== "ordered") continue;
    const list = openOrders.get(o.sku_no) ?? [];
    list.push(o);
    openOrders.set(o.sku_no, list);
  }
  const costOf = makeCostLookup(input.costs ?? []);

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

  const rows: InventoryRow[] = snap.map((s) => {
    const m = mapBySku.get(s.sku_no);
    const parsed = parseWekeepName(s.product_name);
    const brand = toInvBrand(m?.brand) ?? parsed.brand;
    const supplier = (m?.supplier && m.supplier.trim()) || parsed.supplier;
    const t = thresholdsFor(brand, supplier, rules);
    const note = noteBySku.get(s.sku_no) ?? null;

    const cp = stockBy.get(`${s.sku_no}|coupang`);
    const tr = stockBy.get(`${s.sku_no}|transit`);
    const it = stockBy.get(`${s.sku_no}|internal`);
    const coupang = cp ? Number(cp.qty) : null;
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

    let coupangPerDay: number | null = null;
    if (brand === "nutty" && coupang !== null && input.coupangWindow && m?.component && coupangOwner.get(nameKey(m.component)) === s.sku_no) {
      coupangPerDay = (coupangByComponent.get(nameKey(m.component)) ?? 0) / input.coupangWindow.days;
    }

    const runwayW = runwayDays(wekeepSide, speed.perDay);
    const runwayC = coupang !== null && coupangPerDay !== null ? runwayDays(coupang, coupangPerDay) : null;
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
    let status: InvStatus;
    let reason: string;
    if (excludedBy) { status = "excluded"; reason = excludedBy; }
    else if (total <= 0) { status = "soldout"; reason = "위킵·쿠팡·이동·내부 재고 합 0"; }
    else if (runway === null) { status = "nomove"; reason = `최근 ${window}일 출고 0. 남은 날을 계산할 수 없음`; }
    else {
      status = statusFromRunway(runway, t);
      const side = runwayC !== null && runwayW !== null ? (runwayC <= runwayW ? "쿠팡 쪽" : "위킵 쪽") : runwayC !== null ? "쿠팡 쪽" : "위킵 쪽";
      reason = `${side} 남은 ${r1(runway)}일 (발주 필요 ≤ ${t.warn} · 곧 발주 ≤ ${t.soon} · 과재고 > ${t.over}, ${t.basis})`;
    }
    if (incoming && (status === "soldout" || status === "order" || status === "soon")) {
      reason = `${STATUS_LABEL[status]} 상태였으나 발주 입력 있음: ${incoming.qty}개${incoming.expected_at ? ` · ${incoming.expected_at} 입고 예정` : ""}`;
      status = "incoming";
    }

    // 시트 방식: 너티는 총 재고(위킵+쿠팡+이동+내부) ÷ 월평균 환산, 사입은 위킵 재고 ÷ 위킵 일평균
    const sheetStock = brand === "nutty" ? total : available;
    const sheetRunway = sheetPerDay !== null ? runwayDays(sheetStock, sheetPerDay) : null;
    let sheetStatus: InvStatus = excludedBy ? "excluded" : sheetStock <= 0 ? "soldout" : sheetRunway === null ? "nomove" : statusFromRunway(sheetRunway, t);
    if (incoming && (sheetStatus === "soldout" || sheetStatus === "order" || sheetStatus === "soon")) sheetStatus = "incoming";

    const codeName = m?.product_code ? input.codeNames?.[m.product_code] : undefined;
    const cost = costOf(brand, [m?.component, codeName, parsed.bare, s.product_name]);
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
      coupang_as_of: cp?.as_of ?? null,
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
    };
  });

  rows.sort(compareRows);
  return {
    as_of: asOf,
    read_at: snap.reduce<string | null>((m, r) => (r.read_at && (!m || r.read_at > m) ? r.read_at : m), null),
    daily_through: through,
    window,
    window_from: through ? addDays(through, -(window - 1)) : null,
    coupang_window: input.coupangWindow ?? null,
    rows,
    cards: buildCards(rows),
  };
}

/** 묶음 안 정렬: 손댈 것 = 상태 → 남은 날 짧은 순, 과재고·출고 0 = 재고 가치 큰 순, 정상 = 남은 날 짧은 순 */
export function compareRows(a: InventoryRow, b: InventoryRow): number {
  const ga = ["act", "ok", "over", "nomove", "excluded"].indexOf(a.group);
  const gb = ["act", "ok", "over", "nomove", "excluded"].indexOf(b.group);
  if (ga !== gb) return ga - gb;
  if (a.group === "act" && a.status !== b.status) return ACT_ORDER[a.status] - ACT_ORDER[b.status];
  // 품절끼리는 잘 나가던 것(최근 하루 출고 큰 것)이 위
  if (a.status === "soldout" && b.status === "soldout" && a.speed.perDay !== b.speed.perDay) return b.speed.perDay - a.speed.perDay;
  if (a.group === "over" || a.group === "nomove" || a.group === "excluded") {
    const v = (b.value ?? -1) - (a.value ?? -1);
    if (v !== 0) return v;
  }
  const ra = a.runway ?? Infinity;
  const rb = b.runway ?? Infinity;
  if (ra !== rb) return ra - rb;
  return a.name.localeCompare(b.name, "ko");
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
  return { counts, value_total: total, value_by_brand: byBrand, missing_cost: missing, missing_cost_by_brand: missByBrand };
}

/** 예상 소진 점선: 오늘 가용에서 하루 출고만큼 줄어 0 이 되는 날까지(축 끝을 넘으면 축 끝에서 멈춤) */
export function forecastLine(start: string, stock: number, perDay: number, maxDays: number): { date: string; value: number }[] {
  if (!(perDay > 0) || stock <= 0) return [];
  const days = Math.min(Math.ceil(stock / perDay), maxDays);
  const out: { date: string; value: number }[] = [];
  for (let i = 0; i <= days; i += 1) out.push({ date: addDays(start, i), value: Math.max(0, Math.round((stock - perDay * i) * 10) / 10) });
  return out;
}
