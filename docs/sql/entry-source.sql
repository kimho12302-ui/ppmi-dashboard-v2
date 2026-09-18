-- 누가 넣은 값인가. 2026-09-18.
--
-- 왜: 수기입력 정본 7절 규칙 "수기와 자동이 같은 칸을 다투면 자동이 이긴다. 사람이 일부러 덮어쓴 건 표시를 남긴다."
--     2026-09-18 부터 퍼널·GFA·쿠팡 광고비는 aside 자동 수집이 채운다. 사람이 입력 폼으로 넣은 값이 섞이면
--     어느 칸이 사람 손인지 알아야 대조·판단을 할 수 있다.
--
-- 값: 'aside'(자동 수집기) · 'manual'(대시보드 입력 폼·엑셀 업로드를 사람이) · null(그 밖의 동기화 스크립트, 이전 행)
-- 쓰는 곳: /api/settings(smartstore_funnel·cafe24_funnel·manual_ad_spend), /api/upload-coupang-ads
--
-- 실행: Supabase 대시보드 > SQL Editor. 여러 번 실행해도 안전하다.

alter table daily_funnel   add column if not exists entry_source text;
alter table daily_funnel   add column if not exists entered_at   timestamptz;
alter table daily_ad_spend add column if not exists entry_source text;
alter table daily_ad_spend add column if not exists entered_at   timestamptz;
