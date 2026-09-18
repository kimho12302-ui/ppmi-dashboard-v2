import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/db";

// 쿠팡 광고 키워드 성과. 2026-09-18 신설.
// 원천은 raw_coupang_keyword(쿠팡 예약 일간 보고서의 키워드 행, 로컬 수집기가 매일 넣는다).
// 기간 안의 행을 키워드·노출 지면으로 합쳐 돌려준다. 쿠팡 광고는 너티만 집행한다.

interface RawRow {
  date: string;
  keyword: string | null;
  placement: string | null;
  campaign: string | null;
  impressions: number;
  clicks: number;
  spend: number;
  orders_1d: number;
  conv_sales_1d: number;
  orders_14d: number;
  conv_sales_14d: number;
  file: string | null;
  read_at: string | null;
}

type Sum = Omit<RawRow, "date" | "keyword" | "placement" | "campaign" | "file" | "read_at">;
const METRICS: (keyof Sum)[] = ["impressions", "clicks", "spend", "orders_1d", "conv_sales_1d", "orders_14d", "conv_sales_14d"];
const zero = (): Sum => ({ impressions: 0, clicks: 0, spend: 0, orders_1d: 0, conv_sales_1d: 0, orders_14d: 0, conv_sales_14d: 0 });
const add = (a: Sum, r: RawRow) => { for (const k of METRICS) a[k] += Number(r[k]) || 0; };

// 상품 = 캠페인. 쿠팡 캠페인을 상품 하나씩 짜 두었고(로켓배송_제로껌_260815), 맞춤 보고서에는 상품 칸이
// 비어 있어 캠페인 이름이 유일한 상품 단서다(2026-09-18 확인). 앞의 "로켓배송_"·날짜 조각을 떼어 묶는다.
function productOf(campaign: string | null): string {
  if (!campaign) return "(캠페인 없음)";
  const name = campaign
    .replace(/^로켓배송_/, "")
    .replace(/^\d{6}_/, "")
    .replace(/_\d{6}$/, "")
    .trim();
  return name || campaign;
}

// 비검색 영역·외부 채널 행은 키워드 칸이 '-' 다. 키워드 표에서는 한 줄로 묶어 따로 보인다.
const NO_KEYWORD = "(키워드 없음: 비검색·외부 지면)";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";
  const product = sp.get("product"); // 주면 그 상품의 행만으로 키워드·지면을 낸다
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: "from·to 는 YYYY-MM-DD" }, { status: 400 });
  }

  try {
    const fetched = await fetchAll<RawRow>(
      supabase
        .from("raw_coupang_keyword")
        .select("date,keyword,placement,campaign,impressions,clicks,spend,orders_1d,conv_sales_1d,orders_14d,conv_sales_14d,file,read_at")
        .gte("date", from)
        .lte("date", to)
        .order("date"),
      "row_key",
    );

    // 한 날짜에 파일이 둘 이상이면(손으로 받은 맞춤 보고서 + 매일 예약 보고서) 행 구성이 달라 row_key 가
    // 겹치지 않고 둘 다 남는다. 그대로 합치면 두 번 센다. 날짜마다 가장 늦게 읽은 파일 하나만 쓴다.
    const latestFile = new Map<string, { file: string | null; at: string }>();
    for (const r of fetched) {
      const cur = latestFile.get(r.date);
      const at = r.read_at || "";
      if (!cur || at > cur.at) latestFile.set(r.date, { file: r.file, at });
    }
    const deduped = fetched.filter((r) => latestFile.get(r.date)?.file === r.file);

    // 상품 표는 항상 전체 기준. 나머지(키워드·지면·합계)는 상품을 고르면 그 상품만.
    const byProduct = new Map<string, Sum & { product: string; keywords: Set<string> }>();
    for (const r of deduped) {
      const name = productOf(r.campaign);
      const p = byProduct.get(name) || { ...zero(), product: name, keywords: new Set<string>() };
      add(p, r);
      if (r.keyword && r.keyword !== "-") p.keywords.add(r.keyword);
      byProduct.set(name, p);
    }
    const rows = product ? deduped.filter((r) => productOf(r.campaign) === product) : deduped;

    const byKeyword = new Map<string, Sum & { keyword: string; placements: Set<string>; campaigns: Set<string> }>();
    const byPlacement = new Map<string, Sum & { placement: string }>();
    const total = zero();
    for (const r of rows) {
      const kw = !r.keyword || r.keyword === "-" ? NO_KEYWORD : r.keyword;
      const k = byKeyword.get(kw) || { ...zero(), keyword: kw, placements: new Set<string>(), campaigns: new Set<string>() };
      add(k, r);
      if (r.placement) k.placements.add(r.placement);
      if (r.campaign) k.campaigns.add(r.campaign);
      byKeyword.set(kw, k);
      const pl = r.placement || "(지면 없음)";
      const p = byPlacement.get(pl) || { ...zero(), placement: pl };
      add(p, r);
      byPlacement.set(pl, p);
      add(total, r);
    }

    const { data: latest } = await supabase
      .from("raw_coupang_keyword").select("date").order("date", { ascending: false }).limit(1);

    return NextResponse.json({
      keywords: [...byKeyword.values()]
        .map(({ placements, campaigns, ...k }) => ({ ...k, placements: [...placements], campaigns: [...campaigns] }))
        .sort((a, b) => b.spend - a.spend),
      placements: [...byPlacement.values()].sort((a, b) => b.spend - a.spend),
      products: [...byProduct.values()]
        .map(({ keywords, ...p }) => ({ ...p, keywordCount: keywords.size }))
        .sort((a, b) => b.spend - a.spend),
      product: product || null,
      total,
      rows: rows.length,
      latestCollected: latest?.[0]?.date ?? null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
