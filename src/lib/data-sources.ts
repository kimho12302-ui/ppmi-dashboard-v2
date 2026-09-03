import { supabase } from "@/lib/supabase";
import { kstDate } from "@/lib/date";

const DAY_MS = 86400000;

// 수집 소스별 신선도 판정. /api/data-status(화면 상태 레일)와 /api/watchdog(텔레그램 알림)이
// 같은 기준을 쓰도록 여기 한 곳에만 정의한다.
//
// ★ 2026-08-18 재설계: 소스를 3분류(mode)로 가른다.
//   auto     자동 수집 — 늦으면 고장. 사람이 할 일이 없다. 눈에 띄어야 한다.
//   manual   수기 입력 — 비면 사람이 넣어야 한다. 할 일이지 고장이 아니다.
//   inactive 미운영    — 애초에 안 돌리는 채널. 경고가 아니다. 조용해야 한다.
//
//   이전에는 14개가 전부 한 덩어리라 "구글 애즈 D+96"(회사가 집행을 안 함)이
//   실제 고장인 meta 토큰 만료와 같은 무게로 표시됐다. 진짜 고장이 노이즈에 묻혔다.

export type SourceMode = "auto" | "manual" | "inactive";
/** 왜 고장인지. 조치가 각각 다르므로 화면에 그대로 노출한다. */
export type BreakReason = "auth_failed" | "collector_stopped" | "data_frozen" | "unknown";

export interface SourceStatus {
  id: string;
  label: string;
  /** 3분류. 화면 그룹핑·경고 강도의 기준. */
  mode: SourceMode;
  /** 하위호환(watchdog 등): inactive 는 auto 로 접힌다. */
  type: "auto" | "manual";
  latestDate: string | null;
  ok: boolean;
  /**
   * ok           정상
   * broken       자동 수집인데 늦음 = 고장 (reason 으로 원인 구분)
   * input_needed 수기 입력인데 비었음 = 사람이 할 일
   * inactive     미운영 (경고 아님)
   */
  status: "ok" | "broken" | "input_needed" | "inactive";
  reason: BreakReason | null;
  /** 화면에 그대로 쓰는 조치 문구. */
  action: string | null;
  lastSync: string | null;
  /** 수집기가 마지막으로 "돌았다"고 보고한 시각(날짜). last_success 와 다르게 실패 실행도 포함. */
  lastRun: string | null;
  /** 수집기가 스스로 보고한 최신 데이터 날짜. 이게 lastRun 보다 한참 뒤처지면 죽은 수집기다. */
  heartbeatDataDate: string | null;
  /** 최신 데이터가 기준일(어제)보다 며칠 뒤처졌는지. 데이터가 아예 없으면 null. */
  staleDays: number | null;
  /**
   * 이 소스가 기여하는 숫자를 지금 믿을 수 있는가.
   * false 면 화면은 그 숫자를 0 으로 찍으면 안 되고 '측정 불가'로 표기해야 한다.
   * (meta 토큰 만료 때 광고비 0원이 "집행 안 함"으로 읽힌 사고)
   */
  measurable: boolean;
  /** 미운영 사유. mode=inactive 일 때만. */
  inactiveNote: string | null;
  /** 이 소스가 채우는 대시보드 지표. 신뢰도 배지를 붙일 때 쓴다. */
  metrics: MetricKey[];
}

/** 소스 고장이 어떤 화면 숫자를 오염시키는지. */
export type MetricKey = "adSpend" | "roas" | "revenue" | "funnel";

/**
 * 미운영 소스. 고장이 아니라 "애초에 안 돌린다".
 * 여기서 빼면 다시 빨간 경고로 돌아온다. 재개하면 이 목록에서 지운다.
 */
const INACTIVE_SOURCES: Record<string, { since: string; note: string }> = {
  google_ads: {
    since: "2026-05-14",
    note: "구글 애즈 미집행 (2026-05-14 마지막 집행). 재개 시 이 목록에서 해제",
  },
};

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

interface SourceDef {
  id: string;
  label: string;
  type: "auto" | "manual";
  fetcher: () => Promise<string | null>;
  metrics: MetricKey[];
  /** 수기 입력 폼으로 보내는 링크. mode=manual 인데 없으면 화면에 '입력 위치 미정'으로 뜬다. */
  entry?: string;
  /** 수기 입력 안내 문구. */
  entryLabel?: string;
}

const SOURCE_DEFS: SourceDef[] = [
  // Auto - API
  { id: "meta_ads", label: "Meta 광고비", type: "auto", metrics: ["adSpend", "roas"], fetcher: () => getLatestByChannel("meta") },
  { id: "google_ads", label: "Google Ads", type: "auto", metrics: ["adSpend", "roas"], fetcher: () => getLatestByChannel("google_pmax") },
  { id: "ga4", label: "GA4 (카페24 세션)", type: "auto", metrics: ["funnel"], fetcher: () => getLatestFunnelByChannel("cafe24", undefined, ["sessions"]) },
  { id: "naver_sa", label: "네이버 검색광고", type: "auto", metrics: ["adSpend", "roas"], fetcher: () => getLatestByChannel("naver_search") },
  { id: "naver_shopping", label: "네이버 쇼핑광고", type: "auto", metrics: ["adSpend", "roas"], fetcher: () => getLatestByChannel("naver_shopping") },
  // Manual — API 가 없어서 사람이 넣는 게 정상 운영이다. 고장이 아니다.
  { id: "coupang_ads", label: "쿠팡 광고비", type: "manual", metrics: ["adSpend"], entry: "/settings?tab=upload", entryLabel: "엑셀 업로드", fetcher: () => getLatestSpendByChannel("coupang_ads") },
  // GFA 는 브랜드별 입력 주기가 달라 통합 최신일이 결측을 가림 (2026-07 사용성 리뷰) → 브랜드별 분리
  { id: "gfa_saip", label: "GFA (사입)", type: "manual", metrics: ["adSpend"], entry: "/settings?tab=daily#gfa", entryLabel: "GFA 광고비 입력", fetcher: () => getLatestSpendByChannel("gfa", "saip") },
  { id: "gfa_nutty", label: "GFA (너티)", type: "manual", metrics: ["adSpend"], entry: "/settings?tab=daily#gfa", entryLabel: "GFA 광고비 입력", fetcher: () => getLatestSpendByChannel("gfa", "nutty") },
  { id: "gfa_balancelab", label: "GFA (밸런스랩)", type: "manual", metrics: ["adSpend"], entry: "/settings?tab=daily#gfa", entryLabel: "GFA 광고비 입력", fetcher: () => getLatestSpendByChannel("gfa", "balancelab") },
  { id: "sales", label: "판매실적", type: "manual", metrics: ["revenue"], entry: "/settings?tab=upload", entryLabel: "판매 엑셀 업로드", fetcher: () => getLatestFromTable("daily_sales") },
  { id: "coupang_funnel", label: "쿠팡 퍼널", type: "manual", metrics: ["funnel"], entry: "/settings?tab=upload", entryLabel: "엑셀 업로드", fetcher: () => getLatestFunnelByChannel("coupang", "all", ["sessions", "impressions", "cart_adds", "purchases"]) },
  { id: "smartstore_ironpet", label: "스마트스토어 (아이언펫)", type: "manual", metrics: ["funnel"], entry: "/settings?tab=daily#smartstore", entryLabel: "스마트스토어 퍼널 입력", fetcher: () => getLatestFunnelByChannel("smartstore", "all", ["sessions", "subscribers", "repurchases"]) },
  { id: "smartstore_balancelab", label: "스마트스토어 (밸런스랩)", type: "manual", metrics: ["funnel"], entry: "/settings?tab=daily#smartstore", entryLabel: "스마트스토어 퍼널 입력", fetcher: () => getLatestFunnelByChannel("smartstore", "balancelab", ["sessions", "subscribers", "repurchases"]) },
  // GA4 세션과 같은 행에 저장되므로 수기 전용 필드로만 판정한다.
  { id: "cafe24_funnel", label: "카페24 퍼널", type: "manual", metrics: ["funnel"], entry: "/settings?tab=daily#cafe24", entryLabel: "카페24 퍼널 입력", fetcher: () => getLatestFunnelByChannel("cafe24", "all", ["cart_adds", "purchases", "repurchases"]) },
];

// 하트비트 소스명 매핑 (고장 원인 구분용)
const HB_KEY: Record<string, string> = {
  meta_ads: "meta",
  google_ads: "google_ads",
  naver_sa: "naver_sa",
  naver_shopping: "naver_sa",
  ga4: "ga4_campaigns",
};

/** 수집기가 스스로 보고한 최신 데이터가 이 일수 이상 뒤처지면 '죽은 수집기'로 본다. */
const FROZEN_THRESHOLD_DAYS = 7;
/** watchdog 이 자기 알림 기록용으로 쓰는 의사 소스. 수집기가 아니다. */
const PSEUDO_HB_SOURCES = new Set(["watchdog_manual_alert"]);

interface HeartbeatRow {
  source: string;
  last_run: string | null;
  last_success: string | null;
  latest_data_date: string | null;
  rows_written: number | null;
  ok: boolean | null;
  note: string | null;
}

/** 수집기 자체 건강 상태. SOURCE_DEFS 에 없는 수집기(cafe24_sales 등)도 여기서 드러난다. */
export interface CollectorHealth {
  source: string;
  lastRun: string | null;
  lastSuccess: string | null;
  latestDataDate: string | null;
  rowsWritten: number | null;
  ok: boolean;
  /** running=정상, frozen=돌지만 데이터가 안 늘어남, failing=ok:false, stopped=실행 자체가 멈춤 */
  health: "running" | "frozen" | "failing" | "stopped";
  /** latest_data_date 가 어제보다 며칠 뒤처졌는지 */
  dataLagDays: number | null;
}

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(a) - Date.parse(b)) / DAY_MS);
}

function classifyCollector(hb: HeartbeatRow, yesterday: string, staleRunCutoff: string): CollectorHealth {
  const lastRun = hb.last_run ? String(hb.last_run).slice(0, 10) : null;
  const lastSuccess = hb.last_success ? String(hb.last_success).slice(0, 10) : null;
  const latestDataDate = hb.latest_data_date ? String(hb.latest_data_date).slice(0, 10) : null;
  const dataLagDays = latestDataDate ? Math.max(0, dayDiff(yesterday, latestDataDate)) : null;
  const ranRecently = !!lastRun && lastRun >= staleRunCutoff;

  let health: CollectorHealth["health"];
  if (hb.ok === false) health = "failing";
  else if (!ranRecently) health = "stopped";
  // ★ ok:true 인데 데이터가 안 늘어나는 경우. cafe24_sales 가 매일 성공 보고하면서
  //   최신 데이터는 2026-03-10 에 멈춰 있었다(2026-08-18 실측). 정상으로 보고하는 죽은 수집기.
  else if (dataLagDays !== null && dataLagDays > FROZEN_THRESHOLD_DAYS) health = "frozen";
  else health = "running";

  return {
    source: hb.source,
    lastRun,
    lastSuccess,
    latestDataDate,
    rowsWritten: hb.rows_written ?? null,
    ok: hb.ok !== false,
    health,
    dataLagDays,
  };
}

const REASON_ACTION: Record<BreakReason, string> = {
  auth_failed: "토큰·인증 만료. 재발급 후 백필 필요",
  collector_stopped: "수집 워크플로가 멈춤. daily-sync 재실행 필요",
  data_frozen: "수집은 도는데 새 데이터가 안 들어옴. 수집기 점검 필요",
  unknown: "원인 미확인. 수집 로그 확인 필요",
};

export async function getSourceStatuses(): Promise<{
  sources: SourceStatus[];
  collectors: CollectorHealth[];
  referenceDate: string;
}> {
  const yesterday = kstDate(-1);
  const staleRunCutoff = kstDate(-2);

  const { data: hbData } = await supabase
    .from("sync_heartbeat")
    .select("source,last_run,last_success,latest_data_date,rows_written,ok,note");
  const hbRows = (hbData || []) as HeartbeatRow[];
  const hbMap = new Map(hbRows.map((h) => [h.source, h]));

  const collectors = hbRows
    .filter((h) => !PSEUDO_HB_SOURCES.has(h.source))
    .map((h) => classifyCollector(h, yesterday, staleRunCutoff))
    .sort((a, b) => (a.health === "running" ? 1 : 0) - (b.health === "running" ? 1 : 0));

  const sources = await Promise.all(
    SOURCE_DEFS.map(async (def): Promise<SourceStatus> => {
      let latestDate: string | null = null;
      try {
        latestDate = await def.fetcher();
      } catch {
        latestDate = null;
      }
      const ok = !!latestDate && latestDate >= yesterday;
      const hb = hbMap.get(HB_KEY[def.id] || "");
      const lastSync = hb?.last_success ? String(hb.last_success).slice(0, 10) : null;
      const lastRun = hb?.last_run ? String(hb.last_run).slice(0, 10) : null;
      const heartbeatDataDate = hb?.latest_data_date ? String(hb.latest_data_date).slice(0, 10) : null;
      const inactive = INACTIVE_SOURCES[def.id];

      const mode: SourceMode = inactive ? "inactive" : def.type;

      let status: SourceStatus["status"];
      let reason: BreakReason | null = null;

      if (mode === "inactive") {
        status = "inactive";
      } else if (ok) {
        status = "ok";
      } else if (mode === "manual") {
        status = "input_needed";
      } else {
        status = "broken";
        // ★ heartbeat 의 ok:false 를 읽는다. 이전 코드는 타임스탬프만 봐서
        //   토큰 인증 실패가 "수집은 됐고 집행이 0"(no_activity)으로 표시됐다.
        //   측정 불가를 0 으로 표기한 셈이고, 사장님이 "메타를 안 돌렸나"로 읽었다.
        if (hb?.ok === false) reason = "auth_failed";
        else if (!lastRun || lastRun < staleRunCutoff) reason = "collector_stopped";
        else if (heartbeatDataDate && dayDiff(yesterday, heartbeatDataDate) > FROZEN_THRESHOLD_DAYS) reason = "data_frozen";
        else reason = "unknown";
      }

      const staleDays = latestDate ? Math.max(0, dayDiff(yesterday, latestDate)) : null;

      return {
        id: def.id,
        label: def.label,
        mode,
        type: def.type,
        latestDate,
        ok,
        status,
        reason,
        action:
          status === "broken"
            ? REASON_ACTION[reason || "unknown"]
            : status === "input_needed"
            ? def.entryLabel || "설정 > 일일 입력에서 입력"
            : null,
        lastSync,
        lastRun,
        heartbeatDataDate,
        staleDays,
        // 미운영은 '측정 불가'가 아니다. 실제로 0 이 맞다.
        measurable: status !== "broken",
        inactiveNote: inactive ? `${inactive.note}` : null,
        metrics: def.metrics,
      };
    })
  );

  return { sources, collectors, referenceDate: yesterday };
}

/** 수기 입력 소스의 폼 진입 경로. 화면에서 '그 자리에서 입력으로 보내기' 용. */
export function sourceEntryLink(id: string): string | null {
  return SOURCE_DEFS.find((d) => d.id === id)?.entry || null;
}

/** 미운영 소스 id 집합. 결측 목록에서 걸러낼 때 쓴다. */
export const INACTIVE_SOURCE_IDS = new Set(Object.keys(INACTIVE_SOURCES));
export { INACTIVE_SOURCES };
