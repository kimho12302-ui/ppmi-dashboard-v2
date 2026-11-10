// 판매 원장이 어디까지 들어왔는지(「판매 원장 마지막 날」)의 정의 하나 (2026-11-10 QA 2회차 M3).
//
// ★ 정의: 고른 브랜드 범위의 판매 원장(daily_sales) 최대 날짜, 오늘(KST) 미만.
//   - brand=all 이면 전사(브랜드 'all' 집계 행 제외), "pet" 같은 묶음은 expandBrands 로 편다(matchesBrand 와 같은 규칙).
//   - channel='total' 집계 행과 공구(공구*) 채널은 세지 않는다. 화면 매출이 자체매출(공구 제외)이라 같은 범위로 본다.
//   - 오늘은 넣지 않는다. 오늘 행은 장중에 일부만 들어와 있을 수 있다.
//   판매 동기화는 브랜드마다 며칠씩 늦다(11-10 실측: 너티·사입·밸런스랩 11-08, 아이언펫 11-06).
//   그 뒤 날짜는 "안 팔렸다"가 아니라 "아직 안 들어왔다"라, 매출과 나란히 놓는 광고비·일평균·추세는
//   모두 이 날짜까지로 자른다.
//
// 이 함수를 쓰는 곳(같은 날짜를 봐야 하는 곳):
//   /api/dashboard(Overview 차트 끝·ROAS 경고), /api/pacing(페이싱 ROAS·광고비 비중·일평균 분모·브랜드별 행),
//   /api/monthly-summary(진행 중인 달 「(N일)」), /api/channel-groups(판매처 카드 「판매 집계일까지 ROAS」).
//
// 판매 0 인 날은 행이 없다. 그래서 "마지막 행" 이 곧 "마지막으로 판매가 있던 날" 이기도 하다.
// 그 브랜드가 실제로 며칠 안 팔린 것과 동기화가 늦은 것은 이 원장만으로는 구분되지 않는다.
import { supabase } from "@/lib/supabase";
import { expandBrands } from "@/lib/brand-groups";
import { kstDate } from "@/lib/date";

/** 판매 원장 마지막 날을 찾는 조회. 실패하면 던진다(호출부가 0일·빈칸으로 덮지 않게). */
export async function fetchSalesThrough(brand: string, today: string = kstDate()): Promise<string | null> {
  let q = supabase.from("daily_sales").select("date")
    .neq("channel", "total").not("channel", "like", "공구%").lt("date", today);
  q = brand === "all" ? q.neq("brand", "all") : q.in("brand", expandBrands(brand));
  const { data, error } = await q.order("date", { ascending: false }).limit(1);
  if (error) throw new Error(`판매 원장 마지막 날 조회 실패: ${error.message}`);
  return (data?.[0]?.date as string | undefined) ?? null;
}

/** 원장 마지막 날까지만 더한다. through 가 null(원장 없음)이면 0. */
export function sumThrough<T extends { date: string }>(rows: readonly T[], through: string | null, value: (r: T) => number): number {
  if (!through) return 0;
  let s = 0;
  for (const r of rows) if (r.date <= through) s += value(r);
  return s;
}
