-- 대시보드 속도 개선용 함수 2개 + 인덱스 확인. 2026-11-09.
--
-- 실행: Supabase 대시보드 > SQL Editor 에 이 파일 전체를 붙여넣고 한 번 실행. 여러 번 실행해도 안전하다
--       (create or replace / if not exists). 표·데이터는 바꾸지 않는다(함수와 인덱스만).
-- 실행 안 해도 대시보드는 돈다. 함수가 없으면 각 API 가 예전보다 가벼운 대체 경로로 읽는다.
-- 실행하면 DB 를 한 번만 다녀오게 되어 더 빨라진다.
--
-- 실행 뒤 확인(SQL Editor):
--   select count(*) from coupang_campaign_daily(current_date - 21, current_date);   -- 숫자 하나가 나오면 정상
--   select count(*) from product_sales_products();                                    -- 숫자 하나가 나오면 정상

-- ── 1) coupang_campaign_daily : 광고 이상 신호(/api/ad-alerts) ──────────────────
-- 왜: /api/ad-alerts 가 쿠팡 원본 21일치 약 25,000행을 대시보드 서버로 끌어와 캠페인별로 합치다가
--     7~32초 뒤 500 이 났고, 그동안 DB 가 막혀 다른 화면도 같이 느려졌다(2026-11-03 측정).
-- 규칙은 src/app/api/ad-alerts/route.ts 의 대체 경로와 같아야 한다.
--   - 날짜마다 가장 늦게 읽은(read_at) 파일 하나만 쓴다(coupang_keyword_summary 와 같은 규칙)
--   - 캠페인 이름이 비어 있으면 '(캠페인 없음)'
--   - 날짜 x 캠페인으로 광고비·클릭·주문(1일)을 더한다
create or replace function coupang_campaign_daily(p_from date, p_to date)
returns table (date date, campaign text, spend float8, clicks float8, orders_1d float8)
language sql
stable
as $$
  with latest as (
    select k.date, (array_agg(k.file order by k.read_at desc nulls last))[1] as file
    from raw_coupang_keyword k
    where k.date between p_from and p_to
    group by k.date
  )
  select k.date,
         coalesce(nullif(k.campaign, ''), '(캠페인 없음)') as campaign,
         coalesce(sum(k.spend), 0)::float8      as spend,
         coalesce(sum(k.clicks), 0)::float8     as clicks,
         coalesce(sum(k.orders_1d), 0)::float8  as orders_1d
  from raw_coupang_keyword k
  join latest l on l.date = k.date and l.file is not distinct from k.file
  where k.date between p_from and p_to
  group by 1, 2
  order by 1, 2;
$$;

grant execute on function coupang_campaign_daily(date, date) to anon, authenticated;

-- ── 2) product_sales_products : 설정 > 원가 미등록 상품(/api/settings) ─────────────
-- 왜: /api/settings 가 product_sales 전체(7,000행 넘음)에서 (상품, 브랜드)를 고르는데,
--     한 번에 1,000행까지만 와서 1,000행 뒤에만 있는 상품이 '원가 미등록' 목록에서 빠질 수 있었다.
--     DB 안에서 서로 다른 (상품, 브랜드)만 돌려준다.
create or replace function product_sales_products()
returns table (product text, brand text)
language sql
stable
as $$
  select distinct s.product::text, s.brand::text
  from product_sales s
  order by 1, 2;
$$;

grant execute on function product_sales_products() to anon, authenticated;

-- ── 3) 쿠팡 원본 날짜 인덱스(이미 있으면 아무 일 없음) ─────────────────────────
-- docs/sql/raw-sources.sql 에 같은 줄이 있다. 실제로 만들어졌는지 확실하지 않아 한 번 더 둔다.
create index if not exists raw_coupang_keyword_date_idx on raw_coupang_keyword (date);

-- 함수 목록 새로고침(PostgREST 가 새 함수를 바로 알게)
notify pgrst, 'reload schema';
