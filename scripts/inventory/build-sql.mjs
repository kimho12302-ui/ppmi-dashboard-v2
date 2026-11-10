// 재고 화면 DB 표 SQL 을 만든다 (2026-11-10).
//
//   node scripts/inventory/build-sql.mjs [매칭표 초안 json]  → docs/sql/2026-11-10-inventory.sql
//
// 표 정의는 이 파일 TABLES 에, 위킵 SKU 매칭표 시드는 볼트 초안
// (settings/collectors/raw/wekeep-sku-map.draft.json, 확실 77 · 추정 29 · 없음 15)에서 만든다.
// 시드는 on conflict (sku_no) do nothing 이라 SQL 을 다시 실행해도 사람이 설정 화면에서 확정한 줄을 덮지 않는다.
// 새 SKU 가 생기면 초안을 다시 만들고 이 스크립트를 돌려 새 줄만 들어가게 한다.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "../../docs/sql/2026-11-10-inventory.sql");
const DRAFT = process.argv[2] || "H:/내 드라이브/obsidian/Obsidian/settings/collectors/raw/wekeep-sku-map.draft.json";

const q = (v) => (v === null || v === undefined ? "null" : typeof v === "boolean" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

/** 상품명 머리표에서 브랜드·공급처 (src/lib/inventory.ts parseWekeepName 과 같은 규칙) */
function parseName(name) {
  const tags = [];
  let rest = String(name || "").trim();
  for (;;) {
    const m = rest.match(/^\[([^\]]+)\]\s*/);
    if (!m) break;
    tags.push(m[1].trim());
    rest = rest.slice(m[0].length);
  }
  const saip = tags.includes("사입");
  const supplier = saip ? tags.find((t) => !["사입", "파손", "마케팅용"].includes(t)) ?? null : null;
  const brand = saip ? "saip" : /^너티/.test(rest) ? "nutty" : /^아이언펫/.test(rest) ? "ironpet" : "other";
  return { brand, supplier: saip ? supplier : brand === "nutty" ? "너티" : null };
}

function seedRows(draft) {
  return draft.rows.map((r) => {
    const p = parseName(r.productName);
    const codes = r.codes || [];
    const code = codes.find((c) => c.role === "single" && c.confidence === "확실") || codes[0] || null;
    const exclude = r.category !== "상품";
    const notes = [
      r.category !== "상품" ? r.category : null,
      ...(r.notes || []),
      code && codes.length > 1 ? `코드 후보 ${codes.map((c) => `${c.code}(${c.confidence}${c.role === "multi" ? ",묶음" : ""})`).join(", ")}` : null,
      r.code_status && r.code_status !== "code 있음" ? r.code_status : null,
    ].filter(Boolean);
    return {
      sku_no: r.skuNo,
      product_name: r.productName,
      barcode: r.productManageCode && r.productManageCode !== "-" ? r.productManageCode : null,
      product_code: code?.code ?? null,
      // 판매 구성표 component 이름 끝 줄바꿈 2건(11-10 경고)은 떼고 넣는다. 화면은 띄어쓰기를 무시하고 맞춘다
      component: r.component?.name ? r.component.name.trim() : null,
      brand: r.component?.brand || p.brand,
      supplier: p.supplier,
      confidence: r.confidence,
      confirmed: false,
      exclude,
      note: notes.join(" / ") || null,
    };
  });
}

const HEADER = (counts) => `-- ============================================================
-- 2026-11-10  재고 화면 (/inventory) 표 9개
-- ============================================================
--
--  왜: 「2026 재고·출고 통합관리」 시트가 하는 판단(품절·발주 필요·과재고·예상 소진일·재고 가치)을
--    대시보드로 옮긴다. 기획: 볼트 Work/PPMI/projects/마케팅-대시보드/재고-화면-기획-2026-11-10.md
--
--  실행: Supabase > SQL Editor 에 붙여넣고 실행. 여러 번 실행해도 안전하다
--    (create if not exists, 시드는 on conflict do nothing 이라 설정 화면에서 확정한 값을 덮지 않음).
--  만든 곳: node scripts/inventory/build-sql.mjs  (매칭표 시드는 볼트 wekeep-sku-map.draft.json 에서)
--
--  쓰는 쪽
--    raw_wekeep_snapshot · raw_wekeep_daily : 로컬 수집기 settings/collectors/bin/wekeep-inventory.mjs --push
--                                             → POST /api/raw-ingest (source wekeep-snapshot · wekeep-daily)
--                                             또는 POST /api/wekeep-ingest. 받으면 sync_heartbeat 에 wekeep-inventory 를 남긴다
--    wekeep_sku_map · inventory_* : 설정 > 재고 탭 (POST /api/inventory-settings)
--  읽는 쪽: /api/inventory (재고 화면), 계산 규칙 src/lib/inventory.ts
--
--  매칭표 시드: ${counts}
-- ============================================================
`;

const TABLES = `
-- ── 1. 위킵 오늘 재고 (스냅샷) ──────────────────────────
-- 위킵 재고 화면은 "지금" 값만 준다. 지나간 날은 다시 못 받으므로 매일 찍어 쌓는다.
create table if not exists raw_wekeep_snapshot (
  date                   date    not null,
  sku_no                 text    not null,
  product_name           text    not null,
  variation              text,
  barcode                text,            -- 위킵 상품관리코드(EAN 바코드)
  supplier_name          text,            -- 위킵 공급처 칸(11-10 기준 전부 '-'). 공급처는 매칭표 supplier 를 쓴다
  available_qty          int     not null default 0,  -- 가용 재고(읽은 시각 기준, 그날 출고가 진행 중일 수 있음)
  safe_qty               int     default 0,
  reserve_qty            int     default 0,
  faulty_qty             int     default 0,
  damage_qty             int     default 0,
  in_customs_qty         int     default 0,
  before_delivery_qty    int     default 0,
  daily_avg_shipout_qty  numeric,         -- 위킵 일평균 = 출고 있던 가장 최근 한 주 합 ÷ 5 (11-10 실측)
  month_avg_shipout_qty  numeric,         -- 위킵 월평균 = 08-02~10-31 출고 합 ÷ 3 (11-10 실측)
  sku_turnover           numeric,
  read_at                timestamptz,
  source                 text,            -- 읽은 화면
  primary key (date, sku_no)
);

-- ── 2. 위킵 날짜별 입고·출고 ────────────────────────────
-- center_qty 는 **그날 시작 재고**다(= 전날 시작 + 전날 입고·반품·하자입고·파손입고 − 전날 출고, 7~11월 98.6% 일치).
-- 위킵은 재고도 움직임도 없는 날 행을 안 준다. 빈 날은 전날 마감 재고가 이어진 것으로 본다.
create table if not exists raw_wekeep_daily (
  ymd                date not null,
  sku_no             text not null,
  product_name       text,
  barcode            text,
  shipin_qty         int  not null default 0,  -- 입고
  shipout_qty        int  not null default 0,  -- 출고
  return_shipin_qty  int  not null default 0,  -- 반품 입고
  faulty_shipin_qty  int  not null default 0,  -- 하자 입고
  damage_shipin_qty  int  not null default 0,  -- 파손 입고
  center_qty         int  not null default 0,  -- 그날 시작 재고
  read_at            timestamptz,
  primary key (ymd, sku_no)
);
create index if not exists raw_wekeep_daily_sku_idx on raw_wekeep_daily (sku_no, ymd);

-- ── 3. 위킵 SKU ↔ 대시보드 상품 매칭표 ─────────────────
-- 재고는 기본 품목(낱개) 단위, 판매는 묶음 단위라 판매 구성표(product_components)의 component 로 맞춘다.
create table if not exists wekeep_sku_map (
  sku_no        text primary key,
  product_name  text,
  barcode       text,
  product_code  text,                    -- src/lib/product-master.json code
  component     text,                    -- product_components.component (기본 품목)
  brand         text,                    -- nutty · saip · ironpet · other
  supplier      text,                    -- 사입 공급처(파미나·오리젠 …). 판정 기준 일수를 공급처별로 고를 때 씀
  confidence    text not null default '없음' check (confidence in ('확실', '추정', '없음')),
  confirmed     boolean not null default false,  -- 사람이 확인했는지
  exclude       boolean not null default false,  -- 판정에서 뺌(부자재·판촉물)
  note          text,
  updated_at    timestamptz not null default now()
);

-- ── 4. 손 입력 재고 (쿠팡 로켓그로스·이동 중·내부) ───────
-- 기준일마다 한 줄. 화면은 SKU·위치별 가장 최근 기준일 값을 쓴다. 줄이 없으면 「미입력」(0 과 다름).
create table if not exists inventory_manual_stock (
  sku_no      text not null,
  location    text not null check (location in ('coupang', 'transit', 'internal')),
  as_of       date not null,
  qty         int  not null check (qty >= 0),
  note        text,
  updated_at  timestamptz not null default now(),
  primary key (sku_no, location, as_of)
);

-- ── 5. 발주 ─────────────────────────────────────────────
-- status = ordered(입고 대기) 인 줄이 있으면 그 SKU 는 「발주 필요」에서 「입고 대기」로 바뀐다.
create table if not exists inventory_orders (
  id           bigserial primary key,
  sku_no       text not null,
  qty          int  not null check (qty > 0),
  ordered_at   date not null,
  expected_at  date,
  status       text not null default 'ordered' check (status in ('ordered', 'received', 'cancelled')),
  note         text,
  updated_at   timestamptz not null default now()
);
create index if not exists inventory_orders_sku_idx on inventory_orders (sku_no, status);

-- ── 6. 판매 중지·단종 메모 ──────────────────────────────
-- exclude = true 면 판정(품절·발주 필요 …)에서 뺀다. 시트에서 손으로 덮어쓰던 것.
create table if not exists inventory_notes (
  sku_no      text primary key,
  kind        text not null default 'memo' check (kind in ('stopped', 'discontinued', 'memo')),
  note        text,
  exclude     boolean not null default true,
  updated_at  timestamptz not null default now()
);

-- ── 7. 판정 기준 일수 ───────────────────────────────────
-- 공급처 줄 > 브랜드 줄 > 코드 기본값(사입 15 · 너티 20 · 곧 발주 30 · 과재고 60) 순으로 쓴다.
create table if not exists inventory_rules (
  scope_kind  text not null check (scope_kind in ('brand', 'supplier')),
  scope_key   text not null,
  warn_days   numeric not null check (warn_days >= 0),
  soon_days   numeric not null check (soon_days >= 0),
  over_days   numeric not null check (over_days > 0),
  updated_at  timestamptz not null default now(),
  primary key (scope_kind, scope_key),
  check (warn_days <= soon_days and soon_days < over_days)
);
insert into inventory_rules (scope_kind, scope_key, warn_days, soon_days, over_days) values
  ('brand', 'nutty', 20, 30, 60),
  ('brand', 'saip', 15, 30, 60)
on conflict (scope_kind, scope_key) do nothing;

-- 대시보드는 anon 키로 읽고 쓴다(다른 손 입력 표·원천 표와 같은 조건)
grant select, insert, update, delete on raw_wekeep_snapshot, raw_wekeep_daily, wekeep_sku_map,
  inventory_manual_stock, inventory_orders, inventory_notes, inventory_rules to anon, authenticated;
grant usage, select on sequence inventory_orders_id_seq to anon, authenticated;
`;

function seedSql(rows) {
  const cols = ["sku_no", "product_name", "barcode", "product_code", "component", "brand", "supplier", "confidence", "confirmed", "exclude", "note"];
  const values = rows.map((r) => `  (${cols.map((c) => q(r[c])).join(", ")})`).join(",\n");
  return `
-- ── 매칭표 시드 (볼트 초안에서 생성. 다시 실행해도 이미 있는 SKU 는 건드리지 않음) ──
insert into wekeep_sku_map (${cols.join(", ")}) values
${values}
on conflict (sku_no) do nothing;
`;
}

const draft = JSON.parse(readFileSync(DRAFT, "utf8").replace(/^\uFEFF/, ""));
const rows = seedRows(draft);
const count = (k) => rows.filter((r) => r.confidence === k).length;
const counts = `${rows.length}줄 = 확실 ${count("확실")} · 추정 ${count("추정")} · 없음 ${count("없음")} (그중 판정 제외 = 부자재·판촉물 ${rows.filter((r) => r.exclude).length})`;
writeFileSync(OUT, HEADER(counts) + TABLES + seedSql(rows), "utf8");
console.log(`썼음: ${OUT}\n${counts}`);
