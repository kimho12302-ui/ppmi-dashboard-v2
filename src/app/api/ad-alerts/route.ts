import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// 광고 이상 신호. 2026-09-18 신설.
// 예전 aside 루틴(네이버 광고 일별 리포트)이 내던 판단을 대시보드로 옮겼다. 루틴은 김호가 껐다.
// 비즈머니 잔액은 네이버가 따로 알려 주므로 넣지 않는다(김호).
//
// 원천은 캠페인 단위 원천층이다. 브랜드 합계만 보면 어느 캠페인이 문제인지 안 보인다.
//   GFA  : raw_gfa_campaign (계정 × 날짜 × 캠페인)
//   쿠팡 : raw_coupang_keyword 를 캠페인으로 합침(날짜마다 가장 늦게 읽은 파일만, 키워드 탭과 같은 규칙)
//
// 판단 규칙. 숫자를 바꾸려면 여기만 고친다.
const SPIKE_RATIO = 0.5;       // 전일 대비 ±50% 넘게 움직이면
const SPIKE_MIN_WON = 10000;   // 그리고 차이가 이만큼 넘을 때만(작은 캠페인의 들쭉날쭉은 소음)
const ZERO_CONV_DAYS = 7;      // 최근 이만큼의 날 동안
const ZERO_CONV_MIN_WON = 10000; // 이만큼 넘게 썼는데 전환이 0 이면

interface Daily { date: string; spend: number; conv: number; clicks: number }
interface CampaignSeries { source: "GFA" | "쿠팡"; campaign: string; brand: string; days: Map<string, Daily> }

const daysBefore = (iso: string, n: number) => new Date(Date.parse(iso) - n * 86400000).toISOString().slice(0, 10);

async function gfaSeries(since: string): Promise<CampaignSeries[]> {
  const { data, error } = await supabase
    .from("raw_gfa_campaign").select("date,campaign,brand,spend,clicks,conversions").gte("date", since).limit(5000);
  if (error) throw error;
  const m = new Map<string, CampaignSeries>();
  for (const r of data || []) {
    const s = m.get(r.campaign) || { source: "GFA" as const, campaign: r.campaign, brand: r.brand || "", days: new Map() };
    const d = s.days.get(r.date) || { date: r.date, spend: 0, conv: 0, clicks: 0 };
    d.spend += Number(r.spend) || 0; d.conv += Number(r.conversions) || 0; d.clicks += Number(r.clicks) || 0;
    s.days.set(r.date, d);
    m.set(r.campaign, s);
  }
  return [...m.values()];
}

async function coupangSeries(since: string): Promise<CampaignSeries[]> {
  const cols = "row_key,date,campaign,spend,clicks,orders_1d,file,read_at";
  const { count, error } = await supabase.from("raw_coupang_keyword").select("row_key", { count: "exact", head: true }).gte("date", since);
  if (error) throw error;
  const pages = Math.ceil((count || 0) / 1000);
  const res = await Promise.all(Array.from({ length: pages }, (_, i) =>
    supabase.from("raw_coupang_keyword").select(cols).gte("date", since).order("row_key").range(i * 1000, i * 1000 + 999)));
  const rows: { date: string; campaign: string | null; spend: number; clicks: number; orders_1d: number; file: string | null; read_at: string | null }[] = [];
  for (const r of res) { if (r.error) throw r.error; rows.push(...(r.data || [])); }
  if (rows.length !== (count || 0)) throw new Error(`쿠팡 행 수 불일치 ${count}/${rows.length}`);

  const latest = new Map<string, { file: string | null; at: string }>();
  for (const r of rows) {
    const at = r.read_at || "";
    const cur = latest.get(r.date);
    if (!cur || at > cur.at) latest.set(r.date, { file: r.file, at });
  }
  const m = new Map<string, CampaignSeries>();
  for (const r of rows) {
    if (latest.get(r.date)?.file !== r.file) continue;
    const name = r.campaign || "(캠페인 없음)";
    const s = m.get(name) || { source: "쿠팡" as const, campaign: name, brand: "너티", days: new Map() };
    const d = s.days.get(r.date) || { date: r.date, spend: 0, conv: 0, clicks: 0 };
    d.spend += Number(r.spend) || 0; d.conv += Number(r.orders_1d) || 0; d.clicks += Number(r.clicks) || 0;
    s.days.set(r.date, d);
    m.set(name, s);
  }
  return [...m.values()];
}

function judge(series: CampaignSeries[]) {
  const asOf = series.flatMap((s) => [...s.days.keys()]).sort().pop() || null;
  if (!asOf) return { asOf, spikes: [], zeroConv: [] };
  const prevDay = daysBefore(asOf, 1);
  const windowFrom = daysBefore(asOf, ZERO_CONV_DAYS - 1);

  const spikes = series.flatMap((s) => {
    const today = s.days.get(asOf)?.spend ?? 0;
    const prev = s.days.get(prevDay)?.spend ?? 0;
    const diff = today - prev;
    if (Math.abs(diff) < SPIKE_MIN_WON) return [];
    const ratio = prev > 0 ? diff / prev : Infinity;
    if (Math.abs(ratio) <= SPIKE_RATIO) return [];
    return [{ source: s.source, campaign: s.campaign, brand: s.brand, date: asOf, spend: today, prev, changePct: Number.isFinite(ratio) ? Math.round(ratio * 100) : null }];
  }).sort((a, b) => Math.abs(b.spend - b.prev) - Math.abs(a.spend - a.prev));

  const zeroConv = series.flatMap((s) => {
    const win = [...s.days.values()].filter((d) => d.date >= windowFrom && d.date <= asOf);
    const spend = win.reduce((a, d) => a + d.spend, 0);
    const conv = win.reduce((a, d) => a + d.conv, 0);
    const clicks = win.reduce((a, d) => a + d.clicks, 0);
    return spend >= ZERO_CONV_MIN_WON && conv === 0 ? [{ source: s.source, campaign: s.campaign, brand: s.brand, from: windowFrom, to: asOf, spend, clicks }] : [];
  }).sort((a, b) => b.spend - a.spend);

  return { asOf, spikes, zeroConv };
}

export async function GET() {
  try {
    // 기준일을 모르므로 넉넉히 21일을 받아 각 원천의 마지막 날부터 거꾸로 센다.
    const since = daysBefore(new Date().toISOString().slice(0, 10), 21);
    const [gfa, coupang] = await Promise.all([gfaSeries(since), coupangSeries(since)]);
    const g = judge(gfa);
    const c = judge(coupang);
    return NextResponse.json(
      {
        rules: { spikeRatio: SPIKE_RATIO, spikeMinWon: SPIKE_MIN_WON, zeroConvDays: ZERO_CONV_DAYS, zeroConvMinWon: ZERO_CONV_MIN_WON },
        asOf: { gfa: g.asOf, coupang: c.asOf },
        spikes: [...g.spikes, ...c.spikes],
        zeroConv: [...g.zeroConv, ...c.zeroConv],
        conversionBasis: { gfa: "전환수", coupang: "주문수(1일)" },
      },
      { headers: { "Cache-Control": "s-maxage=600, stale-while-revalidate=3600" } },
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
