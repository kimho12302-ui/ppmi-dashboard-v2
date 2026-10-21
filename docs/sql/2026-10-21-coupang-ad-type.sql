-- ============================================================
-- 2026-10-21  쿠팡 키워드 원천에 광고유형 칸 + 추가 후보 함수가 캠페인·광고유형을 같이 돌려준다
-- ============================================================
--
--  왜: 키워드 탭 「쿠팡 추가 후보」가 "이미 수동 캠페인에 있나"를 못 가렸다.
--    1) 캠페인 칸이 비어 있던 건 쿠팡 보고서 탓이 아니라 수집기 탓이었다.
--       일간 보고서 머리글은 「캠페인」인데 수집기(settings/collectors/bin/coupang-ads-parse.py)는
--       「캠페인명」「캠페인 이름」만 찾았다. 10-21 수집기를 고치고 09-18~10-20 파일을 다시 넣는다.
--    2) 수동 캠페인인지는 보고서의 「광고유형」 칸으로 가린다. 원천 표에 그 칸이 없었다.
--       09-18 이후 일간 보고서 29개의 모든 행이 「매출 최적화」였다(수동 성과형 행 0건).
--
--  ★ 보고서에는 노출이 난 행만 나온다. 수동 캠페인에 등록했는데 노출 0 인 키워드는 안 보인다.
--    그래서 manual_hit 은 "수동 캠페인에 등록돼 노출까지 난 적 있음"이지 "등록됨"이 아니다
--    (네이버 「등록·노출 0」 함정과 같은 구조).
--
--  순서: 이 SQL 을 먼저 돌린다 → 그다음 수집기가 ad_type 을 넣는다.
--        (칸이 없는데 수집기가 먼저 ad_type 을 보내면 그 파일 전송이 실패하고 다음 회차에 다시 보낸다)
-- ============================================================


-- ── 1. 광고유형 칸 ──────────────────────────────────────────────
-- 값 예: '매출 최적화'. 열쇠(row_key)에는 넣지 않는다(라벨이다).
-- 비어 있는 행 = 이 칸이 생기기 전에 넣고 아직 다시 넣지 않은 행.
alter table raw_coupang_keyword add column if not exists ad_type text;


-- ── 2. coupang_keyword_add_source 교체 ────────────────────────────
--
-- 2026-10-20 판과 규칙·숫자는 같다. 더한 것:
--   후보마다 campaign(주문이 가장 많은 캠페인, 동률이면 클릭) · ad_types(나온 광고유형 목록)
--            · manual_hit(매출 최적화가 아닌 광고유형 행이 한 번이라도 있음)
--   전체에   ad_type_rows(광고유형별 행 수, 비어 있으면 '(미수집)') · campaigns(캠페인별 행 수·광고유형)
-- 수동 여부는 "광고유형이 비어 있지 않고 '매출 최적화'가 아님"으로 본다.
-- 쿠팡이 수동 캠페인 유형을 뭐라고 부르는지는 아직 행이 없어 실측하지 못했다(10-21 기준).

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
base as (
  -- select k.* 는 쓰지 않는다(10-20 시간 초과 교훈). 필요한 칸만.
  select k.date, k.keyword, k.ad_product, k.campaign, k.ad_type, k.placement,
         k.impressions, k.clicks, k.spend, k.orders_1d, k.orders_14d, k.conv_sales_14d
  from raw_coupang_keyword k
  join latest l on l.date = k.date and l.file is not distinct from k.file
  where k.date between p_from and p_to
),
r as (
  select date,
         btrim(keyword) as keyword,
         lower(replace(btrim(keyword), ' ', '')) as knorm,
         coalesce(nullif(btrim(ad_product), ''), '(상품 없음)') as product,
         nullif(btrim(campaign), '') as campaign,
         nullif(btrim(ad_type), '') as ad_type,
         impressions, clicks, spend, orders_1d, orders_14d, conv_sales_14d
  from base
  where placement = '검색 영역'
    and keyword is not null
    and btrim(keyword) not in ('', '-')
),
g as (
  select knorm,
         sum(impressions)::float8 as impressions, sum(clicks)::float8 as clicks, sum(spend)::float8 as spend,
         sum(orders_1d)::float8 as orders_1d, sum(orders_14d)::float8 as orders_14d,
         sum(conv_sales_14d)::float8 as conv_sales_14d,
         count(distinct date) filter (where orders_14d > 0) as order_days,
         coalesce(array_agg(distinct ad_type) filter (where ad_type is not null), '{}') as ad_types,
         bool_or(ad_type is not null and ad_type <> '매출 최적화') as manual_hit
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
),
camp as (
  select distinct on (knorm) knorm, campaign
  from (select knorm, campaign, sum(orders_14d) as o, sum(clicks) as c from r
        where knorm in (select knorm from g) and campaign is not null group by 1, 2) s
  order by knorm, o desc, c desc, campaign
)
select json_build_object(
  'candidates', (
    select coalesce(json_agg(c), '[]'::json) from (
      select g.knorm as keyword_norm, s.keyword, p.product, cp.campaign,
             g.impressions, g.clicks, g.spend, g.orders_1d, g.orders_14d, g.conv_sales_14d, g.order_days,
             g.ad_types, coalesce(g.manual_hit, false) as manual_hit
      from g join spell s using (knorm) join prod p using (knorm) left join camp cp using (knorm)
    ) c),
  -- 검색 영역 전체 합(검산용). 기준 문서 4-2 보조 검산과 대조한다.
  'search_total', (
    select json_build_object(
      'impressions', coalesce(sum(impressions), 0)::float8, 'clicks', coalesce(sum(clicks), 0)::float8,
      'spend', coalesce(sum(spend), 0)::float8, 'orders_14d', coalesce(sum(orders_14d), 0)::float8,
      'conv_sales_14d', coalesce(sum(conv_sales_14d), 0)::float8)
    from r),
  -- 기간 전체 행(검색 영역만이 아님)의 광고유형·캠페인 분포. 화면이 "수동 캠페인 행 N건"을 여기서 센다.
  'ad_type_rows', (
    select coalesce(json_object_agg(t, n), '{}'::json)
    from (select coalesce(nullif(btrim(ad_type), ''), '(미수집)') as t, count(*) as n from base group by 1) x),
  'campaigns', (
    select coalesce(json_agg(x order by x.rows desc), '[]'::json)
    from (select coalesce(nullif(btrim(campaign), ''), '(빈칸)') as campaign,
                 coalesce(nullif(btrim(ad_type), ''), '(미수집)') as ad_type,
                 count(*) as rows, min(date) as first_date, max(date) as last_date
          from base group by 1, 2) x),
  'rows',   (select count(*) from r),
  'dates',  (select count(*) from latest),
  'latest', (select max(date) from raw_coupang_keyword)
);
$$;

grant execute on function coupang_keyword_add_source(date, date, int) to anon, authenticated;


-- ── 확인. 실행하면 결과 표 한 줄이 나온다 ─────────────────────────
--
-- 기대값(수집기로 다시 넣기 전, 2026-10-21):
--   광고유형칸 true
--   쿠팡_주문어 70 · 쿠팡_주문 110 · 쿠팡_날짜 28   ← 10-20 판과 같아야 한다
--   광고유형별_행수 {"(미수집)": ...}               ← 다시 넣은 뒤엔 {"매출 최적화": ...}
select
  exists (select 1 from information_schema.columns
          where table_name = 'raw_coupang_keyword' and column_name = 'ad_type')                    as 광고유형칸,
  json_array_length(coupang_keyword_add_source('2026-09-20', '2026-10-19')->'candidates')             as 쿠팡_주문어,
  ((coupang_keyword_add_source('2026-09-20', '2026-10-19')->'search_total')->>'orders_14d')::int     as 쿠팡_주문,
  (coupang_keyword_add_source('2026-09-20', '2026-10-19')->>'dates')::int                            as 쿠팡_날짜,
  (coupang_keyword_add_source('2026-09-20', '2026-10-19')->'ad_type_rows')::text                     as 광고유형별_행수;
