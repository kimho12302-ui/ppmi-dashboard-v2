-- 원천(raw) 테이블 4개. 2026-09-17 신설.
--
-- 왜 필요한가
--   사람이 손으로 넣던 숫자는 일별 합계뿐이었다. aside 수집기는 그럴 이유가 없어서
--   채널별·상품별·캠페인별로 받아 온다. 그 깊이를 담을 자리가 여기다.
--   기존 집계 테이블(daily_funnel·daily_ad_spend)은 건드리지 않는다. 화면 숫자가 바뀌면 안 된다.
--
-- 쓰는 쪽: 로컬 크론 dashboard-daily-collect → POST /api/raw-ingest
-- 보는 쪽: /raw 페이지 (테이블 직접 조회). ALLOWED_TABLES 에 이미 추가돼 있다.
--
-- 실행: Supabase 대시보드 > SQL Editor 에 붙여넣고 실행. 여러 번 실행해도 안전하다.
--
-- 공통 규칙
--   - 모든 행에 read_at(수집 시각)과 screen(읽은 화면)을 남긴다.
--     자세해질수록 출처가 없으면 더 헤맨다.
--   - 자연키에 unique 를 걸어 같은 날을 여러 번 수집해도 덧쌓이지 않게 한다(upsert).

-- ── 1. 카페24 장바구니 ─────────────────────────────────
-- 원천 화면이 "지금 장바구니에 남아 있는 것" 스냅샷이라 구매·삭제되면 사라진다.
-- 그래서 본 적 있는 건을 모아 둔다. dup_no 는 같은 분 같은 상품이 두 줄일 때를 가른다.
create table if not exists raw_cafe24_cart (
  ins_at        text        not null,
  date          date        not null,
  dup_no        int         not null default 1,
  member        text,
  maker         text,
  product       text        not null,
  opt           text        not null default '',
  qty           int         not null default 0,
  first_seen_at timestamptz,
  last_seen_at  timestamptz,
  screen        text,
  primary key (ins_at, product, opt, qty, member, dup_no)
);
create index if not exists raw_cafe24_cart_date_idx on raw_cafe24_cart (date);

-- ── 2. 스마트스토어 유입수 (채널별) ────────────────────
-- 차트 범례는 상위 10개까지만 보여 주는데 API 는 전부 준다. 2026-09-17 기준 채널 28개.
create table if not exists raw_smartstore_inflow (
  store    text not null,
  date     date not null,
  channel  text not null,
  inflow   int  not null default 0,
  read_at  timestamptz,
  screen   text,
  primary key (store, date, channel)
);
create index if not exists raw_smartstore_inflow_date_idx on raw_smartstore_inflow (date);

-- ── 3. 스마트스토어 고객현황 ───────────────────────────
-- 대시보드 칸은 알림받기(증감)와 재구매 둘뿐이지만 누적·관심·신규·주문·환불까지 같이 쌓는다.
-- 증감만 쌓으면 나중에 "그때 누적이 얼마였나" 를 되돌아볼 수 없다.
create table if not exists raw_smartstore_customers (
  store                 text not null,
  date                  date not null,
  tiding_keep           int,
  tiding_keep_variation int,
  store_keep            int,
  store_keep_variation  int,
  re_purchaser          int,
  new_purchaser         int,
  purchase              int,
  refund                int,
  read_at               timestamptz,
  screen                text,
  primary key (store, date)
);

-- ── 4. GFA 캠페인별 성과 ───────────────────────────────
-- 브랜드는 계정이 아니라 캠페인 이름으로 갈린다. brand 는 수집기가 계산해서 넣는다.
-- (이름에 '너티' 있으면 너티, '밸런스랩' 있으면 밸런스랩, 나머지 사입)
create table if not exists raw_gfa_campaign (
  account     text not null,
  date        date not null,
  campaign    text not null,
  brand       text,
  spend       numeric default 0,
  impressions bigint  default 0,
  clicks      bigint  default 0,
  conversions bigint  default 0,
  conv_sales  numeric default 0,
  read_at     timestamptz,
  screen      text,
  primary key (account, date, campaign)
);
create index if not exists raw_gfa_campaign_date_idx on raw_gfa_campaign (date);

-- ── 권한 ───────────────────────────────────────────────
-- 대시보드는 anon 키로 붙는다(src/lib/supabase.ts). 기존 집계 테이블과 같은 조건이어야
-- /api/raw-ingest 가 쓰고 /raw 가 읽는다.
--
-- 이 프로젝트의 기존 테이블이 RLS 를 쓰는지 확인하고 맞춰라.
--   select relname, relrowsecurity from pg_class where relname = 'daily_funnel';
--
-- relrowsecurity 가 false 면 아래를 실행하지 않아도 된다(기본 권한으로 동작).
-- true 면 아래 주석을 풀어서 같은 정책을 건다.
--
-- alter table raw_cafe24_cart           enable row level security;
-- alter table raw_smartstore_inflow     enable row level security;
-- alter table raw_smartstore_customers  enable row level security;
-- alter table raw_gfa_campaign          enable row level security;
--
-- create policy raw_rw on raw_cafe24_cart          for all using (true) with check (true);
-- create policy raw_rw on raw_smartstore_inflow    for all using (true) with check (true);
-- create policy raw_rw on raw_smartstore_customers for all using (true) with check (true);
-- create policy raw_rw on raw_gfa_campaign         for all using (true) with check (true);
