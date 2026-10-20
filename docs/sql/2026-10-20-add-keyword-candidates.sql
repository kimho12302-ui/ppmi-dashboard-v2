-- ============================================================
--  키워드 탭 「추가할 키워드」 칸용 표 2개 + 함수 2개 · 2026-10-20
--
--  기준 문서(규칙·검산값 정본):
--    Work/PPMI/projects/검색광고-운영/reports/2026-10-20-추가키워드-기준.md (seo-marketer)
--
--  실행: Supabase 대시보드 > SQL Editor 에 이 파일 전체를 붙여넣고 한 번 실행.
--        여러 번 실행해도 안전하다(if not exists · create or replace · on conflict do nothing).
--        기존 표·함수는 바꾸지도 지우지도 않는다. 인덱스 1개만 원천 표에 더한다.
--
--  만드는 것
--    1. naver_sa_keyword        네이버 등록 키워드 매일 스냅샷 (수집기: marketing-dashboard
--                               scripts/sync_naver_sa_keywords.py, daily-sync)
--    2. sa_keyword_hold         지난 결정으로 막아 둔 검색어. 기준 문서 2-3절 6행으로 채운다
--    3. naver_search_term_add_source(...)  캠페인·광고그룹까지 같이 돌려주는 검색어 집계
--    4. coupang_keyword_add_source(...)    쿠팡 검색 영역 주문어 집계(주문 난 날 수 포함)
--
--  ★ 3번은 기존 naver_search_term_summary 를 고치지 않고 새로 만든다. 기존 함수는 결과가
--    (광고유형·상품·검색어) 단위라 캠페인 칸이 없어서 밸런스랩 계정의 그룹사 캠페인
--    (와이에스환경기술연구소 등)을 뺄 수 없다. 기존 화면은 그대로 기존 함수를 쓴다.
--
--  실행 뒤 할 일: 수집기를 한 번 돌려 naver_sa_keyword 를 채운다(아래 맨 끝 주석).
--  그 전까지 대시보드 네이버 칸은 "등록 목록 수집 전이라 판정 못 함" 안내만 띄운다.
-- ============================================================


-- ── 1. naver_sa_keyword : 등록 키워드 매일 스냅샷 ────────────────
--
-- 키 = (account, keyword_id). 매일 upsert 하고 seen_on 을 그날로 바꾼다.
-- 계정에서 지워진 키워드는 옛 seen_on 에 머문다 → 판정은 계정별 최신 seen_on 행만 쓴다.
-- imp_30d·clk_30d·cost_30d 는 수집일 기준 어제까지 30일 합. /stats 응답에 없는 id 는 0.

create table if not exists naver_sa_keyword (
  account          text        not null,   -- 'main' | 'balancelab' (raw_naver_search_term 과 같은 값)
  keyword_id       text        not null,   -- nccKeywordId
  keyword          text        not null,
  keyword_norm     text        not null,   -- 소문자 + 공백 제거
  brand            text,                   -- 캠페인 이름으로 유도(기준 문서 2-2절). 그룹사 캠페인은 'group'
  campaign_id      text,
  campaign         text,
  campaign_tp      text,                   -- WEB_SITE | SHOPPING | BRAND_SEARCH | POWER_CONTENTS
  campaign_status  text,
  campaign_lock    boolean,
  adgroup_id       text,
  adgroup          text,
  adgroup_status   text,
  adgroup_lock     boolean,
  status           text,                   -- 키워드 status
  status_reason    text,                   -- 키워드 statusReason
  keyword_lock     boolean,                -- 키워드 userLock
  use_group_bid    boolean,
  bid              int,                    -- 실효 입찰가(그룹 입찰가를 쓰면 그 값)
  group_bid        int,
  reg_tm           timestamptz,
  edit_tm          timestamptz,
  is_live          boolean,                -- 키워드·광고그룹·캠페인 모두 ELIGIBLE
  imp_30d          int         default 0,
  clk_30d          int         default 0,
  cost_30d         int         default 0,
  seen_on          date        not null,   -- 이번 수집일(KST)
  primary key (account, keyword_id)
);
create index if not exists naver_sa_keyword_norm_idx on naver_sa_keyword (account, keyword_norm);
create index if not exists naver_sa_keyword_seen_idx on naver_sa_keyword (account, seen_on);

-- 수집기와 대시보드가 anon 키로 붙는다(다른 raw_* 표와 같은 조건).
grant select, insert, update on naver_sa_keyword to anon, authenticated;


-- ── 2. sa_keyword_hold : 지난 결정으로 막아 둔 검색어 ─────────────
--
-- 검색어가 "미등록"·"꺼짐"으로 보여도 우리가 일부러 끈 것이면 후보로 올리지 않는다.
-- 그 결정은 계정 상태만 봐서는 안 보이므로 표로 둔다(기준 문서 2-3절).
-- match: exact = 정규화한 검색어가 pattern 과 같음 / contains = pattern 을 포함
-- review_on 이 비어 있으면 기한 없이 보류. sa_change_log 의 delete·pause 는 화면이 따로 읽는다.

create table if not exists sa_keyword_hold (
  account     text  not null,
  brand       text  not null,
  pattern     text  not null,
  match       text  not null check (match in ('exact', 'contains')),
  reason      text  not null,
  source      text,
  decided_on  date,
  review_on   date,
  primary key (account, brand, pattern, match)
);
grant select on sa_keyword_hold to anon, authenticated;

insert into sa_keyword_hold (account, brand, pattern, match, reason, source, decided_on, review_on) values
  ('main', 'saip', '오리젠', 'contains',
   '오리젠 파워링크 최소화 지시, 10-02 오리젠 MO·PC 그룹 잠금 이행',
   '2026-09-30-사입-광고-대행사-지시서 · 2026-10-19-사입-10-14-점검', '2026-09-30', null),
  ('balancelab', 'balancelab', '알레르기검사', 'exact',
   '08-26 지시서 D 제외 대상(30일 전환 0), 09-24 잠금',
   '2026-08-26-밸런스랩-30일-분석-전략', '2026-08-26', null),
  ('balancelab', 'balancelab', '음식알레르기검사', 'exact',
   '08-26 지시서 D 제외 대상(30일 전환 0), 09-24 잠금',
   '2026-08-26-밸런스랩-30일-분석-전략', '2026-08-26', null),
  ('balancelab', 'balancelab', '알러지검사', 'exact',
   '08-26 지시서 D 제외 대상(30일 전환 0), 09-24 잠금',
   '2026-08-26-밸런스랩-30일-분석-전략', '2026-08-26', null),
  ('balancelab', 'balancelab', '지연성알러지검사', 'exact',
   '08-26 분석 30일 288,274원 구매 0, 08-25(MO)·09-01(PC) 잠금',
   '2026-08-26-밸런스랩-30일-분석-전략', '2026-08-26', null),
  ('balancelab', 'balancelab', '모발검사', 'exact',
   '중지 유지. 1위 입찰가 6만 원대라 수지 안 맞음',
   '2026-10-12-중금속검사-이슈키워드-검색광고', '2026-10-12', null)
on conflict (account, brand, pattern, match) do nothing;


-- ── 3. naver_search_term_add_source : 캠페인을 같이 돌려주는 검색어 집계 ──
--
-- 화면이 후보를 고를 때 쓴다. 원천 raw_naver_search_term 을 (브랜드·캠페인·광고그룹·상품·검색어)
-- 로 묶어 돌려준다. 결과를 작게 하려고 후보가 될 수 없는 검색어는 DB 에서 미리 버린다.
--   shopping : 계정 전체에서 정규화 검색어별 구매 합 >= p_min_purchases 인 검색어만
--              (★ 브랜드로 자르지 않는다. S99.사입_벌크 가 너티 상품도 광고해서 화면이
--               상품명으로 브랜드를 다시 정한다. 그래서 shopping 은 p_brand 를 비워 부른다)
--   powerlink: (브랜드, 정규화 검색어)별 클릭 합 >= p_min_clicks 인 검색어만.
--              자사 1클릭 / 그 외 3클릭 문턱은 화면이 가른다(토큰 목록이 화면 상수에 있다)
-- p_exclude_campaigns 에 든 캠페인 행은 처음부터 뺀다(밸런스랩 계정 그룹사 캠페인 4개).
--
-- 교훈(naver-search-term-speedup.sql): CTE 에서 select * 를 쓰면 안 쓰는 칸까지 물어와
-- 쌓는다. 쓰는 칸만 고른다. 브랜드·광고유형으로 좁혀 부른다(한 달 7만 행).

create index if not exists raw_naver_search_term_type_idx
  on raw_naver_search_term (account, ad_type, date);

create or replace function naver_search_term_add_source(
  p_account           text,
  p_from              date,
  p_to                date,
  p_ad_type           text,                   -- 'shopping' | 'powerlink'
  p_brand             text    default null,   -- null 이면 그 계정 전체
  p_exclude_campaigns text[]  default '{}',
  p_min_purchases     int     default 1,
  p_min_clicks        int     default 1
)
returns json
language sql
stable
as $$
with r as (
  select brand, campaign, adgroup,
         coalesce(product, adgroup, '(상품 없음)') as product,
         query,
         lower(replace(btrim(query), ' ', '')) as qnorm,
         impressions, clicks, cost, purchases, purchase_value
  from raw_naver_search_term
  where account = p_account
    and ad_type = p_ad_type
    and date between p_from and p_to
    and (p_brand is null or brand = p_brand)
    and not (coalesce(campaign, '') = any(coalesce(p_exclude_campaigns, '{}')))
),
keep as (
  -- powerlink 는 브랜드별로, shopping 은 계정 전체로 묶어 문턱을 본다.
  select case when p_ad_type = 'powerlink' then coalesce(brand, '') else '' end as kb, qnorm
  from r
  group by 1, 2
  having (p_ad_type = 'shopping'  and sum(purchases) >= p_min_purchases)
      or (p_ad_type = 'powerlink' and sum(clicks)    >= p_min_clicks)
)
select json_build_object(
  'entries', (
    select coalesce(json_agg(e), '[]'::json) from (
      select r.brand, r.campaign, r.adgroup, r.product, r.query,
        sum(r.impressions)::float8 as impressions, sum(r.clicks)::float8 as clicks,
        sum(r.cost)::float8 as cost, sum(r.purchases)::float8 as purchases,
        sum(r.purchase_value)::float8 as purchase_value
      from r
      join keep k
        on k.qnorm = r.qnorm
       and k.kb = case when p_ad_type = 'powerlink' then coalesce(r.brand, '') else '' end
      group by 1, 2, 3, 4, 5
    ) e),
  'norms',  (select count(*) from keep),
  'rows',   (select count(*) from r),
  -- 최종 수집일은 광고유형·브랜드와 무관하게 계정 기준(기존 함수와 같은 뜻).
  'latest', (select max(date) from raw_naver_search_term where account = p_account)
);
$$;

grant execute on function naver_search_term_add_source(text, date, date, text, text, text[], int, int) to anon, authenticated;


-- ── 4. coupang_keyword_add_source : 쿠팡 검색 영역 주문어 ───────────
--
-- 규칙(기준 문서 1-4절): 날짜마다 read_at 이 가장 늦은 파일 하나만(coupang_keyword_summary 와 같음),
-- placement = '검색 영역', 키워드가 비어 있지 않고 '-' 가 아닌 행. 정규화(소문자 + 공백 제거,
-- '+' 는 지우지 않는다)별로 묶고 주문 합 >= p_min_orders 인 것만 돌려준다.
-- 표기는 노출이 가장 많은 원래 표기. 상품은 주문(동률이면 클릭)이 가장 많은 ad_product.
-- ★ campaign 칸이 거의 빈칸(30일 18,674행 중 18,505행)이라 상품 단서는 ad_product 뿐이다.

create or replace function coupang_keyword_add_source(
  p_from        date,
  p_to          date,
  p_min_orders  int default 1
)
returns json
language sql
stable
as $$
with latest as (
  select date, (array_agg(file order by read_at desc nulls last))[1] as file
  from raw_coupang_keyword
  where date between p_from and p_to
  group by date
),
r as (
  select k.date,
         btrim(k.keyword) as keyword,
         lower(replace(btrim(k.keyword), ' ', '')) as knorm,
         coalesce(nullif(btrim(k.ad_product), ''), '(상품 없음)') as product,
         k.impressions, k.clicks, k.spend, k.orders_1d, k.orders_14d, k.conv_sales_14d
  from raw_coupang_keyword k
  join latest l on l.date = k.date and l.file is not distinct from k.file
  where k.date between p_from and p_to
    and k.placement = '검색 영역'
    and k.keyword is not null
    and btrim(k.keyword) not in ('', '-')
),
g as (
  select knorm,
         sum(impressions)::float8 as impressions, sum(clicks)::float8 as clicks, sum(spend)::float8 as spend,
         sum(orders_1d)::float8 as orders_1d, sum(orders_14d)::float8 as orders_14d,
         sum(conv_sales_14d)::float8 as conv_sales_14d,
         count(distinct date) filter (where orders_14d > 0) as order_days
  from r
  group by knorm
  having sum(orders_14d) >= p_min_orders
),
spell as (
  select distinct on (knorm) knorm, keyword
  from (select knorm, keyword, sum(impressions) as imp from r
        where knorm in (select knorm from g) group by 1, 2) s
  order by knorm, imp desc, keyword
),
prod as (
  select distinct on (knorm) knorm, product
  from (select knorm, product, sum(orders_14d) as o, sum(clicks) as c from r
        where knorm in (select knorm from g) group by 1, 2) s
  order by knorm, o desc, c desc, product
)
select json_build_object(
  'candidates', (
    select coalesce(json_agg(c), '[]'::json) from (
      select g.knorm as keyword_norm, s.keyword, p.product,
             g.impressions, g.clicks, g.spend, g.orders_1d, g.orders_14d, g.conv_sales_14d, g.order_days
      from g join spell s using (knorm) join prod p using (knorm)
    ) c),
  -- 검색 영역 전체 합(검산용). 기준 문서 4-2 보조 검산과 대조한다.
  'search_total', (
    select json_build_object(
      'impressions', coalesce(sum(impressions), 0)::float8, 'clicks', coalesce(sum(clicks), 0)::float8,
      'spend', coalesce(sum(spend), 0)::float8, 'orders_14d', coalesce(sum(orders_14d), 0)::float8,
      'conv_sales_14d', coalesce(sum(conv_sales_14d), 0)::float8)
    from r),
  'rows',   (select count(*) from r),
  'dates',  (select count(*) from latest),
  'latest', (select max(date) from raw_coupang_keyword)
);
$$;

grant execute on function coupang_keyword_add_source(date, date, int) to anon, authenticated;


-- ── 확인. 실행하면 결과 표 한 줄이 나온다 ─────────────────────────
--
-- 기대값(2026-10-20 원천 직접 집계):
--   보류표_행수 6
--   등록키워드_행수 0 (수집기를 돌리기 전. 돌린 뒤엔 약 3,700)
--   쇼핑구매어_펫 116 · 쇼핑구매어_밸런스랩 3        ← 구매 1건 이상 검색어 수(운영중 포함 전부)
--   클릭어_너티 139 · 클릭어_사입 300 · 클릭어_밸런스랩 270 ← 클릭 1회 이상 검색어 수(문턱·등록 대조 전)
--   쿠팡_주문어 70 · 쿠팡_주문 110 · 쿠팡_날짜 28
--   (정규화 차이로 한두 개 다를 수 있다. 크게 다르면 원천이 바뀐 것이다)
select
  (select count(*) from sa_keyword_hold)                                              as 보류표_행수,
  (select count(*) from naver_sa_keyword)                                             as 등록키워드_행수,
  (naver_search_term_add_source('main', '2026-09-20', '2026-10-19', 'shopping')->>'norms')::int as 쇼핑구매어_펫,
  (naver_search_term_add_source('balancelab', '2026-09-20', '2026-10-19', 'shopping', null,
     array['와이에스환경기술연구소','한국반려동물안전인증센터','S99.벌크','수은세상'])->>'norms')::int as 쇼핑구매어_밸런스랩,
  (naver_search_term_add_source('main', '2026-09-20', '2026-10-19', 'powerlink', 'nutty')->>'norms')::int as 클릭어_너티,
  (naver_search_term_add_source('main', '2026-09-20', '2026-10-19', 'powerlink', 'saip')->>'norms')::int  as 클릭어_사입,
  (naver_search_term_add_source('balancelab', '2026-09-20', '2026-10-19', 'powerlink', 'balancelab',
     array['와이에스환경기술연구소','한국반려동물안전인증센터','S99.벌크','수은세상'])->>'norms')::int as 클릭어_밸런스랩,
  json_array_length(coupang_keyword_add_source('2026-09-20', '2026-10-19')->'candidates')             as 쿠팡_주문어,
  ((coupang_keyword_add_source('2026-09-20', '2026-10-19')->'search_total')->>'orders_14d')::int     as 쿠팡_주문,
  (coupang_keyword_add_source('2026-09-20', '2026-10-19')->>'dates')::int                            as 쿠팡_날짜;

-- 실행 뒤 수집기를 한 번 돌려 등록 목록을 채운다(GitHub > marketing-dashboard > Actions >
-- daily-sync > Run workflow, 또는 로컬에서):
--   cd C:\Users\harry\projects\marketing-dashboard
--   python scripts\sync_naver_sa_keywords.py --apply
-- 그 뒤 위 "등록키워드_행수" 가 약 3,700 이 된다.
