-- ============================================================
-- 2026-11-13  쿠팡 광고 키워드: 일별 묶음 표 + 갱신 함수 + 요약 함수 교체 (수집은 절대 막지 않는 구조)
-- ============================================================
--
--  왜: 키워드 > 쿠팡 광고 키워드 탭의 요약 함수 coupang_keyword_summary 가 원본 raw_coupang_keyword
--      (하루 약 1,000행, 2026-11-13 기준 84,158행)를 부를 때마다 처음부터 합쳤다. 7일은 1.3~2초인데
--      30일은 3.8초 안팎이라 anon 시간 제한에 걸리면 "canceling statement due to statement timeout" 이 났다.
--      (대시보드 쪽은 2026-11-13 코드로 "기간을 줄여 보세요" 안내를 띄운다.)
--
--  ★ 설계 원칙: **수집(원본 적재)은 이 SQL 때문에 실패하지 않는다.**
--    - 원본 표에 트리거를 걸지 않는다. 트리거가 느리거나 실패하면 수집기의 upsert(/api/raw-ingest, anon 시간 제한) 자체가
--      「저장 실패」가 되기 때문이다(QA 2026-11-13 M-1). 이 파일은 2026-11-13 초판의 트리거가 있으면 지운다.
--    - 묶음 갱신은 원본 적재가 **성공한 뒤** /api/raw-ingest 가 따로 부른다(coupang_keyword_daily_refresh).
--      그 호출이 실패해도 수집 응답은 성공 그대로이고, 응답에 daily_refresh 실패만 적힌다.
--    - 「판」 = 그 날짜 원본의 (max(read_at), 전체 행 수) 두 값. 수집기는 파일 하나를 500행씩 여러 번 보내고 모든 조각에
--      같은 read_at 을 붙이므로 read_at 만으로는 "조각 1·2 만 묶인 판"과 "다 들어온 판"을 가를 수 없다(QA 재검수 HIGH).
--      행 수를 같이 기록해 조각이 더 들어오거나 일부 행이 지워져도 판이 달라진다.
--    - 요약 함수는 날짜마다 묶음 판이 원본 판과 같으면 묶음 표, 다르거나 없으면 그날을 원본에서 직접 합친다.
--      그래서 묶음이 늦거나 빠져도 숫자는 항상 원본과 같다(갱신이 안 된 날만 느릴 뿐).
--      원본에서 날짜가 통째로 지워지거나 비워져도(truncate) 그 날짜는 결과에서 빠진다.
--    - 갱신 함수는 이미 같은 판인 날짜는 건너뛴다(반복 호출 비용·잠금 대기를 줄임).
--    - 늦은 날짜는 대시보드 「대시보드 상태」(/status)가 coupang_keyword_daily_lag 로 「주의」를 띄운다.
--
--  무엇을:
--    1) coupang_keyword_daily       : (날짜, 상품, 키워드, 지면)별 합계. 날짜마다 가장 늦게 읽은 파일 하나만(옛 규칙 그대로)
--       coupang_keyword_daily_meta  : 날짜마다 묶은 판(원본 max(read_at) · 원본 전체 행 수 date_rows · 쓴 파일 · 그 파일 행 수)
--    2) 원본 인덱스 (date, read_at), (date, file)
--    3) coupang_keyword_daily_refresh(날짜 배열, 최대 62일) : 판이 다른 날짜만 지우고 다시 묶는다(anon 도 부를 수 있음)
--       coupang_keyword_daily_lag(기간) : 묶음 판이 원본 판과 다른 날짜 목록(상태 화면용, 읽기만)
--    4) 백필 : 원본에 있는 모든 날짜를 31일씩 묶는다
--    5) 요약 함수 교체 : 이름·인자·돌려주는 모양(entries · placements · rows)은 그대로. 옛 본문은 coupang_keyword_summary_raw 로 남김
--    6) 대조 select : 최근 30일 새 함수와 옛 함수의 행 수·광고비·14일 전환매출·묶음 수가 같아야 한다
--
--  규칙(옛 함수·/api/coupang-keywords 대체 경로와 같음):
--    - 날짜마다 가장 늦게 읽은(read_at) 파일 하나만 쓴다(맞춤 보고서·예약 보고서 겹침 이중집계 방지)
--    - 상품 = 캠페인 이름에서 앞 "로켓배송_"·"YYMMDD_", 뒤 "_YYMMDD" 를 뗀 것
--    - 키워드가 null 이거나, 앞뒤 공백·탭·줄바꿈을 뗀 값이 '' 또는 '-' 이면(비검색·외부 지면, 원본 빈 문자열 1,307행 포함)
--      '(키워드 없음: 비검색·외부 지면)' 한 줄. 그 밖의 키워드는 원본 글자 그대로. 지면이 비면 '(지면 없음)'
--    ★ 빈 문자열 키워드를 「키워드 없음」으로 묶는 규칙은 2026-11-13 에 바뀌었다. 지금 DB 의 옛 함수(2026-09-18 판)는
--      빈 문자열을 따로 한 줄로 두므로, 이 SQL 실행 전후 「키워드 없음」 줄 숫자가 그만큼 달라질 수 있다(합계는 같다).
--
-- ------------------------------------------------------------
--  실행 순서(SQL Editor, 김호):
--    0) [실행 전 측정, 선택] 아래 두 줄을 **각각 따로** 돌려 화면 아래 걸린 시간을 적어 둔다(지금 함수, 원본 직접 합산).
--         select length(coupang_keyword_summary(current_date - 1, current_date - 1)::text);   -- 하루치
--         select length(coupang_keyword_summary(current_date - 30, current_date - 1)::text);  -- 30일치(시간 제한에 걸릴 수 있음)
--       하루치 묶기가 얼마나 드는지 보려면(원본만 읽음, 아무것도 안 바꿈):
--         explain (analyze, buffers)
--         select k.campaign, k.keyword, k.placement, sum(k.spend)
--         from raw_coupang_keyword k where k.date = current_date - 1 group by 1, 2, 3;
--    1) 이 파일 전체를 붙여넣고 한 번 실행. 여러 번 실행해도 안전하다(if not exists / create or replace / 백필은 다시 묶기).
--       맨 아래 대조 결과 두 줄(new(daily)·old(raw))의 rows · spend · conv_sales_14d · entries 가 같으면 정상.
--    2) [실행 뒤 측정] 0) 의 두 줄을 다시 돌려 시간을 비교한다.
--    3) [확인, 선택] select * from coupang_keyword_daily_lag(current_date - 30, current_date);  → 아무 줄도 안 나오면 정상.
--  대시보드 배포 전에 돌려도, 뒤에 돌려도 된다. 배포 전이면 묶음은 새 원본이 들어올 때 갱신되지 않지만
--  요약 함수가 그날을 원본에서 합치므로 숫자는 맞다(느릴 뿐). 배포 뒤에는 수집 직후 갱신된다.
--  되돌리기: 맨 아래 주석.
-- ============================================================


-- ── 0) 2026-11-13 초판(트리거 방식)이 남아 있으면 지운다 ─────────────
drop trigger if exists coupang_keyword_daily_ins on raw_coupang_keyword;
drop trigger if exists coupang_keyword_daily_upd on raw_coupang_keyword;
drop trigger if exists coupang_keyword_daily_del on raw_coupang_keyword;
drop function if exists coupang_keyword_daily_on_insert();
drop function if exists coupang_keyword_daily_on_update();
drop function if exists coupang_keyword_daily_on_delete();


-- ── 1) 묶음 표 + 판 기록 ───────────────────────────────────────
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
  primary key (date, product, keyword, placement)
);

create table if not exists coupang_keyword_daily_meta (
  date          date        primary key,
  read_at       timestamptz,                       -- 판 ①: 묶을 때 그 날짜 원본의 max(read_at)
  date_rows     integer     not null default 0,    -- 판 ②: 묶을 때 그 날짜 원본 전체 행 수(모든 파일)
  file          text,                              -- 묶을 때 쓴 파일(가장 늦게 읽은 것)
  raw_rows      integer     not null default 0,    -- 그 파일 행 수
  refreshed_at  timestamptz not null default now()
);
alter table coupang_keyword_daily_meta add column if not exists date_rows integer not null default 0;

-- 읽기는 anon 도 된다. 쓰기는 아래 갱신 함수(security definer)만 한다.
alter table coupang_keyword_daily enable row level security;
alter table coupang_keyword_daily_meta enable row level security;
drop policy if exists coupang_keyword_daily_read on coupang_keyword_daily;
create policy coupang_keyword_daily_read on coupang_keyword_daily for select using (true);
drop policy if exists coupang_keyword_daily_meta_read on coupang_keyword_daily_meta;
create policy coupang_keyword_daily_meta_read on coupang_keyword_daily_meta for select using (true);
grant select on coupang_keyword_daily, coupang_keyword_daily_meta to anon, authenticated;
revoke insert, update, delete, truncate on coupang_keyword_daily, coupang_keyword_daily_meta from anon, authenticated;


-- ── 2) 원본 인덱스 ──────────────────────────────────────────────
-- 날짜 인덱스(raw_coupang_keyword_date_idx)는 이미 있다.
-- (date, read_at): 날짜마다 판(max(read_at)·행 수)을 셀 때. (date, file): 그날 고른 파일 행만 읽을 때.
create index if not exists raw_coupang_keyword_date_read_idx on raw_coupang_keyword (date, read_at);
create index if not exists raw_coupang_keyword_date_file_idx on raw_coupang_keyword (date, file);


-- ── 3) 판이 다른 날짜(읽기 전용) ──────────────────────────────────
-- 원본에 있는데 묶음 판이 없거나 다른 날짜 + 원본에서 사라졌는데 묶음이 남은 날짜.
create or replace function coupang_keyword_daily_lag(p_from date, p_to date)
returns table (date date, reason text)
language sql
stable
set search_path = public, pg_temp
as $$
  select d.date,
         case when m.date is null then 'not_built' else 'outdated' end
  from (
    select r.date, max(r.read_at) as read_at, count(*)::int as n
    from raw_coupang_keyword r
    where r.date between p_from and p_to
    group by r.date
  ) d
  left join coupang_keyword_daily_meta m on m.date = d.date
  where m.date is null or m.read_at is distinct from d.read_at or m.date_rows <> d.n
  union all
  select m.date, 'raw_gone'
  from coupang_keyword_daily_meta m
  where m.date between p_from and p_to
    and not exists (select 1 from raw_coupang_keyword r where r.date = m.date)
  order by 1;
$$;
grant execute on function coupang_keyword_daily_lag(date, date) to anon, authenticated;


-- ── 4) 갱신 함수: 판이 다른 날짜만 지우고 다시 묶는다 ─────────────────
-- /api/raw-ingest 가 원본 적재에 성공한 뒤 그 날짜들로 부른다(anon). 실패해도 수집은 성공 그대로다.
-- 한 번에 62일까지만 받는다(anon 이 큰 기간을 통째로 다시 묶어 DB 를 붙잡지 못하게).
create or replace function coupang_keyword_daily_refresh(p_dates date[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n integer;
  ds date[];
  todo date[];
begin
  select array_agg(distinct d) into ds from unnest(p_dates) d where d is not null;
  if ds is null or cardinality(ds) = 0 then
    return 0;
  end if;
  if cardinality(ds) > 62 then
    raise exception 'coupang_keyword_daily_refresh: 한 번에 62일까지 (받은 날짜 %개)', cardinality(ds);
  end if;

  -- 이미 같은 판인 날짜는 건너뛴다. 잠그기 전에 한 번 보고(다 같으면 잠금 대기 없이 끝), 잠근 뒤 다시 본다.
  select array_agg(x.date) into todo from (
    select d.date
    from (select r.date, max(r.read_at) as read_at, count(*)::int as n
          from raw_coupang_keyword r where r.date = any(ds) group by r.date) d
    left join coupang_keyword_daily_meta m on m.date = d.date
    where m.date is null or m.read_at is distinct from d.read_at or m.date_rows <> d.n
    union all
    select m.date from coupang_keyword_daily_meta m
    where m.date = any(ds) and not exists (select 1 from raw_coupang_keyword r where r.date = m.date)
  ) x;
  if todo is null then
    return 0;
  end if;
  -- 같은 날짜를 두 호출이 동시에 다시 묶으면 기본키가 부딪친다. 이 표 갱신은 한 줄로 세운다.
  perform pg_advisory_xact_lock(hashtext('coupang_keyword_daily'));
  select array_agg(x.date) into todo from (
    select d.date
    from (select r.date, max(r.read_at) as read_at, count(*)::int as n
          from raw_coupang_keyword r where r.date = any(ds) group by r.date) d
    left join coupang_keyword_daily_meta m on m.date = d.date
    where m.date is null or m.read_at is distinct from d.read_at or m.date_rows <> d.n
    union all
    select m.date from coupang_keyword_daily_meta m
    where m.date = any(ds) and not exists (select 1 from raw_coupang_keyword r where r.date = m.date)
  ) x;
  if todo is null then
    return 0;
  end if;

  delete from coupang_keyword_daily where date = any(todo);
  delete from coupang_keyword_daily_meta where date = any(todo);

  with latest as (
    select k.date, (array_agg(k.file order by k.read_at desc nulls last))[1] as file
    from raw_coupang_keyword k
    where k.date = any(todo)
    group by k.date
  ),
  r as (
    select k.date,
      coalesce(nullif(trim(regexp_replace(regexp_replace(regexp_replace(
        coalesce(k.campaign, '(캠페인 없음)'), '^로켓배송_', ''), '^[0-9]{6}_', ''), '_[0-9]{6}$', '')), ''),
        coalesce(k.campaign, '(캠페인 없음)')) as product,
      case when btrim(coalesce(k.keyword, ''), E' \t\r\n') in ('', '-') then '(키워드 없음: 비검색·외부 지면)' else k.keyword end as keyword,
      coalesce(k.placement, '(지면 없음)') as placement,
      k.impressions, k.clicks, k.spend, k.orders_1d, k.conv_sales_1d, k.orders_14d, k.conv_sales_14d
    from raw_coupang_keyword k
    join latest l on l.date = k.date and l.file is not distinct from k.file
    where k.date = any(todo)
  )
  insert into coupang_keyword_daily (date, product, keyword, placement,
    impressions, clicks, spend, orders_1d, conv_sales_1d, orders_14d, conv_sales_14d, raw_rows)
  select date, product, keyword, placement,
    coalesce(sum(impressions), 0), coalesce(sum(clicks), 0), coalesce(sum(spend), 0),
    coalesce(sum(orders_1d), 0), coalesce(sum(conv_sales_1d), 0),
    coalesce(sum(orders_14d), 0), coalesce(sum(conv_sales_14d), 0),
    count(*)
  from r
  group by date, product, keyword, placement;
  get diagnostics n = row_count;

  insert into coupang_keyword_daily_meta (date, read_at, date_rows, file, raw_rows, refreshed_at)
  select v.date, v.read_at, v.date_rows, v.file,
    (select count(*) from raw_coupang_keyword k where k.date = v.date and k.file is not distinct from v.file),
    now()
  from (
    select k.date, max(k.read_at) as read_at, count(*)::int as date_rows,
           (array_agg(k.file order by k.read_at desc nulls last))[1] as file
    from raw_coupang_keyword k where k.date = any(todo) group by k.date
  ) v;

  return n;
end;
$$;

revoke execute on function coupang_keyword_daily_refresh(date[]) from public;
grant execute on function coupang_keyword_daily_refresh(date[]) to anon, authenticated;


-- ── 5) 백필: 원본에 있는 모든 날짜를 31일씩 묶는다(다시 돌려도 같은 결과, 같은 판은 건너뜀) ─────
do $$
declare
  all_dates date[];
  i int := 1;
begin
  select array_agg(distinct date order by date) into all_dates from raw_coupang_keyword;
  if all_dates is null then return; end if;
  while i <= cardinality(all_dates) loop
    perform coupang_keyword_daily_refresh(all_dates[i : least(i + 30, cardinality(all_dates))]);
    i := i + 31;
  end loop;
end $$;


-- ── 6) 요약 함수 ───────────────────────────────────────────────
-- 옛 본문(원본을 매번 합침)은 대조용으로 이름만 바꿔 남긴다(키워드 없음 규칙만 2026-11-13 판으로). 화면은 부르지 않는다.
create or replace function coupang_keyword_summary_raw(p_from date, p_to date)
returns json
language sql
stable
set search_path = public, pg_temp
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
        case when btrim(coalesce(keyword, ''), E' \t\r\n') in ('', '-') then '(키워드 없음: 비검색·외부 지면)' else keyword end as keyword,
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

-- 화면이 부르는 함수. 이름·인자·모양은 2026-09-18 판과 같다.
-- 날짜마다: 묶음 판(meta.read_at · meta.date_rows)이 원본 판(max(read_at) · count(*))과 같으면 묶음 표,
-- 아니면(갱신 전·조각이 더 들어옴·일부 삭제·원본이 더 새것) 원본에서 직접.
create or replace function coupang_keyword_summary(p_from date, p_to date)
returns json
language sql
stable
set search_path = public, pg_temp
as $$
with raw_dates as (
  select date, max(read_at) as read_at, count(*)::int as n
  from raw_coupang_keyword
  where date between p_from and p_to
  group by date
),
fresh as (
  select d.date from raw_dates d
  join coupang_keyword_daily_meta m
    on m.date = d.date and m.read_at is not distinct from d.read_at and m.date_rows = d.n
),
stale as (
  select date from raw_dates
  except
  select date from fresh
),
latest as (
  select k.date, (array_agg(k.file order by k.read_at desc nulls last))[1] as file
  from raw_coupang_keyword k
  where k.date in (select date from stale)
  group by k.date
),
r as (
  select c.product, c.keyword, c.placement, c.impressions, c.clicks, c.spend,
         c.orders_1d, c.conv_sales_1d, c.orders_14d, c.conv_sales_14d, c.raw_rows
  from coupang_keyword_daily c
  where c.date in (select date from fresh)
  union all
  select
    coalesce(nullif(trim(regexp_replace(regexp_replace(regexp_replace(
      coalesce(k.campaign, '(캠페인 없음)'), '^로켓배송_', ''), '^[0-9]{6}_', ''), '_[0-9]{6}$', '')), ''),
      coalesce(k.campaign, '(캠페인 없음)')),
    case when btrim(coalesce(k.keyword, ''), E' \t\r\n') in ('', '-') then '(키워드 없음: 비검색·외부 지면)' else k.keyword end,
    coalesce(k.placement, '(지면 없음)'),
    k.impressions, k.clicks, k.spend, k.orders_1d, k.conv_sales_1d, k.orders_14d, k.conv_sales_14d, 1
  from raw_coupang_keyword k
  join latest l on l.date = k.date and l.file is not distinct from k.file
  where k.date in (select date from stale)
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
-- docs/sql/coupang-keyword-summary.sql 을 다시 실행하면 요약 함수가 원본만 읽는 판으로 돌아간다.
-- 묶음 표·판 기록 표·갱신 함수는 남겨도 화면·수집에 영향이 없다(대시보드가 갱신 함수를 부르지만 실패해도 수집은 성공).
-- 완전히 지우려면:
-- drop function if exists coupang_keyword_daily_refresh(date[]);
-- drop function if exists coupang_keyword_daily_lag(date, date);
-- drop function if exists coupang_keyword_summary_raw(date, date);
-- drop table if exists coupang_keyword_daily_meta;
-- drop table if exists coupang_keyword_daily;
