import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// 네이버 검색광고 실제 검색어. 2026-09-18 신설. SQL: docs/sql/raw-naver-search-term.sql
// 원천 raw_naver_search_term(수집기 marketing-dashboard scripts/sync_naver_search_terms.py, daily-sync).
// 두 축을 섞지 않는다: account=main(너티·사입·아이언펫) | balancelab.
// 요약은 DB 함수 naver_search_term_summary 가 (광고유형 × 상품 × 검색어) 로 합쳐 준다(한 달 10만 행 이상이라).
//
// 검색어 보고서가 캠페인 광고비를 얼마나 잡았는지(coverage)를 같이 준다. 쇼핑검색은 네이버가 소량 검색어를
// 보고서에서 빼서 100% 가 안 되는 날이 있다. 화면이 이 비율을 보여 준다(정확도 우선).

const ACCOUNTS = new Set(["main", "balancelab"]);

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const account = sp.get("account") || "main";
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";
  if (!ACCOUNTS.has(account)) return NextResponse.json({ error: "account 는 main|balancelab" }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: "from·to 는 YYYY-MM-DD" }, { status: 400 });
  }

  const brands = account === "balancelab" ? ["balancelab"] : ["nutty", "saip", "ironpet"];
  const [rpc, ads] = await Promise.all([
    supabase.rpc("naver_search_term_summary", { p_account: account, p_from: from, p_to: to }),
    supabase.from("daily_ad_spend").select("channel,spend").in("channel", ["naver_search", "naver_shopping"])
      .in("brand", brands).gte("date", from).lte("date", to).limit(5000),
  ]);
  if (rpc.error) return NextResponse.json({ error: rpc.error.message }, { status: 500 });
  if (ads.error) return NextResponse.json({ error: ads.error.message }, { status: 500 });

  const campaignCost = { powerlink: 0, shopping: 0 };
  for (const r of ads.data || []) {
    if (r.channel === "naver_search") campaignCost.powerlink += Number(r.spend) || 0;
    else campaignCost.shopping += Number(r.spend) || 0;
  }
  const d = rpc.data as { entries: unknown[]; rows: number; latest: string | null };
  return NextResponse.json(
    { account, entries: d.entries, rows: d.rows, latestCollected: d.latest, campaignCost },
    { headers: { "Cache-Control": "s-maxage=600, stale-while-revalidate=3600" } },
  );
}
