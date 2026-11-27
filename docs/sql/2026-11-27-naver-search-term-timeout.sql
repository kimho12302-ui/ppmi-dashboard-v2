-- 네이버 검색어 요약 함수에 함수 단위 시간 한도. 2026-11-27 (대시보드 전체 진단 2-3).
--
-- 왜: 대시보드는 공개(anon) 키로 DB를 부르고, anon 역할의 기본 시간 한도는 3초다(Supabase 문서 「Timeouts」).
--     밸런스랩·너티·사입 30일 요약이 3.6~6.2초에 57014 로 실패해 키워드 화면 네이버 검색어 30일이 안 열렸다.
-- 무엇: 이 함수 하나에만 12초 한도를 준다(실측 최악 6.2초의 두 배. 공개 키로 누구나 부를 수 있어 너무 길게 열지 않는다, Fable 검수 M2). 다른 함수·역할 한도는 그대로다.
--       Supabase 문서: 함수에 건 `set statement_timeout` 은 클라이언트 라이브러리를 통한 REST 호출에도 적용된다.
-- 안 돌리면: 30일 네이버 검색어는 계속 57014 로 실패한다. naver-search-term-speedup.sql·naver-search-term-brand.sql 을 다시 돌려도 한도는 남는다(두 파일에도 같은 set 절을 넣음).
--
-- 실행: Supabase 대시보드 > SQL Editor. 여러 번 실행해도 안전하다. 함수 본문은 바꾸지 않는다.

alter function naver_search_term_summary(text, date, date, text) set statement_timeout = '12s';

-- PostgREST 가 함수 설정을 다시 읽게 한다.
notify pgrst, 'reload schema';

-- 확인 1: 아래 한 줄의 proconfig 에 {statement_timeout=12s} 가 보이면 저장은 된 것.
-- 확인 2(실제 효과): 대시보드 키워드 화면에서 밸런스랩 30일, 「전체」 30일 네이버 검색어가 오류 없이 열리면 끝.
select proname, proconfig from pg_proc where proname = 'naver_search_term_summary';
