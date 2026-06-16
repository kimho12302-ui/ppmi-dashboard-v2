const BASE = "https://ppmi-dashboard-kappa.vercel.app";
const MTD_FROM = "2026-06-01", YDAY = "2026-06-11"; // 어제(최신 완성일)
async function j(p) { const r = await fetch(BASE + p); return r.ok ? r.json() : { __err: r.status, __t: await r.text() }; }

const [ins, dash, pac, cg] = await Promise.all([
  j(`/api/insights?from=${MTD_FROM}&to=${YDAY}&brand=all`),
  j(`/api/dashboard?brand=all&from=${MTD_FROM}&to=${YDAY}`),
  j(`/api/pacing?brand=all&from=${MTD_FROM}&to=${YDAY}`),
  j(`/api/channel-groups?from=${MTD_FROM}&to=${YDAY}`),
]);

console.log("==== INSIGHTS API ====");
console.log(JSON.stringify(ins, null, 1).slice(0, 2500));

console.log("\n==== DASHBOARD KPI (MTD 06-01~11) ====");
if (dash.kpi) {
  const k = dash.kpi;
  console.log(JSON.stringify({
    revenue: k.revenue, revenuePrev: k.revenuePrev, adSpend: k.adSpend, miscCost: k.miscCost,
    roas: k.roas, mer: k.mer, orders: k.orders, profit: k.profit, aov: k.aov,
  }, null, 1));
}
console.log("anomalies:", JSON.stringify(dash.anomalies || []));
console.log("brandRevenue:", JSON.stringify(dash.brandRevenue || dash.kpi?.brandRevenue || "n/a"));
console.log("salesByChannel:", JSON.stringify(dash.salesByChannel || "n/a"));

console.log("\n==== PACING (이번달 목표대비) ====");
console.log(JSON.stringify({
  headline: pac.headline || pac.summary || null,
  pace: pac.pace, dateProgress: pac.dateProgress,
  target: pac.target, actual: pac.actual, remaining: pac.remaining, perBrand: pac.perBrand,
}, null, 1).slice(0, 2200));

console.log("\n==== CHANNEL GROUPS (채널별 ROAS, 원단위) ====");
for (const g of cg.groups || []) {
  console.log(`  ${g.label}: 매출 ${Math.round(g.revenue).toLocaleString()} / 광고비 ${Math.round(g.adSpend).toLocaleString()} = ROAS ${g.roas.toFixed(2)}x, 광고비비중 ${g.adRatio.toFixed(1)}%, 전기간Δ ROAS ${g.roasDelta==null?"-":g.roasDelta.toFixed(0)+"%"}`);
}
if (cg.total) console.log(`  합계: 매출 ${Math.round(cg.total.revenue).toLocaleString()} / 광고비 ${Math.round(cg.total.adSpend).toLocaleString()} = ROAS ${cg.total.roas.toFixed(2)}x`);
