-- ============================================================
-- 2026-11-26  판매입력 「원본 다시 만들기」 표시 (sales_entry_runs.original_stale)
-- ============================================================
--
--  왜: 원본 파일이 보관된 날은 「코드 넣기」로 보관 줄을 고쳐도 「엑셀 받기」가 회사 PC 가 만든 원본 그대로라
--    #N/A 가 남는다. 그날을 회사 PC 아침 회차(볼트 sales_entry_daily.py plan)가 고친 코드로 다시 만들어 올리게 하려고
--    표시 칸을 하나 둔다.
--    · 켜는 쪽: POST /api/sales-match(코드 넣기, 창고 고르기 포함). 그날 줄이 실제로 바뀌었고 원본(original_file_path)이 있으면 true
--    · 끄는 쪽: POST /api/sales-entry/file(원본 올리기) 성공 → false. 그날 JSON 을 다시 보내면 실행 행이 새로 들어가 기본값 false
--    · 읽는 쪽: GET /api/sales-entry?days=N → items[].original_stale. 회사 PC plan 이 true 인 날을 다시 고른다.
--      카드는 그날 옆에 「원본 다시 만드는 중」을 띄운다.
--
--  실행: Supabase > SQL Editor 에 이 파일 전체를 붙여넣고 실행. 여러 번 실행해도 안전하다(if not exists).
--  ★ 순서: 2026-11-26-sales-entry.sql(표) → 2026-11-26-sales-entry-files.sql(원본 칸) 뒤에 실행.
--    안 돌려도 대시보드는 돈다: 목록은 이 칸 없이 읽고, 원본 올리기도 그대로 성공한다.
--    다만 그동안 「코드 넣기」는 표시를 못 켜고 「원본」인 날은 회사 PC 에서 손으로 다시 보내야 한다(저장 결과에 경고가 뜬다).
--    이 SQL 전에 고친 날은 표시가 안 켜진다(지난 날은 회사 PC 에서 그날을 다시 보내면 된다).
--  다른 표·칸은 건드리지 않는다. product_sales·daily_sales·통계 시트와 무관.
-- ============================================================

alter table sales_entry_runs add column if not exists original_stale boolean not null default false;

-- 새 칸을 API 가 바로 보게
notify pgrst, 'reload schema';

-- ── 확인 ─────────────────────────────────────────────────
-- 1 이 나오면 정상(칸 하나). 두 번째 줄은 지금 표시가 켜진 날 수(처음엔 0).
select 'sales_entry_runs.original_stale 칸' as item, count(*) as n
  from information_schema.columns
  where table_name = 'sales_entry_runs' and column_name = 'original_stale'
union all
select 'original_stale = true 인 날', count(*) from sales_entry_runs where original_stale;
