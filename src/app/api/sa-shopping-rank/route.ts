// 요청 파라미터가 없어도 빌드 때 한 번 굳히지 않는다(값은 cachedGET 5분 캐시가 맡음).
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/db";
import { cachedGET } from "@/lib/api-cache";
import { isMissing, errMessage } from "@/lib/pg-errors";
import { buildRankView, type ShoppingRankRow } from "@/lib/sa-balancelab";

// 키워드 탭 > 네이버 검색어 > 「메디넥스 쇼핑 자연 순위」. 2026-11-10 신설.
// 원천: sa_shopping_rank (메디넥스 7종 네이버 쇼핑 자연 순위, 광고 제외. 검색어 × 제품 한 줄).
//   쓰는 쪽: 볼트 settings/search-ads/shopping_rank.py · 표 정의 settings/search-ads/routine/sql/2026-11-09-shopping_rank.sql
// 최신 measured_on 과 그 직전 회차 두 날짜만 읽는다(표 전체를 읽지 않는다). 직전 회차가 없으면 previous=null.
// 화면에는 목표 검색어(is_target)만 싣는다. 판정은 src/lib/sa-balancelab.ts buildRankView.

const COLS = "measured_on,query,product,query_group,is_target,method,module,our_rank,catalog_rank,catalog_id,ad_seen,seen_up_to,page1,measured_at";

async function getImpl() {
  try {
    const head = await supabase.from("sa_shopping_rank").select("measured_on").order("measured_on", { ascending: false }).limit(1);
    if (isMissing(head.error)) return NextResponse.json({ ready: false, reason: "sql" });
    if (head.error) throw head.error;
    const latest = head.data?.[0]?.measured_on as string | undefined;
    if (!latest) return NextResponse.json({ ready: false, reason: "empty" });

    const prevQ = await supabase.from("sa_shopping_rank").select("measured_on").lt("measured_on", latest)
      .order("measured_on", { ascending: false }).limit(1);
    if (prevQ.error) throw prevQ.error;
    const previous = (prevQ.data?.[0]?.measured_on as string | undefined) ?? null;

    // (measured_on, query, product) 가 기본키. id 칸이 없어 앞 두 칸으로 정렬하고 product 를 마지막 키로 둔다.
    const rows = await fetchAll<ShoppingRankRow>(
      supabase.from("sa_shopping_rank").select(COLS)
        .in("measured_on", previous ? [latest, previous] : [latest])
        .order("measured_on", { ascending: false }).order("query", { ascending: true }),
      "product",
    );
    return NextResponse.json({ ready: true, ...buildRankView(rows, latest, previous) });
  } catch (e) {
    return NextResponse.json({ error: errMessage(e) }, { status: 500 });
  }
}

export const GET = cachedGET(getImpl, ["sa_shopping_rank"], []);
