import { NextRequest, NextResponse } from "next/server";
import { TEAM_COOKIE, isTeamCookieValid } from "@/lib/team-auth";

// 팀 비밀번호가 필요한 화면만 막는다. 나머지 대시보드는 지금처럼 공개다.
export async function middleware(req: NextRequest) {
  if (await isTeamCookieValid(req.cookies.get(TEAM_COOKIE)?.value)) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith("/api/")) {
    const msg = process.env.TEAM_PASSWORD ? "팀 비밀번호 로그인이 필요합니다" : "서버에 TEAM_PASSWORD 가 설정되지 않았습니다";
    return NextResponse.json({ error: msg }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname)}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/influencers/:path*", "/api/influencers/:path*"] };
