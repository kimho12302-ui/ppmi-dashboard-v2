export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/db";
import { expandBrands } from "@/lib/brand-groups";
import { masterByPid } from "@/lib/product-master";
import { blTestLineOrNull } from "@/lib/brand-groups";
import { cachedGET } from "@/lib/api-cache";
import { isGonggu, isGongguAggregate } from "@/lib/gonggu";

/**
 * 제품(상품) 단위 광고 성과.
 *
 * daily_ad_spend 와 **의도적으로 분리된** 테이블을 읽는다. 브랜드 합계는 daily_ad_spend 가
 * 원장이고(매출·ROAS·페이싱이 전부 거기 걸려 있다), 여기는 드릴다운 전용이다.
 * 한 테이블에 섞으면 /api/ads 가 행 단위로 합산해 무조건 이중계상된다.
 */
async function getImpl(req: NextRequest) {
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
    let sq = supabase.from("product_sales").select("product,brand,channel,lineup,revenue,quantity").gte("date", from).lte("date", to);
    if (brand !== "all") sq = sq.in("brand", expandBrands(brand));
    const salesRows = await fetchAll(sq);
    // ★ 실매출은 공구 판매를 뺀다(2026-11-09). 공구는 셀러가 자기 채널에서 팔아 광고와 상관없이
    //   팔리는데, 검사 라인으로 이으면 공구까지 실매출에 들어가 실 ROAS 가 부풀었다
    //   (2026-10 뉴트리션 1,941,000원 = 자체 969,000 + 공구 972,000).
    //   공구 판정은 공용 규칙(gonggu.ts isGonggu)이고 밸런스랩에만 쓴다. 펫은 lineup 이 정규
    //   라인업이라 같은 규칙을 쓰면 정상 판매가 통째로 빠진다.
    //   연결 여부(이름·라인이 판매 원장에 있는가)는 공구 포함 전체 판매로 정한다. 공구로만 팔린
    //   제품은 「미연결」이 아니라 「연결됨, 자체 실매출 0」이다.
    const isExcludedGonggu = (r: Record<string, unknown>): boolean => {
      if (r.brand !== "balancelab") return false;
      const row = { product: r.product as string | null, channel: r.channel as string | null, lineup: r.lineup as string | null };
      return isGonggu(row) || isGongguAggregate(row);
    };
    const linkedNames = new Set<string>();
    const linkedLines = new Set<string>();
    const salesByProduct = new Map<string, { revenue: number; quantity: number }>();
    // ★ 밸런스랩은 판매 원장이 옵션까지 쪼개진 SKU 다
    //   ("큐모발검사 중금속", "큐모발검사 중금속 + 종이결과지", "큐음식물 과민증 검사 식단관리").
    //   광고는 검사 제품 단위라 이름이 정확히 같은 것만 이으면 옵션 매출이 통째로 빠진다
    //   (중금속이 65,000원으로 나왔는데 + 종이결과지 209,000원이 누락됐다, 2026-09-29).
    //   검사 라인 분류기(brand-groups 의 단일 정본)로 묶어 같은 라인끼리 합산한다.
    // ★ 라인 묶음은 밸런스랩 검사 제품만이다(키 = 브랜드|라인). 어느 라인에도 안 맞는 이름은
    //   묶지 않는다. 예전엔 "etc" 라는 이름의 묶음이 생겨, 라인 밖 광고 상품이 라인 밖 판매 전체와
    //   이어졌다(밸런스랩검사 광고에 비타민C 매출, 펫 브랜드는 정본에 없는 상품이 그 브랜드 판매 전체).
    //   그런 상품은 「미연결」로 둔다(2026-11-09).
    const salesByLine = new Map<string, { revenue: number; quantity: number }>();
    const lineKey = (brand: unknown, product: unknown): string | null => {
      if (brand !== "balancelab") return null;
      const line = blTestLineOrNull(String(product));
      return line ? `balancelab|${line}` : null;
    };
    for (const r of salesRows as Record<string, unknown>[]) {
      const k = String(r.product);
      const line = lineKey(r.brand, k);
      linkedNames.add(k);
      if (line) linkedLines.add(line);
      if (isExcludedGonggu(r)) continue;

      const cur = salesByProduct.get(k) || { revenue: 0, quantity: 0 };
      cur.revenue += Number(r.revenue) || 0;
      cur.quantity += Number(r.quantity) || 0;
      salesByProduct.set(k, cur);

      if (line) {
        const lc = salesByLine.get(line) || { revenue: 0, quantity: 0 };
        lc.revenue += Number(r.revenue) || 0;
        lc.quantity += Number(r.quantity) || 0;
        salesByLine.set(line, lc);
      }
    }

    // 상품 단위로 기간 합산.
    const map = new Map<string, {
      product_id: string; product_name: string; brand: string; lineup: string | null;
      spend: number; impressions: number; clicks: number; conversions: number; conversion_value: number;
    }>();
    for (const r of rows as Record<string, unknown>[]) {
      // ★ 합산 키는 제품명이다. 같은 제품이 매체·캠페인별로 여러 product_id 를 갖는다
      //   (네이버 검색광고는 파워링크·쇼핑이 캠페인ID가 달라 큐음식물과민증검사가 두 줄로 갈렸다).
      //   화면이 보는 단위는 '제품'이지 '광고 단위'가 아니다.
      const key = `${r.brand}|${r.product_name}`;
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
        // 상품번호(스마트스토어)로 정본을 찾는다. 네이버 검색광고처럼 캠페인ID 기반이라
        // 정본에 없으면, 제품명이 판매 원장과 그대로 일치하는지 본다(밸런스랩 검사 제품이 그렇다).
        // ① 스마트스토어 상품번호로 정본 조회(GFA 경로). ② 제품명이 판매 원장에 그대로 있으면 그것.
        // ③ 밸런스랩은 검사 라인으로 묶어 옵션 SKU 까지 합산.
        const m = masterByPid(p.product_id);
        const adLine = lineKey(p.brand, p.product_name);
        const lineSale = adLine ? salesByLine.get(adLine) : undefined;
        const nameLinked = linkedNames.has(p.product_name);
        const salesName = m?.product
          ?? (nameLinked ? p.product_name : null)
          ?? (adLine && linkedLines.has(adLine) ? p.product_name : null);
        const sale = m?.product
          ? salesByProduct.get(m.product)
          : (nameLinked ? salesByProduct.get(p.product_name) : lineSale);
        return {
          ...p,
          roas: p.spend > 0 ? p.conversion_value / p.spend : 0,
          // 정본으로 이어붙인 실제 판매(밸런스랩은 공구 제외). 상품번호가 시트에 없으면 null 로 두고
          // 화면이 '연결 안 됨'과 '판매 0'을 구분해 말할 수 있게 한다.
          salesProduct: salesName,
          actualRevenue: salesName ? (sale?.revenue ?? 0) : null,
          actualQuantity: salesName ? (sale?.quantity ?? 0) : null,
          actualRoas: salesName && p.spend > 0 ? (sale?.revenue ?? 0) / p.spend : null,
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

// 5분 캐시·쓰기 후 무효화 (src/lib/api-cache.ts)
export const GET = cachedGET(getImpl, ["ad_product_performance", "product_sales"], ["brand", "from", "to"]);
