-- ============================================================
--  아직 실행 안 된 SQL 모음 · 2026-09-21 확인
--
--  Supabase 대시보드 > SQL Editor 에 이 파일 전체를 붙여넣고 한 번 실행하면 됩니다.
--  여러 번 실행해도 안전합니다(전부 if not exists).
--
--  2026-09-21 에 실제로 조회해 확인한 결과, 아래 하나만 남았습니다.
--    이미 적용됨: raw_cafe24_cart · raw_smartstore_inflow · raw_smartstore_customers
--                raw_gfa_campaign · raw_coupang_keyword · raw_naver_search_term
--                content_candidates · ops_status · daily_ad_spend.entry_source
-- ============================================================

-- ── content_board : 콘텐츠 탭 보드 ───────────────────────────
--
-- 이게 없어서 콘텐츠 탭의 **세 칸이 통째로 안 뜹니다.**
--   naver    네이버 블로그 진행판 (초안 → 임시저장 → 발행 확인)
--   research 자료조사 신선도 (축별 최근 7일 수집·후보·판정)
--   magazine 자사몰 매거진 진행·조회수 (2026-09-21 추가)
--
-- 쓰는 쪽: 로컬 content-board-push.mjs → POST /api/content-board (섹션 단위 통째 교체)
-- 보는 쪽: content 페이지
--
-- 왜 ops_status 와 따로 두나: ops_status 는 관제판이 section 을 통째로 갈아 끼운다.
-- 같은 섹션을 두 곳에서 쓰면 서로 지운다. 게다가 ops_status 는 section 에 CHECK 제약이 있어
-- 새 이름을 넣을 수 없다.

create table if not exists content_board (
  section     text        not null,
  item_key    text        not null,
  sort_order  int         not null default 0,
  data        jsonb       not null default '{}'::jsonb,
  reported_at timestamptz not null default now(),
  primary key (section, item_key)
);

-- ── 실행 뒤 확인 ─────────────────────────────────────────────
-- 아래가 0 행이면 정상입니다(표만 생기고 값은 로컬에서 올립니다).
select count(*) as content_board_rows from content_board;

-- 그다음 볼트에서 한 번 돌리면 값이 찹니다.
--   cd "H:/내 드라이브/obsidian/Obsidian/Work/밸런스랩/projects/네이버블로그-자동화/_스크립트"
--   node content-board-push.mjs

-- ─────────────────────────────────────────────────────────────
-- 2026-09-22 자료조사 채택·폐기 버튼
--
-- 김호: "자료조사 채택한 것에 버튼 넣어서 버리거나 채택을 할 수 있게 했으면 좋겠어.
--        사람이 선택하거나, 의견이 없으면 니가 알아서 진행"
--
-- 판정 결과(review.json 의 '채택')를 content_candidates 에 channel='research' 로 올리고
-- 대시보드에서 누른 것을 status 로 남긴다. 표를 새로 만들지 않고 있는 표를 넓힌다.
-- 지금은 channel 에 CHECK 가 걸려 있어 'research' 가 들어가지 않는다.
--
-- ※ 버튼은 **게이트가 아니라 덮어쓰기**다. 김호가 아무것도 안 누르면 내 판정대로 간다.
alter table content_candidates drop constraint if exists content_candidates_channel_check;
alter table content_candidates add constraint content_candidates_channel_check
  check (channel in ('threads', 'instagram', 'naver_blog', 'research'));
