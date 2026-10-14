// 팀 비밀번호 잠금. 대시보드는 원래 인증이 없다(전부 공개). 공구 후보 화면은 공유 시트에 행을 쓰고
// 우리 인스타 계정의 API 호출 한도를 쓰므로 URL 만 알면 누구나 누를 수 있게 둘 수 없다.
// 계정 체계를 들이기엔 과해서, 팀 공용 비밀번호 하나 + 이름(누가 넣었는지 시트에 남긴다)으로 막는다.
//
// 쿠키에는 비밀번호가 아니라 그 해시를 넣는다. 비밀번호를 바꾸면 기존 쿠키는 전부 무효가 된다.
// 미들웨어(edge)와 API(node) 양쪽에서 쓰려고 Web Crypto 만 쓴다.

export const TEAM_COOKIE = "ppmi_team";
export const USER_COOKIE = "ppmi_user";
export const PROTECTED = ["/influencers", "/api/influencers"];

export async function teamToken(password: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`ppmi-team:${password}`));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function isTeamCookieValid(value: string | undefined): Promise<boolean> {
  const pw = process.env.TEAM_PASSWORD;
  if (!pw || !value) return false;
  return value === (await teamToken(pw));
}
