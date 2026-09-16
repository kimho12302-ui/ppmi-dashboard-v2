export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/db";
import { expandBrands } from "@/lib/brand-groups";
import { masterByPid } from "@/lib/product-master";

/**
 * 제품(상품) 단위 광고 성과.
 *
 * daily_ad_spend 와 **의도적으로 분리된** 테이블을 읽는다. 브랜드 합계는 daily_ad_spend 가
 * 원장이고(매출·ROAS·페이싱이 전부 거기 걸려 있다), 여기는 드릴다운 전용이다.
 * 한 테이블에 섞으면 /api/ads 가 행 단위로 합산해 무조건 이중계상된다.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";
  const brand = sp.get("brand") || "all";

  try {
    let q = supabase
      .from("ad_product_performance")
      .select("date,brand,product_id,product_name,lineup,spend,impressions,clicks,conversions,conversion_value")
      .gte("date", from)
      .lte("date", to);
    if (brand !== "all") q = q.in("brand", expandBrands(brand));

    const rows = await fetchAll(q);

    // 같은 기간 실제 판매. 제품 정본(상품번호 → 판매 제품명)으로 광고와 잇는다.
    // 플랫폼 신고 전환매출은 매체마다 같은 주문을 자기 기여로 세서 실매출을 넘는다.
    // 제품 단위에서도 마찬가지라, 실판매를 같이 보여줘야 판단이 된다.
    let sq = supabase.from("product_sales").select("product,brand,revenue,quantity").gte("date", from).lte("date", to);
    if (brand !== "all") sq = sq.in("brand", expandBrands(brand));
    const salesRows = await fetchAll(sq);
    const salesByProduct = new Map<string, { revenue: number; quantity: number }>();
    for (const r of salesRows as Record<string, unknown>[]) {
      const k = String(r.product);
      const cur = salesByProduct.get(k) || { revenue: 0, quantity: 0 };
      cur.revenue += Number(r.revenue) || 0;
      cur.quantity += Number(r.quantity) || 0;
      salesByProduct.set(k, cur);
    }

    // 상품 단위로 기간 합산.
    const map = new Map<string, {
      product_id: string; product_name: string; brand: string; lineup: string | null;
      spend: number; impressions: number; clicks: number; conversions: number; conversion_value: number;
    }>();
    for (const r of rows as Record<string, unknown>[]) {
      const key = `${r.brand}|${r.product_id}`;
      const cur = map.get(key) || {
        product_id: String(r.product_id), product_name: String(r.product_name),
        brand: String(r.brand), lineup: (r.lineup as string) ?? null,
        spend: 0, impressions: 0, clicks: 0, conversions: 0, conversion_value: 0,
      };
      cur.spend += Number(r.spend) || 0;
      cur.impressions += Number(r.impressions) || 0;
      cur.clicks += Number(r.clicks) || 0;
      cur.conversions += Number(r.conversions) || 0;
      cur.conversion_value += Number(r.conversion_value) || 0;
      map.set(key, cur);
    }

    const products = Array.from(map.values())
      .map((p) => {
        const m = masterByPid(p.product_id);
        const sale = m ? salesByProduct.get(m.product) : undefined;
        return {
          ...p,
          roas: p.spend > 0 ? p.conversion_value / p.spend : 0,
          // 정본으로 이어붙인 실제 판매. 상품번호가 시트에 없으면 null 로 두고
          // 화면이 '연결 안 됨'과 '판매 0'을 구분해 말할 수 있게 한다.
          salesProduct: m?.product ?? null,
          actualRevenue: m ? (sale?.revenue ?? 0) : null,
          actualQuantity: m ? (sale?.quantity ?? 0) : null,
          actualRoas: m && p.spend > 0 ? (sale?.revenue ?? 0) / p.spend : null,
        };
      })
      .sort((a, b) => b.spend - a.spend);
    const linkedCount = products.filter((p) => p.salesProduct !== null).length;

    // 라인업(밸런스랩 검사 제품) 합산. 펫 브랜드는 lineup 이 null 이라 빠진다.
    const lineMap = new Map<string, { lineup: string; brand: string; spend: number; conversion_value: number }>();
    for (const p of products) {
      if (!p.lineup) continue;
      const cur = lineMap.get(p.lineup) || { lineup: p.lineup, brand: p.brand, spend: 0, conversion_value: 0 };
      cur.spend += p.spend;
      cur.conversion_value += p.conversion_value;
      lineMap.set(p.lineup, cur);
    }
    const lineups = Array.from(lineMap.values())
      .map((l) => ({ ...l, roas: l.spend > 0 ? l.conversion_value / l.spend : 0 }))
      .sort((a, b) => b.spend - a.spend);

    return NextResponse.json({ available: true, products, lineups, linkedCount, latestDate: rows.length ? (rows as Record<string, unknown>[]).reduce((m, r) => (String(r.date) > m ? String(r.date) : m), "") : null });
  } catch (error) {
    // ★ 테이블이 아직 없을 때(마이그레이션 미실행)는 500 이 아니라 available:false 로 내린다.
    //   화면이 '데이터 없음'과 '아직 준비 안 됨'을 구분해서 말할 수 있어야 한다.
    //   그 외 오류는 그대로 500 으로 드러낸다 — 조용히 빈 화면이 되는 게 제일 나쁘다.
    const msg = String((error as { message?: string })?.message || error);
    if (msg.includes("ad_product_performance") || msg.includes("PGRST205")) {
      return NextResponse.json({ available: false, products: [], lineups: [], reason: "제품 축 테이블이 아직 없습니다 (migrations/2026-09-15_ad_product_performance.sql 실행 필요)" });
    }
    console.error("product-ads error:", error);
    return NextResponse.json({ error: "제품별 광고 성과를 불러오지 못했습니다" }, { status: 500 });
  }
}
