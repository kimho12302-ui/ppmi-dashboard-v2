// DB 합산 함수(RPC) 호출 + 옛 경로 자동 폴백 (2026-10-14).
//
// 함수 정의: docs/sql/2026-10-14-summary-rpc.sql (김호가 SQL Editor 에서 실행).
// 실행 전에는 함수가 없어 PGRST202 가 난다. 그때는 null 을 돌려주고, 호출부가 옛 경로(원본 행)로 간다.
// 그래서 SQL 실행 전에 배포해도 화면이 깨지지 않는다. 대조: scripts/verify-summary-rpc.mjs.
import { supabase } from "@/lib/supabase";

const MISSING_FUNCTION_CODES = new Set(["PGRST202", "42883"]);

/** 함수 결과 또는 null(함수 없음·오류 → 옛 경로로). 없음은 조용히, 그 밖의 오류는 서버 로그에 남긴다. */
export async function tryRpc<T>(name: string, params: Record<string, unknown>): Promise<T | null> {
  const { data, error } = await supabase.rpc(name, params);
  if (!error) return data as T;
  if (!MISSING_FUNCTION_CODES.has(error.code || "")) {
    console.warn(`[rpc] ${name} 실패, 옛 경로로 대체: ${error.code || ""} ${error.message}`);
  }
  return null;
}
