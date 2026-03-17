# Dashboard Rebuild Specification

## Supabase Schema

### daily_sales (465 rows)
- Columns: date, brand, channel, revenue, orders, avg_order_value
- brand: nutty | ironpet | saip | balancelab
- channel: cafe24 | smartstore | coupang | ably | petfriends | pp

### daily_ad_spend (698 rows)
- Columns: date, brand, channel, spend, impressions, clicks, conversions, conversion_value, roas, ctr, cpc
- channel: meta | naver_search | naver_shopping | ga4_Performance Max | coupang | ga4_Demand Gen

### daily_funnel (340 rows)
- Columns: date, brand, impressions, sessions, cart_adds, signups, purchases, repurchases
- brand: "all" = total site, "cafe24" | "smartstore" | "coupang" = per-channel funnel

### product_sales (1203 rows)
- Columns: date, brand, category, product, channel, revenue, quantity, buyers, avg_price
- category: 간식 | 사료 | 영양제 | 헬스케어
- channel: 스마트스토어 | 카페24 | 쿠팡 | 에이블리 | 펫프렌즈 | 피피 (Korean names)

### product_costs (0 rows)
- Columns: product, brand, cost_price, shipping_cost, category

### keyword_performance (1287 rows)
- Columns: date, brand, platform, keyword, impressions, clicks, ctr, cpc, cost, conversions
- platform: naver_search | naver_shopping

### manual_monthly (60 rows)
- Columns: month, brand, channel, category, metric, value

## Supabase Connection
- URL: https://phcfydxgwkmjiogerqmm.supabase.co
- Anon Key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBoY2Z5ZHhnd2ttamlvZ2VycW1tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1Njg4NjQsImV4cCI6MjA4OTE0NDg2NH0.M0ThTSK0kBvN71rccvzQpr3dQuL52oRs_Tj9MT7VWRg

## Brand Info
- nutty (너티): 반려동물 간식 브랜드 - color #6366f1
- ironpet (아이언펫): 반려동물 헬스케어 - color #22c55e
- saip (사입): 수입 사료/영양제 - color #f97316
- balancelab (밸런스랩): 사람 헬스케어 - color #ec4899

## Tech Stack
- Next.js 14 App Router
- Tailwind CSS v4 (postcss plugin, NO tailwind.config.ts)
- Recharts for charts
- next-themes for dark/light mode
- Supabase JS client (@supabase/supabase-js)
- Existing: src/lib/supabase.ts, src/lib/types.ts, src/lib/utils.ts

## Pages Required

### 1. Layout & Sidebar
- Dark/light theme toggle (next-themes, attribute="class", default dark)
- Sidebar: Overview, Sales, Ads, Funnel, Keywords, Content, Insights, Settings
- Mobile bottom nav
- **Light mode MUST work** - use CSS variables or dark: prefix properly

### 2. Overview (/)
- KPI Cards: 매출, 광고비, ROAS, 주문수, 영업이익, CAC - clickable for drilldown
- Revenue vs Ad Spend trend (stacked bar by brand + ad spend line)
- Brand revenue breakdown (horizontal bar + pie)
- Brand revenue trend (line chart)
- Top 5 products (bars colored by brand)
- Channel ROAS trend (line chart per channel)

### 3. Sales (/sales)
- Filters: brand, date range
- Channel pie, Category/Product pie (if single category → product pie), Brand bar (only for "all")
- Channel trend (line), Brand trend (line), Product trend TOP 5 (line)
- Top products table

### 4. Ads (/ads)
- Channel breakdown (spend + ROAS)
- Spend trend by channel
- ROAS trend by channel
- Per-channel detail cards

### 5. Funnel (/funnel)
- 5-step funnel visualization: 노출 → 유입 → 장바구니 → 구매 → 재구매
- Channel funnel comparison (cafe24/smartstore/coupang bar + table)
- Daily trend (area chart)
- Period comparison
- Cart abandonment analysis

### 6. Keywords (/keywords)
- Top keywords by clicks/spend
- Keyword performance table

### 7. Settings (/settings)
- Product costs: dropdown from product_sales, missing cost warnings, click-to-fill
- Manual ad spend: single entry + CSV/XLSX upload
- Data source info

## Design System
- Dark: bg-zinc-950, bg-zinc-900, text-zinc-100, border-zinc-800
- Light: bg-gray-50, bg-white, text-gray-900, border-gray-200
- Use CSS variables or proper dark: classes so theme toggle works
- Cards with subtle shadows in light mode
- Recharts: use theme-aware colors for grid, ticks, tooltips

## API Routes (under /api/)
- /api/dashboard - Overview data
- /api/product-sales - Sales page data
- /api/funnel - Funnel data
- /api/settings - Product costs CRUD
- /api/upload - CSV/XLSX upload for ad spend

## CRITICAL RULES
1. Theme toggle MUST work - test both dark and light modes
2. Brand colors consistent everywhere
3. Korean labels for UI (채널, 브랜드, 매출, 광고비, etc.)
4. All charts responsive
5. Existing Supabase connection in src/lib/supabase.ts - keep it
6. Existing theme-provider.tsx - keep it
7. Git: commit as "ho kim <oo12302@gmail.com>", push to origin master
