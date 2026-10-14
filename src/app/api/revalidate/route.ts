// 바깥 수집기가 DB 에 쓴 뒤 대시보드 5분 캐시를 지우는 곳 (2026-10-14).
//
// 부르는 쪽: marketing-dashboard daily-sync.yml 마지막 단계, 볼트 크론 등.
//   curl -X POST https://ppmi-dashboard-kappa.vercel.app/api/revalidate \
//     -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" \
//     -d '{"tags":["all"]}'
// 본문을 비우면 전부("all") 지운다. 태그 목록은 src/lib/api-cache.ts DATA_TAGS.
// 시크릿은 Vercel 크론이 쓰는 CRON_SECRET 과 같다(watchdog 와 같은 검사).
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { ALL_TAG, revalidateTags } from "@/lib/api-cache";

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let tags: string[] = [ALL_TAG];
  const text = await req.text();
  if (text.trim()) {
    try {
      const body = JSON.parse(text) as { tags?: unknown };
      if (Array.isArray(body.tags) && body.tags.length > 0) tags = body.tags.map(String);
    } catch {
      return NextResponse.json({ error: "본문은 {\"tags\":[...]} JSON 이어야 합니다" }, { status: 400 });
    }
  }
  const done = revalidateTags(tags);
  const skipped = tags.filter((t) => !done.includes(t));
  return NextResponse.json({ revalidated: done, skipped, at: new Date().toISOString() }, { status: done.length ? 200 : 400 });
}
