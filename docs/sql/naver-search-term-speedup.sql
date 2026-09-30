-- 네이버 검색어 요약 함수 속도 개선. 2026-09-30.
--
-- 왜: 브랜드로 좁혀도 찬 상태(cold)에서 statement timeout 이 난다. 특히 '전체' 는 브랜드 4개를
--     이어서 부르므로 하나만 느려도 화면 전체가 죽는다(2026-09-30 실측: 라이브에서 3회 연속 실패,
--     데워진 뒤에는 브랜드당 1.3~6.3초).
--
-- 무엇: CTE 가 `select *` 라 안 쓰는 칸(row_key·campaign_id·campaign·adgroup_id·ad_id·device·
--       cart_value·read_at)까지 통째로 물어와 쌓았다. CTE 를 두 번 참조하므로 Postgres 가
--       이걸 그대로 materialize 한다. 쓰는 9칸만 남긴다.
--
-- 결과 모양은 그대로다. entries·rows·latest 의 값도 같아야 한다(아래 확인 질의로 대조).
--
-- 실행: Supabase 대시보드 > SQL Editor. 여러 번 실행해도 안전하다.

create or replace function naver_search_term_summary(
  p_account text,
  p_from    date,
  p_to      date,
  p_brand   text default null
)
returns json
language sql
stable
as $$
with r as (
  -- 쓰는 칸만. product 는 여기서 한 번만 정리해 둔다.
  select ad_type,
         coalesce(product, adgroup, '(상품 없음)') as product,
         query,
         impressions, clicks, cost, purchases, purchase_value, cart_adds
  from raw_naver_search_term
  where account = p_account
    and date between p_from and p_to
    and (p_brand is null or brand = p_brand)
)
select json_build_object(
  'entries', (
    select coalesce(json_agg(e), '[]'::json) from (
      select ad_type, product, query,
        sum(impressions)::float8 as impressions, sum(clicks)::float8 as clicks, sum(cost)::float8 as cost,
        sum(purchases)::float8 as purchases, sum(purchase_value)::float8 as purchase_value,
        sum(cart_adds)::float8 as cart_adds
      from r group by 1, 2, 3
    ) e),
  'rows', (select count(*) from r),
  'latest', (select max(date) from raw_naver_search_term where account = p_account)
);
$$;

grant execute on function naver_search_term_summary(text, date, date, text) to anon, authenticated;

-- 확인. 9월 기준으로 아래 값이 나와야 한다.
--   너티 17074 · 사입 30718 · 아이언펫 0 · 밸런스랩 22833 · main 전체 47792
select
  (naver_search_term_summary('main', '2026-09-01', '2026-09-30', 'nutty')->>'rows')::int   as 너티,
  (naver_search_term_summary('main', '2026-09-01', '2026-09-30', 'saip')->>'rows')::int    as 사입,
  (naver_search_term_summary('main', '2026-09-01', '2026-09-30', 'ironpet')->>'rows')::int as 아이언펫,
  (naver_search_term_summary('balancelab', '2026-09-01', '2026-09-30')->>'rows')::int      as 밸런스랩,
  (naver_search_term_summary('main', '2026-09-01', '2026-09-30')->>'rows')::int            as main_전체;
