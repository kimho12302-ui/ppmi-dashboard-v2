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

export const BRAND_COLORS: Record<string, string> = {
  nutty: "#dc2626",
  ironpet: "#ea580c",
  saip: "#92400e",
  balancelab: "#2563eb",
};

export const BRAND_LABELS: Record<string, string> = {
  nutty: "너티",
  ironpet: "아이언펫",
  saip: "사입",
  balancelab: "밸런스랩",
};

export const AD_CHANNEL_COLORS: Record<string, string> = {
  meta: "#1d4ed8",
  naver_search: "#15803d",
  naver_shopping: "#0e7490",
  google_pmax: "#c2410c",
  google_search: "#b45309",
  gfa: "#6d28d9",
  coupang_ads: "#b91c1c",
};

export const SALES_CHANNEL_COLORS: Record<string, string> = {
  cafe24: "#2563eb",
  smartstore: "#16a34a",
  coupang: "#dc2626",
  ably: "#be185d",
  petfriends: "#7c3aed",
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
export const BRANDS = ["all", "nutty", "ironpet", "saip", "balancelab"] as const;
export type BrandKey = (typeof BRANDS)[number];
