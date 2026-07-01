const B = "https://ppmi-dashboard-kappa.vercel.app";
const J = { from: "2026-06-01", to: "2026-06-27" };   // 6월 MTD
const M = { from: "2026-05-01", to: "2026-05-31" };   // 5월 비교
const g = async (p) => { const r = await fetch(B + p); return r.ok ? r.json() : { __err: r.status }; };
const won = (n) => Math.round(n || 0).toLocaleString();

const [dJun, dMay, cgJun, cgMay, pac, fun] = await Promise.all([
  g(`/api/dashboard?brand=all&from=${J.from}&to=${J.to}`),
  g(`/api/dashboard?brand=all&from=${M.from}&to=${M.to}`),
  g(`/api/channel-groups?from=${J.from}&to=${J.to}&brand=all`),
  g(`/api/channel-groups?from=${M.from}&to=${M.to}&brand=all`),
  g(`/api/pacing?brand=all&from=${J.from}&to=${J.to}`),
  g(`/api/funnel?brand=all&from=${J.from}&to=${J.to}`),
]);

const k = dJun.kpi || {}, km = dMay.kpi || {};
console.log("==== 전사 KPI (6월 MTD vs 5월 전체) ====");
console.log(`매출      6월 ${won(k.revenue)}  /  5월 ${won(km.revenue)}`);
console.log(`광고비    6월 ${won(k.adSpend)}  /  5월 ${won(km.adSpend)}`);
console.log(`ROAS(매체) 6월 ${(k.roas||0).toFixed(2)}x  /  5월 ${(km.roas||0).toFixed(2)}x`);
console.log(`MER       6월 ${(k.mer||0).toFixed(2)}x  /  5월 ${(km.mer||0).toFixed(2)}x`);
console.log(`주문      6월 ${won(k.orders)}  /  5월 ${won(km.orders)}    AOV 6월 ${won(k.aov)}`);
console.log(`이익      6월 ${won(k.profit)}  /  5월 ${won(km.profit)}`);

console.log("\n==== 브랜드별 매출 (6월) ====");
for (const b of (dJun.brandRevenue || [])) console.log(`  ${b.brand.padEnd(11)} 매출 ${won(b.revenue).padStart(12)}  주문 ${b.orders}`);
console.log("salesByChannel:", JSON.stringify(dJun.salesByChannel || []));

console.log("\n==== 채널 성과 (6월: 매출÷그채널광고비) ====");
for (const x of (cgJun.groups || [])) console.log(`  ${x.label.padEnd(20)} 매출 ${won(x.revenue).padStart(11)} / 광고비 ${won(x.adSpend).padStart(9)} = ROAS ${x.roas.toFixed(2)}x, 비중 ${x.adRatio.toFixed(1)}%`);
console.log("  --- 5월 비교 ---");
for (const x of (cgMay.groups || [])) console.log(`  ${x.label.padEnd(20)} ROAS ${x.roas.toFixed(2)}x, 광고비 ${won(x.adSpend)}`);

console.log("\n==== 채널 광고비 구성 (6월, sub) ====");
for (const x of (cgJun.groups || [])) console.log(`  ${x.label}: ` + (x.subAds||[]).map(s=>`${s.label} ${won(s.spend)}`).join(", "));

console.log("\n==== 페이싱 (6월 목표 대비) ====");
if (pac.target) {
  console.log(`날짜진행 ${((pac.dateProgress||0)*100).toFixed(0)}%`);
  console.log(`매출  실적 ${won(pac.actual?.revenue)} / 목표 ${won(pac.target?.revenue)} = ${((pac.actual?.revenue/pac.target?.revenue)*100||0).toFixed(0)}%`);
  console.log(`광고비 소진 ${won(pac.actual?.ad)} / 목표 ${won(pac.target?.ad)} = ${((pac.actual?.ad/pac.target?.ad)*100||0).toFixed(0)}%, 광고비비중 실제 ${((pac.actual?.adRatio||0)*100).toFixed(0)}% vs 목표 ${((pac.target?.adRatio||0)*100).toFixed(0)}%`);
  console.log("perBrand:");
  for (const pb of (pac.perBrand||[])) console.log(`  ${pb.brand.padEnd(11)} 매출달성 ${(pb.revAchievement*100).toFixed(0)}% (실 ${won(pb.actualRevenue)}/목 ${won(pb.targetRevenue)}), 광고소진 ${(pb.adConsumption*100).toFixed(0)}%, ROAS ${(pb.actualRoas||0).toFixed(1)}x/목${(pb.targetRoas||0).toFixed(1)}, 광고비중 ${(pb.actualAdRatio*100).toFixed(0)}%/목${(pb.targetAdRatio*100).toFixed(0)}%`);
}

console.log("\n==== 퍼널 (6월) ====");
for (const s of (fun.funnel || [])) console.log(`  ${s.name}: ${won(s.value)}${s.rate!=null?`  (${s.rate.toFixed(1)}%)`:""}`);

// 채널 일별 추이 마지막주 vs 첫주 (효율 추세)
const ser = cgJun.series || [];
if (ser.length) {
  const sum = (arr, g) => arr.reduce((a, r) => ({ rev: a.rev + (r[g]?.revenue||0), ad: a.ad + (r[g]?.adSpend||0) }), { rev: 0, ad: 0 });
  const wk1 = ser.slice(0, 7), wk4 = ser.slice(-7);
  console.log("\n==== 채널 효율 추세 (첫주 vs 최근7일 ROAS) ====");
  for (const g2 of ["naver", "jasamol", "coupang"]) {
    const a = sum(wk1, g2), b = sum(wk4, g2);
    console.log(`  ${g2}: 첫주 ${a.ad>0?(a.rev/a.ad).toFixed(1):"-"}x → 최근 ${b.ad>0?(b.rev/b.ad).toFixed(1):"-"}x`);
  }
}
