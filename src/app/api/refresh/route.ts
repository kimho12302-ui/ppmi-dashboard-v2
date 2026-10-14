// 화면의 "새로고침" 버튼 (2026-10-14).
//
// 그 화면이 읽은 API 의 태그(응답 헤더 X-Cache-Tags)만 지운다. 전부 지우기("all")는 받지 않는다.
// 대시보드 읽기 화면이 원래 공개이고 지우는 것은 캐시뿐이라 비밀번호를 받지 않는다.
// 대신 같은 태그는 10초에 한 번만 지워 DB 를 연타로 두드리지 못하게 한다(인스턴스 단위).
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { ALL_TAG, DATA_TAGS, isKnownTag, revalidateTagsNow } from "@/lib/api-cache";

const MIN_INTERVAL_MS = 10_000;
const MAX_TAGS = DATA_TAGS.length; // 한 번에 받는 태그 수 상한
const lastRun = new Map<string, number>();

export async function POST(req: NextRequest) {
  let tags: string[] = [];
  try {
    const body = (await req.json()) as { tags?: unknown };
    if (Array.isArray(body.tags)) tags = body.tags.slice(0, MAX_TAGS + 1).map(String);
  } catch {
    return NextResponse.json({ error: "본문은 {\"tags\":[...]} JSON 이어야 합니다" }, { status: 400 });
  }
  if (tags.length > MAX_TAGS) {
    return NextResponse.json({ error: `태그는 한 번에 ${MAX_TAGS}개까지` }, { status: 400 });
  }
  const now = Date.now();
  const wanted = Array.from(new Set(tags)).filter((t) => t !== ALL_TAG && isKnownTag(t));
  const due = wanted.filter((t) => now - (lastRun.get(t) || 0) >= MIN_INTERVAL_MS);
  for (const t of due) lastRun.set(t, now);
  const done = await revalidateTagsNow(due);
  return NextResponse.json({ revalidated: done, throttled: wanted.filter((t) => !due.includes(t)) });
}
