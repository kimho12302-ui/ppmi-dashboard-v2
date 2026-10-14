// DB 합산 함수(RPC) 호출 + 옛 경로 자동 폴백 (2026-10-14).
//
// 함수 정의: docs/sql/2026-10-14-summary-rpc.sql (김호가 SQL Editor 에서 실행).
// 실행 전에는 함수가 없어 PGRST202 가 난다. 그때는 조용히 null 을 돌려주고, 호출부가 옛 경로(원본 행)로 간다.
// 그 밖의 오류(시간 초과·권한·인자 타입 등)도 옛 경로로 가되 서버 로그에 남긴다.
// 그래서 SQL 실행 전에 배포해도 화면이 깨지지 않는다. 대조: scripts/verify-summary-rpc.mjs.
import { supabase } from "@/lib/supabase";

const FUNCTION_NOT_FOUND = "PGRST202";

/** 함수 결과 또는 null(→ 옛 경로). */
export async function tryRpc<T>(name: string, params: Record<string, unknown>): Promise<T | null> {
  const { data, error } = await supabase.rpc(name, params);
  if (!error) return data as T;
  if (error.code !== FUNCTION_NOT_FOUND) {
    console.warn(`[rpc] ${name} 실패, 옛 경로로 대체: ${error.code || ""} ${error.message}`);
  }
  return null;
}

/* ── 함수가 없을 때 같은 모양을 JS 로 만든다 (2026-10-14) ──
 * SQL 실행 전에도 화면으로 가는 응답은 묶음 합계로 줄인다. 묶는 기준·칸·null 처리는
 * docs/sql/2026-10-14-summary-rpc.sql 의 같은 이름 함수와 같다. 다른 점은 DB 에서 원본 행을
 * 받아 오는 서버 안쪽 비용뿐이다(SQL 을 실행하면 그것도 준다). */

type Num = number | string | null | undefined;
const n = (v: Num) => Number(v) || 0;

/** product_sales_daily 와 같은 모양: (date, brand, product) 별 revenue·quantity 합, n = 원본 행 수 */
export function groupProductSalesDaily(rows: { date: string; brand: string; product: string; revenue: Num; quantity: Num }[]) {
  const m = new Map<string, { date: string; brand: string; product: string; revenue: number; quantity: number; n: number }>();
  for (const r of rows) {
    const k = JSON.stringify([r.date, r.brand, r.product]);
    const g = m.get(k) || { date: r.date, brand: r.brand, product: r.product, revenue: 0, quantity: 0, n: 0 };
    g.revenue += n(r.revenue);
    g.quantity += n(r.quantity);
    g.n += 1;
    m.set(k, g);
  }
  return Array.from(m.values()).sort((a, b) => b.revenue - a.revenue);
}

/** keyword_summary 와 같은 모양: (platform, keyword) 별 합. 전환매출이 전부 비면 null, wasted_cost = 행마다 전환매출 0 인 날의 광고비 */
export function groupKeywordSummary(rows: { platform: string; keyword: string; impressions: Num; clicks: Num; cost: Num; conversions: Num; conversion_value: Num }[]) {
  type G = { platform: string; keyword: string; impressions: number; clicks: number; cost: number; conversions: number; conversion_value: number | null; wasted_cost: number; n: number };
  const m = new Map<string, G>();
  for (const r of rows) {
    const k = JSON.stringify([r.platform, r.keyword]);
    const g = m.get(k) || { platform: r.platform, keyword: r.keyword, impressions: 0, clicks: 0, cost: 0, conversions: 0, conversion_value: null, wasted_cost: 0, n: 0 };
    g.impressions += n(r.impressions);
    g.clicks += n(r.clicks);
    g.cost += n(r.cost);
    g.conversions += n(r.conversions);
    if (r.conversion_value !== null && r.conversion_value !== undefined) g.conversion_value = (g.conversion_value ?? 0) + n(r.conversion_value);
    if (n(r.conversion_value) === 0) g.wasted_cost += n(r.cost);
    g.n += 1;
    m.set(k, g);
  }
  return Array.from(m.values()).sort((a, b) => b.clicks - a.clicks);
}
