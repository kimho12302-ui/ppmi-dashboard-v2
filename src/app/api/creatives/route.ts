import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/db";
import { expandBrands } from "@/lib/brand-groups";
import { cachedGET } from "@/lib/api-cache";

// 메타 소재별 성과. 2026-10-13 원천 교체.
//
// 전에는 이 서버가 그래프 API 를 직접 불렀는데, 유효한 메타 토큰은 GitHub Secrets 에만 있고
// (rotate_meta_token.py 가 거기만 갱신) 대시보드 서버 사본은 비어 있어 탭이 늘 비었다.
// 게다가 계정 목록에 밸런스랩이 빠져 있었다(지금 메타를 쓰는 유일한 브랜드).
// 지금은 수집기(sync_meta_api.py)가 소재×일을 meta_ad_daily 에 쓰고 여기서 기간 합산한다.
//
// ★ 밸런스랩 픽셀은 건강 분류로 구매(Purchase)가 막혀 있고 상세조회(ViewContent)는 살아 있다.
//   구매·ROAS 로 그리면 모든 소재가 0 으로 보이므로 purchaseTracked=false 를 같이 준다.
const PURCHASE_UNTRACKED = new Set(["balancelab"]);

interface Row {
  date: string; brand: string; ad_id: string; ad_name: string | null; campaign_name: string | null;
  thumbnail_url: string | null; impressions: number; clicks: number; spend: number;
  purchases: number; purchase_value: number; add_to_cart: number; view_content: number;
}

async function getImpl(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const brand = sp.get("brand") || "all";
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ creatives: [], total: 0, error: "from·to 는 YYYY-MM-DD" }, { status: 400 });
  }
  if (brand === "saip") {
    return NextResponse.json({ creatives: [], total: 0, error: "사입은 메타 광고 계정이 없습니다" });
  }

  try {
    let q = supabase.from("meta_ad_daily")
      .select("date,brand,ad_id,ad_name,campaign_name,thumbnail_url,impressions,clicks,spend,purchases,purchase_value,add_to_cart,view_content")
      .gte("date", from).lte("date", to).order("date");
    if (brand !== "all") q = q.in("brand", expandBrands(brand));
    // 기본키 (date, ad_id) 라 date 다음 ad_id 로 전순서가 된다.
    const rows = (await fetchAll(q, "ad_id")) as Row[];

    const m = new Map<string, Row & { lastDate: string; firstDate: string }>();
    for (const r of rows) {
      const e = m.get(r.ad_id);
      if (!e) { m.set(r.ad_id, { ...r, lastDate: r.date, firstDate: r.date }); continue; }
      e.impressions += Number(r.impressions || 0); e.clicks += Number(r.clicks || 0); e.spend += Number(r.spend || 0);
      e.purchases += Number(r.purchases || 0); e.purchase_value += Number(r.purchase_value || 0);
      e.add_to_cart += Number(r.add_to_cart || 0); e.view_content += Number(r.view_content || 0);
      if (r.date > e.lastDate) { e.lastDate = r.date; if (r.thumbnail_url) e.thumbnail_url = r.thumbnail_url; if (r.ad_name) e.ad_name = r.ad_name; }
      if (r.date < e.firstDate) e.firstDate = r.date;
    }

    const creatives = Array.from(m.values())
      .filter((c) => Number(c.spend) > 0)
      .map((c) => {
        const spend = Number(c.spend), clicks = Number(c.clicks), imp = Number(c.impressions);
        const purchases = Number(c.purchases), revenue = Number(c.purchase_value);
        return {
          id: c.ad_id, name: c.ad_name || c.ad_id, campaign: c.campaign_name || "",
          brand: c.brand, status: `${c.firstDate.slice(5)} ~ ${c.lastDate.slice(5)} 집행`,
          thumbnail_url: c.thumbnail_url || "",
          spend: Math.round(spend), impressions: imp, clicks,
          ctr: imp > 0 ? (clicks / imp) * 100 : 0, cpc: clicks > 0 ? spend / clicks : 0,
          purchases, revenue, roas: spend > 0 ? revenue / spend : 0, cac: purchases > 0 ? spend / purchases : 0,
          add_to_cart: Number(c.add_to_cart), view_content: Number(c.view_content), landing_page_views: 0,
          purchaseTracked: !PURCHASE_UNTRACKED.has(c.brand),
        };
      })
      .sort((a, b) => b.spend - a.spend);

    const latest = rows.reduce((mx, r) => (r.date > mx ? r.date : mx), "");
    return NextResponse.json({
      creatives, total: creatives.length, latestCollected: latest || null,
      ...(creatives.length === 0 && brand !== "all" && brand !== "balancelab"
        ? { notice: "이 기간에 이 브랜드의 메타 집행이 없습니다" } : {}),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : (error as { message?: string })?.message || String(error);
    console.error("Creatives API error:", msg);
    return NextResponse.json({ creatives: [], total: 0, error: `메타 소재를 불러오지 못했습니다: ${msg}` }, { status: 500 });
  }
}

// 5분 캐시·쓰기 후 무효화 (src/lib/api-cache.ts)
export const GET = cachedGET(getImpl, ["meta_ad_daily"], ["brand", "from", "to"]);
