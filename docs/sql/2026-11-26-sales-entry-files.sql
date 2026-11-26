-- ============================================================
-- 2026-11-26  판매입력 원본 엑셀 암호화 보관 (Storage 비공개 버킷 + 실행 행 원본 칸)
-- ============================================================
--
--  왜: 김호는 대시보드 「자동 판매입력」 카드에서 받는 엑셀이 회사 PC 파이썬이 만든 판매입력_YYMMDD.xlsx 와
--    완전히 같기를 원한다(탭 15개, 수령인 이름·연락처·주소 포함). 그 파일을 그대로 올려 두고 「엑셀 받기」로 내려준다.
--  ★ 이 DB·Storage 는 anon 키로 접근하고 그 키가 공개 리포에 있다. 그래서 파일은 서버(API)가 AES-256-GCM 으로
--    암호화해서 넣는다. 열쇠는 Vercel 환경변수 SALES_FILE_KEY 에만 있다. 버킷에는 암호문만 들어간다.
--    아래 정책이 anon 에 읽기·쓰기를 여는 이유: 서버가 anon 키로 넣고 꺼내기 때문. 꺼내도 열쇠 없이는 못 연다.
--
--  실행: Supabase > SQL Editor 에 이 파일 전체를 붙여넣고 실행. 여러 번 실행해도 안전하다.
--  ★ 순서: 2026-11-26-sales-entry.sql(sales_entry_runs 표)이 먼저 돌아 있어야 한다(아래 alter table 이 그 표에 칸을 붙인다)
--    → 이 SQL → 대시보드 배포 → GET /api/sales-entry/file/health 가 {keyOk:true, bucketOk:true}
--    → 회사 PC 에서 그날 JSON 보낸 뒤 파일 보내기 → 카드에 「원본」 표시, 「엑셀 받기」가 원본.
--    SQL 전에 배포돼도 카드는 죽지 않고 전부 「요약본」으로 보이며, 파일 올리기는 503(이 파일 경로 안내)으로 답한다.
--
--  쓰는 쪽: 볼트 sales_entry_push.py → POST /api/sales-entry/file?date=YYYY-MM-DD (x-ppmi-key)
--  읽는 쪽: GET /api/sales-entry/xlsx?date=, 규칙 src/lib/sales-entry-file-core.ts
--  다른 버킷·표·정책은 건드리지 않는다. product_sales·daily_sales·통계 시트와 무관.
-- ============================================================

-- ── 1. 비공개 버킷 (공개 URL 없음, 파일 하나 10MB 상한) ─────
insert into storage.buckets (id, name, public, file_size_limit)
values ('sales-entry-files', 'sales-entry-files', false, 10485760)
on conflict (id) do update set public = false, file_size_limit = 10485760;

-- ── 2. 이 버킷에만 한정한 정책 (anon·authenticated 에 읽기·넣기·덮어쓰기·지우기) ──
-- 덮어쓰기(upsert)는 insert 와 update 둘 다 필요하다. 정책은 if not exists 가 없어 지우고 다시 만든다.
drop policy if exists "sales_entry_files_select" on storage.objects;
create policy "sales_entry_files_select" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'sales-entry-files');

drop policy if exists "sales_entry_files_insert" on storage.objects;
create policy "sales_entry_files_insert" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'sales-entry-files');

drop policy if exists "sales_entry_files_update" on storage.objects;
create policy "sales_entry_files_update" on storage.objects
  for update to anon, authenticated
  using (bucket_id = 'sales-entry-files')
  with check (bucket_id = 'sales-entry-files');

drop policy if exists "sales_entry_files_delete" on storage.objects;
create policy "sales_entry_files_delete" on storage.objects
  for delete to anon, authenticated
  using (bucket_id = 'sales-entry-files');

-- ── 3. 실행 행에 원본 칸 ─────────────────────────────────
-- 원본 유무는 original_file_path 로만 판정한다. 그날 JSON 을 다시 보내면 실행 행이 통째로 바뀌어 이 칸이 비므로
-- 파일도 다시 보내야 「원본」으로 돌아온다(옛 원본이 새 데이터와 어긋난 채 내려가지 않게).
alter table sales_entry_runs add column if not exists original_file_path   text;        -- 버킷 안 경로 YYYY-MM-DD/sales_entry_YYMMDD.xlsx.enc
alter table sales_entry_runs add column if not exists original_file_size   int;         -- 원본(암호화 전) 바이트 수
alter table sales_entry_runs add column if not exists original_uploaded_at timestamptz; -- 올린 시각

-- 새 칸을 API 가 바로 보게
notify pgrst, 'reload schema';

-- ── 확인 ─────────────────────────────────────────────────
-- 세 줄: 버킷 1(public false), 정책 4, 칸 3 이면 정상.
select 'bucket sales-entry-files (public=false)' as item, count(*) as n
  from storage.buckets where id = 'sales-entry-files' and public = false
union all
select 'storage.objects 정책 sales_entry_files_*', count(*)
  from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'sales_entry_files_%'
union all
select 'sales_entry_runs.original_* 칸', count(*)
  from information_schema.columns
  where table_name = 'sales_entry_runs' and column_name in ('original_file_path', 'original_file_size', 'original_uploaded_at');
