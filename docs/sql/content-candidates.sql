-- 콘텐츠 후보 표. 2026-09-18 신설. 기획: 볼트 Work/PPMI/docs/콘텐츠-자동화-대시보드-요구사항.md
--
-- 왜 필요한가
--   쓰레드 정보형 글은 축마다 주 1편이다. 로컬 작업이 후보 2~3개를 완성 초안으로 쓰고 검증 게이트를
--   통과한 것만 여기 올린다. 김호가 대시보드 콘텐츠 탭에서 하나를 고르면 같은 주·축·채널의 나머지는
--   자동으로 탈락한다. 고른 글은 다음 로컬 회차가 노션에 보관하고 notion_url 을 채운다.
--   대시보드는 노션·네이버를 직접 건드리지 않는다(면 경계, 대시보드-2면-구조.md).
--
-- 쓰는 쪽: 로컬 → POST /api/content-candidates (후보 적재), 대시보드 → PATCH (선택·취소),
--          로컬 → PATCH action=archived (노션 보관 후)
-- 보는 쪽: content 페이지 "이번 주 쓰레드 후보"
--
-- 실행: Supabase 대시보드 > SQL Editor 에 붙여넣고 실행. 여러 번 실행해도 안전하다.

create table if not exists content_candidates (
  id          text        primary key,               -- threads:balancelab:2026-W38:1
  axis        text        not null check (axis in ('balancelab', 'pet')),
  channel     text        not null check (channel in ('threads', 'instagram', 'naver_blog')),
  week        text        not null,                  -- ISO 주 YYYY-Www
  title       text        not null,                  -- 내부용 한 줄 제목
  body        text        not null,                  -- 올릴 글 전문
  sources     jsonb       not null default '[]'::jsonb,  -- [{label, url}]
  research    jsonb       not null default '{}'::jsonb,  -- {url, claim, evidence, krCoverage, publishedAt}
  gates       jsonb       not null default '{}'::jsonb,  -- {evidence, regulation, evals}: pass|fail
  status      text        not null default 'proposed'
              check (status in ('proposed', 'chosen', 'rejected', 'archived')),
  chosen_at   timestamptz,
  notion_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists content_candidates_group
  on content_candidates (channel, week, axis);
