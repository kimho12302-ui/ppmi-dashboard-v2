// 팀 비밀번호 잠금. 2026-11-09 부터 대시보드 전체(화면 + /api/*)를 잠근다. 그 전에는 공구 후보
// 화면만 잠겨 있었고 나머지(매출·광고비·ROAS·이익, 쓰기 API 포함)는 URL 만 알면 누구나 열 수 있었다.
// 계정 체계를 들이기엔 과해서, 팀 공용 비밀번호 하나 + 이름(누가 넣었는지 시트에 남긴다)으로 막는다.
//
// 쿠키에는 비밀번호가 아니라 그 해시를 넣는다. 비밀번호를 바꾸면 기존 쿠키는 전부 무효가 된다.
// 미들웨어(edge)와 API(node) 양쪽에서 쓰려고 Web Crypto 만 쓴다(node:crypto 금지).
//
// 사람이 아닌 호출(수집기·크론 지시서·GitHub Actions)은 쿠키 대신 키로 통과한다.
//   - 요청 헤더 x-ppmi-key = 환경변수 PPMI_API_KEY
//   - Vercel 크론·캐시 비우기 엔드포인트는 Authorization: Bearer CRON_SECRET (라우트도 같은 검사를 한 번 더 한다)

export const TEAM_COOKIE = "ppmi_team";
export const USER_COOKIE = "ppmi_user";
export const API_KEY_HEADER = "x-ppmi-key";

// CRON_SECRET 베어러로 미들웨어를 지나갈 수 있는 경로. 전부 라우트 안에서 다시 검사한다.
export const CRON_PATHS = ["/api/cron-daily-report", "/api/watchdog", "/api/revalidate"];

export async function teamToken(password: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`ppmi-team:${password}`));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 길이가 같으면 끝까지 다 비교한다(앞에서 틀렸다고 일찍 돌아오지 않는다). 기대값이 비어 있으면 늘 거짓.
export function constantTimeEqual(given: string | null | undefined, expected: string | null | undefined): boolean {
  if (!given || !expected) return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a[i % a.length] ?? 0) ^ (b[i % b.length] ?? 0);
  return diff === 0;
}

export async function isTeamCookieValid(value: string | undefined): Promise<boolean> {
  const pw = process.env.TEAM_PASSWORD;
  if (!pw || !value) return false;
  return constantTimeEqual(value, await teamToken(pw));
}

export function isApiKeyValid(value: string | null): boolean {
  return constantTimeEqual(value, process.env.PPMI_API_KEY);
}

export function isCronBearerValid(authorization: string | null): boolean {
  if (!authorization || !authorization.startsWith("Bearer ")) return false;
  return constantTimeEqual(authorization.slice(7), process.env.CRON_SECRET);
}
