-- 2026-11-10 김호: 고네이티브 스몰브리드 40g 4종은 무상 샘플이라 원가 0 이 맞다.
-- 첫 SQL(2026-11-10-inventory.sql)은 원가 > 0 만 받게 만들어서 0 을 넣을 수 없었다. 이미 실행한 DB 에만 이 파일을 실행한다.
-- 여러 번 실행해도 안전하다.
alter table inventory_costs drop constraint if exists inventory_costs_cost_check;
alter table inventory_costs add constraint inventory_costs_cost_check check (cost >= 0);

insert into inventory_costs (cost_key, sku_no, product_name, cost, source, note) values
  ('36242036355747', '36242036355747', '[사입][고네이티브]스몰브리드 독 청어 40g', 0, 'sheet:고네이티브!R8', '무상 샘플 (김호 11-10)'),
  ('46934483705856', '46934483705856', '[사입][고네이티브]스몰브리드 독 치킨 40g', 0, 'sheet:고네이티브!R9', '무상 샘플 (김호 11-10)'),
  ('20469262200289', '20469262200289', '[사입][고네이티브]스몰브리드 독 오리 40g', 0, 'sheet:고네이티브!R10', '무상 샘플 (김호 11-10)'),
  ('26213689210292', '26213689210292', '[사입][고네이티브]스몰브리드 독 연어 40g', 0, 'sheet:고네이티브!R11', '무상 샘플 (김호 11-10)')
on conflict (cost_key) do nothing;
