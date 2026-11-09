export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/db";
import { expandBrands } from "@/lib/brand-groups";
import { masterByPid } from "@/lib/product-master";
import { blTestLineOrNull } from "@/lib/brand-groups";
import { cachedGET } from "@/lib/api-cache";
import { isGonggu, isGongguAggregate } from "@/lib/gonggu";
import { loadComponentIndex } from "@/lib/product-components-server";
import { expandSales, isMultiComponent, productKey, singleComponentOf } from "@/lib/product-components";
import { adStoreOf, type AdStore } from "@/lib/ad-store";

interface SaleRow { product: string; brand: string; channel: string | null; lineup: string | null; revenue: number; quantity: number }
interface Sale { revenue: number; quantity: number }
type Basis = "item" | "set" | "line";
/** 광고 줄이 이어지는 판매 단위. 실매출은 줄의 광고 판매처마다 saleKey 로 꺼내 더한다. */
type Link = { group: string; salesProduct: string | null; basis: Basis | null; saleKey: string | null };

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
      .select("date,brand,channel,product_id,product_name,lineup,spend,impressions,clicks,conversions,conversion_value")
      .gte("date", from)
      .lte("date", to);
    if (brand !== "all") q = q.in("brand", expandBrands(brand));

    // 같은 기간 실제 판매. 제품 정본(상품번호 → 판매 제품명)으로 광고와 잇는다.
    // 플랫폼 신고 전환매출은 매체마다 같은 주문을 자기 기여로 세서 실매출을 넘는다.
    // 제품 단위에서도 마찬가지라, 실판매를 같이 보여줘야 판단이 된다.
    let sq = supabase.from("product_sales").select("product,brand,channel,lineup,revenue,quantity").gte("date", from).lte("date", to);
    if (brand !== "all") sq = sq.in("brand", expandBrands(brand));
    const [rows, salesRows, components] = await Promise.all([fetchAll(q), fetchAll<SaleRow>(sq), loadComponentIndex()]);

    // ★ 판매는 구성표로 기본 품목까지 푼다(2026-11-09, src/lib/product-components.ts).
    //   「스트레스제로껌 2개」 광고와 「스트레스제로껌」 광고는 같은 품목(껌) 판매로 잇고,
    //   「큐모발검사 뉴트리션 + 종이결과지」 판매는 뉴트리션 몫만 뉴트리션 실매출에 들어간다.
    //   구성표가 없으면(SQL 실행 전) 행이 그대로라 예전과 같다.
    const sales = expandSales(salesRows, components);

    // ★ 실매출은 공구 판매를 뺀다(2026-11-09). 공구는 셀러가 자기 채널에서 팔아 광고와 상관없이
    //   팔리는데, 검사 라인으로 이으면 공구까지 실매출에 들어가 실 ROAS 가 부풀었다
    //   (2026-10 뉴트리션 1,941,000원 = 자체 969,000 + 공구 972,000).
    //   공구 판정은 공용 규칙(gonggu.ts isGonggu)이고 밸런스랩에만 쓴다. 펫은 lineup 이 정규
    //   라인업이라 같은 규칙을 쓰면 정상 판매가 통째로 빠진다.
    //   연결 여부(이름·라인이 판매 원장에 있는가)는 공구 포함 전체 판매로 정한다. 공구로만 팔린
    //   제품은 「미연결」이 아니라 「연결됨, 자체 실매출 0」이다.
    const isExcludedGonggu = (r: SaleRow): boolean =>
      r.brand === "balancelab" && (isGonggu(r) || isGongguAggregate(r));

    // ★ 밸런스랩은 판매 원장이 옵션까지 쪼개진 SKU 다
    //   ("큐모발검사 중금속", "큐모발검사 중금속 + 종이결과지", "큐음식물 과민증 검사 식단관리").
    //   광고는 검사 제품 단위라 검사 라인 분류기(brand-groups 의 단일 정본)로 묶어 같은 라인끼리 합산한다.
    //   예전엔 이름이 정확히 같은 판매가 라인보다 먼저 이겨 「+ 종이결과지」 판매가 통째로 빠졌다
    //   (2026-09 뉴트리션 299,000원, 중금속 209,000원). 이제 밸런스랩 검사 광고는 라인을 먼저 보고,
    //   라인 합은 구성표로 푼 뒤 품목 기준으로 센다(종이결과지 몫은 라인 밖).
    // ★ 라인 묶음은 밸런스랩 검사 제품만이다(키 = 브랜드|라인). 어느 라인에도 안 맞는 이름은
    //   묶지 않는다. 예전엔 "etc" 라는 이름의 묶음이 생겨, 라인 밖 광고 상품이 라인 밖 판매 전체와
    //   이어졌다(밸런스랩검사 광고에 비타민C 매출, 펫 브랜드는 정본에 없는 상품이 그 브랜드 판매 전체).
    //   그런 상품은 「미연결」로 둔다(2026-11-09).
    const lineKey = (b: unknown, product: unknown): string | null => {
      if (b !== "balancelab") return null;
      const line = blTestLineOrNull(String(product));
      return line ? `balancelab|${line}` : null;
    };
    const key = (b: unknown, product: unknown) => `${String(b)}|${productKey(String(product))}`;
    // ★ 실매출은 그 광고가 손님을 보내는 판매처 판매만 센다(2026-11-09).
    //   예전엔 판매처를 가리지 않아, 스마트스토어로 보내는 GFA 광고에 쿠팡·자사몰 판매까지 붙어
    //   펫 실 ROAS 가 수백 배로 보였다. 매체 → 판매처 대응은 「판매처별 성과」와 같은 공용 규칙
    //   (src/lib/ad-store.ts)이다. 판매 집계는 판매처별로 따로 두고, 광고 줄의 판매처만 더한다.
    //   연결 여부(linkedNames·linkedLines)는 판매처와 상관없이 전체 판매로 정한다.
    //   쿠팡에서만 팔린 품목은 「미연결」이 아니라 「연결됨, 광고 판매처 실매출 0」이다.
    const add = (m: Map<string, Sale>, k: string, r: SaleRow) => {
      const sk = `${r.channel ?? ""}|${k}`;
      const cur = m.get(sk) || { revenue: 0, quantity: 0 };
      m.set(sk, { revenue: cur.revenue + (Number(r.revenue) || 0), quantity: cur.quantity + (Number(r.quantity) || 0) });
    };
    const saleIn = (m: Map<string, Sale>, k: string, stores: readonly AdStore[]): Sale => {
      let revenue = 0, quantity = 0;
      for (const st of stores) {
        const v = m.get(`${st}|${k}`);
        if (v) { revenue += v.revenue; quantity += v.quantity; }
      }
      return { revenue, quantity };
    };

    const linkedNames = new Set<string>();         // 판매 원장 이름 + 기본 품목 이름 (브랜드|이름)
    const linkedLines = new Set<string>();
    const salesByItem = new Map<string, Sale>();   // 판매처|기본 품목별 (푼 뒤)
    const salesBySet = new Map<string, Sale>();    // 판매처|판매 상품별 (풀기 전, 세트 광고용)
    const salesByLine = new Map<string, Sale>();   // 판매처|밸런스랩 검사 라인별 (푼 뒤)
    for (const r of salesRows) {
      linkedNames.add(key(r.brand, r.product));
      if (!isExcludedGonggu(r)) add(salesBySet, key(r.brand, r.product), r);
    }
    for (const r of sales) {
      linkedNames.add(key(r.brand, r.product));
      const line = lineKey(r.brand, r.product);
      if (line) linkedLines.add(line);
      if (isExcludedGonggu(r)) continue;
      add(salesByItem, key(r.brand, r.product), r);
      if (line) add(salesByLine, line, r);
    }

    // 광고 상품 → 이을 판매 단위. 같은 판매 단위(기본 품목·세트·검사 라인)로 이어지는 광고 상품은 한 줄로 합친다.
    // 「껌」「껌 2개」 광고가 따로 줄이면 둘 다 껌 전체 실매출을 받아 실 ROAS 가 부풀고 합계도 두 번 센다.
    const linkOf = (b: string, productId: string, productName: string): Link => {
      // ① 밸런스랩 검사 광고는 검사 라인(옵션 SKU 까지 합산, 푼 뒤 품목 기준)
      const adLine = lineKey(b, productName);
      if (adLine && linkedLines.has(adLine)) {
        return { group: `${b}|line|${adLine}|${productName}`, salesProduct: productName, basis: "line", saleKey: adLine };
      }
      // ② 스마트스토어 상품번호로 정본 조회(GFA 경로). ③ 광고 이름이 판매 원장·구성표에 그대로 있으면 그것.
      const m = masterByPid(productId);
      const name = m?.product
        ?? (linkedNames.has(key(b, productName)) || components.get(b, productName) ? productName : null);
      if (!name) return { group: `${b}|ad|${productName}`, salesProduct: null, basis: null, saleKey: null };
      // 여러 품목 세트(냠+바삭 등)는 세트 상품 자체 판매로 잇는다. 한 품목 묶음·단품은 그 품목 판매 전체.
      if (isMultiComponent(components, b, name)) {
        return { group: `${b}|set|${productKey(name)}`, salesProduct: name, basis: "set", saleKey: key(b, name) };
      }
      const item = singleComponentOf(components, b, name) ?? name;
      return { group: `${b}|item|${productKey(item)}`, salesProduct: item, basis: "item", saleKey: key(b, item) };
    };

    // 판매 단위로 기간 합산.
    // ★ 같은 제품이 매체·캠페인별로 여러 product_id 를 갖는다
    //   (네이버 검색광고는 파워링크·쇼핑이 캠페인ID가 달라 큐음식물과민증검사가 두 줄로 갈렸다).
    //   화면이 보는 단위는 '제품'이지 '광고 단위'가 아니다. 판매에 못 이은 광고는 광고 이름 단위로 둔다.
    //   검사 라인 광고는 광고 이름까지 키에 넣는다(「큐모발검사」 공통 광고와 「큐모발검사 뉴트리션」 광고는 그대로 따로).
    const map = new Map<string, {
      product_id: string; product_name: string; brand: string; lineup: string | null; adNames: string[];
      spend: number; impressions: number; clicks: number; conversions: number; conversion_value: number;
      link: Link;
      /** 이 줄 광고들이 손님을 보내는 판매처(여러 매체를 합친 줄이면 합집합) */
      stores: AdStore[];
      /** 판매처를 정하지 않은 매체(공용 규칙에 없는 매체). 실매출에 넣지 않는다 */
      unmappedChannels: string[];
    }>();
    for (const r of rows as Record<string, unknown>[]) {
      const b = String(r.brand), name = String(r.product_name), ch = String(r.channel ?? "");
      const link = linkOf(b, String(r.product_id), name);
      const store = adStoreOf(b, ch);
      const cur = map.get(link.group) || {
        product_id: String(r.product_id),
        // 기본 품목·세트로 이은 줄은 판매 이름으로 보인다(광고 상품명은 adNames)
        product_name: link.basis === "item" || link.basis === "set" ? String(link.salesProduct) : name,
        brand: b, lineup: (r.lineup as string) ?? null, adNames: [],
        spend: 0, impressions: 0, clicks: 0, conversions: 0, conversion_value: 0, link,
        stores: [] as AdStore[], unmappedChannels: [] as string[],
      };
      map.set(link.group, {
        ...cur,
        adNames: cur.adNames.includes(name) ? cur.adNames : [...cur.adNames, name],
        stores: !store || cur.stores.includes(store) ? cur.stores : [...cur.stores, store],
        unmappedChannels: store || cur.unmappedChannels.includes(ch) ? cur.unmappedChannels : [...cur.unmappedChannels, ch],
        spend: cur.spend + (Number(r.spend) || 0),
        impressions: cur.impressions + (Number(r.impressions) || 0),
        clicks: cur.clicks + (Number(r.clicks) || 0),
        conversions: cur.conversions + (Number(r.conversions) || 0),
        conversion_value: cur.conversion_value + (Number(r.conversion_value) || 0),
      });
    }

    const saleMap = (basis: Basis): Map<string, Sale> => (basis === "line" ? salesByLine : basis === "set" ? salesBySet : salesByItem);
    const products = Array.from(map.values())
      .map(({ link, stores, ...p }) => {
        // 이어붙인 실제 판매(광고 판매처 판매만, 밸런스랩은 공구 제외). 이을 판매를 못 찾으면 null 로 두고
        // 화면이 '연결 안 됨'과 '판매 0'을 구분해 말할 수 있게 한다.
        // 판매처를 하나도 정하지 못한 줄(공용 규칙에 없는 매체만 있는 줄)도 null 이다. 판매처를 모르면서
        // 전체 판매를 붙이면 예전처럼 부풀고, 0 을 붙이면 안 팔린 것처럼 읽힌다. 2026-11-09 기준 해당 행 0건.
        const linked = link.salesProduct !== null && link.basis !== null && link.saleKey !== null && stores.length > 0;
        const sale = linked ? saleIn(saleMap(link.basis as Basis), link.saleKey as string, stores) : null;
        return {
          ...p,
          roas: p.spend > 0 ? p.conversion_value / p.spend : 0,
          salesProduct: link.salesProduct,
          salesBasis: link.basis,
          salesStores: stores,
          actualRevenue: sale ? sale.revenue : null,
          actualQuantity: sale ? sale.quantity : null,
          actualRoas: sale && p.spend > 0 ? sale.revenue / p.spend : null,
        };
      })
      .sort((a, b) => b.spend - a.spend);
    const linkedCount = products.filter((p) => p.salesProduct !== null).length;

    // 라인업(밸런스랩 검사 제품) 합산. 펫 브랜드는 lineup 이 null 이라 빠진다.
    const lineMap = new Map<string, { lineup: string; brand: string; spend: number; conversion_value: number }>();
    for (const p of products) {
      if (!p.lineup) continue;
      const cur = lineMap.get(p.lineup) || { lineup: p.lineup, brand: p.brand, spend: 0, conversion_value: 0 };
      lineMap.set(p.lineup, { ...cur, spend: cur.spend + p.spend, conversion_value: cur.conversion_value + p.conversion_value });
    }
    const lineups = Array.from(lineMap.values())
      .map((l) => ({ ...l, roas: l.spend > 0 ? l.conversion_value / l.spend : 0 }))
      .sort((a, b) => b.spend - a.spend);

    return NextResponse.json({
      available: true, products, lineups, linkedCount,
      componentsReady: components.size > 0,
      latestDate: rows.length ? (rows as Record<string, unknown>[]).reduce((m, r) => (String(r.date) > m ? String(r.date) : m), "") : null,
    });
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
export const GET = cachedGET(getImpl, ["ad_product_performance", "product_sales", "product_components"], ["brand", "from", "to"]);
