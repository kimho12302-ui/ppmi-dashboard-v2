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
}

export interface DailyFunnel {
  date: string;
  brand: string;
  impressions: number;
  sessions: number;
  cart_adds: number;
  signups: number;
  purchases: number;
  repurchases: number;
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
}

export interface ManualMonthly {
  month: string;
  brand: string;
  channel: string;
  category: string;
  metric: string;
  value: number;
}

export const BRAND_COLORS: Record<string, string> = {
  nutty: "#6366f1",
  ironpet: "#22c55e",
  saip: "#f97316",
  balancelab: "#ec4899",
};

export const BRAND_LABELS: Record<string, string> = {
  nutty: "너티",
  ironpet: "아이언펫",
  saip: "사입",
  balancelab: "밸런스랩",
};

export const CHANNEL_LABELS: Record<string, string> = {
  cafe24: "카페24",
  smartstore: "스마트스토어",
  coupang: "쿠팡",
  ably: "에이블리",
  petfriends: "펫프렌즈",
  pp: "피피",
  meta: "메타",
  naver_search: "네이버 검색",
  naver_shopping: "네이버 쇼핑",
  "ga4_Performance Max": "GA4 퍼포먼스맥스",
  "ga4_Demand Gen": "GA4 디맨드젠",
};

export const CHANNEL_COLORS: Record<string, string> = {
  cafe24: "#3b82f6",
  smartstore: "#22c55e",
  coupang: "#ef4444",
  ably: "#f97316",
  petfriends: "#8b5cf6",
  pp: "#ec4899",
  meta: "#3b82f6",
  naver_search: "#22c55e",
  naver_shopping: "#06b6d4",
  "ga4_Performance Max": "#f97316",
  "ga4_Demand Gen": "#8b5cf6",
  coupang_ads: "#ef4444",
};
