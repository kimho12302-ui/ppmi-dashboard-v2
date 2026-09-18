-- 콘텐츠 탭 보드(네이버 진행판·자료조사 신선도). 2026-09-18 신설.
-- 기획: 볼트 Work/PPMI/docs/콘텐츠-자동화-대시보드-요구사항.md "대시보드 콘텐츠 탭"
--
-- 왜 별도 표인가: ops_status 는 관제판이 섹션을 통째로 갈아 끼운다. 같은 섹션을 두 곳에서 쓰면 서로 지운다.
-- 쓰는 쪽: 로컬 content-board-push.mjs (크롤러 06:00 직후, 밸런스랩 일일 작업 [2-D] 직후) → POST /api/content-board
-- 보는 쪽: content 페이지
--
-- 실행: Supabase SQL Editor 에서 아래 한 줄. 여러 번 실행해도 안전하다.
create table if not exists content_board (section text not null, item_key text not null, sort_order int not null default 0, data jsonb not null default '{}', reported_at timestamptz not null default now(), primary key (section, item_key));
