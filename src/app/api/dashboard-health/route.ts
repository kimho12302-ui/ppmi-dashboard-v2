export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getSourceStatuses, sourceEntryLink } from "@/lib/data-sources";
import { buildDashboardHealth, type HeartbeatNote, type OpsCollectorItem } from "@/lib/dashboard-health";
import { cachedGET, DATA_TAGS } from "@/lib/api-cache";
import { kstDate } from "@/lib/date";

// 「대시보드 상태」 화면(/status)과 사이드바 로고 빨간 점이 읽는다. 2026-11-06 신설.
// 새로 수집하지 않는다. data-status 와 같은 판정(@/lib/data-sources) + 하트비트 사유 + 관제판 collector 섹션을
// 합쳐서 @/lib/dashboard-health 가 '고장 / 주의 / 정상 / 의도 중단'으로 가른다.

async function getImpl() {
  try {
    const [{ sources, collectors, referenceDate }, hbRes, opsRes] = await Promise.all([
      getSourceStatuses(),
      supabase.from("sync_heartbeat").select("source,note,last_run"),
      supabase.from("ops_status").select("item_key,label,signal,summary,last_at,reported_at").eq("section", "collector"),
    ]);
    if (hbRes.error) throw new Error(`sync_heartbeat: ${hbRes.error.message}`);
    // 관제판 표를 못 읽어도 화면은 띄운다. 대신 '관제판 보고가 멈춤'이 주의로 뜬다(빈 목록 = 보고 없음).
    if (opsRes.error) console.error("dashboard-health ops_status:", opsRes.error.message);

    const health = buildDashboardHealth({
      sources: sources.map((s) => ({ ...s, entry: sourceEntryLink(s.id) })),
      collectors,
      referenceDate,
      today: kstDate(),
      heartbeatNotes: (hbRes.data || []) as HeartbeatNote[],
      ops: (opsRes.data || []) as OpsCollectorItem[],
      nowMs: Date.now(),
    });
    return NextResponse.json(health);
  } catch (error) {
    console.error("dashboard-health error:", error);
    // fail-closed: 못 읽은 것을 '이상 없음'으로 내보내지 않는다.
    return NextResponse.json({ error: "대시보드 상태를 불러오지 못했습니다" }, { status: 500 });
  }
}

// 5분 캐시·쓰기 후 무효화 (src/lib/api-cache.ts)
export const GET = cachedGET(getImpl, [...DATA_TAGS], []);
