import { NextRequest, NextResponse } from "next/server";
import { TEAM_COOKIE, USER_COOKIE, teamToken } from "@/lib/team-auth";

const MAX_AGE = 60 * 60 * 24 * 30;

export async function POST(req: NextRequest) {
  const pw = process.env.TEAM_PASSWORD;
  if (!pw) return NextResponse.json({ error: "서버에 TEAM_PASSWORD 가 설정되지 않았습니다" }, { status: 503 });
  const { password, name } = await req.json().catch(() => ({}));
  const who = String(name || "").trim().slice(0, 20);
  if (!who) return NextResponse.json({ error: "이름을 적어 주세요 (시트에 누가 넣었는지 남깁니다)" }, { status: 400 });
  if (String(password || "") !== pw) {
    // 무차별 대입을 늦춘다
    await new Promise((r) => setTimeout(r, 800));
    return NextResponse.json({ error: "비밀번호가 다릅니다" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  const secure = process.env.NODE_ENV === "production";
  res.cookies.set(TEAM_COOKIE, await teamToken(pw), { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: MAX_AGE });
  res.cookies.set(USER_COOKIE, encodeURIComponent(who), { httpOnly: false, secure, sameSite: "lax", path: "/", maxAge: MAX_AGE });
  return res;
}
