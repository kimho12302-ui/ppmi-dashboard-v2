import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// 네이버 검색광고 실제 검색어. 2026-09-18 신설, 2026-09-30 브랜드 축으로 전환.
// 원천 raw_naver_search_term(수집기 marketing-dashboard scripts/sync_naver_search_terms.py, daily-sync).
// 요약은 DB 함수 naver_search_term_summary 가 (광고유형 × 상품 × 검색어) 로 합쳐 준다(한 달 7만 행이라).
// SQL: docs/sql/raw-naver-search-term.sql + docs/sql/naver-search-term-brand.sql
//
// ★ 2026-09-30: 입력이 account 에서 brand 로 바뀌었다. 화면의 계정 탭이 상단 브랜드 필터와 겹쳐
//   "밸런스랩 → 네이버 검색어 → 또 밸런스랩"을 눌러야 했다. 계정은 브랜드에서 유도한다.
//   네이버 계정은 둘이다: main(너티·사입·아이언펫 한 계정, customer 3158060) · balancelab(800812).
//   brand=all 은 두 계정을 각각 불러 합친다. 합칠 때 같은 (광고유형·상품·검색어) 는 더한다.
//
// 검색어 보고서가 캠페인 광고비를 얼마나 잡았는지(coverage)를 같이 준다. 쇼핑검색은 네이버가 소량
// 검색어를 보고서에서 빼서 100% 가 안 되는 날이 있다. 화면이 이 비율을 보여 준다(정확도 우선).

const PET_BRANDS = ["nutty", "saip", "ironpet"] as const;
const KNOWN = new Set<string>(["all", "pet", "balancelab", ...PET_BRANDS]);

/**
 * 브랜드 → 불러야 할 (계정, 브랜드) 목록.
 *
 * ★ 묶음(pet·all)도 브랜드를 지정해 **나눠 부른다.** 브랜드 없이 main 계정 한 달을 부르면
 *   요약 쿼리가 statement timeout 으로 죽는다(2026-09-30 실측, 47,792행). 브랜드로 좁히면
 *   같은 기간이 2.2~3.0초다. 나눠 부른 뒤 (광고유형·상품·검색어) 로 합치므로 결과는 같다.
 *   합계가 어긋날 걱정도 없다 — brand 가 빈 행이 0건이고 아래 네 값이 원천의 100% 다
 *   (전 기간 99,875행 전부, 2026-09-30 실측).
 */
function plan(brand: string): { account: string; brand: string }[] {
  const pet = PET_BRANDS.map(b => ({ account: "main", brand: b }));
  if (brand === "balancelab") return [{ account: "balancelab", brand: "balancelab" }];
  if (brand === "pet") return pet;
  if (brand === "all") return [...pet, { account: "balancelab", brand: "balancelab" }];
  return [{ account: "main", brand }]; // nutty | saip | ironpet
}

/** coverage 분모(캠페인 광고비)를 재는 대상 브랜드. */
function spendBrands(brand: string): string[] {
  if (brand === "balancelab") return ["balancelab"];
  if (brand === "pet") return [...PET_BRANDS];
  if (brand === "all") return [...PET_BRANDS, "balancelab"];
  return [brand];
}

interface Entry {
  ad_type: string; product: string; query: string;
  impressions: number; clicks: number; cost: number;
  purchases: number; purchase_value: number; cart_adds: number;
}
const SUM_KEYS = ["impressions", "clicks", "cost", "purchases", "purchase_value", "cart_adds"] as const;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const brand = sp.get("brand") || "all";
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";
  if (!KNOWN.has(brand)) return NextResponse.json({ error: `brand 는 ${[...KNOWN].join("|")}` }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: "from·to 는 YYYY-MM-DD" }, { status: 400 });
  }

  const calls = plan(brand);

  // ★ RPC 는 하나씩 부른다. Promise.all 로 3~4개를 한꺼번에 쏘면 서로 물려 전부
  //   statement timeout 으로 죽는다(2026-09-30 실측: 병렬이면 단일 브랜드까지 8초에 실패,
  //   순차면 같은 질의가 0.9~3.6초). 광고비 조회는 가벼워 같이 띄워도 된다.
  const adsPromise = supabase.from("daily_ad_spend").select("channel,spend")
    .in("channel", ["naver_search", "naver_shopping"])
    .in("brand", spendBrands(brand)).gte("date", from).lte("date", to).limit(5000);

  // 오래 안 본 뒤 처음 여는 질의(cold)는 타임아웃을 넘길 때가 있다. 두 번째는 1~3초에 끝난다.
  // 읽기 전용이라 다시 불러도 안전하다. 타임아웃(57014)일 때만 한 번 더 부른다.
  const isTimeout = (e: { code?: string; message?: string } | null) =>
    !!e && (e.code === "57014" || (e.message || "").includes("statement timeout"));

  const rpcs: { brand: string; data: unknown; error: { message: string } | null }[] = [];
  for (const c of calls) {
    const args = { p_account: c.account, p_from: from, p_to: to, p_brand: c.brand };
    let r = await supabase.rpc("naver_search_term_summary", args);
    if (isTimeout(r.error)) r = await supabase.rpc("naver_search_term_summary", args);
    rpcs.push({ brand: c.brand, data: r.data, error: r.error });
  }
  const ads = await adsPromise;

  // 어느 브랜드에서 터졌는지 같이 알린다. 그냥 "timeout" 만 뜨면 어디를 볼지 알 수 없다.
  const failed = rpcs.find(r => r.error);
  if (failed?.error) return NextResponse.json({ error: `${failed.brand}: ${failed.error.message}` }, { status: 500 });
  if (ads.error) return NextResponse.json({ error: ads.error.message }, { status: 500 });

  // 계정이 둘일 때만 합친다. 키는 (광고유형·상품·검색어) — RPC 가 이미 그 단위로 묶어 준다.
  const merged = new Map<string, Entry>();
  let rows = 0;
  let latest: string | null = null;
  for (const r of rpcs) {
    const d = r.data as { entries: Entry[]; rows: number; latest: string | null } | null;
    rows += Number(d?.rows || 0);
    if (d?.latest && (latest === null || d.latest > latest)) latest = d.latest;
    for (const e of d?.entries || []) {
      const k = `${e.ad_type}|${e.product}|${e.query}`;
      const cur = merged.get(k);
      if (!cur) { merged.set(k, { ...e }); continue; }
      for (const m of SUM_KEYS) cur[m] = Number(cur[m] || 0) + Number(e[m] || 0);
    }
  }

  const campaignCost = { powerlink: 0, shopping: 0 };
  for (const r of ads.data || []) {
    if (r.channel === "naver_search") campaignCost.powerlink += Number(r.spend) || 0;
    else campaignCost.shopping += Number(r.spend) || 0;
  }

  return NextResponse.json(
    { brand, entries: [...merged.values()], rows, latestCollected: latest, campaignCost },
    { headers: { "Cache-Control": "s-maxage=600, stale-while-revalidate=3600" } },
  );
}
