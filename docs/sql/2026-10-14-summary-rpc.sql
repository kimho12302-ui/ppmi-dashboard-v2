-- ============================================================
--  대시보드 속도 개선: DB 에서 미리 합산해 돌려주는 함수 3개 · 2026-10-14
--
--  실행: Supabase 대시보드 > SQL Editor 에 이 파일 전체를 붙여넣고 한 번 실행.
--        여러 번 실행해도 안전하다(create or replace). 함수만 만든다.
--        표·데이터는 바꾸지도 지우지도 않는다. 인덱스도 만들지 않는다.
--
--  왜: 화면이 원본 행을 1,000행씩 여러 번 받아 서버·브라우저에서 더했다.
--      올해 전체 기준 키워드 2.66MB, 상품 판매 1.29MB 를 브라우저로 보냈다.
--      여기서는 화면이 실제로 쓰는 칸 단위로만 묶어(group by) 합계만 보낸다.
--
--  원칙: 결과는 옛 경로와 같은 숫자여야 한다. 묶는 기준은 화면 코드가 쓰는 칸 그대로이고
--        더하기만 한다. 행 개수가 필요한 곳을 위해 묶인 원본 행 수(n)도 같이 준다.
--
--  앱은 이 함수가 없으면(실행 전) 옛 경로로 자동으로 돌아간다. 실행 전에 배포해도 안 깨진다.
--
--  실행 뒤 확인(로컬 PC):
--    cd C:\Users\harry\projects\ppmi-dashboard-v2
--    node scripts/verify-summary-rpc.mjs
--  "불일치 0" 이 나오면 정상이다.
--
--  모두 읽기 전용(stable), 호출한 사람 권한으로 실행(security invoker).
--  anon 이 이미 읽을 수 있는 표만 읽으므로 새로 열리는 데이터는 없다.
-- ============================================================


-- ── 1) keyword_summary : 키워드 화면 (/api/keywords) ─────────────
--
-- 화면은 (플랫폼, 키워드) 로 묶어 더하기만 한다. 브랜드·날짜는 안 쓴다.
-- 예외 하나: "낭비 광고비" 는 **행마다** 전환매출이 0 인 날의 광고비를 더한다.
-- 묶은 뒤에는 그 판정을 못 하므로 wasted_cost 로 미리 더해 준다.
create or replace function keyword_summary(
  p_from   date,
  p_to     date,
  p_brands text[] default null      -- null 이면 전체 브랜드(옛 경로와 같이 필터 없음)
)
returns json
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(json_agg(k order by k.clicks desc, k.platform, k.keyword), '[]'::json)
  from (
    select platform,
           keyword,
           sum(impressions)::float8      as impressions,
           sum(clicks)::float8           as clicks,
           sum(cost)::float8             as cost,
           sum(conversions)::float8      as conversions,
           sum(conversion_value)::float8 as conversion_value,   -- 전부 비어 있으면 null (화면의 "전환매출 있음" 판정과 같게)
           coalesce(sum(cost) filter (where coalesce(conversion_value, 0) = 0), 0)::float8 as wasted_cost,
           count(*)::int                 as n
    from keyword_performance
    where date between p_from and p_to
      and (p_brands is null or brand = any(p_brands))
    group by platform, keyword
  ) k;
$$;

grant execute on function keyword_summary(date, date, text[]) to anon, authenticated;


-- ── 2) product_sales_daily : 매출 화면 상품 추이 (/api/product-sales) ──
--
-- 차트는 (날짜, 브랜드, 상품) 으로만 묶어 매출·수량을 더한다. 판매처·라인업은 안 쓴다.
-- "공구 합계" 집계 행은 상품명으로 거르므로 묶어도 그대로 걸러진다.
create or replace function product_sales_daily(
  p_from   date,
  p_to     date,
  p_brands text[] default null
)
returns json
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(json_agg(p order by p.revenue desc nulls last, p.date, p.brand, p.product), '[]'::json)
  from (
    select date,
           brand,
           product,
           sum(revenue)::float8  as revenue,
           sum(quantity)::float8 as quantity,
           count(*)::int         as n
    from product_sales
    where date between p_from and p_to
      and (p_brands is null or brand = any(p_brands))
    group by date, brand, product
  ) p;
$$;

grant execute on function product_sales_daily(date, date, text[]) to anon, authenticated;


-- ── 3) monthly_summary_parts : 월간 화면 (/api/monthly-summary) ──
--
-- 옛 경로가 원본으로 받던 네 묶음을 월 단위로 묶어 한 번에 준다. 필터는 옛 경로와 같다.
--   sales  : daily_sales, 공구·total 채널 제외, 전체일 때 brand='all' 매직행 제외
--   ads    : daily_ad_spend, ga4_* 제외, 전체일 때 brand='all' 제외. 월별 채널 광고비가 필요해 (월, 채널)
--   gonggu : product_sales 밸런스랩. 공구 판정이 판매처·라인업·상품명으로 갈리므로 그 셋을 남긴다
--   cogs   : product_sales. 원가는 (상품, 브랜드) 단가 × 수량, 공구 판정용으로 판매처·라인업도 남긴다
create or replace function monthly_summary_parts(
  p_from   date,
  p_to     date,
  p_brands text[] default null
)
returns json
language sql
stable
security invoker
set search_path = public
as $$
  select json_build_object(
    'sales', (
      select coalesce(json_agg(s), '[]'::json) from (
        select to_char(date, 'YYYY-MM') as month,
               sum(revenue)::float8 as revenue,
               sum(orders)::float8  as orders,
               count(*)::int        as n
        from daily_sales
        where date between p_from and p_to
          and channel <> 'total'
          and channel not like '공구%'
          and ((p_brands is null and brand <> 'all') or brand = any(p_brands))
        group by 1
      ) s),
    'ads', (
      select coalesce(json_agg(a), '[]'::json) from (
        select to_char(date, 'YYYY-MM') as month,
               channel,
               sum(spend)::float8            as spend,
               sum(conversion_value)::float8 as conversion_value,
               count(*)::int                 as n
        from daily_ad_spend
        where date between p_from and p_to
          and channel not like 'ga4_%'
          and ((p_brands is null and brand <> 'all') or brand = any(p_brands))
        group by 1, 2
      ) a),
    'gonggu', (
      select coalesce(json_agg(g), '[]'::json) from (
        select to_char(date, 'YYYY-MM') as month,
               channel, lineup, product,
               sum(revenue)::float8 as revenue,
               count(*)::int        as n
        from product_sales
        where date between p_from and p_to
          and brand = 'balancelab'
        group by 1, 2, 3, 4
      ) g),
    'cogs', (
      select coalesce(json_agg(c), '[]'::json) from (
        select to_char(date, 'YYYY-MM') as month,
               product, brand, channel, lineup,
               sum(quantity)::float8 as quantity,
               count(*)::int         as n
        from product_sales
        where date between p_from and p_to
          and (p_brands is null or brand = any(p_brands))
        group by 1, 2, 3, 4, 5
      ) c)
  );
$$;

grant execute on function monthly_summary_parts(date, date, text[]) to anon, authenticated;


-- ── 실행 뒤 바로 보는 확인 ───────────────────────────────────
-- 세 칸 모두 0 보다 큰 숫자가 나오면 함수가 만들어진 것이다. 숫자 대조는 위의 node 스크립트로 한다.
select
  json_array_length(keyword_summary('2026-01-01', '2026-12-31'))                                as 키워드_묶음수,
  json_array_length(product_sales_daily('2026-01-01', '2026-12-31'))                            as 상품일별_묶음수,
  json_array_length(monthly_summary_parts('2026-01-01', '2026-12-31')->'sales')                 as 월매출_달수;
