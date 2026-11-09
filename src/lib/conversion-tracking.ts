// 광고 전환 측정이 성립하지 않는 곳 (2026-11-03 한곳으로 모음).
//
// 화면마다 따로 적어 두면 한쪽만 고쳐지고 다른 쪽이 "전환 0 = 성과 0" 으로 남는다.
// 서버(라우트)와 화면(클라이언트) 양쪽에서 이 파일만 가져다 쓴다.

/**
 * 메타 픽셀에서 구매(Purchase) 이벤트가 막힌 브랜드.
 * 밸런스랩 픽셀은 건강 분류로 구매·리드가 막혀 있고 상세조회(ViewContent)만 살아 있다.
 * 이 브랜드의 메타 전환 0 은 "성과 0" 이 아니라 "측정 불가(미배선)" 다.
 */
export const META_PURCHASE_UNTRACKED_BRANDS: ReadonlySet<string> = new Set(["balancelab"]);

/**
 * 네이버 검색광고 계정 중 전환매출을 믿을 수 없는 계정.
 * 밸런스랩 계정은 장바구니 전환(add_to_cart)에 상품가가 붙어 전환·전환매출이 부풀려진다(2026-11-02 원인 확정).
 * 이 계정 캠페인은 ROAS·전환수로 판단하지 않는다.
 */
export const NAVER_ROAS_UNTRUSTED_ACCOUNTS: ReadonlySet<string> = new Set(["balancelab"]);

/** 측정 불가 표기 문구. 화면마다 다르게 쓰지 않는다. */
export const UNMEASURED_LABEL = "측정 불가(미배선)";

/**
 * 광고 원장(daily_ad_spend) 한 행의 전환이 "구매 전환"으로 측정되는지.
 *  - GA4 행: 구글 광고비 중복이라 애초에 집계 대상이 아니다.
 *  - 메타 × 구매 막힌 브랜드: 미배선.
 *  - 네이버 검색·쇼핑 × 밸런스랩: 장바구니 전환이 섞여 구매 전환으로 볼 수 없다.
 *    (daily_ad_spend 에는 계정 칸이 없어 브랜드로 가른다. 밸런스랩 브랜드 행 = 밸런스랩 계정)
 */
export function isPurchaseConversionMeasured(channel: string, brand: string): boolean {
  if (channel.startsWith("ga4_")) return false;
  if (channel === "meta" && META_PURCHASE_UNTRACKED_BRANDS.has(brand)) return false;
  if (channel.startsWith("naver_") && NAVER_ROAS_UNTRUSTED_ACCOUNTS.has(brand)) return false;
  return true;
}
