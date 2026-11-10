// Supabase(PostgREST) 오류 판별 공용. 2026-11-10 키워드 탭 밸런스랩 칸 신설 때 뽑아냄.
// keyword-candidates 라우트에 같은 판별이 있다(그쪽은 그대로 둠).

export type PgErr = { code?: string; message?: string } | null;

/** 표·함수가 아직 DB 에 없음(SQL 실행 전). 화면은 "SQL 실행 전" 안내를 띄운다. */
export const isMissing = (e: PgErr) =>
  !!e && (e.code === "PGRST205" || e.code === "PGRST202" || e.code === "42P01" || e.code === "42883");

export const errMessage = (e: unknown) =>
  e instanceof Error ? e.message : (e as PgErr)?.message || String(e);
