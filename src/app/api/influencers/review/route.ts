import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { reviewCandidate, STATUSES } from "@/lib/influencer-sheet";
import { USER_COOKIE } from "@/lib/team-auth";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const handle = String(body.handle || "");
  const 상태 = body.status === undefined ? undefined : String(body.status);
  const 메모 = body.memo === undefined ? undefined : String(body.memo).slice(0, 300);
  if (!/^[a-z0-9._]{1,30}$/i.test(handle)) return NextResponse.json({ error: "핸들이 이상합니다" }, { status: 400 });
  if (상태 !== undefined && !STATUSES.includes(상태)) return NextResponse.json({ error: `상태는 ${STATUSES.join("/")} 중 하나` }, { status: 400 });
  const who = decodeURIComponent(cookies().get(USER_COOKIE)?.value || "") || "이름 없음";
  try {
    await reviewCandidate(handle, { 상태, 메모 }, who);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
