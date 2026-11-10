import { NextRequest, NextResponse } from "next/server";
import { cachedGET } from "@/lib/api-cache";
import { kstDate } from "@/lib/date";
import { loadInventoryInputs, loadSkuDaily } from "@/lib/inventory-server";
import { addDays, computeInventory, fillDailySeries, DEFAULT_SPEED_WINDOW, SPEED_WINDOWS } from "@/lib/inventory";

// 재고 화면(/inventory) 읽기 (2026-11-10). 계산은 src/lib/inventory.ts, 원천 읽기는 src/lib/inventory-server.ts.
//   GET /api/inventory?window=28          → 카드·표 (SKU 마다 판정)
//   GET /api/inventory?sku=…&days=90      → 상품 하나 날짜별(상세 그래프). days = 30 · 90 · 180 · all(1월 1일부터)
// 위킵 표가 없으면(SQL 실행 전) 200 으로 { setupNeeded: true } 를 준다. 화면이 「SQL 실행 필요」를 띄운다.

const DETAIL_DAYS = ["30", "90", "180", "all"] as const;
const ALL_FROM = "2026-01-01";

async function getImpl(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  try {
    const sku = sp.get("sku");
    if (sku) {
      const daysParam = (DETAIL_DAYS as readonly string[]).includes(sp.get("days") || "") ? sp.get("days")! : "90";
      const to = kstDate(-1);
      const from = daysParam === "all" ? ALL_FROM : addDays(to, -(Number(daysParam) - 1));
      // 기간 앞 며칠을 더 읽어 첫날 재고를 전날 마감에서 잇는다
      const { mode, rows, missing } = await loadSkuDaily(sku, addDays(from, -7));
      if (missing) return NextResponse.json({ setupNeeded: true, mode });
      return NextResponse.json({ sku, from, to, days: daysParam, mode, series: fillDailySeries(rows, from, to) });
    }

    const w = Number(sp.get("window"));
    const window = (SPEED_WINDOWS as readonly number[]).includes(w) ? w : DEFAULT_SPEED_WINDOW;
    const loaded = await loadInventoryInputs(window);
    if (loaded.setupNeeded) {
      return NextResponse.json({ setupNeeded: true, mode: loaded.mode, missing: loaded.missing });
    }
    const result = computeInventory(loaded.input);
    return NextResponse.json({ ...result, mode: loaded.mode, missing: loaded.missing, today: kstDate() });
  } catch (error) {
    console.error("inventory API error:", error);
    // 못 읽은 것을 빈 재고로 내보내지 않는다
    return NextResponse.json({ error: "재고를 불러오지 못했습니다", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export const GET = cachedGET(
  getImpl,
  ["raw_wekeep_snapshot", "raw_wekeep_daily", "wekeep_sku_map", "inventory_manual_stock", "inventory_orders", "inventory_notes",
    "inventory_rules", "product_costs", "product_sales", "product_components"],
  ["window", "sku", "days"],
);
