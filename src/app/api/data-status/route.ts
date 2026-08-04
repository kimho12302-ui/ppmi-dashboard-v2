export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getSourceStatuses } from "@/lib/data-sources";

// 소스 정의·신선도 판정은 @/lib/data-sources 에 있다 (watchdog 과 공유).

export async function GET() {
  try {
    const { sources, referenceDate } = await getSourceStatuses();
    const okCount = sources.filter((s) => s.ok).length;

    return NextResponse.json({
      sources,
      referenceDate,
      summary: {
        total: sources.length,
        ok: okCount,
        stale: sources.length - okCount,
      },
    });
  } catch (error) {
    console.error("Data status error:", error);
    // fail-closed: 빈 목록을 200으로 주면 "stale 0건"으로 표시돼 감시 장치가 고장난 것을
    // 정상으로 오독하게 된다(2026-08 수정). 실패는 500으로 드러낸다.
    return NextResponse.json({ error: "데이터 수집 현황을 불러오지 못했습니다" }, { status: 500 });
  }
}
