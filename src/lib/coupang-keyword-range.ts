// 쿠팡 광고 키워드 탭(/api/coupang-keywords) 불러오기 판정. 2026-11-13 신설.
//
// 왜: 요약 함수 coupang_keyword_summary 가 원본(하루 약 1,000행)을 매번 합쳐, 30일이면 DB 시간 제한
//     ("canceling statement due to statement timeout")에 걸렸다. 그러면 라우트가 원본 수만 행을 1,000행씩 끌어오는
//     대체 경로로 떨어졌고 그것도 함수 시간 안에 못 끝나, 화면은 오류 대신 「아직 수집된 쿠팡 키워드가 없습니다」를 띄웠다.
//   - 시간 초과면 대체 경로로 가지 않는다(더 무겁다). 바로 "기간을 줄여 보세요"로 답한다.
//   - 함수가 없거나 다른 오류면 대체 경로로 가되, 원본 행 수가 한도를 넘으면 끌어오지 않고 바로 안내한다.
//   근본 해결은 docs/sql/2026-11-13-coupang-keyword-daily.sql(일별 묶음 표 + 트리거).
//
// ★ 다른 모듈을 import 하지 않는다. scripts/tests/*.test.mjs 가 node --test 로 바로 불러 시험한다.

/** PostgREST: 함수를 못 찾음(SQL 실행 전) */
export const PGRST_FUNCTION_NOT_FOUND = "PGRST202";
/** Postgres: 문장 시간 초과(statement_timeout) */
export const PG_STATEMENT_TIMEOUT = "57014";
/** 대체 경로가 끌어올 원본 행 한도. 1,000행 페이지 20개를 한 번에(동시 25개 안) 받는 양이다.
 *  하루 최대 약 1,350행(10-14 실측 1,343)이라 「최근 14일로 보기」(최대 약 1.9만 행)가 이 한도 안에 든다. */
export const COUPANG_FALLBACK_MAX_ROWS = 20_000;
/** 실패 응답 상태 코드. 5xx 가 아니라서 useFetch 가 자동 재시도(무거운 요약을 한 번 더)를 하지 않는다. */
export const COUPANG_LOAD_FAIL_STATUS = 422;
/** 줄여 보기 단추가 제안하는 기간(일) */
export const COUPANG_SHORT_RANGES = [7, 14];

export type RpcFailure = "missing" | "timeout" | "other";

/** 요약 함수 오류를 셋으로 가른다. 메시지만 오고 코드가 비는 경우도 있어 문구도 본다. */
export function coupangRpcFailure(err: { code?: string | null; message?: string | null } | null | undefined): RpcFailure {
  if (!err) return "other";
  if (err.code === PGRST_FUNCTION_NOT_FOUND) return "missing";
  if (err.code === PG_STATEMENT_TIMEOUT || /statement timeout/i.test(err.message || "")) return "timeout";
  return "other";
}

/** from~to 포함 일수. 형식이 틀리면 0. */
export function daysInclusive(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return Math.round((b - a) / 86_400_000) + 1;
}

/** to 로 끝나는 days 일 기간. */
export function shortRange(to: string, days: number): { from: string; to: string } {
  const t = new Date(`${to}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - (days - 1));
  return { from: t.toISOString().slice(0, 10), to };
}

/** 지금 기간보다 짧은 제안 기간만 (7일 기간이면 단추 없음). */
export function shorterRanges(from: string, to: string): number[] {
  const days = daysInclusive(from, to);
  return COUPANG_SHORT_RANGES.filter((d) => d < days);
}

/** 대체 경로를 탈지: 원본 행 수가 한도 안이면 끌어온다. */
export function fallbackAllowed(count: number, max = COUPANG_FALLBACK_MAX_ROWS): boolean {
  return count <= max;
}

/**
 * 화면에 그대로 나가는 안내 문구. 원인을 사실대로 적는다.
 *   timeout  : 요약 함수가 DB 시간 제한에 걸림(기간이 긴 것이 원인)
 *   too_long : 요약 함수를 못 써서(cause: missing = SQL 실행 전, other = 그 밖 오류) 원본을 직접 읽어야 하는데 행이 한도를 넘음
 */
export function coupangLoadErrorMessage(kind: "timeout" | "too_long", days: number, rows?: number,
  cause: RpcFailure = "missing", code?: string | null): string {
  const span = days > 0 ? `${days}일` : "고른 기간";
  if (kind === "timeout") {
    return `기간이 길어(${span}) DB 가 시간 안에 합계를 내지 못했습니다. 7일·14일로 줄여 보거나 잠시 뒤 다시 시도해 주세요.`;
  }
  const n = rows !== undefined ? `, 원본 ${rows.toLocaleString("ko-KR")}행` : "";
  const why = cause === "other"
    ? `요약 함수가 오류를 내서${code ? `(${code})` : ""}`
    : "요약 함수가 아직 DB 에 없어서(SQL 실행 전)";
  return `${why} 원본을 직접 읽어야 하는데, 기간이 길어(${span}${n}) 한 번에 읽지 못합니다. 7일·14일로 줄여 보세요.`;
}

// ── 일별 묶음 갱신(2026-11-13, QA M-1) ──────────────────────────
/** coupang_keyword_daily_refresh 가 한 번에 받는 날짜 수 상한(SQL 함수와 같음). */
export const COUPANG_REFRESH_MAX_DATES = 62;

/**
 * 원본 적재 행들에서 다시 묶을 날짜를 뽑아 한 번에 보낼 묶음으로 나눈다. 형식이 틀린 날짜는 뺀다.
 * /api/raw-ingest 가 적재 성공 뒤에 쓴다. 갱신이 실패해도 적재(수집)는 성공으로 둔다.
 */
export function refreshDateBatches(rows: unknown[], max = COUPANG_REFRESH_MAX_DATES): string[][] {
  const set = new Set<string>();
  for (const r of rows) {
    const d = (r as { date?: unknown } | null)?.date;
    if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) set.add(d);
  }
  const all = Array.from(set).sort();
  const out: string[][] = [];
  for (let i = 0; i < all.length; i += max) out.push(all.slice(i, i + max));
  return out;
}
