// 요청 파라미터가 없어도 빌드 때 한 번 굳히지 않는다(값은 cachedGET 5분 캐시가 맡음).
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/db";
import { cachedGET } from "@/lib/api-cache";
import { isMissing, errMessage } from "@/lib/pg-errors";
import type { RoutineCandidate } from "@/lib/sa-balancelab";

// 키워드 탭 > 네이버 검색어 > 추가할 검색어 > 「루틴이 본 후보」. 2026-11-10 신설.
// 원천: sa_keyword_candidate (밸런스랩 SA 일일 키워드 루틴이 그날 본 후보 전부와 결과, 스펙 7-1).
//   쓰는 쪽: 볼트 settings/search-ads/sa_daily_routine.py · 표 정의 settings/search-ads/routine/sql/2026-10-20-03-sa_keyword_candidate.sql
// 가장 최근 date 한 회차만 돌려준다. 묶기·정렬은 화면(src/lib/sa-balancelab.ts groupRoutine).
// 표가 없으면 ready:false reason "sql", 비었으면 reason "empty". 둘 다 200 이다(빈 칸이 오류로 안 보이게).

const COLS = "date,keyword_norm,keyword,source,product,is_brand,stage,result,why,devices,clicks_30d,cost_30d,volume,start_bid,bid_basis";

async function getImpl() {
  try {
    const head = await supabase.from("sa_keyword_candidate").select("date").order("date", { ascending: false }).limit(1);
    if (isMissing(head.error)) return NextResponse.json({ ready: false, reason: "sql" });
    if (head.error) throw head.error;
    const date = head.data?.[0]?.date as string | undefined;
    if (!date) return NextResponse.json({ ready: false, reason: "empty" });
    const rows = await fetchAll<RoutineCandidate>(
      supabase.from("sa_keyword_candidate").select(COLS).eq("date", date),
      "keyword_norm", // 이 표에는 id 칸이 없다. (date, keyword_norm) 이 기본키라 날짜를 고정하면 이걸로 순서가 선다
    );
    return NextResponse.json({ ready: true, date, rows });
  } catch (e) {
    return NextResponse.json({ error: errMessage(e) }, { status: 500 });
  }
}

export const GET = cachedGET(getImpl, ["sa_keyword_candidate"], []);
