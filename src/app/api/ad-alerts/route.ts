import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { cachedGET } from "@/lib/api-cache";
import { fetchAll } from "@/lib/db";

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

// 쿠팡 원본은 하루 수백 행(키워드 x 지면 x 파일)이라 통째로 읽으면 DB 가 막힌다.
// 2026-11-09 속도 수정: 예전엔 21일치 약 25,000행을 건수 세기(5초) 뒤 25개 질의로 동시에 읽다가
// 함수 시간 초과로 500("[object Object]")이 났고, 그동안 다른 화면까지 같이 느려졌다.
//   1순위: DB 안에서 (날짜 x 캠페인)으로 합친 함수 coupang_campaign_daily 한 번 (docs/sql/2026-11-09-perf-rpc.sql).
//   함수가 아직 없으면(PGRST202) 판단에 실제로 쓰는 날만 읽는다. judge() 는 마지막 날부터 ZERO_CONV_DAYS 일만
//   보므로 그보다 오래된 날은 결과에 영향이 없다. 건수 세기 없이 필요한 열만 1,000행씩 나눠 읽는다.
// 두 길 모두 "날짜마다 가장 늦게 읽은 파일 하나만" 규칙이 같다(키워드 탭 coupang_keyword_summary 와도 같다).
// ※ coupang_keyword_summary 는 날짜를 합쳐 버리고 캠페인 이름을 상품명으로 바꾸므로 여기 쓸 수 없다.
const COUPANG_RPC = "coupang_campaign_daily";
const FAR_FUTURE = "2999-12-31";
const JUDGE_WINDOW_DAYS = Math.max(ZERO_CONV_DAYS, 2); // 전일 대비(2일)와 무전환(ZERO_CONV_DAYS일) 중 긴 쪽

interface CoupangDayRow { date: string; campaign: string | null; spend: number | null; clicks: number | null; orders_1d: number | null }

function toCoupangSeries(rows: CoupangDayRow[]): CampaignSeries[] {
  const m = new Map<string, CampaignSeries>();
  for (const r of rows) {
    const name = r.campaign || "(캠페인 없음)";
    const s = m.get(name) || { source: "쿠팡" as const, campaign: name, brand: "너티", days: new Map() };
    const d = s.days.get(r.date) || { date: r.date, spend: 0, conv: 0, clicks: 0 };
    d.spend += Number(r.spend) || 0; d.conv += Number(r.orders_1d) || 0; d.clicks += Number(r.clicks) || 0;
    s.days.set(r.date, d);
    m.set(name, s);
  }
  return [...m.values()];
}

/** 함수가 없을 때의 길. 마지막 날을 먼저 찾고 그 날부터 JUDGE_WINDOW_DAYS 일만 읽는다. */
async function coupangRowsLean(since: string): Promise<CoupangDayRow[]> {
  const top = await supabase.from("raw_coupang_keyword").select("date").gte("date", since).order("date", { ascending: false }).limit(1);
  if (top.error) throw top.error;
  const last = top.data?.[0]?.date as string | undefined;
  if (!last) return [];
  const windowFrom = daysBefore(last, JUDGE_WINDOW_DAYS - 1);
  const from = windowFrom > since ? windowFrom : since;
  type Raw = CoupangDayRow & { file: string | null; read_at: string | null };
  const rows = await fetchAll<Raw>(
    // 날짜 순 + row_key 로 순서를 고정한다(날짜 인덱스로 범위를 좁히게).
    supabase.from("raw_coupang_keyword").select("row_key,date,campaign,spend,clicks,orders_1d,file,read_at").gte("date", from).order("date"),
    "row_key",
  );
  const latest = new Map<string, { file: string | null; at: string }>();
  for (const r of rows) {
    const at = r.read_at || "";
    const cur = latest.get(r.date);
    if (!cur || at > cur.at) latest.set(r.date, { file: r.file, at });
  }
  return rows.filter((r) => latest.get(r.date)?.file === r.file);
}

async function coupangSeries(since: string): Promise<CampaignSeries[]> {
  const rpc = await supabase.rpc(COUPANG_RPC, { p_from: since, p_to: FAR_FUTURE });
  if (!rpc.error) return toCoupangSeries((rpc.data || []) as CoupangDayRow[]);
  if (rpc.error.code !== "PGRST202") throw rpc.error; // 함수 없음만 대체 경로로. 다른 오류는 그대로 드러낸다
  return toCoupangSeries(await coupangRowsLean(since));
}

/** PostgrestError 는 Error 가 아닌 평범한 객체라 String() 하면 "[object Object]" 가 된다. */
function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as { message?: unknown; code?: unknown; details?: unknown };
    const text = [o.message, o.details, o.code ? `(${String(o.code)})` : ""].filter((x) => x && String(x).trim()).join(" ");
    return text || JSON.stringify(e);
  }
  return String(e);
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

async function getImpl() {
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
    console.error("ad-alerts error:", e);
    return NextResponse.json({ error: errorMessage(e) }, { status: 500 });
  }
}

// 5분 캐시·쓰기 후 무효화 (src/lib/api-cache.ts)
export const GET = cachedGET(getImpl, ["raw_coupang_keyword", "raw_gfa_campaign"], []);
