import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = {};
for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

// 1) naver ad spend rows 06-07 ~ 06-12
const { data: ad } = await sb.from("daily_ad_spend")
  .select("date,brand,channel,spend,impressions,clicks")
  .gte("date", "2026-06-07").lte("date", "2026-06-12")
  .like("channel", "naver%").order("date");
console.log("=== naver* daily_ad_spend 06-07~06-12 ===");
const byDateCh = {};
for (const r of ad || []) {
  const k = `${r.date} ${r.channel}`;
  byDateCh[k] = byDateCh[k] || { spend: 0, n: 0 };
  byDateCh[k].spend += Number(r.spend || 0); byDateCh[k].n++;
}
for (const k of Object.keys(byDateCh).sort()) console.log(`  ${k.padEnd(28)} spend=${byDateCh[k].spend} rows=${byDateCh[k].n}`);
if (!ad || ad.length === 0) console.log("  (naver 행 자체가 없음)");

// 2) ALL channels present per date (to see what DID sync) 06-10~06-12
const { data: all } = await sb.from("daily_ad_spend").select("date,channel,spend")
  .gte("date", "2026-06-10").lte("date", "2026-06-12");
const dch = {};
for (const r of all || []) { dch[r.date] = dch[r.date] || new Set(); dch[r.date].add(r.channel); }
console.log("\n=== 날짜별 존재 채널 (daily_ad_spend) ===");
for (const d of Object.keys(dch).sort()) console.log(`  ${d}: ${[...dch[d]].sort().join(", ")}`);

// 3) sync heartbeat
for (const t of ["sync_heartbeat", "sync_log", "collection_heartbeat"]) {
  const { data, error } = await sb.from(t).select("*").order("last_success", { ascending: false }).limit(30);
  if (!error) {
    console.log(`\n=== ${t} ===`);
    for (const r of data || []) console.log("  ", JSON.stringify(r));
    break;
  }
}
