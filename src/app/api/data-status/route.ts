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
    return NextResponse.json({ sources: [], summary: { total: 0, ok: 0, stale: 0 } });
  }
}
