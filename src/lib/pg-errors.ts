// Supabase(PostgREST) 오류 판별과 라우트 실패 응답 공용. 2026-11-10 키워드 탭 밸런스랩 칸 신설 때 뽑아냄.
// keyword-candidates 라우트에 같은 판별이 있다(그쪽은 그대로 둠).
import { NextResponse } from "next/server";

export type PgErr = { code?: string; message?: string } | null;

/** 표·함수가 아직 DB 에 없음(SQL 실행 전). 화면은 "SQL 실행 전" 안내를 띄운다. */
export const isMissing = (e: PgErr) =>
  !!e && (e.code === "PGRST205" || e.code === "PGRST202" || e.code === "42P01" || e.code === "42883");

/** 화면에 내보내는 고정 문구. DB 원문(표·칸 이름, 질의 조각)은 서버 기록에만 남긴다. */
export const PUBLIC_FAIL_MESSAGE = "데이터를 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요.";

/**
 * 라우트 catch 공용. 어느 조회에서든(fetchAll 이 던진 오류 포함) 표가 없으면 ready:false reason "sql" 로 200,
 * 그 밖은 상세를 console.error 로만 남기고 고정 문구로 500(500 은 캐시되지 않는다).
 */
export function routeFailure(route: string, e: unknown): NextResponse {
  if (isMissing(e as PgErr)) return NextResponse.json({ ready: false, reason: "sql" });
  console.error(`[${route}]`, e);
  return NextResponse.json({ error: PUBLIC_FAIL_MESSAGE }, { status: 500 });
}
