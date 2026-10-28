-- ============================================================
-- 2026-10-28  밸런스랩 제품별 손익: 광고 외 마케팅비(체험 키트 원가 등) 손 입력 표
-- ============================================================
--
--  왜: 시트 「★브랜드별 매출」 음식물과민증 자체 마케팅비가 광고비보다 크다.
--    8월 2,808,443 = 광고비 + 1,548,574, 9월 1,183,702 = 광고비 + 163,860.
--    이 차액은 체험을 위해 나간 키트 원가다(김호 2026-10-28). 광고 원장에 없으므로 손으로 넣는다.
--
--  쓰는 쪽: 손익 화면(/monthly?view=pnl, 옛 /brand/balancelab/pnl) 자체표 마케팅비 칸 클릭 → POST /api/settings type=bl_pnl_manual_cost
--  읽는 쪽: GET /api/bl-product-pnl. 자체 마케팅비 = 광고비 + 이 표 합계.
--  이 표가 없으면(이 SQL 전) 화면은 광고비만으로 계산하고 입력 칸에 "SQL 실행 후 사용" 을 띄운다.
--
--  product: 손익 제품 키 (nutrition·heavy·saliva·food·supplement·etc, src/lib/bl-pnl.ts PNL_PRODUCTS)
--  month:   YYYY-MM
--  kind:    비용 종류 이름. 같은 제품·달에 종류가 여럿이면 행이 여럿
--
--  몇 번 실행해도 안전하다(if not exists, on conflict do nothing).
-- ============================================================

create table if not exists bl_pnl_manual_cost (
  product     text    not null check (product in ('nutrition', 'heavy', 'saliva', 'food', 'supplement', 'etc')),
  month       text    not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  kind        text    not null check (length(kind) between 1 and 40),
  amount      bigint  not null check (amount >= 0),
  memo        text,
  updated_at  timestamptz not null default now(),
  primary key (product, month, kind)
);

-- 대시보드는 anon 키로 붙는다(다른 손 입력 표와 같은 조건)
grant select, insert, update, delete on bl_pnl_manual_cost to anon, authenticated;

insert into bl_pnl_manual_cost (product, month, kind, amount, memo) values
  ('food', '2026-08', '체험 키트 원가', 1548574, '시트 ★브랜드별 매출 Q80 마케팅비 − 광고비. 김호 2026-10-28 확인'),
  ('food', '2026-09', '체험 키트 원가',  163860, '시트 ★브랜드별 매출 Q81 마케팅비 − 광고비. 김호 2026-10-28 확인')
on conflict (product, month, kind) do nothing;

-- 확인: 두 줄이 보이면 정상
select product, month, kind, amount, memo from bl_pnl_manual_cost order by month, product, kind;
