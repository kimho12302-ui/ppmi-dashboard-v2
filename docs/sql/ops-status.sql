-- 팀용 운영 상태 표 하나. 2026-09-18 신설. 기획: 볼트 Work/PPMI/docs/대시보드-2면-구조.md 3·4·5번.
--
-- 왜 필요한가
--   수집기가 죽었는지, 콘텐츠가 어디서 막혔는지, 보고가 제때 나왔는지를 팀이 대시보드에서 본다.
--   세 가지 모두 로컬 관제판(org-dashboard.mjs)이 이미 매일 계산한다. 대시보드는 볼트를 못 읽으므로
--   관제판이 팀용 칸만 골라 여기에 쓰고, 대시보드는 이 표만 읽는다(외부 연동을 늘리지 않는다).
--   개인 트랙·볼트 위생·인프라는 올리지 않는다(면 경계).
--
-- 쓰는 쪽: 로컬 관제판 → POST /api/ops-status (섹션 단위로 통째 교체)
-- 보는 쪽: settings 화면(수집·보고), content 페이지(콘텐츠 진행)
--
-- 실행: Supabase 대시보드 > SQL Editor 에 붙여넣고 실행. 여러 번 실행해도 안전하다.

create table if not exists ops_status (
  section     text        not null check (section in ('collector', 'content', 'report')),
  item_key    text        not null,
  label       text        not null,
  signal      text        not null check (signal in ('ok', 'warn', 'fail', 'unknown')),
  summary     text        not null default '',
  detail      text        not null default '',
  last_at     text,
  sort_order  int         not null default 0,
  metrics     jsonb       not null default '{}'::jsonb,
  reported_at timestamptz not null default now(),
  primary key (section, item_key)
);
