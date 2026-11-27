-- ============================================================
--  ★ 2026-11-27 추가: 키워드 화면 네이버 검색어 30일 시간 초과 → 별도 파일 하나, 한 줄짜리
--    docs/sql/2026-11-27-naver-search-term-timeout.sql  (naver_search_term_summary 에만 함수 단위 한도 12초)
--    안 돌리면 30일 네이버 검색어가 계속 57014 로 실패한다. 끝의 select 에 {statement_timeout=12s} 가 보이면 정상
-- ============================================================

-- ============================================================
--  ★ 2026-11-26 추가: 판매입력 「원본 다시 만들기」 표시 → 별도 파일 하나만 붙여넣으면 된다
--    docs/sql/2026-11-26-sales-entry-stale.sql  (sales_entry_runs 에 original_stale 칸 하나, 기본 false)
--    ★ 2026-11-26-sales-entry.sql → 2026-11-26-sales-entry-files.sql 뒤에 실행
--    「코드 넣기」로 원본이 있는 날 줄을 고치면 이 칸이 켜지고, 회사 PC 아침 회차(sales_entry_daily.py plan)가 그날을 다시 만들어 올린다
--    안 돌려도 화면·원본 올리기는 돈다(표시만 안 켜진다). 끝의 select 첫 줄이 1 이면 정상
-- ============================================================

-- ============================================================
--  ★ 2026-11-13 추가: 키워드 화면 → 별도 파일 둘, 순서 상관없음, 각각 한 번에 붙여넣기
--    docs/sql/2026-11-13-coupang-keyword-daily.sql  (표 2개 coupang_keyword_daily · _meta + 원본 인덱스 2개 + 갱신 함수 +
--      백필 + 요약 함수 coupang_keyword_summary 교체, 옛 본문은 coupang_keyword_summary_raw 로 남김. 원본 표 트리거 없음)
--      수집(원본 적재)은 이 SQL 때문에 실패하지 않는다. 묶음은 대시보드 /api/raw-ingest 가 적재 성공 뒤 따로 갱신한다.
--      파일 머리의 「실행 전 측정」 두 줄을 먼저 돌려 시간을 적어 두면 전후 비교가 된다.
--      끝의 대조 select 두 줄(new(daily)·old(raw))의 rows·spend·conv_sales_14d·entries 가 같으면 정상
--    docs/sql/2026-11-13-keyword-legacy-campaign-rows.sql  (선택. keyword_performance 옛 캠페인 이름 행 468행 백업 뒤 삭제)
--      안 돌려도 화면은 같다(이미 표·KPI 에서 뺌). 끝의 한 줄이 legacy_left 0, backed_up 468 안팎이면 정상
-- ============================================================

-- ============================================================
--  ★ 2026-11-26 추가: 판매입력 원본 엑셀 암호화 보관 → 별도 파일 하나만 붙여넣으면 된다
--    docs/sql/2026-11-26-sales-entry-files.sql  (Storage 비공개 버킷 sales-entry-files + 그 버킷 한정 정책 4개,
--    sales_entry_runs 에 original_file_path·original_file_size·original_uploaded_at 칸)
--    ★ 2026-11-26-sales-entry.sql 을 먼저 돌린 뒤 실행. 파일은 서버가 암호화해 넣는다(열쇠 SALES_FILE_KEY 는 Vercel 에만)
--    순서: SQL → 배포 → GET /api/sales-entry/file/health 가 {keyOk:true, bucketOk:true} → 회사 PC 가 JSON 뒤 파일 보내기
--    안 돌려도 카드는 돈다(전부 「요약본」). 끝의 select 세 줄이 1·4·3 이면 정상. 다른 버킷·표는 안 건드린다
-- ============================================================

-- ============================================================
--  ★ 2026-11-26 추가: 판매입력 매칭표(대시보드에서 품목코드 넣기) → 별도 파일 하나만 붙여넣으면 된다
--    docs/sql/2026-11-26-sales-match.sql  (표 2개 sales_match·sales_item_codes, sales_entry_lines 에 match_key 칸)
--    ★ 위 2026-11-26-sales-entry.sql 을 먼저 돌린 뒤 실행(sales_entry_lines 에 칸을 붙인다)
--    순서: SQL → 배포 → 회사 PC 에서 볼트 sales_match.json 옮기기(seed) → 카드에서 편집
--    seed 전에는 카드가 「매칭표 옮기기 전」으로 저장을 막는다. 끝의 select 세 줄이 나오면 정상
--    통계 시트 「상품 목록」은 읽기만, product_sales·daily_sales 는 건드리지 않는다
-- ============================================================

-- ============================================================
--  ★ 2026-11-26 추가: 자동 판매입력 보관 → 별도 파일 하나만 붙여넣으면 된다
--    docs/sql/2026-11-26-sales-entry.sql  (표 2개 sales_entry_runs·sales_entry_lines, 이 두 표에만 delete 권한)
--    안 돌려도 화면은 돈다(「자동 판매입력」 카드에 「표 없음, SQL 실행 필요」). 돌린 뒤 배포 → 회사 PC
--    sales_entry_push.py 로 하루치 보내기 → 카드 「엑셀 받기」 확인. 끝의 select 두 줄이 나오면 정상
--    매출 원장(product_sales·daily_sales)·통계 시트는 건드리지 않는다
-- ============================================================

-- ============================================================
--  ★ 2026-11-10 추가: 쿠팡 로켓그로스 재고 → 별도 파일 하나만 붙여넣으면 된다
--    docs/sql/2026-11-10-coupang-rg.sql  (표 2개 raw_coupang_rg_inventory·coupang_rg_sku_map + 짝짓기 시드 32줄)
--    안 돌려도 재고 화면은 돈다(쿠팡 재고는 손 입력으로 대체). 돌린 뒤 배포 → 볼트 수집기 --push → 같은 날 크론 등록
-- ============================================================

-- ============================================================
--  ★ 2026-11-09 추가: 대시보드 속도 → 별도 파일 하나만 붙여넣으면 된다
--    docs/sql/2026-11-09-perf-rpc.sql  (함수 2개 coupang_campaign_daily·product_sales_products,
--    쿠팡 원본 날짜 인덱스 확인. 표·데이터는 안 바꾼다)
--    안 돌려도 화면은 돈다(대체 경로). 돌리면 광고 이상 신호·설정 응답이 DB 한 번 왕복으로 끝난다
-- ============================================================

-- ============================================================
--  ★ 2026-11-09 추가: 판매 상품 구성표 → 별도 파일 하나만 붙여넣으면 된다
--    docs/sql/2026-11-09-product-components.sql  (표 1개 product_components + 시드 194줄)
--    실행 전에는 화면이 예전처럼 판매 상품 이름 그대로 센다. 실행하면 묶음·세트가 기본 품목으로 풀린다.
--    끝의 확인 select 1번이 파일 머리의 「줄 수」와 같고, 2번이 아무 줄도 안 나오면 정상
--    실행 뒤 대조: node --experimental-strip-types scripts/product-components/verify.mjs --from-db
-- ============================================================

-- ============================================================
--  ★ 2026-10-28 추가: 밸런스랩 제품별 손익 → 별도 파일 두 개, 순서 상관없음, 각각 한 번에 붙여넣기
--    docs/sql/2026-10-28-bl-pnl-manual-cost.sql  (표 1개 + 음식물 8·9월 체험 키트 원가 2줄)
--    docs/sql/2026-10-28-bl-gonggu.sql           (공구 일정표 20줄 + 판매 원장 12~5월 공구 표식 보정)
--      두 번째 실행은 스스로 멈춘다. 끝의 select 결과가 파일 안 기대값과 같으면 정상
-- ============================================================

-- ============================================================
--  ★ 2026-10-20 추가: 키워드 탭 「추가할 키워드」 → 별도 파일 하나만 붙여넣으면 된다
--    docs/sql/2026-10-20-add-keyword-candidates.sql  (표 2개 naver_sa_keyword·sa_keyword_hold,
--    함수 2개, 원천 인덱스 1개. 기존 표·함수는 안 바꾼다)
--    실행 뒤: marketing-dashboard 에서 python scripts\sync_naver_sa_keywords.py --apply 한 번
-- ============================================================

-- ============================================================
--  ★ 2026-10-14 추가: 대시보드 합산 함수 3개 → 별도 파일 하나만 붙여넣으면 된다
--    docs/sql/2026-10-14-summary-rpc.sql  (함수 생성만, 표·데이터 변경 없음)
--    실행 뒤 확인: node scripts/verify-summary-rpc.mjs  → "불일치 0"
--  아래 옛 항목과 섞지 않은 이유: 이 파일 전체가 한 번에 돌아 옛 항목 하나가 실패하면
--  함수까지 같이 취소된다.
-- ============================================================

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
