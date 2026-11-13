-- ============================================================
-- 2026-11-13  keyword_performance 옛 캠페인 단위 행 정리 (선택, 안 돌려도 화면은 같다)
-- ============================================================
--
--  무엇: keyword_performance 의 2026-05-04 이전 행 가운데 키워드가 아니라 **캠페인 이름**이 들어간 것.
--    - platform 이 naver_search 가 아닌 행 전부(네이버 쇼핑 "사입_벌크"·"04.너티_쇼핑검색"·"네이버 쇼핑광고",
--      메타 "Meta 광고", GFA "GFA", 구글 "Google 검색"·"Google DA") : 441행
--    - naver_search 중 캠페인 이름 꼴 3건("01.아이언펫_파워링크", "02.너티_파워링크", "05. 사입_파미나/닥터레이") : 27행
--    합계 468행(2026-11-13 anon 조회 실측, 마지막 날짜 2026-05-04). 키워드 단위였던 적이 없다
--    (marketing-dashboard scripts/sync_naver_keywords.py 머리 주석).
--
--  화면은 이미 이 행을 키워드 표·KPI·칩에서 빼고 「옛 캠페인 단위 기록」 회색 한 줄로 보여 준다
--  (src/lib/sa-balancelab.ts isLegacyCampaignRow). 이 SQL 은 DB 에서도 치우고 싶을 때만 돌린다.
--  다른 화면 영향: 밸런스랩 제품별 손익(/api/bl-product-pnl)은 밸런스랩 naver_search 중금속 검색어만 읽어 이 행과 무관하다.
--  /raw 화면(원본 표 보기)에서는 이 행이 사라진다(백업 표에 남는다).
--
--  실행: SQL Editor 에 전체를 붙여넣고 한 번 실행. 백업 → 개수 확인 → 지우기가 한 덩어리(begin ~ commit)다.
--        백업 개수와 지울 개수가 다르면 스스로 멈추고 아무것도 지우지 않는다. 다시 돌려도 안전하다.
--  되돌리기: 맨 아래 주석.
-- ============================================================

begin;

-- 1) 백업 표(모양 그대로). 이미 있으면 그대로 쓴다.
create table if not exists keyword_performance_legacy_backup_20261113 as
  select * from keyword_performance where false;

-- 2) 대상 행을 백업에 넣는다(이미 넣은 id 는 건너뜀).
insert into keyword_performance_legacy_backup_20261113
select k.* from keyword_performance k
where (k.platform <> 'naver_search'
       or k.keyword in ('01.아이언펫_파워링크', '02.너티_파워링크', '05. 사입_파미나/닥터레이')
       or k.keyword ~ '^[0-9]{2}\.\s?[^\s_]+_')
  and not exists (select 1 from keyword_performance_legacy_backup_20261113 b where b.id = k.id);

-- 3) 지울 행이 전부 백업에 있는지 확인. 아니면 멈춘다(begin 덩어리 전체가 취소된다).
do $$
declare
  targets int;
  backed  int;
begin
  select count(*) into targets from keyword_performance k
  where (k.platform <> 'naver_search'
         or k.keyword in ('01.아이언펫_파워링크', '02.너티_파워링크', '05. 사입_파미나/닥터레이')
         or k.keyword ~ '^[0-9]{2}\.\s?[^\s_]+_');
  select count(*) into backed from keyword_performance k
  where exists (select 1 from keyword_performance_legacy_backup_20261113 b where b.id = k.id);
  if targets <> backed then
    raise exception '백업 % 행 / 지울 대상 % 행이 달라 멈춤', backed, targets;
  end if;
  if targets > 1000 then
    raise exception '지울 대상 % 행이 예상(468행 안팎)보다 많아 멈춤. 조건을 다시 확인', targets;
  end if;
  raise notice '지울 대상 % 행, 전부 백업됨', targets;
end $$;

-- 4) 지우기(백업에 있는 id 만)
delete from keyword_performance k
where exists (select 1 from keyword_performance_legacy_backup_20261113 b where b.id = k.id);

commit;

-- 5) 확인(SQL Editor 는 마지막 결과만 보여 주므로 한 줄로 합침): legacy_left 0, backed_up 468 안팎이면 정상
select
  (select count(*) from keyword_performance
    where platform <> 'naver_search' or keyword ~ '^[0-9]{2}\.\s?[^\s_]+_') as legacy_left,
  (select count(*) from keyword_performance_legacy_backup_20261113) as backed_up;

-- ── 되돌리기(필요할 때만, 주석을 풀어 실행) ─────────────────────────
-- insert into keyword_performance select * from keyword_performance_legacy_backup_20261113 b
--   where not exists (select 1 from keyword_performance k where k.id = b.id);
