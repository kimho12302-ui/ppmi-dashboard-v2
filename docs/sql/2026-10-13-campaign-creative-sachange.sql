-- 2026-10-13. 대시보드 빈 칸 2개(네이버 캠페인·메타 소재) + 밸런스랩 검색광고 직접 조정 연계.
--
-- 1) naver_campaign_daily : 네이버 검색광고 캠페인 × 일. 옛 원천(구글시트 「캠페인_성과」)이
--    2026-09 부터 안 채워지고 글자도 깨져 「광고 분석 > 네이버 캠페인」이 전 브랜드 0건이었다.
--    수집기(sync_naver_sa.py 펫 계정, sync_all.py 밸런스랩 계정)가 이미 캠페인별 /stats 를
--    부르면서 이름을 버리고 있었으므로, 같은 값을 여기에 같이 쓴다.
-- 2) meta_ad_daily : 메타 광고(소재) × 일. 유효한 메타 토큰은 GitHub Secrets 에만 있어
--    대시보드 서버가 직접 그래프 API 를 부르면 늘 실패했다. 수집기가 대신 받아 여기에 쓴다.
-- 3) sa_change_log : 밸런스랩 검색광고(800812)를 Claude 가 직접 조정한 이력(2026-10-12~).
--    볼트 JSON 에만 있어 대시보드가 못 읽었다. 변경 전·후 값과 원복 검토일을 남긴다.
--
-- 실행: Supabase 대시보드 > SQL Editor. 여러 번 실행해도 안전하다.
-- 맨 끝 select 에서 결과 표(세 줄)가 나오면 성공이다.

create table if not exists naver_campaign_daily (
  date              date        not null,
  account           text        not null,   -- 'main'(너티·사입·아이언펫) | 'balancelab'
  campaign_id       text        not null,
  campaign          text,
  campaign_type     text,                   -- WEB_SITE | SHOPPING | POWER_CONTENTS ...
  brand             text,                   -- 수집기의 캠페인명 규칙. 타사업 캠페인은 'other'
  impressions       bigint      default 0,
  clicks            bigint      default 0,
  cost              numeric     default 0,
  conversions       numeric     default 0,
  conversion_value  numeric     default 0,
  read_at           timestamptz default now(),
  primary key (date, campaign_id)
);
create index if not exists naver_campaign_daily_brand_date on naver_campaign_daily (brand, date);

create table if not exists meta_ad_daily (
  date              date        not null,
  account_id        text        not null,
  brand             text,
  ad_id             text        not null,
  ad_name           text,
  adset_name        text,
  campaign_id       text,
  campaign_name     text,
  thumbnail_url     text,
  impressions       bigint      default 0,
  clicks            bigint      default 0,
  spend             numeric     default 0,
  purchases         numeric     default 0,
  purchase_value    numeric     default 0,
  add_to_cart       numeric     default 0,
  view_content      numeric     default 0,  -- 밸런스랩 픽셀은 구매가 막혀 있고 ViewContent 는 살아 있다
  read_at           timestamptz default now(),
  primary key (date, ad_id)
);
create index if not exists meta_ad_daily_brand_date on meta_ad_daily (brand, date);

create table if not exists sa_change_log (
  id            bigserial   primary key,
  applied_at    timestamptz not null,
  account       text        not null,   -- 'balancelab'
  campaign      text,
  adgroup       text,
  adgroup_id    text,
  keyword_id    text,
  keyword       text        not null,
  device        text,                   -- 'PC' | 'MO'
  action        text        not null,   -- 'bid' | 'resume' | 'pause' | 'add' | 'delete'
  bid_before    int,
  bid_after     int,
  lock_before   boolean,
  lock_after    boolean,
  reason        text,
  review_on     date,                   -- 원복·유지 판단 예정일
  source_doc    text,                   -- 볼트 문서 경로
  actor         text        default 'claude'
);
create unique index if not exists sa_change_log_uniq on sa_change_log (applied_at, keyword, device, action);
create index if not exists sa_change_log_keyword on sa_change_log (account, keyword);

select 'naver_campaign_daily' as 테이블, count(*) as 행 from naver_campaign_daily
union all select 'meta_ad_daily', count(*) from meta_ad_daily
union all select 'sa_change_log', count(*) from sa_change_log;
