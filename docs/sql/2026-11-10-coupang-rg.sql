-- ============================================================
-- 2026-11-10  쿠팡 로켓그로스(RG) 재고 원천 표 2개
-- ============================================================
--
--  왜: 재고 화면의 너티 쿠팡 재고를 손 입력 대신 WING 로켓그로스 재고현황에서 매일 자동으로 읽는다(김호 선택 (b) 원천 표).
--    같이 쿠팡 판매 속도를 RG 전용 판매(salesStatistics 30일)로 바꾼다. 지금 방식(판매 원장 쿠팡 전체)은
--    판매자배송이 섞여 위킵 출고와 두 번 셀 수 있다.
--    기획: 볼트 Work/PPMI/projects/마케팅-대시보드/재고-화면-기획-2026-11-10.md 「쿠팡 로켓그로스 재고 조사」
--
--  실행: Supabase > SQL Editor 에 붙여넣고 실행. 여러 번 실행해도 안전하다(create if not exists, 시드는 on conflict do nothing).
--  순서: 이 SQL → 대시보드 배포 → 볼트 수집기 --push 1회 → 같은 날 크론 dashboard-daily-collect 에 등록.
--    SQL 전에 배포돼도 화면은 손 입력 쿠팡 재고로 그대로 그린다(표가 없으면 조용히 손 입력으로 대체).
--
--  쓰는 쪽: 볼트 settings/collectors/bin/coupang-rg-inventory.mjs --push
--           → POST /api/raw-ingest (source coupang-rg-inventory · coupang-rg-sku-map, x-ppmi-key 필수)
--           받으면 sync_heartbeat 에 coupang-rg-inventory 를 남긴다(「대시보드 상태」 화면)
--  읽는 쪽: /api/inventory (재고 화면), 계산 규칙 src/lib/inventory.ts
-- ============================================================

-- ── 1. RG 재고 (날짜 × 옵션) ─────────────────────────────
-- 수량은 전부 **옵션 묶음 단위**다([2박스] 판매 가능 49 = 껌 낱개 98). 낱개 환산은 짝짓기 표 qty 를 곱해 화면이 한다.
-- 지나간 날은 쿠팡이 다시 주지 않으므로 매일 찍어 쌓는다.
create table if not exists raw_coupang_rg_inventory (
  date              date    not null,
  vendor_item_id    bigint  not null,          -- 쿠팡 옵션 ID(int4 를 넘음)
  product_name      text,                      -- 등록상품명 예 「[2박스] 너티 하루루틴 스트레스제로껌」
  option_name       text,                      -- 옵션명 예 「2개 덴탈껌 225g」
  sale_suspended    boolean not null default false,
  hidden_by_vendor  boolean not null default false,
  orderable         int     not null default 0, -- 판매 가능(orderableQuantity). 적치가 끝난 입고분은 이미 들어 있음(11-10 실측)
  inbound           int     not null default 0, -- 입고 중 합(inProgressInboundQuantity = 건별 inProgress 합). 판매 가능에 안 들어감
  inbounds          jsonb,                     -- 입고 건별(shipmentId·status·fcCode·expected·requested·received·stowed·inProgress·rejected)
  days_of_cover     int,                       -- 쿠팡이 센 남은 날(참고용, 화면 판정에는 안 씀)
  health_group      text,                      -- OUT_OF_STOCK · ALMOST_OUT_OF_STOCK · null
  sales_7d          int,                       -- RG 판매 7일, 순판매(판매 − 취소), 옵션 묶음 단위. 판매 통계가 없는 옵션은 null
  sales_30d         int,                       -- RG 판매 30일, 순판매. 쿠팡 판매 속도 = 낱개 환산 ÷ 30
  cancelled_30d     int,                       -- 30일 취소 수량(쿠팡은 음수로 주지만 양수로 바꿔 넣음)
  read_at           timestamptz,
  primary key (date, vendor_item_id)
);

-- ── 2. 옵션 → 위킵 SKU 짝짓기 ────────────────────────────
-- RG 바코드(S00+옵션아이템ID)는 위킵 EAN 과 못 잇는다. 그래서 옵션 ID 를 명시한 표로 잇는다.
-- 한 옵션이 두 SKU 로 나뉠 수 있다([1+1] 냠 바삭 세트 = 냠 1 + 바삭 1). qty = 옵션 한 묶음에 든 그 SKU 낱개 수.
-- 정본은 볼트 settings/collectors/raw/coupang-rg/coupang-rg-sku-map.draft.json. 수집기 --push 가 매번 통째로 다시 보낸다.
-- 짝이 없는 옵션(이 표에 줄이 없음)에 재고가 있으면 재고 화면이 경고를 띄우고 수집기는 실패(exit 1)로 끝난다.
-- needs_review = true 는 이름으로 추정한 짝(사람 확인 전). 계산에는 쓰고 화면에 「확인 필요」로 보인다.
create table if not exists coupang_rg_sku_map (
  vendor_item_id  bigint  not null,
  sku_no          text    not null,               -- 위킵 SKU 번호(raw_wekeep_snapshot.sku_no)
  qty             int     not null check (qty >= 1),
  component       text,                           -- 기본 품목 이름(사람이 읽는 용도)
  needs_review    boolean not null default false,
  note            text,
  updated_at      timestamptz not null default now(),
  primary key (vendor_item_id, sku_no)
);

-- 대시보드는 anon 키로 읽고 쓴다(위킵 원천 표와 같은 조건). 원천·짝짓기는 지우지 않는다(upsert 만): delete 권한을 주지 않는다.
-- 잘못 맺은 짝을 없앨 때는 김호가 SQL Editor 에서 delete 한다(볼트 초안에서도 같이 지운다. 안 지우면 다음 --push 가 되살림).
grant select, insert, update on raw_coupang_rg_inventory, coupang_rg_sku_map to anon, authenticated;

-- ── 짝짓기 시드 (볼트 초안 2026-11-10, 옵션 32개 중 짝 있는 31개 → 32줄, 확인 필요 7개) ──
-- 짝 없는 옵션 1개(재고 0, 위킵 대응 SKU 미확인): 95580945402 "23개 덴탈껌+고구마양갱 20g" 혼합 소포장
insert into coupang_rg_sku_map (vendor_item_id, sku_no, qty, component, needs_review, note) values
  (96117368113, '28472426320363', 2, '스트레스제로껌', false, '[2박스] 2개 225g'),
  (96120876984, '28472426320363', 3, '스트레스제로껌', false, '[3박스]'),
  (96121349235, '28472426320363', 4, '스트레스제로껌', false, '[4박스]'),
  (96238800191, '28472426320363', 1, '스트레스제로껌', false, '[1박스]'),
  (96242671446, '28472426320363', 5, '스트레스제로껌', false, '[5박스]'),
  (93782230346, '28472426320363', 1, '스트레스제로껌', false, '옛 옵션 (X), 판매중지'),
  (93924424105, '28472426320363', 2, '스트레스제로껌', false, '로켓배송 중단 (X) 2박스'),
  (94932757989, '28472426320363', 3, '스트레스제로껌', false, '로켓배송 중단 (X) 3박스'),
  (95024945400, '28472426320363', 4, '스트레스제로껌', false, '로켓배송 중단 (X) 4박스'),
  (94589709079, '28472426320363', 1, '스트레스제로껌', true, '"15개 덴탈껌 15g" = 225g 한 봉으로 봄(15×15g). 낱알 15개를 낱개로 세지 말 것'),
  (95147862744, '28472426320363', 1, '스트레스제로껌', true, '"15개 덴탈껌 15g" 위와 같음, 다른 등록상품'),
  (96160992674, '51556448638685', 1, '냠 단호박', false, '[1세트] 냠 160g 1봉. 옵션명이 11-10 "8개 고구마 20g" 로 바뀜(10-30 "1개 고구마 160g")'),
  (96117507812, '51556448638685', 2, '냠 단호박', false, '[2세트] 옵션명 "16개 고구마 20g"(11-10)'),
  (96223218138, '51556448638685', 3, '냠 단호박', false, '[3세트] 새 옵션(10-23). 옵션명 "24개 고구마 20g"(11-10)'),
  (95198605274, '51556448638685', 3, '냠 단호박', false, '[3세트] (X) 옛 옵션, 판매중지'),
  (96117499837, '16538975708680', 2, '바삭 닭가슴살', false, '[2세트] 2개 80g'),
  (96238816047, '16538975708680', 1, '바삭 닭가슴살', false, '[1세트]'),
  (96242662827, '16538975708680', 3, '바삭 닭가슴살', false, '[3세트]'),
  (93734679678, '16538975708680', 1, '바삭 닭가슴살', false, '로켓배송 중단 (X) 1개 80g'),
  (93992113473, '51556448638685', 1, '냠 단호박', false, '[1+1] 냠 바삭 세트: 두 SKU 로 나눔'),
  (93992113473, '16538975708680', 1, '바삭 닭가슴살', false, '[1+1] 냠 바삭 세트: 두 SKU 로 나눔'),
  (96142533338, '09474258740421', 2, '에너젯바', false, '[2박스] 2개 165g'),
  (96117223036, '09474258740421', 1, '에너젯바', true, '"[2박스] (X)" 인데 옵션은 "1개 165g". 1개로 봄'),
  (93782206488, '09474258740421', 1, '에너젯바', true, '"15개 닭가슴살 11g" = 165g 한 봉으로 봄'),
  (96117104871, '66240602840420', 2, '굿모닝퓨레', false, '[2박스] 2개 연어 180g'),
  (94466764972, '66240602840420', 1, '굿모닝퓨레', false, '1개 연어 180g'),
  (93782178712, '66240602840420', 1, '굿모닝퓨레', true, '"15개 연어 12g" = 180g 한 봉으로 봄'),
  (93734666706, '51556448638685', 1, '냠 단호박', true, '"8개 고구마 20g" = 냠 160g 한 봉(20g×8)으로 봄. 근거: 11-10 [1세트] 냠(96160992674) 옵션명이 같은 "8개 고구마 20g" 로 바뀜(10-30 은 "1개 고구마 160g"). 재고·판매 0'),
  (95586082517, '51556448638685', 1, '냠 단호박', true, '"8개 고구마 20g" = 냠 160g 한 봉(20g×8)으로 봄. 근거: 11-10 [1세트] 냠(96160992674) 옵션명이 같은 "8개 고구마 20g" 로 바뀜(10-30 은 "1개 고구마 160g"). 재고·판매 0'),
  (96267821284, '51556448638685', 4, '냠 단호박', false, '[4세트] 냠 "32개 고구마 20g" = 160g×4. 11-10 처음 보임'),
  (96278879930, '09474258740421', 3, '에너젯바', false, '[3박스] 에너젯바 "3개 닭가슴살 165g". 11-10 처음 보임'),
  (96267839165, '16538975708680', 4, '바삭 닭가슴살', false, '[4세트] 바삭 "4개 닭가슴살 80g". 11-10 처음 보임')
on conflict (vendor_item_id, sku_no) do nothing;
