// 화면 안의 칸(컴포넌트)이 부르는 API 주소를 한곳에서 만든다.
//
// 부모 화면이 usePrefetch 로 같은 주소를 미리 부를 때, 칸이 실제로 부르는 주소와 글자 하나라도
// 다르면 미리 부른 응답을 못 받아 쓰고 한 번 더 부른다. 그래서 칸과 부모가 이 함수를 같이 쓴다.

export const pacingUrl = (brand: string) => `/api/pacing?brand=${brand || "all"}`;

export const channelGroupsUrl = (brand: string, from: string, to: string) =>
  `/api/channel-groups?brand=${brand}&from=${from}&to=${to}`;

// shape=daily: (날짜, 브랜드, 상품) 합계만. 상품 추이 차트 전용. 기본 응답(원본 행)은 크론이 쓴다.
export const productSalesUrl = (brand: string, from: string, to: string) =>
  `/api/product-sales?brand=${brand || "all"}&from=${from}&to=${to}&shape=daily`;

// shape=channel: 채널별 합계만(매출 화면 채널 효율 사분면 전용). /ads 화면은 원본 행을 쓴다.
export const channelAdsUrl = (brand: string, from: string, to: string) =>
  brand && brand !== "all" ? `/api/ads?from=${from}&to=${to}&brand=${brand}&shape=channel` : `/api/ads?from=${from}&to=${to}&shape=channel`;

export const AD_ALERTS_URL = "/api/ad-alerts";

export const saChangesUrl = (brand: string) => `/api/sa-changes?brand=${brand}`;

export const brandDetailUrl = (brand: string, from: string, to: string) =>
  `/api/brand-detail?brand=${brand}&from=${from}&to=${to}`;
