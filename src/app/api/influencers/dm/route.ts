import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { dmAction, type DmAction } from "@/lib/influencer-sheet";
import { USER_COOKIE } from "@/lib/team-auth";

const ACTIONS: DmAction[] = ["save", "approve", "cancel", "redraft"];

// 발송은 여기서 하지 않는다. '승인' 표시만 남기고 PC 의 DM 워커(aside)가 승인된 행만 보낸다.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const handle = String(body.handle || "");
  const action = body.action as DmAction;
  if (!/^[a-z0-9._]{1,30}$/i.test(handle)) return NextResponse.json({ error: "핸들이 이상합니다" }, { status: 400 });
  if (!ACTIONS.includes(action)) return NextResponse.json({ error: "알 수 없는 동작" }, { status: 400 });
  const who = decodeURIComponent(cookies().get(USER_COOKIE)?.value || "") || "이름 없음";
  try {
    await dmAction(handle, action, who, body.text, body.instruction);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
