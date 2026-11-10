import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { cachedGET, revalidateAfter, type DataTag } from "@/lib/api-cache";
import { isMissingTable } from "@/lib/bl-pnl";
import { loadComponentRows } from "@/lib/product-components-server";
import { loadSkuList, INVENTORY_TABLES, type InventoryTable } from "@/lib/inventory-server";
import { DEFAULT_THRESHOLDS } from "@/lib/inventory";

// 설정 > 재고 탭의 읽기·쓰기 (2026-11-10). /api/settings 를 키우지 않고 따로 둔다.
//   GET                         → SKU 목록 · 매칭표 · 손 입력 재고 · 발주 · 메모 · 판정 기준 · 기본 품목 이름
//   POST { type, data }         → type = stock | order | note | rule | map
//   DELETE ?type=…&(키)         → stock(sku_no·location·as_of) | order(id) | note(sku_no) | rule(scope_kind·scope_key)
// 표가 없으면(SQL 실행 전) 쓰기는 409 「SQL 실행 전」. 인증은 /api/settings 와 같다(미들웨어 팀 로그인).

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const LOCATIONS = ["coupang", "transit", "internal"];
const ORDER_STATUS = ["ordered", "received", "cancelled"];
const NOTE_KINDS = ["stopped", "discontinued", "memo"];
const BRANDS = ["nutty", "saip", "ironpet", "other"];
const CONFIDENCE = ["확실", "추정", "없음"];
const TAGS: DataTag[] = ["wekeep_sku_map", "inventory_manual_stock", "inventory_orders", "inventory_notes", "inventory_rules"];

type Json = Record<string, unknown>;
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
const str = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const optStr = (v: unknown, max = 500) => { const s = str(v, max); return s ? s : null; };
const nonNegInt = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n >= 0 ? n : null; };

async function getImpl() {
  const missing = new Set<string>();
  const read = async <T,>(table: InventoryTable, q: PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>) => {
    const { data, error } = await q;
    if (error) {
      if (isMissingTable(error)) { missing.add(table); return [] as T[]; }
      throw new Error(`${table}: ${error.message}`);
    }
    return (data as T[]) || [];
  };
  try {
    const [skus, stocks, orders, notes, rules, components] = await Promise.all([
      loadSkuList(),
      read<Json>("inventory_manual_stock", supabase.from("inventory_manual_stock").select("*").order("as_of", { ascending: false }).limit(2000)),
      read<Json>("inventory_orders", supabase.from("inventory_orders").select("*").order("ordered_at", { ascending: false }).limit(500)),
      read<Json>("inventory_notes", supabase.from("inventory_notes").select("*")),
      read<Json>("inventory_rules", supabase.from("inventory_rules").select("*").order("scope_kind").order("scope_key")),
      loadComponentRows(),
    ]);
    skus.missing.forEach((t) => missing.add(t));
    const componentNames = [...new Set(components.filter((c) => ["nutty", "saip", "ironpet"].includes(c.brand)).map((c) => c.component.trim()))]
      .sort((a, b) => a.localeCompare(b, "ko"));
    return NextResponse.json({
      mode: skus.mode,
      missing: INVENTORY_TABLES.filter((t) => missing.has(t)),
      skus: skus.snapshot.map((s) => ({ sku_no: s.sku_no, name: s.product_name, available: s.available_qty, date: s.date })),
      map: skus.map,
      stocks, orders, notes, rules,
      defaults: DEFAULT_THRESHOLDS,
      components: componentNames,
    });
  } catch (error) {
    console.error("inventory-settings GET:", error);
    return NextResponse.json({ error: "재고 설정을 불러오지 못했습니다" }, { status: 500 });
  }
}

/** 표 쓰기 결과 → 응답. 표가 없으면 409 */
function written(error: { code?: string; message?: string } | null, table: string) {
  if (!error) return NextResponse.json({ ok: true });
  if (isMissingTable(error)) return bad(`${table} 표가 아직 없습니다. docs/sql/2026-11-10-inventory.sql 을 먼저 실행해야 합니다`, 409);
  return bad(`저장 실패: ${error.message}`, 500);
}

async function postImpl(req: NextRequest) {
  let body: { type?: string; data?: Json };
  try { body = await req.json(); } catch { return bad("JSON 파싱 실패"); }
  const d = body.data || {};
  const now = new Date().toISOString();
  const sku = str(d.sku_no, 40);

  switch (body.type) {
    case "stock": {
      const qty = nonNegInt(d.qty);
      const asOf = str(d.as_of, 10);
      if (!sku) return bad("SKU 를 고르세요");
      if (!LOCATIONS.includes(String(d.location))) return bad("위치는 쿠팡·이동 중·내부 중 하나");
      if (!ISO.test(asOf)) return bad("기준일 형식은 YYYY-MM-DD");
      if (qty === null) return bad("수량은 0 이상 정수");
      const { error } = await supabase.from("inventory_manual_stock").upsert(
        { sku_no: sku, location: d.location, as_of: asOf, qty, note: optStr(d.note), updated_at: now },
        { onConflict: "sku_no,location,as_of" });
      return written(error, "inventory_manual_stock");
    }
    case "order": {
      const qty = nonNegInt(d.qty);
      const orderedAt = str(d.ordered_at, 10);
      const expectedAt = optStr(d.expected_at, 10);
      const status = String(d.status || "ordered");
      if (!sku) return bad("SKU 를 고르세요");
      if (!qty) return bad("발주 수량은 1 이상 정수");
      if (!ISO.test(orderedAt)) return bad("발주일 형식은 YYYY-MM-DD");
      if (expectedAt && !ISO.test(expectedAt)) return bad("입고 예정일 형식은 YYYY-MM-DD");
      if (expectedAt && expectedAt < orderedAt) return bad("입고 예정일이 발주일보다 앞입니다");
      if (!ORDER_STATUS.includes(status)) return bad("상태는 ordered·received·cancelled 중 하나");
      const row = { sku_no: sku, qty, ordered_at: orderedAt, expected_at: expectedAt, status, note: optStr(d.note), updated_at: now };
      const id = Number(d.id);
      const { error } = Number.isInteger(id) && id > 0
        ? await supabase.from("inventory_orders").update(row).eq("id", id)
        : await supabase.from("inventory_orders").insert(row);
      return written(error, "inventory_orders");
    }
    case "note": {
      if (!sku) return bad("SKU 를 고르세요");
      const kind = String(d.kind || "memo");
      if (!NOTE_KINDS.includes(kind)) return bad("종류는 판매 중지·단종·메모 중 하나");
      const { error } = await supabase.from("inventory_notes").upsert(
        { sku_no: sku, kind, note: optStr(d.note), exclude: d.exclude !== false, updated_at: now }, { onConflict: "sku_no" });
      return written(error, "inventory_notes");
    }
    case "rule": {
      const kind = String(d.scope_kind);
      const key = str(d.scope_key, 40);
      const [w, s, o] = [Number(d.warn_days), Number(d.soon_days), Number(d.over_days)];
      if (!["brand", "supplier"].includes(kind) || !key) return bad("브랜드 또는 공급처를 고르세요");
      if (kind === "brand" && !BRANDS.includes(key)) return bad("모르는 브랜드");
      if (![w, s, o].every((n) => Number.isFinite(n) && n >= 0) || !(w <= s && s < o)) return bad("발주 필요 ≤ 곧 발주 < 과재고 순이어야 합니다");
      const { error } = await supabase.from("inventory_rules").upsert(
        { scope_kind: kind, scope_key: key, warn_days: w, soon_days: s, over_days: o, updated_at: now }, { onConflict: "scope_kind,scope_key" });
      return written(error, "inventory_rules");
    }
    case "map": {
      if (!sku) return bad("SKU 가 없습니다");
      const brand = optStr(d.brand, 20);
      const confidence = optStr(d.confidence, 4);
      if (brand && !BRANDS.includes(brand)) return bad("모르는 브랜드");
      if (confidence && !CONFIDENCE.includes(confidence)) return bad("확실·추정·없음 중 하나");
      const row: Json = {
        sku_no: sku, component: optStr(d.component), product_code: optStr(d.product_code, 40), brand, supplier: optStr(d.supplier, 40),
        confirmed: d.confirmed === true, exclude: d.exclude === true, note: optStr(d.note, 1000), updated_at: now,
      };
      if (confidence) row.confidence = confidence;
      if (typeof d.product_name === "string") row.product_name = str(d.product_name, 300);
      const { error } = await supabase.from("wekeep_sku_map").upsert(row, { onConflict: "sku_no" });
      return written(error, "wekeep_sku_map");
    }
    default:
      return bad("type 은 stock · order · note · rule · map 중 하나");
  }
}

async function deleteImpl(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const type = sp.get("type");
  if (type === "stock") {
    const { error } = await supabase.from("inventory_manual_stock").delete()
      .eq("sku_no", sp.get("sku_no") || "").eq("location", sp.get("location") || "").eq("as_of", sp.get("as_of") || "");
    return written(error, "inventory_manual_stock");
  }
  if (type === "order") {
    const id = Number(sp.get("id"));
    if (!Number.isInteger(id) || id <= 0) return bad("id 가 이상합니다");
    const { error } = await supabase.from("inventory_orders").delete().eq("id", id);
    return written(error, "inventory_orders");
  }
  if (type === "note") {
    const { error } = await supabase.from("inventory_notes").delete().eq("sku_no", sp.get("sku_no") || "");
    return written(error, "inventory_notes");
  }
  if (type === "rule") {
    const { error } = await supabase.from("inventory_rules").delete()
      .eq("scope_kind", sp.get("scope_kind") || "").eq("scope_key", sp.get("scope_key") || "");
    return written(error, "inventory_rules");
  }
  return bad("type 은 stock · order · note · rule 중 하나");
}

export const GET = cachedGET(getImpl, [...TAGS, "raw_wekeep_snapshot", "product_components"], []);
export const POST = revalidateAfter(postImpl, TAGS);
export const DELETE = revalidateAfter(deleteImpl, TAGS);
