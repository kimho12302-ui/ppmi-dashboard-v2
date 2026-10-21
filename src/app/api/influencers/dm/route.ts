import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { dmAction, loadForFix, queueRedraft, readDmSettings, saveFixedDraft, type DmAction } from "@/lib/influencer-sheet";
import { fixDraft, hasApiKey } from "@/lib/dm-fix";
import { USER_COOKIE } from "@/lib/team-auth";

// 「바로 고치기」는 Claude API 를 최대 세 번(처음, 금지 표현 재작성, 길이 줄이기) 부른다
export const maxDuration = 60;
const FIX_BUDGET_MS = 50000;

const ACTIONS: (DmAction | "fix")[] = ["save", "approve", "cancel", "redraft", "fix"];

/**
 * fix: 지금 초안을 Claude API 로 그 자리에서 고친다. 키가 없으면 지시만 시트에 남기고 PC 워커가 다음 정시에 다시 쓴다.
 * 고친 글은 상태 「초안」, 승인은 지운다(다시 승인해야 보낸다).
 */
async function fix(handle: string, instruction: string, draftFromScreen: string | undefined) {
  const c = await loadForFix(handle);
  if (!hasApiKey()) {
    await queueRedraft(c, instruction);
    return { ok: true, fallback: true, message: "API 키가 없어 다음 정시에 다시 씁니다" };
  }
  const started = Date.now();
  const cfg = await readDmSettings();
  // 화면에서 손본 글이 있으면 그것을 고친다(저장 안 한 수정도 살린다)
  const current = (draftFromScreen ?? c.get("DM 초안")).trim();
  const { text, errors } = await fixDraft(c.row, cfg, current, instruction, started + FIX_BUDGET_MS);
  await saveFixedDraft(c, text, instruction, errors);
  return { ok: true, fallback: false, text, length: text.length, errors };
}

// 발송은 여기서 하지 않는다. '승인' 표시만 남기고 PC 의 DM 워커(aside)가 승인된 행만 보낸다.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const handle = String(body.handle || "");
  const action = body.action as DmAction | "fix";
  if (!/^[a-z0-9._]{1,30}$/i.test(handle)) return NextResponse.json({ error: "핸들이 이상합니다" }, { status: 400 });
  if (!ACTIONS.includes(action)) return NextResponse.json({ error: "알 수 없는 동작" }, { status: 400 });
  const who = decodeURIComponent(cookies().get(USER_COOKIE)?.value || "") || "이름 없음";
  try {
    if (action === "fix") {
      const draft = typeof body.text === "string" ? body.text : undefined;
      return NextResponse.json(await fix(handle, String(body.instruction || ""), draft));
    }
    await dmAction(handle, action, who, body.text, body.instruction);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(`[influencers/dm] ${action} @${handle} 실패:`, (e as Error).message);
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
