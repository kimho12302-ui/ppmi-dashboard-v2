-- 네이버 검색광고 실제 검색어 원천 + 요약 함수. 2026-09-18.
--
-- 원천: 검색광고 API /stat-reports
--   EXPKEYWORD                        파워링크 실제 검색어별 노출·클릭·광고비 (검색어 단위 전환은 네이버가 주지 않음)
--   SHOPPINGKEYWORD_DETAIL            쇼핑검색 실제 검색어별 노출·클릭·광고비
--   SHOPPINGKEYWORD_CONVERSION_DETAIL 쇼핑검색 검색어별 전환(purchase·add_to_cart 건수·금액)
-- 수집기: marketing-dashboard scripts/sync_naver_search_terms.py (daily-sync, 두 계정)
-- 계정이 둘이다: main(너티·사입·아이언펫, customer 3158060) · balancelab(800812). 두 축은 섞지 않는다.
--
-- 칸 뜻은 2026-09-18 실측으로 확정했다. 09-16 보고서 합계가 캠페인 /stats 와 맞았다
--   (파워링크 클릭·광고비 일치, 쇼핑검색은 네이버가 소량 검색어를 빼서 광고비 97.8~100%).
--
-- 실행: Supabase 대시보드 > SQL Editor. 여러 번 실행해도 안전하다.

create table if not exists raw_naver_search_term (
  row_key         text        primary key,  -- date|account|ad_type|campaign_id|adgroup_id|ad_id|device|query
  date            date        not null,
  account         text        not null,     -- 'main' | 'balancelab'
  ad_type         text        not null,     -- 'powerlink' | 'shopping'
  brand           text,                     -- 캠페인 이름 규칙(sync_naver_sa.py 와 같음)
  campaign_id     text,
  campaign        text,
  adgroup_id      text,
  adgroup         text,
  ad_id           text,                     -- 쇼핑검색 소재(nad). 파워링크는 ''
  product         text,                     -- 쇼핑검색 소재의 상품명, 없으면 광고그룹 이름
  device          text,                     -- 'M' | 'P'
  query           text        not null,     -- 사람들이 실제로 친 검색어
  impressions     bigint      default 0,
  clicks          bigint      default 0,
  cost            numeric     default 0,
  purchases       int         default 0,
  purchase_value  numeric     default 0,
  cart_adds       int         default 0,
  cart_value      numeric     default 0,
  read_at         timestamptz
);
create index if not exists raw_naver_search_term_date_idx on raw_naver_search_term (account, date);

-- 요약: 한 축(p_account) · 기간을 DB 안에서 (광고유형 × 상품 × 검색어) 로 합쳐 JSON 한 덩어리로.
create or replace function naver_search_term_summary(p_account text, p_from date, p_to date)
returns json
language sql
stable
as $$
with r as (
  select * from raw_naver_search_term
  where account = p_account and date between p_from and p_to
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
  'latest', (select max(date) from raw_naver_search_term where account = p_account)
);
$$;

grant execute on function naver_search_term_summary(text, date, date) to anon, authenticated;
