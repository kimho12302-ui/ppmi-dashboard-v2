-- ============================================================
-- 2026-11-26  자동 판매입력 보관 표 2개
-- ============================================================
--
--  왜: 이카운트용 「판매입력」 엑셀을 사람이 매일 손으로 만들던 것을 회사 PC 파이썬 스크립트가 자동으로 만든다
--    (볼트 settings/collectors/bin/sales_entry_*.py). 그 결과를 날짜별로 보관하고, 대시보드
--    「일일 입력 > 📤 엑셀 업로드」의 「자동 판매입력」 카드에서 날짜를 골라 판매입력 엑셀을 받는다.
--    ★ 보관·조회·다운로드만 한다. product_sales·daily_sales·통계 시트에는 쓰지 않는다
--      (매출 원장 반영은 기존 /api/upload-sales 몫, 시작일은 사람이 정한다).
--
--  실행: Supabase > SQL Editor 에 이 파일 전체를 붙여넣고 실행. 여러 번 실행해도 안전하다(create if not exists).
--  순서: 이 SQL → 대시보드 배포 → 회사 PC 에서 sales_entry_push.py 로 하루치 보내기 → 카드에서 「엑셀 받기」 확인.
--    SQL 전에 배포돼도 화면·API 는 죽지 않고 「표 없음, SQL 실행 필요」를 띄운다.
--
--  쓰는 쪽: 볼트 sales_entry_push.py → POST /api/sales-entry (x-ppmi-key 필수)
--  읽는 쪽: GET /api/sales-entry(목록·상세), GET /api/sales-entry/xlsx?date=(엑셀), 규칙 src/lib/sales-entry-core.ts
--
--  ★ 고객 개인정보는 넣지 않는다. 이 DB 는 anon 키로 읽고 쓰고 그 키가 공개 리포에 있다.
--    판매정리의 수령인·수령인번호·수령인주소·적요(보내는 쪽이 적요에 수령인 이름을 넣는다) 칸은
--    API 가 받을 때 비우고 저장한다.
-- ============================================================

-- ── 1. 날짜별 실행 (하루 1행, 완료 표식) ──────────────────
-- API 는 같은 날 재전송을 통째 교체한다: 이 행 삭제 → 줄 삭제 → 줄 삽입 → 이 행 삽입(맨 마지막).
-- 그래서 이 행이 있고 line_count 가 실제 줄 수와 같을 때만 「저장 완료」로 본다.
create table if not exists sales_entry_runs (
  date            date        primary key,
  basis           jsonb,                     -- 기준 날짜 {스마트스토어: 발주확인일, 그 외: 결제일}
  summary         jsonb,                     -- {total, revenue, shipping, groups[{mall, qty, sum, lines[{name, qty, sum}]}]}
  unmatched       jsonb,                     -- [{판매몰, 매칭열쇠, 줄수}] 품목코드를 못 찾은 상품
  gaps            jsonb,                     -- {스토어: {빠짐[], 클레임[], 취소반품[], 남음[], 통합검색, 판매정리}}
  problems        jsonb,                     -- 수집 중 문제 문구 목록
  sheet_headers   jsonb       not null,      -- 판매정리 2행 머리글 42칸(A~AP, 같은 이름 중복 있음)
  line_count      int         not null check (line_count >= 0),
  total           numeric     not null,      -- 총매출(배송비 포함, 슬랙 보고 표와 같은 값)
  revenue         numeric,                   -- 공급가액+부가세 합(배송비 제외)
  shipping        numeric     not null default 0,
  unmatched_count int         not null default 0, -- 미매칭 줄 수(unmatched 줄수 합)
  gap_count       int         not null default 0, -- 누락(빠짐+클레임) 건수
  problem_count   int         not null default 0,
  generated_at    timestamptz,               -- 보내는 쪽이 만든 시각(KST 로 해석해 저장)
  updated_at      timestamptz not null default now()
);

-- ── 2. 판매정리 줄 (날짜 × 순서) ─────────────────────────
-- 같은 이름이 두 번인 머리글(수량·출하창고)은 뒤 칸(이카운트 판매입력 쪽)을 쓴다. /api/upload-sales 와 같은 규칙.
create table if not exists sales_entry_lines (
  date              date     not null,
  seq               int      not null,       -- 판매정리 순서(1부터)
  mall              text,                    -- 판매몰
  order_no          text,                    -- 주문번호(문자열 그대로)
  item_order_no     text,                    -- 품목별주문번호
  paid_at           text,                    -- 결제일(원문 "YYYY-MM-DD HH:MM:SS")
  item_code         text,                    -- 품목코드(못 찾으면 "#N/A")
  item_name         text,                    -- 품목명(비면 상품명)
  qty               numeric,                 -- 수량(이카운트 쪽 칸)
  supply            numeric,                 -- 공급가액
  vat               numeric,                 -- 부가세
  amount            numeric,                 -- 매출 = 공급가액 + 부가세
  warehouse         text,                    -- 출하창고(이카운트 쪽 칸)
  unmatched         boolean  not null default false,
  row_values        jsonb    not null,       -- 42칸 원본 값(개인정보 칸은 비운 뒤). values 는 SQL 예약어라 이 이름
  primary key (date, seq)
);

-- 대시보드는 anon 키로 읽고 쓴다. 같은 날 재전송을 통째 교체하려고 **이 두 표에만** delete 를 준다.
grant select, insert, update, delete on sales_entry_runs, sales_entry_lines to anon, authenticated;

-- ── 확인 ─────────────────────────────────────────────────
-- 두 줄 모두 나오면 정상(처음엔 rows 0).
select 'sales_entry_runs' as tbl, count(*) as rows from sales_entry_runs
union all
select 'sales_entry_lines', count(*) from sales_entry_lines;
