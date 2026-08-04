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

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function fetchAll<T = any>(baseQuery: any): Promise<T[]> {
  let from = 0;
  const all: T[] = [];
  while (true) {
    const { data, error } = await baseQuery.range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}
