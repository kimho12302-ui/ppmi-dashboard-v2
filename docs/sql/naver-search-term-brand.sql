-- 네이버 검색어 요약 함수에 브랜드 축 추가. 2026-09-30.
--
-- 왜: 키워드 화면의 계정 탭(너티·사입·아이언펫 / 밸런스랩)이 상단 브랜드 필터와 겹쳐,
--     밸런스랩을 고른 뒤 또 밸런스랩을 골라야 했다. 계정 탭을 없애고 상단 필터를 따르게 하려면
--     main 계정(너티·사입·아이언펫 한 계정)을 브랜드로 가를 수 있어야 한다.
--     원천 raw_naver_search_term 에는 brand 칸이 이미 있고 채워져 있다
--     (2026-09 실측: nutty 17,074행 · saip 30,718행 · balancelab 22,833행 · ironpet 0행).
--
-- ★ 함정: 인자만 추가하면 옛 3인자 판이 남아 3인자 호출이 모호해진다(둘 다 후보가 된다).
--   그래서 옛 판을 먼저 지운다. 지운 뒤에도 옛 배포본은 이름 붙은 인자로 호출하므로
--   p_brand 기본값(null)이 채워져 그대로 동작한다. 배포 순서는 상관없다.
--
-- 실행: Supabase 대시보드 > SQL Editor. 여러 번 실행해도 안전하다.

-- 브랜드로 좁혀 읽으므로 (계정·브랜드·날짜) 인덱스를 둔다. 기존 인덱스는 (account, date) 라
-- 브랜드 조건이 붙으면 걸러낸 뒤 버리는 행이 많다. main 계정 한 달이 47,792행이고 요약이 5.6초 걸린다.
create index if not exists raw_naver_search_term_brand_idx
  on raw_naver_search_term (account, brand, date);

drop function if exists naver_search_term_summary(text, date, date);

create or replace function naver_search_term_summary(
  p_account text,
  p_from    date,
  p_to      date,
  p_brand   text default null   -- null 이면 그 계정 전체
)
returns json
language sql
stable
as $$
with r as (
  select * from raw_naver_search_term
  where account = p_account
    and date between p_from and p_to
    and (p_brand is null or brand = p_brand)
)
select json_build_object(
  'entries', (
    select coalesce(json_agg(e), '[]'::json) from (
      select ad_type, coalesce(product, adgroup, '(상품 없음)') as product, query,
        sum(impressions)::float8 as impressions, sum(clicks)::float8 as clicks, sum(cost)::float8 as cost,
        sum(purchases)::float8 as purchases, sum(purchase_value)::float8 as purchase_value,
        sum(cart_adds)::float8 as cart_adds
      from r group by 1, 2, 3
    ) e),
  'rows', (select count(*) from r),
  -- 최종 수집일은 브랜드와 무관하게 그 계정 기준. "이 브랜드에 데이터가 없다"와
  -- "수집이 멈췄다"를 화면이 구분할 수 있어야 한다.
  'latest', (select max(date) from raw_naver_search_term where account = p_account)
);
$$;

grant execute on function naver_search_term_summary(text, date, date, text) to anon, authenticated;

-- 확인용. 실행하면 결과 표가 나온다.
select
  (naver_search_term_summary('main', '2026-09-01', '2026-09-30')->>'rows')::int              as main_전체,
  (naver_search_term_summary('main', '2026-09-01', '2026-09-30', 'nutty')->>'rows')::int      as 너티,
  (naver_search_term_summary('main', '2026-09-01', '2026-09-30', 'saip')->>'rows')::int       as 사입,
  (naver_search_term_summary('main', '2026-09-01', '2026-09-30', 'ironpet')->>'rows')::int    as 아이언펫,
  (naver_search_term_summary('balancelab', '2026-09-01', '2026-09-30')->>'rows')::int         as 밸런스랩;
