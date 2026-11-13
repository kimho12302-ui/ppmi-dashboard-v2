-- ============================================================
-- 2026-11-13  쿠팡 광고 키워드: 일별 묶음 표 + 자동 갱신 트리거 + 요약 함수 교체
-- ============================================================
--
--  왜: 키워드 > 쿠팡 광고 키워드 탭의 요약 함수 coupang_keyword_summary 가 원본 raw_coupang_keyword
--      (하루 약 1,000행, 2026-11-13 기준 84,158행)를 부를 때마다 처음부터 합쳤다. 7일은 1.3~2초인데
--      30일은 3.8초 안팎이라 anon 시간 제한에 걸리면 "canceling statement due to statement timeout" 500 이 났다.
--      그러면 화면이 비었다(대시보드 쪽은 2026-11-13 코드로 "기간을 줄여 보세요" 안내로 바꿨다).
--
--  무엇을:
--    1) coupang_keyword_daily  : (날짜, 상품, 키워드, 지면)별 합계. 날짜마다 가장 늦게 읽은 파일 하나만(옛 규칙 그대로)
--    2) 원본 인덱스 (date, file) : 날짜 하나 다시 묶을 때 그 날짜·파일 행만 읽게
--    3) coupang_keyword_daily_refresh(날짜 배열) : 그 날짜들을 지우고 다시 묶는다
--    4) 원본 표 트리거 3개(넣기·고치기·지우기, 문장 단위) : 수집기가 올린 날짜를 그 자리에서 다시 묶는다
--       → 수집기(볼트 settings/collectors/bin/coupang-ads.mjs)·/api/raw-ingest 는 고칠 것이 없다.
--         수집기는 /api/raw-ingest 로 500행씩 upsert 하고, 그 문장마다 트리거가 그 날짜(보통 1~2일치)를 다시 묶는다.
--    5) 백필 : 원본에 있는 모든 날짜를 한 번 묶는다
--    6) 요약 함수 교체 : 이름·인자·돌려주는 모양(entries · placements · rows)은 그대로, 읽는 곳만 묶음 표로.
--       옛 본문은 coupang_keyword_summary_raw 로 남겨 대조에 쓴다.
--    7) 대조 select : 최근 30일 새 함수와 옛 함수의 행 수·광고비·14일 전환매출이 같아야 한다.
--
--  실행: Supabase 대시보드 > SQL Editor 에 이 파일 전체를 붙여넣고 한 번 실행. 여러 번 실행해도 안전하다
--        (if not exists / create or replace / drop trigger if exists, 백필은 다시 묶기라 같은 결과).
--  순서: 이 파일 하나면 된다. 대시보드 배포 전에 돌려도, 뒤에 돌려도 된다(함수 이름·모양이 같다).
--  되돌리기(필요할 때만): 맨 아래 「되돌리기」 주석.
--
--  규칙은 /api/coupang-keywords 의 JS 판(대체 경로)·옛 함수와 같아야 한다.
--    - 날짜마다 가장 늦게 읽은(read_at) 파일 하나만 쓴다(맞춤 보고서·예약 보고서 겹침 이중집계 방지)
--    - 상품 = 캠페인 이름에서 앞 "로켓배송_"·"YYMMDD_", 뒤 "_YYMMDD" 를 뗀 것
--    - 키워드 '-' 또는 빈 값(비검색·외부 지면)은 '(키워드 없음: 비검색·외부 지면)' 한 줄
--    - 지면이 비면 '(지면 없음)'
-- ============================================================


-- ── 1) 일별 묶음 표 ─────────────────────────────────────────────
create table if not exists coupang_keyword_daily (
  date            date        not null,
  product         text        not null,
  keyword         text        not null,
  placement       text        not null,
  impressions     numeric     not null default 0,
  clicks          numeric     not null default 0,
  spend           numeric     not null default 0,
  orders_1d       numeric     not null default 0,
  conv_sales_1d   numeric     not null default 0,
  orders_14d      numeric     not null default 0,
  conv_sales_14d  numeric     not null default 0,
  raw_rows        integer     not null default 0,   -- 묶인 원본 행 수(요약 함수 'rows' 의 재료)
  file            text,                             -- 이 날짜에 쓴 원본 파일(가장 늦게 읽은 것)
  refreshed_at    timestamptz not null default now(),
  primary key (date, product, keyword, placement)
);

-- 읽기는 anon 도 된다. 쓰기는 아래 갱신 함수(security definer)만 한다.
alter table coupang_keyword_daily enable row level security;
drop policy if exists coupang_keyword_daily_read on coupang_keyword_daily;
create policy coupang_keyword_daily_read on coupang_keyword_daily for select using (true);
grant select on coupang_keyword_daily to anon, authenticated;
revoke insert, update, delete, truncate on coupang_keyword_daily from anon, authenticated;


-- ── 2) 원본 인덱스 ──────────────────────────────────────────────
-- 날짜 인덱스(raw_coupang_keyword_date_idx)는 이미 있다. 날짜 + 파일로 고르는 갱신·옛 함수가 이걸 쓴다.
create index if not exists raw_coupang_keyword_date_file_idx on raw_coupang_keyword (date, file);


-- ── 3) 갱신 함수: 날짜들을 지우고 다시 묶는다 ─────────────────────
create or replace function coupang_keyword_daily_refresh(p_dates date[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if p_dates is null or cardinality(p_dates) = 0 then
    return 0;
  end if;
  -- 같은 날짜를 두 문장이 동시에 다시 묶으면 기본키가 부딪친다. 이 표 갱신은 한 줄로 세운다.
  perform pg_advisory_xact_lock(hashtext('coupang_keyword_daily'));

  delete from coupang_keyword_daily where date = any(p_dates);

  with latest as (
    select k.date, (array_agg(k.file order by k.read_at desc nulls last))[1] as file
    from raw_coupang_keyword k
    where k.date = any(p_dates)
    group by k.date
  ),
  r as (
    select k.date,
      coalesce(nullif(trim(regexp_replace(regexp_replace(regexp_replace(
        coalesce(k.campaign, '(캠페인 없음)'), '^로켓배송_', ''), '^[0-9]{6}_', ''), '_[0-9]{6}$', '')), ''),
        coalesce(k.campaign, '(캠페인 없음)')) as product,
      case when k.keyword is null or k.keyword = '-' then '(키워드 없음: 비검색·외부 지면)' else k.keyword end as keyword,
      coalesce(k.placement, '(지면 없음)') as placement,
      k.impressions, k.clicks, k.spend, k.orders_1d, k.conv_sales_1d, k.orders_14d, k.conv_sales_14d,
      l.file
    from raw_coupang_keyword k
    join latest l on l.date = k.date and l.file is not distinct from k.file
    where k.date = any(p_dates)
  )
  insert into coupang_keyword_daily (date, product, keyword, placement,
    impressions, clicks, spend, orders_1d, conv_sales_1d, orders_14d, conv_sales_14d, raw_rows, file, refreshed_at)
  select date, product, keyword, placement,
    coalesce(sum(impressions), 0), coalesce(sum(clicks), 0), coalesce(sum(spend), 0),
    coalesce(sum(orders_1d), 0), coalesce(sum(conv_sales_1d), 0),
    coalesce(sum(orders_14d), 0), coalesce(sum(conv_sales_14d), 0),
    count(*), max(file), now()
  from r
  group by date, product, keyword, placement;

  get diagnostics n = row_count;
  return n;
end;
$$;

-- 트리거와 SQL Editor 만 부른다. 화면(anon)은 부르지 않는다.
revoke execute on function coupang_keyword_daily_refresh(date[]) from public, anon, authenticated;


-- ── 4) 트리거: 원본이 바뀐 날짜를 그 자리에서 다시 묶는다 ─────────────
-- 문장 단위 + 바뀐 행 표(transition table). 변경 표는 이벤트 하나에만 걸 수 있어 셋으로 나눈다.
-- upsert(insert ... on conflict do update)는 넣기·고치기 트리거가 둘 다 돈다(각자 자기 행만 본다).
create or replace function coupang_keyword_daily_on_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform coupang_keyword_daily_refresh((select array_agg(distinct date) from new_rows));
  return null;
end;
$$;

create or replace function coupang_keyword_daily_on_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform coupang_keyword_daily_refresh((
    select array_agg(distinct d) from (select date as d from new_rows union select date from old_rows) x));
  return null;
end;
$$;

create or replace function coupang_keyword_daily_on_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform coupang_keyword_daily_refresh((select array_agg(distinct date) from old_rows));
  return null;
end;
$$;

drop trigger if exists coupang_keyword_daily_ins on raw_coupang_keyword;
create trigger coupang_keyword_daily_ins
  after insert on raw_coupang_keyword
  referencing new table as new_rows
  for each statement execute function coupang_keyword_daily_on_insert();

drop trigger if exists coupang_keyword_daily_upd on raw_coupang_keyword;
create trigger coupang_keyword_daily_upd
  after update on raw_coupang_keyword
  referencing old table as old_rows new table as new_rows
  for each statement execute function coupang_keyword_daily_on_update();

drop trigger if exists coupang_keyword_daily_del on raw_coupang_keyword;
create trigger coupang_keyword_daily_del
  after delete on raw_coupang_keyword
  referencing old table as old_rows
  for each statement execute function coupang_keyword_daily_on_delete();


-- ── 5) 백필: 원본에 있는 모든 날짜를 묶는다(다시 돌려도 같은 결과) ─────
select coupang_keyword_daily_refresh(array_agg(distinct date)) as backfilled_rows
from raw_coupang_keyword;


-- ── 6) 요약 함수 ───────────────────────────────────────────────
-- 옛 본문(원본을 매번 합침)은 대조용으로 이름만 바꿔 남긴다. 화면은 부르지 않는다.
create or replace function coupang_keyword_summary_raw(p_from date, p_to date)
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
revoke execute on function coupang_keyword_summary_raw(date, date) from public, anon, authenticated;

-- 화면이 부르는 함수. 이름·인자·모양은 2026-09-18 판과 같다. 읽는 곳만 묶음 표.
create or replace function coupang_keyword_summary(p_from date, p_to date)
returns json
language sql
stable
as $$
with r as (
  select * from coupang_keyword_daily where date between p_from and p_to
)
select json_build_object(
  'entries', (
    select coalesce(json_agg(e), '[]'::json) from (
      select product, keyword,
        sum(impressions)::float8 as impressions, sum(clicks)::float8 as clicks, sum(spend)::float8 as spend,
        sum(orders_1d)::float8 as orders_1d, sum(conv_sales_1d)::float8 as conv_sales_1d,
        sum(orders_14d)::float8 as orders_14d, sum(conv_sales_14d)::float8 as conv_sales_14d
      from r group by 1, 2
    ) e),
  'placements', (
    select coalesce(json_agg(p), '[]'::json) from (
      select product, placement,
        sum(impressions)::float8 as impressions, sum(clicks)::float8 as clicks, sum(spend)::float8 as spend,
        sum(orders_1d)::float8 as orders_1d, sum(conv_sales_1d)::float8 as conv_sales_1d,
        sum(orders_14d)::float8 as orders_14d, sum(conv_sales_14d)::float8 as conv_sales_14d
      from r group by 1, 2
    ) p),
  'rows', (select coalesce(sum(raw_rows), 0)::bigint from r)
);
$$;
grant execute on function coupang_keyword_summary(date, date) to anon, authenticated;


-- ── 7) 대조: 아래 두 줄이 같으면 정상(행 수 · 광고비 · 14일 전환매출 · 키워드 묶음 수) ─────
with a as (select coupang_keyword_summary(current_date - 30, current_date) j),
     b as (select coupang_keyword_summary_raw(current_date - 30, current_date) j)
select 'new(daily)' as via, (j->>'rows')::bigint as rows,
       (select round(sum((e->>'spend')::numeric)) from json_array_elements(j->'entries') e) as spend,
       (select round(sum((e->>'conv_sales_14d')::numeric)) from json_array_elements(j->'entries') e) as conv_sales_14d,
       json_array_length(j->'entries') as entries
from a
union all
select 'old(raw)', (j->>'rows')::bigint,
       (select round(sum((e->>'spend')::numeric)) from json_array_elements(j->'entries') e),
       (select round(sum((e->>'conv_sales_14d')::numeric)) from json_array_elements(j->'entries') e),
       json_array_length(j->'entries')
from b;


-- ── 되돌리기(필요할 때만, 주석을 풀어 실행) ─────────────────────────
-- drop trigger if exists coupang_keyword_daily_ins on raw_coupang_keyword;
-- drop trigger if exists coupang_keyword_daily_upd on raw_coupang_keyword;
-- drop trigger if exists coupang_keyword_daily_del on raw_coupang_keyword;
-- 그다음 docs/sql/coupang-keyword-summary.sql 을 다시 실행하면 요약 함수가 원본을 읽는 옛 판으로 돌아간다.
-- 묶음 표(coupang_keyword_daily)는 남겨도 화면에 영향이 없다.
