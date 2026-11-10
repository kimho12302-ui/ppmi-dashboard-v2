// 요청 파라미터가 없어도 빌드 때 한 번 굳히지 않는다(값은 cachedGET 5분 캐시가 맡음).
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/db";
import { cachedGET } from "@/lib/api-cache";
import { isMissing, routeFailure } from "@/lib/pg-errors";
import {
  MEDINEX_CAMPAIGN, MEDINEX_TEST_FROM, LOCK_LINE_WON, MEDINEX_DAILY_BUDGET_WON,
  buildMedinexTest, type MedinexAdd, type KeywordSnapshot,
} from "@/lib/sa-balancelab";

// 키워드 탭 > 네이버 검색어 > 「메디넥스 10일 시험」. 2026-11-10 신설.
//
// 대상: sa_change_log 에서 밸런스랩 계정 · 캠페인 P10.메디넥스 · 동작 add · 적용 시각이 시험 시작일(KST 0시) 이후인 키워드.
// 누적 비용·클릭·상태: naver_sa_keyword(네이버 등록 키워드 목록)의 계정 최신 seen_on 행을 keyword_id 로 붙인다.
//
// ★ 비용 원천을 keyword_performance 로 하지 않는 이유(2026-11-10 실측): 그 표에는 캠페인·keyword_id 칸이 없어
//   키워드 글자로만 붙는다. 다른 캠페인의 같은 글자와 섞이고, 11-10 기준 67개 중 0개가 붙었다.
//   naver_sa_keyword 는 keyword_id 로 67/67 이 붙는다. 값은 기준일까지 30일 이동 합계이고, 시험 키워드는
//   11-09 에 새로 넣어 시험 누적과 같다(시험 시작 30일 뒤부터는 달라진다).
// ★ 구매 수는 키워드 단위로 확실한 원천이 없어 싣지 않는다. 구매 판정은 SA 루틴 보고서가 한다.

async function getImpl() {
  try {
    const adds = await fetchAll<MedinexAdd & { id: number }>(
      supabase.from("sa_change_log").select("id,keyword_id,keyword,adgroup,bid_after,review_on,applied_at")
        .eq("account", "balancelab").eq("campaign", MEDINEX_CAMPAIGN).eq("action", "add")
        .gte("applied_at", `${MEDINEX_TEST_FROM}T00:00:00+09:00`),
    );
    if (adds.length === 0) return NextResponse.json({ ready: false, reason: "empty" });

    const head = await supabase.from("naver_sa_keyword").select("seen_on").eq("account", "balancelab")
      .order("seen_on", { ascending: false }).limit(1);
    if (isMissing(head.error)) return NextResponse.json({ ready: false, reason: "sql" });
    if (head.error) throw head.error;
    const seenOn = (head.data?.[0]?.seen_on as string | undefined) ?? null;
    const snaps = seenOn
      ? await fetchAll<KeywordSnapshot>(
        supabase.from("naver_sa_keyword")
          .select("keyword_id,keyword,adgroup,bid,keyword_lock,status_reason,adgroup_status,adgroup_lock,campaign_status,campaign_lock,imp_30d,clk_30d,cost_30d")
          .eq("account", "balancelab").eq("seen_on", seenOn).eq("campaign", MEDINEX_CAMPAIGN),
        "keyword_id",
      )
      : [];

    return NextResponse.json({
      ready: true, seenOn, testFrom: MEDINEX_TEST_FROM, lockLine: LOCK_LINE_WON, dailyBudget: MEDINEX_DAILY_BUDGET_WON,
      ...buildMedinexTest(adds, snaps),
    });
  } catch (e) {
    return routeFailure("sa-medinex-test", e); // 표 없음은 ready:false(sql), 그 밖은 고정 문구 500
  }
}

export const GET = cachedGET(getImpl, ["sa_change_log", "naver_sa_keyword"], []);
