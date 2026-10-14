// 서버 5분 캐시를 건너뛰고 DB 에서 바로 읽는 조회 (2026-10-14).
//
// 저장 직후 다시 읽기, "새로고침" 버튼처럼 **방금 바뀐 값이 꼭 보여야 하는** 조회에만 쓴다.
// 서버(src/lib/api-cache.ts cachedGET)는 이 헤더가 있으면 캐시를 보지 않는다.
export const CACHE_BYPASS_HEADER = "x-cache-bypass";

export function freshFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set(CACHE_BYPASS_HEADER, "1");
  return fetch(url, { ...init, headers, cache: "no-store" });
}
