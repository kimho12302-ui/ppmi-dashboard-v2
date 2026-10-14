import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { addTags } from "@/lib/influencer-sheet";
import { USER_COOKIE } from "@/lib/team-auth";

// 수집할 해시태그를 큐(시트 「발굴_태그」)에 넣는다. 수집은 PC 수집기가 다음 회차에 한다.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const tags = String(body.tags || "").split(/[\s,]+/).map((t) => t.trim()).filter(Boolean).slice(0, 20);
  if (!tags.length) return NextResponse.json({ error: "해시태그를 넣어 주세요" }, { status: 400 });
  if (tags.some((t) => !/^#?[가-힣A-Za-z0-9_]{1,40}$/.test(t))) return NextResponse.json({ error: "해시태그는 글자·숫자·밑줄만 됩니다 (띄어쓰기 없이)" }, { status: 400 });
  const who = decodeURIComponent(cookies().get(USER_COOKIE)?.value || "") || "이름 없음";
  try {
    return NextResponse.json(await addTags(tags, who));
  } catch (e) {
    return NextResponse.json({ error: `시트 쓰기 실패: ${(e as Error).message}` }, { status: 500 });
  }
}
