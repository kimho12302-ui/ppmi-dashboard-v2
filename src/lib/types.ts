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

// 계열색 — ui-ux-pro-max "Analytics Dashboard" 팔레트(블루 데이터 + 앰버 액센트) 기준으로
// 다시 배치했다. 채도·명도를 한 단계로 맞춰 어느 하나가 튀지 않게 한다.
// ★ 의미 색은 건드리지 않는다: 매출=파랑, 광고비=빨강, ROAS=초록 (--sig-* 토큰).
export const BRAND_COLORS: Record<string, string> = {
  pet: "#f59e0b",
  nutty: "#3b82f6",
  ironpet: "#f59e0b",
  saip: "#8b5cf6",
  balancelab: "#06b6d4",
};

export const BRAND_LABELS: Record<string, string> = {
  pet: "펫 (너티·아이언펫·사입)",
  nutty: "너티",
  ironpet: "아이언펫",
  saip: "사입",
  balancelab: "밸런스랩",
};

export const AD_CHANNEL_COLORS: Record<string, string> = {
  meta: "#3b82f6",
  naver_search: "#22c55e",
  naver_shopping: "#06b6d4",
  google_pmax: "#f59e0b",
  google_search: "#eab308",
  gfa: "#8b5cf6",
  coupang_ads: "#ef4444",
};

export const SALES_CHANNEL_COLORS: Record<string, string> = {
  cafe24: "#3b82f6",
  smartstore: "#22c55e",
  coupang: "#f59e0b",
  ably: "#ec4899",
  petfriends: "#8b5cf6",
};

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

/** 브랜드 키 배열 */
// UI 필터용 (2026-07-29 그룹 뷰): 펫 3사는 "pet" 하나로 묶어서 본다. API는 expandBrands 로 해석.
export const BRANDS = ["all", "pet", "balancelab"] as const;
export type BrandKey = (typeof BRANDS)[number];
