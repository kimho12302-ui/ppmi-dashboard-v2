import { NextRequest, NextResponse } from "next/server";
import { API_KEY_HEADER, CRON_PATHS, TEAM_COOKIE, isApiKeyValid, isCronBearerValid, isTeamCookieValid } from "@/lib/team-auth";

// 대시보드 전체를 잠근다(2026-11-09). 통과 조건은 셋 중 하나다.
//   1) 팀 비밀번호 로그인 쿠키(사람)
//   2) x-ppmi-key 헤더 = PPMI_API_KEY (수집기·지시서·Actions)
//   3) 크론 경로에 한해 Authorization: Bearer CRON_SECRET (Vercel 크론, marketing-dashboard 캐시 비우기)
// 로그인 화면·로그인 API·정적 자원은 matcher 에서 뺀다.
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (await isTeamCookieValid(req.cookies.get(TEAM_COOKIE)?.value)) return NextResponse.next();
  if (isApiKeyValid(req.headers.get(API_KEY_HEADER))) return NextResponse.next();
  if (CRON_PATHS.some((p) => pathname === p) && isCronBearerValid(req.headers.get("authorization"))) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    const msg = process.env.TEAM_PASSWORD ? "팀 비밀번호 로그인 또는 접근 키가 필요합니다" : "서버에 TEAM_PASSWORD 가 설정되지 않았습니다";
    return NextResponse.json({ error: msg }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\.ico|robots\.txt|login|api/auth/login).*)"],
};
