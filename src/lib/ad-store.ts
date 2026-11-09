// 광고 매체 → 그 광고가 손님을 보내는 판매처. 공용 규칙 한 곳(2026-11-09 channel-groups 에서 꺼냄).
//
// 쓰는 곳
//   - /api/channel-groups: 「판매처별 성과」·「판매처 상세」 판매처마다 붙는 광고비
//   - /api/product-ads: 「제품별 광고 성과」 실매출을 광고 판매처 판매로 좁힘
//
// 규칙
//   - 네이버 검색·네이버 쇼핑·GFA → 스마트스토어
//   - 메타·구글 P-Max → 자사몰(카페24)
//   - 쿠팡 광고 → 쿠팡
//   - ★ 밸런스랩은 스마트스토어에서만 판다. 밸런스랩 메타·구글도 스마트스토어 몫이다(자사몰 아님).
//   여기 없는 매체(구글 검색·GDN·인플루언서 등)는 판매처를 정하지 않는다(null).

/** 광고가 붙는 판매처. product_sales·daily_sales 의 channel 값과 같다. */
export type AdStore = "smartstore" | "cafe24" | "coupang";

/** 매체 → 판매처 기본 대응(밸런스랩 예외 전). 순서는 판매처별 광고비 합산 순서다. */
export const AD_CHANNEL_STORE: Readonly<Record<string, AdStore>> = {
  naver_search: "smartstore",
  naver_shopping: "smartstore",
  gfa: "smartstore",
  meta: "cafe24",
  google_pmax: "cafe24",
  coupang_ads: "coupang",
};

/** 밸런스랩 메타·구글(스마트스토어로 옮기는 몫)인가 */
export function isBalancelabMetaGoogle(brand: string, adChannel: string): boolean {
  return brand === "balancelab" && (adChannel === "meta" || adChannel === "google_pmax");
}

/** 이 브랜드의 이 매체 광고가 손님을 보내는 판매처. 정하지 않은 매체는 null. */
export function adStoreOf(brand: string, adChannel: string): AdStore | null {
  if (isBalancelabMetaGoogle(brand, adChannel)) return "smartstore";
  return AD_CHANNEL_STORE[adChannel] ?? null;
}

/** 기본 대응으로 그 판매처에 붙는 매체들의 광고비 합(밸런스랩 예외 전) */
export function baseStoreAdSpend(store: AdStore, adByChannel: Record<string, number>): number {
  let sum = 0;
  for (const [ch, s] of Object.entries(AD_CHANNEL_STORE)) if (s === store) sum += adByChannel[ch] || 0;
  return sum;
}
