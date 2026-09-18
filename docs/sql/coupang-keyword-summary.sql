-- 쿠팡 광고 키워드 요약 함수. 2026-09-18.
--
-- 왜: 키워드 탭이 한 달 2만 행을 대시보드 서버로 끌어와 합치느라 첫 조회가 6~12초 걸렸다.
--     DB 안에서 (상품 × 키워드)·(상품 × 지면) 로 합쳐 JSON 한 덩어리로 돌려주면 한 번 왕복으로 끝난다.
-- 규칙은 /api/coupang-keywords 의 JS 판(대체 경로)과 같아야 한다.
--   - 날짜마다 가장 늦게 읽은(read_at) 파일 하나만 쓴다(맞춤 보고서·예약 보고서 겹침 이중집계 방지)
--   - 상품 = 캠페인 이름에서 앞 "로켓배송_"·"YYMMDD_", 뒤 "_YYMMDD" 를 뗀 것
--   - 키워드 '-'(비검색·외부 지면)는 한 줄로 묶는다
--
-- 실행: Supabase 대시보드 > SQL Editor. 여러 번 실행해도 안전하다(create or replace).

create or replace function coupang_keyword_summary(p_from date, p_to date)
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
  select k.*,
    coalesce(nullif(trim(regexp_replace(regexp_replace(regexp_replace(
      coalesce(k.campaign, '(캠페인 없음)'), '^로켓배송_', ''), '^[0-9]{6}_', ''), '_[0-9]{6}$', '')), ''),
      coalesce(k.campaign, '(캠페인 없음)')) as product
  from raw_coupang_keyword k
  join latest l on l.date = k.date and l.file is not distinct from k.file
  where k.date between p_from and p_to
)
select json_build_object(
  'entries', (
    select coalesce(json_agg(e), '[]'::json) from (
      select product,
        case when keyword is null or keyword = '-' then '(키워드 없음: 비검색·외부 지면)' else keyword end as keyword,
        sum(impressions)::float8 as impressions, sum(clicks)::float8 as clicks, sum(spend)::float8 as spend,
        sum(orders_1d)::float8 as orders_1d, sum(conv_sales_1d)::float8 as conv_sales_1d,
        sum(orders_14d)::float8 as orders_14d, sum(conv_sales_14d)::float8 as conv_sales_14d
      from r group by 1, 2
    ) e),
  'placements', (
    select coalesce(json_agg(p), '[]'::json) from (
      select product, coalesce(placement, '(지면 없음)') as placement,
        sum(impressions)::float8 as impressions, sum(clicks)::float8 as clicks, sum(spend)::float8 as spend,
        sum(orders_1d)::float8 as orders_1d, sum(conv_sales_1d)::float8 as conv_sales_1d,
        sum(orders_14d)::float8 as orders_14d, sum(conv_sales_14d)::float8 as conv_sales_14d
      from r group by 1, 2
    ) p),
  'rows', (select count(*) from r)
);
$$;

grant execute on function coupang_keyword_summary(date, date) to anon, authenticated;
