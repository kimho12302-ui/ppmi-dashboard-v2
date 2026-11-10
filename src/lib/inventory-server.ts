// 재고 화면 원천 읽기 (서버 전용). 계산은 src/lib/inventory.ts.
//
// 읽는 표: raw_wekeep_snapshot · raw_wekeep_daily · wekeep_sku_map · inventory_manual_stock · inventory_orders ·
//   inventory_notes · inventory_rules · inventory_costs (docs/sql/2026-11-10-inventory.sql) + product_sales · product_components.
//   product_sales 는 두 번 쓴다: 너티 쿠팡 판매 속도(28일)와 판매 규모 등급(너티·사입 90일 매출, 2026-11-10).
//   쿠팡 로켓그로스 재고: raw_coupang_rg_inventory 최신 날짜 + coupang_rg_sku_map (docs/sql/2026-11-10-coupang-rg.sql).
//   이 두 표가 없으면(SQL 실행 전) 「SQL 실행 필요」가 아니라 조용히 손 입력 쿠팡 재고로 대체한다.
//   원가는 inventory_costs(시트 「2026 재고·출고 통합관리」 원가가 정본, 2026-11-10 김호). product_costs 는 쓰지 않는다.
// 표가 없으면(SQL 실행 전) 화면은 「SQL 실행 필요」를 띄운다. 500 으로 죽이지 않는다.
//
// ★ 개발용 대체 경로: NODE_ENV 가 production 이 아니고 INVENTORY_DEV_RAW_DIR 에 볼트 원천 폴더
//   (settings/collectors/raw) 를 주면 위킵 표 대신 그 폴더의 json 을 읽는다. DB 표가 생기기 전에 화면을 띄워 보려고
//   둔 것이다. `next build && next start`(운영)에서는 NODE_ENV=production 이라 꺼진다. Vercel 에 이 변수를 넣지 않는다.
//   (.env.local 에 VERCEL_ENV=production 이 들어 있어 VERCEL_ENV 로는 가르지 않는다.)

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/db";
import { isMissingTable } from "@/lib/bl-pnl";
import { kstDate } from "@/lib/date";
import { loadComponentIndex } from "@/lib/product-components-server";
import { expandSales, type ComponentIndex } from "@/lib/product-components";
import { isGongguAggregate, isGongguOutOfDailySales } from "@/lib/gonggu";
import {
  addDays, mergeDailyRows, coupangWindowFor, parseWekeepName, SALES_SCALE_DAYS, COUPANG_SALES_LAG_DAYS,
  type ComputeInput, type SalesScaleInput, type SkuCostRow, type DailyRow, type ManualStockRow, type NoteRow, type OrderRow, type RuleRow,
  type SkuMapRow, type SnapshotRow, type RgInventoryRow, type RgMapRow,
} from "@/lib/inventory";

export const INVENTORY_TABLES = [
  "raw_wekeep_snapshot", "raw_wekeep_daily", "wekeep_sku_map",
  "inventory_manual_stock", "inventory_orders", "inventory_notes", "inventory_rules", "inventory_costs",
] as const;
export type InventoryTable = (typeof INVENTORY_TABLES)[number];

/** 하루 출고 기간 최대(28일) + 여유. 이만큼만 날짜별을 읽는다 */
const SPEED_LOOKBACK_DAYS = 40;

export type SourceMode = "db" | "dev-files";

/** 개발용 원천 폴더. 운영(NODE_ENV=production)에서는 항상 null */
export function devRawDir(): string | null {
  if (process.env.NODE_ENV === "production") return null;
  const dir = process.env.INVENTORY_DEV_RAW_DIR;
  return dir && existsSync(dir) ? dir : null;
}

/**
 * 개발용 손 입력 목업. INVENTORY_DEV_MANUAL_FILE 에 { stocks, orders, notes, rules } json 을 주면 그 표가 없을 때만 대신 쓴다.
 * 입고 대기·쿠팡 재고 화면을 SQL 실행 전에 확인하려는 것. 운영(NODE_ENV=production)에서는 devRawDir 와 같이 꺼진다.
 */
function devManual(): { stocks?: ManualStockRow[]; orders?: OrderRow[]; notes?: NoteRow[]; rules?: RuleRow[]; costs?: SkuCostRow[] } {
  if (!devRawDir()) return {};
  const p = process.env.INVENTORY_DEV_MANUAL_FILE;
  return p && existsSync(p) ? readJson(p) : {};
}

/** 개발용 원가 목업(설정 화면 원가 탭 미리보기). 운영에서는 null */
export function devManualCosts(): SkuCostRow[] | null {
  return devManual().costs ?? null;
}

/* ── 개발용: 볼트 원천 json → DB 행 모양 ── */
interface RawSnap { date: string; skuNo: string; productName: string; variation?: string; productManageCode?: string; supplierName?: string;
  availableQty: number; safeQty?: number; reserveQty?: number; faultyQty?: number; damageQty?: number; inCustomsQty?: number;
  beforeDeliveryQty?: number; dailyAvgShipoutQty?: number; monthAvgShipoutQty?: number; skuTurnover?: number; readAt?: string }
interface RawDaily { ymd: string; skuNo: string; shipinQty: number; shipoutQty: number; returnShipinQty: number; faultyShipinQty: number;
  damageShipinQty: number; centerQty: number }

const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, "")) as T;
const snapFromRaw = (v: RawSnap): SnapshotRow => ({
  date: v.date, sku_no: v.skuNo, product_name: v.productName, variation: v.variation ?? null,
  barcode: v.productManageCode && v.productManageCode !== "-" ? v.productManageCode : null, supplier_name: v.supplierName ?? null,
  available_qty: v.availableQty ?? 0, safe_qty: v.safeQty ?? 0, reserve_qty: v.reserveQty ?? 0, faulty_qty: v.faultyQty ?? 0,
  damage_qty: v.damageQty ?? 0, in_customs_qty: v.inCustomsQty ?? 0, before_delivery_qty: v.beforeDeliveryQty ?? 0,
  daily_avg_shipout_qty: v.dailyAvgShipoutQty ?? null, month_avg_shipout_qty: v.monthAvgShipoutQty ?? null,
  sku_turnover: v.skuTurnover ?? null, read_at: v.readAt ?? null,
});
const dailyFromRaw = (v: RawDaily): DailyRow => ({
  ymd: v.ymd, sku_no: v.skuNo, shipin_qty: v.shipinQty ?? 0, shipout_qty: v.shipoutQty ?? 0,
  return_shipin_qty: v.returnShipinQty ?? 0, faulty_shipin_qty: v.faultyShipinQty ?? 0, damage_shipin_qty: v.damageShipinQty ?? 0,
  center_qty: v.centerQty ?? 0,
});

function devSnapshot(dir: string): SnapshotRow[] {
  const doc = readJson<{ items: Record<string, RawSnap> }>(join(dir, "wekeep-snapshot.json"));
  return Object.values(doc.items || {}).map(snapFromRaw);
}
/** 백필(1월~) 위에 최근 원천을 덮는다. 같은 날 같은 SKU 는 최근 원천이 이긴다 */
function devDaily(dir: string, from: string | null, sku?: string): DailyRow[] {
  const byKey = new Map<string, DailyRow>();
  const backfillDir = join(dir, "wekeep-backfill");
  if (existsSync(backfillDir)) {
    for (const f of readdir(backfillDir)) {
      const doc = readJson<{ daily?: RawDaily[] }>(join(backfillDir, f));
      for (const r of mergeDailyRows((doc.daily || []).map(dailyFromRaw))) byKey.set(`${r.ymd}|${r.sku_no}`, r);
    }
  }
  const recent = readJson<{ items: Record<string, RawDaily> }>(join(dir, "wekeep-daily.json"));
  for (const r of mergeDailyRows(Object.values(recent.items || {}).map(dailyFromRaw))) byKey.set(`${r.ymd}|${r.sku_no}`, r);
  return [...byKey.values()].filter((r) => (!from || r.ymd >= from) && (!sku || r.sku_no === sku));
}
function readdir(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.endsWith(".json"));
}
interface DraftRow { skuNo: string; productName: string; productManageCode?: string; category?: string; confidence?: string;
  component?: { name?: string; brand?: string } | null; codes?: { code: string; role?: string; confidence?: string }[]; notes?: string[] }
/** 개발용: 볼트 RG 누적 원천(raw/coupang-rg-inventory.json)과 짝짓기 초안. 없으면 null */
interface RawRg { date: string; vendorItemId: number; productName?: string | null; optionName?: string | null; saleSuspended?: boolean;
  hiddenByVendor?: boolean; orderable: number; inbound: number; daysOfCover?: number | null; healthGroup?: string | null;
  sales7d?: number | null; sales30d?: number | null }
interface RawRgMap { items: { vendorItemId: number; needs_review?: boolean; note?: string; components: { wekeep_sku_no: string; component?: string; qty: number }[] }[] }
function devCoupangRg(dir: string): { rows: RgInventoryRow[]; map: RgMapRow[] } | null {
  const p = join(dir, "coupang-rg-inventory.json");
  const mp = join(dir, "coupang-rg", "coupang-rg-sku-map.draft.json");
  if (!existsSync(p) || !existsSync(mp)) return null;
  const items = Object.values(readJson<{ items: Record<string, RawRg> }>(p).items || {});
  const last = items.reduce((m, v) => (v.date > m ? v.date : m), "");
  return {
    rows: items.filter((v) => v.date === last).map((v) => ({
      date: v.date, vendor_item_id: v.vendorItemId, product_name: v.productName ?? null, option_name: v.optionName ?? null,
      sale_suspended: !!v.saleSuspended, hidden_by_vendor: !!v.hiddenByVendor, orderable: v.orderable, inbound: v.inbound,
      days_of_cover: v.daysOfCover ?? null, health_group: v.healthGroup ?? null, sales_7d: v.sales7d ?? null, sales_30d: v.sales30d ?? null,
    })),
    map: readJson<RawRgMap>(mp).items.flatMap((i) => i.components.map((c) => ({
      vendor_item_id: i.vendorItemId, sku_no: c.wekeep_sku_no, qty: c.qty, component: c.component ?? null, needs_review: !!i.needs_review, note: i.note ?? null,
    }))),
  };
}

function devMap(dir: string): SkuMapRow[] {
  const p = join(dir, "wekeep-sku-map.draft.json");
  if (!existsSync(p)) return [];
  const doc = readJson<{ rows: DraftRow[] }>(p);
  return doc.rows.map((r) => {
    const parsed = parseWekeepName(r.productName);
    const codes = r.codes || [];
    const code = codes.find((c) => c.role === "single" && c.confidence === "확실") || codes[0];
    return {
      sku_no: r.skuNo, product_name: r.productName,
      barcode: r.productManageCode && r.productManageCode !== "-" ? r.productManageCode : null,
      product_code: code?.code ?? null, component: r.component?.name?.trim() ?? null,
      brand: r.component?.brand || parsed.brand, supplier: parsed.supplier,
      confidence: r.confidence ?? "없음", confirmed: false, exclude: r.category !== "상품", note: (r.notes || []).join(" / ") || null,
    };
  });
}

/* ── DB ── */
async function readTable<T>(table: InventoryTable, build: () => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>,
  missing: Set<string>): Promise<T[]> {
  const { data, error } = await build();
  if (error) {
    if (isMissingTable(error)) { missing.add(table); return []; }
    throw new Error(`${table}: ${error.message}`);
  }
  return (data as T[]) || [];
}

/** fetchAll(1,000행씩 전부) + 표 없음은 빈 배열 */
async function readAll<T>(table: InventoryTable, query: unknown, tieBreak: string | null, missing: Set<string>): Promise<T[]> {
  try {
    return await fetchAll<T>(query, tieBreak);
  } catch (e) {
    if (isMissingTable(e as { code?: string })) { missing.add(table); return []; }
    throw new Error(`${table}: ${(e as { message?: string })?.message ?? String(e)}`);
  }
}

async function latestSnapshotDb(missing: Set<string>): Promise<SnapshotRow[]> {
  const head = await readTable<{ date: string }>("raw_wekeep_snapshot",
    () => supabase.from("raw_wekeep_snapshot").select("date").order("date", { ascending: false }).limit(1), missing);
  const date = head[0]?.date;
  if (!date) return [];
  return readTable<SnapshotRow>("raw_wekeep_snapshot", () => supabase.from("raw_wekeep_snapshot").select("*").eq("date", date), missing);
}

async function dailyDb(from: string, missing: Set<string>, sku?: string, to?: string): Promise<DailyRow[]> {
  try {
    let q = supabase.from("raw_wekeep_daily")
      .select("ymd,sku_no,shipin_qty,shipout_qty,return_shipin_qty,faulty_shipin_qty,damage_shipin_qty,center_qty")
      .gte("ymd", from).order("ymd");
    if (to) q = q.lte("ymd", to);
    if (sku) q = q.eq("sku_no", sku);
    return await fetchAll<DailyRow>(q, "sku_no");
  } catch (e) {
    if (isMissingTable(e as { code?: string })) { missing.add("raw_wekeep_daily"); return []; }
    throw e;
  }
}

/** 너티 쿠팡 판매(기본 품목 낱개). 끝 = min(너티×쿠팡 판매 원장 마지막 날, 오늘 − 지연 5일). 판매 동기화가 늦게 차는 최근 날은 뺀다 */
async function coupangSales(index: ComponentIndex): Promise<{ sales: { component: string; qty: number }[]; window: ComputeInput["coupangWindow"]; unmapped: ComputeInput["coupangUnmapped"] }> {
  const today = kstDate();
  const { data, error } = await supabase.from("product_sales").select("date").eq("brand", "nutty").eq("channel", "coupang")
    .lt("date", today).order("date", { ascending: false }).limit(1);
  if (error) throw new Error(`product_sales 쿠팡 마지막 날: ${error.message}`);
  const window = coupangWindowFor((data?.[0]?.date as string | undefined) ?? null, today);
  if (!window) return { sales: [], window: null, unmapped: null };
  const { from, to } = window;
  const rows = await fetchAll<{ date: string; brand: string; product: string; quantity: number; revenue: number }>(
    supabase.from("product_sales").select("id,date,brand,product,quantity,revenue").eq("brand", "nutty").eq("channel", "coupang")
      .gte("date", from).lte("date", to));
  const agg = new Map<string, number>();
  for (const r of expandSales(rows, index)) agg.set(r.product, (agg.get(r.product) ?? 0) + (Number(r.quantity) || 0));
  // 판매 구성표에 없는 판매 상품은 낱개로 못 풀어 쿠팡 속도에서 빠질 수 있다. 화면에 건수를 보인다
  const missing = new Map<string, number>();
  if (index.size) for (const r of rows) if (!index.get(r.brand, r.product)) missing.set(r.product, (missing.get(r.product) ?? 0) + (Number(r.quantity) || 0));
  return {
    sales: [...agg].map(([component, qty]) => ({ component, qty })),
    window,
    unmapped: missing.size ? { products: [...missing.keys()], qty: [...missing.values()].reduce((a, b) => a + b, 0) } : null,
  };
}

/**
 * 쿠팡 로켓그로스 재고: 최신 날짜 행 + 짝짓기 전부. 표가 없으면(SQL 실행 전) null 이고 화면은 손 입력으로 대체한다.
 * 그 밖의 읽기 오류는 올린다(못 읽은 것을 손 입력 값으로 몰래 바꾸지 않음)
 */
async function coupangRgDb(): Promise<{ rows: RgInventoryRow[]; map: RgMapRow[] } | null> {
  const head = await supabase.from("raw_coupang_rg_inventory").select("date").order("date", { ascending: false }).limit(1);
  if (head.error) {
    if (isMissingTable(head.error)) return null;
    throw new Error(`raw_coupang_rg_inventory: ${head.error.message}`);
  }
  const date = (head.data?.[0] as { date?: string } | undefined)?.date;
  if (!date) return null;
  const [rows, map] = await Promise.all([
    supabase.from("raw_coupang_rg_inventory")
      .select("date,vendor_item_id,product_name,option_name,sale_suspended,hidden_by_vendor,orderable,inbound,days_of_cover,health_group,sales_7d,sales_30d")
      .eq("date", date),
    supabase.from("coupang_rg_sku_map").select("vendor_item_id,sku_no,qty,component,needs_review,note"),
  ]);
  if (rows.error) throw new Error(`raw_coupang_rg_inventory: ${rows.error.message}`);
  if (map.error) {
    if (isMissingTable(map.error)) return null;
    throw new Error(`coupang_rg_sku_map: ${map.error.message}`);
  }
  return { rows: (rows.data as RgInventoryRow[]) || [], map: (map.data as RgMapRow[]) || [] };
}

/** 판매 규모 등급을 매기는 판매 원장 브랜드(사입 전체 · 너티 각각 풀) */
const SCALE_BRANDS = ["nutty", "saip"] as const;

/**
 * 판매 규모 기간: 끝 = min(너티·사입 판매 원장 마지막 날, 오늘 − 지연 5일), 길이 90일. 판매 원장이 아예 없으면 null.
 * 쿠팡 판매 기간과 같은 규칙(coupangWindowFor)을 길이만 바꿔 쓴다.
 */
async function salesScaleWindow(): Promise<SalesScaleInput["window"] | null> {
  const today = kstDate();
  const { data, error } = await supabase.from("product_sales").select("date").in("brand", [...SCALE_BRANDS])
    .lt("date", today).order("date", { ascending: false }).limit(1);
  if (error) throw new Error(`product_sales 마지막 날: ${error.message}`);
  return coupangWindowFor((data?.[0]?.date as string | undefined) ?? null, today, COUPANG_SALES_LAG_DAYS, SALES_SCALE_DAYS);
}

type SaleRow = { date: string; brand: string; channel: string | null; lineup: string | null; product: string; quantity: number; revenue: number };

/**
 * 판매 규모 재료: 너티·사입 판매 원장 90일을 판매 구성표로 기본 품목에 풀어 매출·수량을 합한다.
 * 공구는 채널로만 뺀다(channel 「공구」·「공구_…」, 「공구 합계」 행). isGonggu 는 쓰지 않는다:
 * 사입·너티의 lineup 칸(「N&D」「하루루틴」)은 정규 라인업이라 lineup 으로 가르면 정상 매출이 통째로 공구가 된다(gonggu.ts 경고).
 */
async function salesScaleInput(window: SalesScaleInput["window"], index: ComponentIndex): Promise<SalesScaleInput> {
  const rows = await fetchAll<SaleRow>(
    supabase.from("product_sales").select("id,date,brand,channel,lineup,product,quantity,revenue").in("brand", [...SCALE_BRANDS])
      .gte("date", window.from).lte("date", window.to));
  const gonggu = rows.filter((r) => isGongguOutOfDailySales(r) || isGongguAggregate(r));
  const own = rows.filter((r) => !(isGongguOutOfDailySales(r) || isGongguAggregate(r)));
  const agg = new Map<string, { revenue: number; qty: number }>();
  for (const r of expandSales(own, index)) {
    const p = agg.get(r.product) ?? { revenue: 0, qty: 0 };
    agg.set(r.product, { revenue: p.revenue + (Number(r.revenue) || 0), qty: p.qty + (Number(r.quantity) || 0) });
  }
  const missing = new Map<string, number>();
  if (index.size) for (const r of own) if (!index.get(r.brand, r.product)) missing.set(r.product, (missing.get(r.product) ?? 0) + (Number(r.revenue) || 0));
  return {
    window,
    byComponent: [...agg].map(([component, v]) => ({ component, revenue: v.revenue, qty: v.qty })),
    gonggu_excluded: { rows: gonggu.length, revenue: gonggu.reduce((a, r) => a + (Number(r.revenue) || 0), 0) },
    unmapped: missing.size ? { products: [...missing.keys()], revenue: [...missing.values()].reduce((a, b) => a + b, 0) } : null,
  };
}

export interface LoadedInputs {
  mode: SourceMode;
  missing: InventoryTable[];
  /** 위킵 표가 없어 계산할 수 없음 */
  setupNeeded: boolean;
  /** 판매 규모 등급 재료를 못 읽은 이유(등급 없이 화면을 그림). 읽었으면 null */
  scaleError: string | null;
  input: ComputeInput;
}

export async function loadInventoryInputs(window: number): Promise<LoadedInputs> {
  const missing = new Set<string>();
  const dev = devRawDir();
  // 판매 규모 기간(90일)을 먼저 정해 날짜별 출고를 그만큼 읽는다(판매 매출이 안 붙는 SKU 의 출고 × 원가 대체값).
  // 못 읽으면 등급 없이 그린다: 판매 원장을 못 읽은 것을 「판매 없음」으로 보면 품절이 보류로 숨어 버린다
  const [index, scaleWindow] = await Promise.all([loadComponentIndex(), salesScaleWindow().catch((e: unknown) => e as Error)]);
  const speedFrom = addDays(kstDate(), -SPEED_LOOKBACK_DAYS);
  const from = scaleWindow && !(scaleWindow instanceof Error) && scaleWindow.from < speedFrom ? scaleWindow.from : speedFrom;

  const [snapshot, daily, mapDb, stocks, orders, notes, rules, costs, coupang, scale, coupangRg] = await Promise.all([
    dev ? Promise.resolve(devSnapshot(dev)) : latestSnapshotDb(missing),
    dev ? Promise.resolve(devDaily(dev, from)) : dailyDb(from, missing),
    readTable<SkuMapRow>("wekeep_sku_map", () => supabase.from("wekeep_sku_map").select("*"), missing),
    // 손 입력은 1,000행을 넘을 수 있어 전부 읽는다(PostgREST 1,000행 상한). 미래 기준일은 빼고, 기준키 전체로 순서를 고정
    readAll<ManualStockRow>("inventory_manual_stock", supabase.from("inventory_manual_stock").select("sku_no,location,qty,as_of,note")
      .lte("as_of", kstDate()).order("as_of", { ascending: false }).order("sku_no").order("location"), null, missing),
    readAll<OrderRow>("inventory_orders", supabase.from("inventory_orders").select("*").eq("status", "ordered"), "id", missing),
    readTable<NoteRow>("inventory_notes", () => supabase.from("inventory_notes").select("*"), missing),
    readTable<RuleRow>("inventory_rules", () => supabase.from("inventory_rules").select("*"), missing),
    readAll<SkuCostRow>("inventory_costs", supabase.from("inventory_costs").select("cost_key,sku_no,product_name,cost,source,note"), "cost_key", missing),
    coupangSales(index),
    scaleWindow instanceof Error || !scaleWindow
      ? Promise.resolve(scaleWindow instanceof Error ? scaleWindow : new Error("판매 원장에 너티·사입 판매가 없음"))
      : salesScaleInput(scaleWindow, index).catch((e: unknown) => (e instanceof Error ? e : new Error(String(e)))),
    dev ? Promise.resolve(devCoupangRg(dev)) : coupangRgDb(),
  ]);
  // 개발용: 매칭표 표가 아직 없으면 볼트 초안을, 손 입력 표가 없으면 목업 파일을 쓴다
  const map = dev && missing.has("wekeep_sku_map") ? devMap(dev) : mapDb;
  const mock = dev ? devManual() : {};
  const pick = <T,>(table: InventoryTable, real: T[], fake: T[] | undefined) => (missing.has(table) && fake ? fake : real);
  const setupNeeded = !dev && (missing.has("raw_wekeep_snapshot") || missing.has("raw_wekeep_daily"));
  return {
    mode: dev ? "dev-files" : "db",
    missing: [...missing] as InventoryTable[],
    setupNeeded,
    scaleError: scale instanceof Error ? scale.message : null,
    input: {
      snapshot, daily, map,
      stocks: pick("inventory_manual_stock", stocks, mock.stocks),
      orders: pick("inventory_orders", orders, mock.orders?.filter((o) => o.status === "ordered")),
      notes: pick("inventory_notes", notes, mock.notes),
      rules: pick("inventory_rules", rules, mock.rules),
      skuCosts: pick("inventory_costs", costs, mock.costs),
      coupangRg,
      coupangSales: coupang.sales, coupangWindow: coupang.window, coupangUnmapped: coupang.unmapped,
      salesScale: scale instanceof Error ? null : scale, window, today: kstDate() },
  };
}

/** 상품 하나의 날짜별 원천(상세 그래프). from 이전 마지막 행부터 이어 그리려고 from 보다 넉넉히 읽는 것은 호출부가 정한다 */
export async function loadSkuDaily(sku: string, from: string): Promise<{ mode: SourceMode; rows: DailyRow[]; missing: boolean }> {
  const dev = devRawDir();
  if (dev) return { mode: "dev-files", rows: devDaily(dev, from, sku), missing: false };
  const missing = new Set<string>();
  const rows = await dailyDb(from, missing, sku);
  return { mode: "db", rows: mergeDailyRows(rows), missing: missing.size > 0 };
}

/** 설정 화면 고르기용: 최근 스냅샷 SKU 목록과 매칭표(표가 없으면 개발용 초안) */
export async function loadSkuList(): Promise<{ mode: SourceMode; snapshot: SnapshotRow[]; map: SkuMapRow[]; missing: InventoryTable[] }> {
  const missing = new Set<string>();
  const dev = devRawDir();
  const [snapshot, mapDb] = await Promise.all([
    dev ? Promise.resolve(devSnapshot(dev)) : latestSnapshotDb(missing),
    readTable<SkuMapRow>("wekeep_sku_map", () => supabase.from("wekeep_sku_map").select("*"), missing),
  ]);
  const latest = snapshot.reduce<string>((m, r) => (r.date > m ? r.date : m), "");
  return {
    mode: dev ? "dev-files" : "db",
    snapshot: snapshot.filter((r) => r.date === latest),
    map: dev && missing.has("wekeep_sku_map") ? devMap(dev) : mapDb,
    missing: [...missing] as InventoryTable[],
  };
}
