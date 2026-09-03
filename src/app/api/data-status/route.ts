export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getSourceStatuses, sourceEntryLink } from "@/lib/data-sources";

// 소스 정의·신선도 판정은 @/lib/data-sources 에 있다 (watchdog 과 공유).
// 이 라우트는 화면이 바로 쓸 수 있게 3분류 요약과 오염된 지표 목록까지 계산해서 내린다.

export async function GET() {
  try {
    const { sources, collectors, referenceDate } = await getSourceStatuses();

    const broken = sources.filter((s) => s.status === "broken");
    const inputNeeded = sources.filter((s) => s.status === "input_needed");
    const inactive = sources.filter((s) => s.status === "inactive");
    const okCount = sources.filter((s) => s.status === "ok").length;

    // 고장난 소스가 오염시키는 지표 목록. KPI 카드가 '측정 불가/부분 측정' 배지를 붙이는 근거.
    const impactedMetrics: Record<string, { label: string; latestDate: string | null; reason: string | null }[]> = {};
    for (const s of broken) {
      for (const m of s.metrics) {
        (impactedMetrics[m] ||= []).push({ label: s.label, latestDate: s.latestDate, reason: s.reason });
      }
    }

    // 죽은 수집기: SOURCE_DEFS 에 없어도 여기서 드러난다 (cafe24_sales 가 ok:true 로 D+161).
    const unhealthyCollectors = collectors.filter((c) => c.health !== "running");

    return NextResponse.json({
      sources: sources.map((s) => ({ ...s, entry: sourceEntryLink(s.id) })),
      collectors,
      referenceDate,
      impactedMetrics,
      summary: {
        total: sources.length,
        ok: okCount,
        broken: broken.length,
        inputNeeded: inputNeeded.length,
        inactive: inactive.length,
        unhealthyCollectors: unhealthyCollectors.length,
        // 하위호환: 기존 소비자가 stale 을 읽는다. 미운영은 stale 이 아니다.
        stale: broken.length + inputNeeded.length,
      },
    });
  } catch (error) {
    console.error("Data status error:", error);
    // fail-closed: 빈 목록을 200으로 주면 "stale 0건"으로 표시돼 감시 장치가 고장난 것을
    // 정상으로 오독하게 된다(2026-08 수정). 실패는 500으로 드러낸다.
    return NextResponse.json({ error: "데이터 수집 현황을 불러오지 못했습니다" }, { status: 500 });
  }
}
