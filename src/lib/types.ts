/* ────────────────────────────────────────────
   데이터 인터페이스
   ──────────────────────────────────────────── */

export interface DailySales {
  date: string;
  brand: string;
  channel: string;
  revenue: number;
  orders: number;
  avg_order_value: number;
}

export interface DailyAdSpend {
  date: string;
  brand: string;
  channel: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversion_value: number;
  roas: number;
  ctr: number;
  cpc: number;
  /* v3 확장 필드 */
  reach?: number;
  frequency?: number;
  cpm?: number;
  link_clicks?: number;
  outbound_clicks?: number;
  landing_page_views?: number;
  video_views?: number;
  add_to_cart?: number;
  initiate_checkout?: number;
  purchases?: number;
  cost_per_purchase?: number;
  view_through_conv?: number;
  avg_rank?: number;
  search_impression_share?: number;
}

/** /api/ads?shape=daily 한 줄: (날짜, 매체) 합계. 브랜드·reach 같은 행 단위 칸은 없다(api-urls.ts dailyAdsUrl). */
export type DailyAdTotal = Pick<DailyAdSpend, "date" | "channel" | "spend" | "impressions" | "clicks" | "conversions" | "conversion_value"> & {
  /** 합친 원본 행 수 */
  n: number;
};

export interface DailyFunnel {
  date: string;
  brand: string;
  channel: string;
  impressions: number;
  sessions: number;
  cart_adds: number;
  signups: number;
  purchases: number;
  repurchases: number;
  subscribers?: number;
  avg_duration?: number;
  /* v3 확장 */
  active_users?: number;
  new_users?: number;
  bounce_rate?: number;
  engagement_rate?: number;
  page_views?: number;
  pages_per_session?: number;
  ecom_purchases?: number;
  ecom_revenue?: number;
  ecom_add_to_cart?: number;
  ecom_checkouts?: number;
}

export interface ProductSales {
  date: string;
  brand: string;
  category: string;
  product: string;
  channel: string;
  revenue: number;
  quantity: number;
  buyers: number;
  avg_price: number;
  lineup?: string;
}

export interface ProductCost {
  product: string;
  brand: string;
  cost_price: number;
  shipping_cost: number;
  category: string;
}

export interface KeywordPerformance {
  date: string;
  brand: string;
  platform: string;
  keyword: string;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cost: number;
  conversions: number;
  conversion_value?: number;
  avg_rank?: number;
  /** DB 합산 응답에만: 묶기 전 행마다 전환매출 0 인 날의 광고비 합 */
  wasted_cost?: number;
  /** DB 합산 응답에만: 묶인 원본 행 수 */
  n?: number;
}

export interface MonthlyTarget {
  month: string;
  brand: string;
  revenue_target: number;
  ad_spend_target: number;
  roas_target: number;
}

export interface BrandConfig {
  id: number;
  key: string;
  label: string;
  color: string;
  order: number;
  active: boolean;
  parent_key?: string;
  category?: string;
}

export interface ChannelConfig {
  id: number;
  key: string;
  label: string;
  color: string;
  type: "ad" | "sales";
  auto: boolean;
  order: number;
  active: boolean;
}

/* ────────────────────────────────────────────
   하드코딩 fallback (DB 없을 때)
   ──────────────────────────────────────────── */

// ★ 색의 원천은 이 파일 하나다 (2026-11-04).
//   예전에는 이 상수, globals.css 의 --brand-*·--channel-* 변수, 설정 DB(/api/settings)의 색, 화면마다 하드코딩한 색이
//   제각각이라 쿠팡이 화면마다 빨강·파랑·주황·보라로 바뀌었고 밸런스랩이 네이버 쇼핑과 같은 색이었다.
//   규칙: 같은 대상 = 모든 화면에서 같은 색. 한 차원(브랜드끼리, 판매처끼리, 매체끼리) 안에서는 서로 다른 색.
//   useConfig 는 여기 있는 키에 이 색을 쓰고, 여기 없는 새 키에만 설정 DB 색을 쓴다.
//   판단용 그래프(src/components/judge) 중 계열이 하나인 것(관리도·스몰 멀티플)은 무채색 + 강조색 하나.
//   계열이 여럿인 쌓은 막대(매출 구성)는 이 색을 쓴다(2026-11-10 김호: 회색끼리 구분 안 됨).
//   의미 색(정상·주의·위험)은 --sig-* 토큰이다. 이 계열색과 섞지 않는다.
export const BRAND_COLORS: Record<string, string> = {
  pet: "#d97706",
  nutty: "#dc2626",
  ironpet: "#ea580c",
  saip: "#78716c",
  balancelab: "#2563eb",
};

export const BRAND_LABELS: Record<string, string> = {
  pet: "펫 (너티·아이언펫·사입)",
  nutty: "너티",
  ironpet: "아이언펫",
  saip: "사입",
  balancelab: "밸런스랩",
};

// 쿠팡은 판매처(coupang)와 광고(coupang_ads)가 같은 색이다.
const COUPANG_COLOR = "#e11d48";

export const AD_CHANNEL_COLORS: Record<string, string> = {
  meta: "#4f46e5",
  naver_search: "#059669",
  naver_shopping: "#0d9488",
  google_pmax: "#ca8a04",
  google_search: "#a16207",
  gfa: "#65a30d",
  coupang_ads: COUPANG_COLOR,
};

export const SALES_CHANNEL_COLORS: Record<string, string> = {
  cafe24: "#7c3aed",
  smartstore: "#16a34a",
  coupang: COUPANG_COLOR,
  ably: "#c026d3",
  petfriends: "#0891b2",
  other: "#6b7280",
};

/** 판매처 성과(/channel)의 판매처 묶음 → 대표 판매처 색. 스마트스토어=네이버 묶음, 자사몰=카페24. */
export const SALES_GROUP_COLORS: Record<string, string> = {
  naver: SALES_CHANNEL_COLORS.smartstore,
  jasamol: SALES_CHANNEL_COLORS.cafe24,
  coupang: COUPANG_COLOR,
  other: SALES_CHANNEL_COLORS.other,
};

/** 퍼널 노출 원천(광고 매체 묶음) → 대표 매체 색. */
export const IMPRESSION_SOURCE_COLORS: Record<string, string> = {
  meta: AD_CHANNEL_COLORS.meta,
  naver: AD_CHANNEL_COLORS.naver_search,
  google: AD_CHANNEL_COLORS.google_pmax,
  coupang: COUPANG_COLOR,
};

const FALLBACK_COLOR = "#6b7280";
export const brandColor = (key: string): string => BRAND_COLORS[key] || FALLBACK_COLOR;

export const CHANNEL_LABELS: Record<string, string> = {
  cafe24: "카페24",
  smartstore: "스마트스토어",
  coupang: "쿠팡",
  ably: "에이블리",
  petfriends: "펫프렌즈",
  meta: "메타",
  naver_search: "네이버 검색",
  naver_shopping: "네이버 쇼핑",
  google_pmax: "구글 P-Max",
  google_search: "구글 검색",
  gfa: "GFA",
  coupang_ads: "쿠팡 광고",
};

/** v2 호환 alias */
export const CHANNEL_COLORS: Record<string, string> = {
  ...SALES_CHANNEL_COLORS,
  ...AD_CHANNEL_COLORS,
};
export const channelColor = (key: string): string => CHANNEL_COLORS[key] || FALLBACK_COLOR;

/** 브랜드 키 배열 */
// UI 필터용 (2026-07-29 그룹 뷰): 펫 3사는 "pet" 하나로 묶어서 본다. API는 expandBrands 로 해석.
export const BRANDS = ["all", "pet", "balancelab"] as const;
export type BrandKey = (typeof BRANDS)[number];
