-- ============================================================
-- 2026-11-26  판매입력 매칭표 (대시보드에서 품목코드 넣기)
-- ============================================================
--
--  왜: 자동 판매입력은 스토어 「상품명+옵션」(매칭열쇠)으로 품목코드를 찾는다. 원래 사람 판매입력 엑셀
--    「제품코드매칭」 탭이었고 지금은 볼트 settings/collectors/bin/sales_match.json 이다. 못 찾으면 #N/A.
--    이 표를 대시보드로 옮겨 「자동 판매입력」 카드에서 미매칭 상품에 코드를 바로 넣는다.
--    넣으면 이미 보관된 판매입력 줄(#N/A)도 그 자리에서 고친다. 회사 PC 실행기는 매일 이 표를 받아 계산한다(정본).
--
--  실행: Supabase > SQL Editor 에 이 파일 전체를 붙여넣고 실행. 여러 번 실행해도 안전하다(if not exists).
--  ★ 순서: 이 SQL → 대시보드 배포 → 회사 PC 에서 볼트 sales_match.json 을 한 번 옮기기(seed)
--      → 그다음부터 카드에서 편집.
--    seed 전에는 대시보드가 「매칭표 옮기기 전」으로 막는다. 한 줄만 든 표를 실행기가 정본으로 받아
--    나머지 전 상품이 #N/A 가 되는 사고를 막기 위해서다.
--
--  쓰는 쪽: POST /api/sales-match(카드, 한 줄), POST /api/sales-match/seed(볼트 실행기, 처음 한 번),
--          POST /api/sales-entry(줄마다 match_key 저장)
--  읽는 쪽: GET /api/sales-match(카드·볼트 실행기). 규칙 src/lib/sales-match-core.ts
--
--  ★ 품목코드는 통계 시트 「상품 목록」 A열에 있는 코드만 받는다(대시보드 업로드의 「미등록 품목코드」를 막으려고).
--    시트에는 쓰지 않는다(읽기만). product_sales·daily_sales 도 건드리지 않는다.
-- ============================================================

-- ── 1. 매칭표: 매칭열쇠(상품명+옵션) → 품목코드 ─────────────
-- 엑셀 VLOOKUP 처럼 대소문자를 안 가린다. 그래서 키는 소문자 열쇠(key_norm). 같은 열쇠는 한 줄뿐이다
-- (엑셀은 먼저 나온 줄이 이겼다. 옮길 때 먼저 나온 줄만 넣는다).
create table if not exists sales_match (
  key_norm   text        primary key,                 -- lower(매칭열쇠). 앞뒤 공백도 그대로 둔다(파이썬 build_lookup 과 같게)
  match_key  text        not null,                    -- 매칭열쇠 원문
  code       text        not null,                    -- 품목코드(「상품 목록」 A열 글자 그대로)
  source     text        not null default '대시보드' check (source in ('엑셀옮김', '대시보드')), -- 처음 들어온 곳(코드를 바꿔도 안 바뀜)
  note       text,                                    -- 메모. 엑셀옮김 줄의 코드를 바꾸면 옛 코드가 여기 남는다
  updated_at timestamptz not null default now()
);

-- ── 2. 품목코드 → 출하창고 (엑셀 「제품코드별출하창고」 탭) ──
create table if not exists sales_item_codes (
  code      text primary key,
  name      text,
  warehouse text
);

-- ── 3. 판매입력 줄에 매칭열쇠 칸 ─────────────────────────
-- 대시보드에서 코드를 넣으면 이 열쇠로 #N/A 줄을 찾아 고친다. 이 칸이 생기기 전에 보낸 줄은 null(다시 보내야 고쳐짐).
alter table sales_entry_lines add column if not exists match_key text;

-- anon 키로 읽고 쓴다. 매칭표는 「대시보드에서 넣은 줄 지우기」가 있어 delete 까지, 창고 표는 지우지 않는다.
grant select, insert, update, delete on sales_match to anon, authenticated;
grant select, insert, update on sales_item_codes to anon, authenticated;

-- 새 칸을 API 가 바로 보게(안 하면 몇 분 동안 「match_key 칸 없음」으로 보일 수 있다)
notify pgrst, 'reload schema';

-- ── 확인 ─────────────────────────────────────────────────
-- 세 줄이 나오면 정상(처음엔 sales_match·sales_item_codes 0, seed 뒤 346·171, 2026-11-26 볼트 사본 기준).
select 'sales_match' as tbl, count(*) as rows from sales_match
union all
select 'sales_item_codes', count(*) from sales_item_codes
union all
select 'sales_entry_lines.match_key 칸', count(*) from information_schema.columns
  where table_name = 'sales_entry_lines' and column_name = 'match_key';
