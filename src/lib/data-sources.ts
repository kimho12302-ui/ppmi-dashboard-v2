import { supabase } from "@/lib/supabase";
import { kstDate } from "@/lib/date";

const DAY_MS = 86400000;

// 수집 소스별 신선도 판정. /api/data-status(화면 배너)와 /api/watchdog(텔레그램 알림)이
// 같은 기준을 쓰도록 여기 한 곳에만 정의한다.

export interface SourceStatus {
  id: string;
  label: string;
  type: "auto" | "manual";
  latestDate: string | null;
  ok: boolean;
  // 하트비트 결합 상태: ok=정상 / no_activity=수집됐으나 데이터 없음(집행0) / disconnected=수집 끊김 / stale_manual=수기 미입력
  status: "ok" | "no_activity" | "disconnected" | "stale_manual";
  lastSync: string | null;
  // 최신 데이터가 기준일(어제)보다 며칠 뒤처졌는지. 데이터가 아예 없으면 null.
  staleDays: number | null;
}

async function getLatestByChannel(channel: string, brand?: string): Promise<string | null> {
  let q = supabase.from("daily_ad_spend").select("date").eq("channel", channel);
  if (brand) q = q.eq("brand", brand);
  const { data } = await q.order("date", { ascending: false }).limit(1);
  return data?.[0]?.date || null;
}

/**
 * @param nonZeroCols 이 컬럼들 중 하나라도 0보다 커야 '데이터 있음'으로 본다.
 *
 * 값이 전부 0인 행을 '있음'으로 세면 안 된다. 실제로 쿠팡 퍼널 업로드가 빈 날짜까지
 * 0으로 채워 넣는 바람에, 07-17 이후 값이 전무한데도 배너가 07-28 정상으로 표시됐다
 * (2026-07-29 확인). 수기 소스는 '행의 존재'가 아니라 '값의 존재'로 판정해야 한다.
 */
async function getLatestFunnelByChannel(
  channel: string,
  brand?: string,
  nonZeroCols?: string[]
): Promise<string | null> {
  let query = supabase.from("daily_funnel").select("date").eq("channel", channel);
  if (brand) query = query.eq("brand", brand);
  if (nonZeroCols?.length) query = query.or(nonZeroCols.map((c) => `${c}.gt.0`).join(","));
  const { data } = await query.order("date", { ascending: false }).limit(1);
  return data?.[0]?.date || null;
}

/** 광고비도 마찬가지로 0원 행을 '입력됨'으로 세지 않는다. */
async function getLatestSpendByChannel(channel: string, brand?: string): Promise<string | null> {
  let q = supabase.from("daily_ad_spend").select("date").eq("channel", channel).gt("spend", 0);
  if (brand) q = q.eq("brand", brand);
  const { data } = await q.order("date", { ascending: false }).limit(1);
  return data?.[0]?.date || null;
}

async function getLatestFromTable(table: string): Promise<string | null> {
  const { data } = await supabase.from(table).select("date").order("date", { ascending: false }).limit(1);
  return data?.[0]?.date || null;
}

const SOURCE_DEFS: { id: string; label: string; type: "auto" | "manual"; fetcher: () => Promise<string | null> }[] = [
  // Auto - API
  { id: "meta_ads", label: "Meta 광고비", type: "auto", fetcher: () => getLatestByChannel("meta") },
  { id: "google_ads", label: "Google Ads", type: "auto", fetcher: () => getLatestByChannel("google_pmax") },
  { id: "ga4", label: "GA4 (카페24 세션)", type: "auto", fetcher: () => getLatestFunnelByChannel("cafe24", undefined, ["sessions"]) },
  { id: "naver_sa", label: "네이버 검색광고", type: "auto", fetcher: () => getLatestByChannel("naver_search") },
  { id: "naver_shopping", label: "네이버 쇼핑광고", type: "auto", fetcher: () => getLatestByChannel("naver_shopping") },
  // Manual
  { id: "coupang_ads", label: "쿠팡 광고비", type: "manual", fetcher: () => getLatestSpendByChannel("coupang_ads") },
  // GFA 는 브랜드별 입력 주기가 달라 통합 최신일이 결측을 가림 (2026-07 사용성 리뷰) → 브랜드별 분리
  { id: "gfa_saip", label: "GFA (사입)", type: "manual", fetcher: () => getLatestSpendByChannel("gfa", "saip") },
  { id: "gfa_nutty", label: "GFA (너티)", type: "manual", fetcher: () => getLatestSpendByChannel("gfa", "nutty") },
  { id: "gfa_balancelab", label: "GFA (밸런스랩)", type: "manual", fetcher: () => getLatestSpendByChannel("gfa", "balancelab") },
  { id: "sales", label: "판매실적", type: "manual", fetcher: () => getLatestFromTable("daily_sales") },
  { id: "coupang_funnel", label: "쿠팡 퍼널", type: "manual", fetcher: () => getLatestFunnelByChannel("coupang", "all", ["sessions", "impressions", "cart_adds", "purchases"]) },
  { id: "smartstore_ironpet", label: "스마트스토어 (아이언펫)", type: "manual", fetcher: () => getLatestFunnelByChannel("smartstore", "all", ["sessions", "subscribers", "repurchases"]) },
  { id: "smartstore_balancelab", label: "스마트스토어 (밸런스랩)", type: "manual", fetcher: () => getLatestFunnelByChannel("smartstore", "balancelab", ["sessions", "subscribers", "repurchases"]) },
  // GA4 세션과 같은 행에 저장되므로 수기 전용 필드로만 판정한다.
  { id: "cafe24_funnel", label: "카페24 퍼널", type: "manual", fetcher: () => getLatestFunnelByChannel("cafe24", "all", ["cart_adds", "purchases", "repurchases"]) },
];

// 하트비트 소스명 매핑 (집행0 vs 연결끊김 구분용)
const HB_KEY: Record<string, string> = {
  meta_ads: "meta",
  google_ads: "google_ads",
  naver_sa: "naver_sa",
  naver_shopping: "naver_sa",
  ga4: "ga4_campaigns",
};

export async function getSourceStatuses(): Promise<{ sources: SourceStatus[]; referenceDate: string }> {
  const yesterday = kstDate(-1);

  const { data: hbData } = await supabase.from("sync_heartbeat").select("source,last_success");
  const hbMap = new Map((hbData || []).map((h) => [h.source as string, h]));
  const recentThreshold = kstDate(-2);

  const sources = await Promise.all(
    SOURCE_DEFS.map(async (def) => {
      let latestDate: string | null = null;
      try {
        latestDate = await def.fetcher();
      } catch {
        latestDate = null;
      }
      const ok = !!latestDate && latestDate >= yesterday;
      const hb = hbMap.get(HB_KEY[def.id] || "");
      const lastSync = hb?.last_success ? String(hb.last_success).slice(0, 10) : null;
      const pipelineRan = !!lastSync && lastSync >= recentThreshold;

      let status: SourceStatus["status"];
      if (def.type === "manual") status = ok ? "ok" : "stale_manual";
      else if (ok) status = "ok";
      else if (pipelineRan) status = "no_activity"; // 수집은 됨 → 집행/활동 0
      else status = "disconnected"; // 수집 자체가 끊김

      const staleDays = latestDate
        ? Math.max(0, Math.round((Date.parse(yesterday) - Date.parse(latestDate)) / DAY_MS))
        : null;

      return { id: def.id, label: def.label, type: def.type, latestDate, ok, status, lastSync, staleDays };
    })
  );

  return { sources, referenceDate: yesterday };
}
