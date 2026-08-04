// Supabase 조회 공용 헬퍼.
//
// 배경(2026-08 리뷰): 동일한 fetchAll 페이지네이션이 7개 route에 복붙돼 있었고,
// 그중 6개가 `if (error) break` 라 페이지 도중 실패해도 부분 데이터를 정상처럼 200으로 반환했다.
// (3페이지 중 3번째가 타임아웃되면 2/3만 든 매출이 에러 없이 응답됨 → 원인 추적 불가)
// → 여기 한 벌만 두고 실패는 반드시 throw 한다. 라우트의 catch가 500으로 변환한다.
//
// 또한 `.range(0, 99999)` 같은 큰 range로는 1000행 제한을 넘을 수 없다.
// PostgREST의 db-max-rows(1000)가 클라이언트 range보다 우선하기 때문이며,
// 넓은 기간 조회에서 데이터가 조용히 잘렸다(실측: 2026년 product_sales 3,619행 중 1,000행).
// 전체 행이 필요하면 반드시 이 fetchAll을 쓸 것.

const PAGE = 1000;
// 안전장치: 정상 조회는 수천 행 수준이다. 이보다 커지면 필터가 빠진 쿼리로 보고 멈춘다.
const MAX_PAGES = 100;

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 쿼리 전체 행을 페이지네이션으로 가져온다.
 *
 * ★ OFFSET 페이징이라 **전순서(total order)가 없으면 페이지 경계에서 행이 중복되거나 누락된다.**
 *   Postgres는 동률(tie) 행의 순서를 보장하지 않기 때문이다. 실제로 정렬이 없거나
 *   `date`(하루 수백 행)로만 정렬한 쿼리에서 2026년 광고비가 호출마다 달라졌다
 *   (진값 68,262,090 대비 -3,487 ~ -7,390, 2026-08 리뷰 실측).
 *   → 여기서 항상 `id` 를 마지막 정렬 키로 덧붙여 순서를 고정한다.
 *   호출부의 `.order("date")` 는 그대로 유지되고 그 뒤에 tie-break 로 붙는다.
 *
 * @param baseQuery Supabase 쿼리 빌더
 * @param tieBreak  전순서를 만들 유니크 컬럼 (기본 "id"). 해당 컬럼이 없는 테이블이면 명시적으로 넘길 것.
 */
export async function fetchAll<T = any>(baseQuery: any, tieBreak: string | null = "id"): Promise<T[]> {
  const q = tieBreak ? baseQuery.order(tieBreak, { ascending: true }) : baseQuery;
  let from = 0;
  const all: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) return all;
    all.push(...(data as T[]));
    if (data.length < PAGE) return all;
    from += PAGE;
  }
  throw new Error(`fetchAll: ${MAX_PAGES}페이지(${MAX_PAGES * PAGE}행) 초과 — 쿼리 필터를 확인하세요`);
}
