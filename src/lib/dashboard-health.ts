import type { SourceStatus, CollectorHealth, MetricKey } from "@/lib/data-sources";

// 「대시보드 상태」 화면(/status) 전용 판정. 2026-11-06 신설.
//
// 질문 하나에 답한다: "지금 대시보드 숫자를 믿어도 되나".
// 원재료는 이미 있는 두 곳이다.
//   /api/data-status 의 소스별 신선도(@/lib/data-sources) + sync_heartbeat 수집기 상태
//   /api/ops-status 의 collector 섹션(로컬 관제판이 aside 수집기 결과를 올린 것)
// 여기서는 그 둘을 합치고, '고장처럼 보이지만 고장이 아닌 것'을 걸러 낸다.
//
// ★ 공유 모듈(data-sources.ts)은 watchdog·텔레그램과 같이 쓰므로 고치지 않는다.
//   이 화면에서만 필요한 예외(의도 중단·옛 수집기·판매 동기화 지연)는 이 파일에만 둔다.

export type Level = "ok" | "warn" | "broken" | "paused";

export interface OpsCollectorItem {
  item_key: string;
  label: string;
  signal: "ok" | "warn" | "fail" | "unknown";
  summary: string | null;
  last_at: string | null;
  reported_at: string | null;
}

export interface HeartbeatNote {
  source: string;
  note: string | null;
  last_run: string | null;
}

export interface Issue {
  key: string;
  level: "broken" | "warn";
  title: string;
  /** 문제가 시작된 날(데이터가 끊긴 첫 날 등). 모르면 null */
  since: string | null;
  impact: string;
  /** 원인으로 기록된 문장(관제판·하트비트가 남긴 것 그대로). 추정한 원인은 넣지 않는다 */
  cause: string | null;
  action: string;
  link: string | null;
}

export interface SourceRow {
  id: string;
  label: string;
  kind: string;
  latestDate: string | null;
  level: Level;
  verdict: string;
  note: string;
}

export interface CollectorRow {
  source: string;
  label: string;
  lastRun: string | null;
  latestDataDate: string | null;
  level: Level;
  verdict: string;
  note: string;
}

export interface InputRow {
  id: string;
  label: string;
  latestDate: string | null;
  link: string;
}

export interface DashboardHealth {
  referenceDate: string;
  counts: { broken: number; warn: number; ok: number; paused: number };
  issues: Issue[];
  sources: SourceRow[];
  collectors: CollectorRow[];
  dailySync: { lastRun: string | null; level: Level; verdict: string; note: string };
  inputs: InputRow[];
  opsReportedAt: string | null;
}

const DAY_MS = 86400000;
const nextDay = (d: string) => new Date(Date.parse(d) + DAY_MS).toISOString().slice(0, 10);
const day = (iso: string | null) => (iso ? String(iso).slice(0, 10) : null);

/** 판매실적은 동기화가 최근 5일 정도 늦게 차는 게 정상이다(지연이지 고장 아님). */
const SALES_NORMAL_LAG_DAYS = 5;
/** 관제판은 하루 두 번 올린다. 36시간 넘게 안 오면 관제판 쪽이 멈춘 것. ops-status-panel 과 같은 기준. */
const OPS_STALE_HOURS = 36;
/** daily-sync 가 이 일수 넘게 안 돌았으면 고장. */
const DAILY_SYNC_STALE_DAYS = 1;

/** 오염되는 지표를 '어느 화면의 무슨 숫자'로 풀어 쓴다. */
const METRIC_SCREENS: Record<MetricKey, string> = {
  adSpend: "광고비 (Overview · 광고 분석 · 매체별 집행 · 예산 페이싱)",
  roas: "ROAS (Overview · 광고 분석)",
  revenue: "매출 (Overview · 매출 분석 · 브랜드 화면)",
  funnel: "퍼널 수치 (퍼널 · 판매처 성과)",
};

/**
 * data-status 소스 ↔ 관제판(ops-status collector) 항목. data-sources.ts 의 collector 필드와 같은 이름이다.
 * 한 소스를 두 수집기가 나눠 채우는 경우가 있다(카페24 퍼널 = 장바구니 + 회원가입).
 */
const OPS_KEYS_BY_SOURCE: Record<string, string[]> = {
  coupang_ads: ["coupang-ads"],
  gfa_saip: ["gfa-spend"],
  gfa_nutty: ["gfa-spend"],
  smartstore_ironpet: ["smartstore-inflow", "smartstore-customers"],
  smartstore_balancelab: ["smartstore-inflow", "smartstore-customers"],
  cafe24_funnel: ["cafe24-cart", "cafe24-signup"],
  coupang_funnel: ["coupang-funnel"],
};

/** 하트비트 수집기 이름 → 사람이 읽는 이름. */
const HB_LABEL: Record<string, string> = {
  meta: "Meta 광고비",
  naver_sa: "네이버 검색광고",
  naver_balancelab: "네이버 검색광고 (밸런스랩)",
  instagram_content: "인스타 콘텐츠 성과",
  blog_posts: "블로그 글 목록",
  ga4_campaigns: "GA4 광고비 익스포트",
  google_ads: "Google Ads",
  cafe24_sales: "카페24 매출 (옛 시트 수집기)",
  sales_rebuild: "판매실적 재빌드 (수동 도구)",
  daily_report: "대시보드 일일 보고 (텔레그램)",
  // 2026-11-10 재고 화면. 로컬 수집기 wekeep-inventory.mjs --push 가 보내면 받는 API(src/lib/wekeep-ingest.ts)가 남긴다
  "wekeep-inventory": "위킵 재고 (재고 화면)",
  // 2026-11-10 같은 날. 로컬 수집기 coupang-rg-inventory.mjs --push(WING 로켓그로스 재고현황) → 같은 받는 API
  "coupang-rg-inventory": "쿠팡 로켓그로스 재고 (재고 화면)",
};

/**
 * 고장 칸에 올리면 안 되는 하트비트. 빨간색 금지, 회색으로만.
 *   paused   = 일부러 멈춘 것(구글 애즈 2026-05-14 집행 중단, 같이 멈춘 GA4 광고비 익스포트)
 *   retired  = 더는 안 쓰는 수집기·수동 도구(정기 실행이 원래 없음)
 * 재개·재도입하면 여기서 지운다.
 */
const QUIET_HB: Record<string, { level: "paused"; verdict: string; note: string }> = {
  google_ads: { level: "paused", verdict: "중단(의도)", note: "2026-05-14 부터 광고 집행 0원. 일부러 멈춘 것이라 고장 아님" },
  ga4_campaigns: { level: "paused", verdict: "중단(의도)", note: "구글 애즈를 멈춰 광고비 익스포트도 2026-05-14 에서 멈춤. 카페24 세션 수집과는 별개" },
  cafe24_sales: { level: "paused", verdict: "안 씀", note: "2026-09-18 제거된 옛 시트 수집기. 매출은 판매 업로드로 들어옴" },
  sales_rebuild: { level: "paused", verdict: "수동 도구", note: "rebuild_sales_full.py 빈칸 채우기를 사람이 돌릴 때만 기록됨. 정기 실행 아님" },
};

/** daily-sync 실패 단계 중 무시하는 것. 구글 애즈는 광고를 일부러 멈춰서 실패가 정상이다. */
const IGNORED_SYNC_STEPS = new Set(["google ads"]);

function opsItemsFor(id: string, ops: OpsCollectorItem[]): OpsCollectorItem[] {
  const keys = OPS_KEYS_BY_SOURCE[id] || [];
  return ops.filter((o) => keys.includes(o.item_key));
}

function impactOf(metrics: MetricKey[]): string {
  return Array.from(new Set(metrics.map((m) => METRIC_SCREENS[m]))).join(", ");
}

function classifySource(
  s: SourceStatus & { entry?: string | null },
  ops: OpsCollectorItem[],
): { row: SourceRow; issue: Issue | null; input: InputRow | null } {
  const related = opsItemsFor(s.id, ops);
  const failing = related.filter((o) => o.signal === "fail" || o.signal === "warn");
  const kind = s.mode === "inactive" ? "미운영" : s.mode === "manual" ? "손 입력" : "자동 수집";
  const base = { id: s.id, label: s.label, kind, latestDate: s.latestDate };

  if (s.status === "inactive") {
    const verdict = s.id === "google_ads" ? "중단(의도)" : "미운영";
    return { row: { ...base, level: "paused", verdict, note: (s.inactiveNote || "").split(".")[0] }, issue: null, input: null };
  }

  if (s.status === "ok") {
    const note = s.id === "sales" ? `최근 ${SALES_NORMAL_LAG_DAYS}일은 덜 들어오는 게 정상(동기화 지연)` : "";
    return { row: { ...base, level: "ok", verdict: "정상", note }, issue: null, input: null };
  }

  // 판매실적: 며칠 늦은 건 지연이지 고장이 아니다.
  if (s.id === "sales" && s.staleDays !== null && s.staleDays <= SALES_NORMAL_LAG_DAYS) {
    return {
      row: { ...base, level: "ok", verdict: "동기화 지연(정상)", note: `최근 ${SALES_NORMAL_LAG_DAYS}일은 덜 들어오는 게 정상` },
      issue: null,
      input: null,
    };
  }

  if (s.status === "input_needed") {
    const link = s.entry || "/daily";
    return {
      row: { ...base, level: "warn", verdict: "입력 필요", note: s.action || "" },
      issue: {
        key: `input:${s.id}`,
        level: "warn",
        title: `${s.label} 손 입력이 비어 있음`,
        since: s.latestDate ? nextDay(s.latestDate) : null,
        impact: impactOf(s.metrics),
        cause: null,
        action: s.action || "일일 입력에서 넣기",
        link,
      },
      input: { id: s.id, label: s.label, latestDate: s.latestDate, link },
    };
  }

  // broken: 자동 수집이 늦다. 원인은 관제판이 보고한 문장이 있으면 그걸 쓴다(추정하지 않는다).
  const opsCause = failing.map((o) => `${o.label}: ${o.summary || "실패"}`).join(" / ");
  const opsOkLatest = related.filter((o) => o.signal === "ok").map((o) => o.last_at).filter(Boolean).sort().pop() || null;
  let note = opsCause;
  if (!note && opsOkLatest && s.latestDate && opsOkLatest > s.latestDate) {
    // 관제판은 수집했다고 하는데 DB 는 그보다 이르다. 원인은 단정하지 않고 어긋남만 적는다.
    note = `관제판은 ${opsOkLatest} 까지 수집 보고, 대시보드 DB 에는 ${s.latestDate} 까지`;
  }
  if (!note) note = s.action || "";
  return {
    row: { ...base, level: "broken", verdict: s.latestDate ? `늦음 (${s.staleDays}일)` : "데이터 없음", note },
    issue: {
      key: `source:${s.id}`,
      level: "broken",
      title: `${s.label} 수집이 늦음`,
      since: s.latestDate ? nextDay(s.latestDate) : null,
      impact: impactOf(s.metrics),
      cause: note || null,
      action: opsCause
        ? "로그인이 풀린 것이면 사람이 다시 로그인한 뒤 수집을 다시 돌림"
        : opsOkLatest ? "내일 아침 다시 확인. 계속 같으면 이 소스의 DB 반영 단계 점검" : s.action || "수집 로그 확인",
      link: s.entry || null,
    },
    input: null,
  };
}

function classifyCollector(c: CollectorHealth, note: string | null): CollectorRow {
  const label = HB_LABEL[c.source] || c.source;
  const base = { source: c.source, label, lastRun: c.lastRun, latestDataDate: c.latestDataDate };
  const quiet = QUIET_HB[c.source];
  if (quiet) return { ...base, level: quiet.level, verdict: quiet.verdict, note: quiet.note };
  if (c.health === "running") {
    return { ...base, level: "ok", verdict: "정상", note: "" };
  }
  const verdict = { frozen: "데이터 정지", failing: "실패 보고", stopped: "실행 중단" }[c.health];
  return { ...base, level: "broken", verdict, note: note ? `기록된 사유 ${note}` : "" };
}

function classifyDailySync(hb: HeartbeatNote | undefined, today: string): DashboardHealth["dailySync"] {
  if (!hb) return { lastRun: null, level: "warn", verdict: "기록 없음", note: "daily-sync 실행 기록(sync_heartbeat workflow)을 찾지 못함" };
  const lastRun = day(hb.last_run);
  const stale = !lastRun || (Date.parse(today) - Date.parse(lastRun)) / DAY_MS > DAILY_SYNC_STALE_DAYS;
  const steps = (hb.note || "").split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
  const ignored = steps.filter((x) => IGNORED_SYNC_STEPS.has(x.toLowerCase()));
  const real = steps.filter((x) => !IGNORED_SYNC_STEPS.has(x.toLowerCase()));
  const ignoredNote = ignored.length ? `실패 단계 ${ignored.join(", ")} 는 광고 중단(의도)이라 무시` : "";
  if (stale) return { lastRun, level: "broken", verdict: "안 돎", note: `마지막 실행 ${lastRun || "없음"}. GitHub Actions daily-sync 확인` };
  if (real.length) return { lastRun, level: "broken", verdict: "단계 실패", note: `실패 단계: ${real.join(", ")}${ignoredNote ? `. ${ignoredNote}` : ""}` };
  return { lastRun, level: "ok", verdict: "정상", note: ignoredNote };
}

export function buildDashboardHealth(input: {
  sources: (SourceStatus & { entry?: string | null })[];
  collectors: CollectorHealth[];
  referenceDate: string;
  today: string;
  heartbeatNotes: HeartbeatNote[];
  ops: OpsCollectorItem[];
  nowMs: number;
}): DashboardHealth {
  const { sources, collectors, referenceDate, today, heartbeatNotes, ops, nowMs } = input;
  const noteOf = new Map(heartbeatNotes.map((h) => [h.source, h]));

  const classified = sources.map((s) => classifySource(s, ops));
  const issues: Issue[] = classified.map((c) => c.issue).filter((x): x is Issue => !!x);

  // daily-sync 자체 기록(workflow)과 일일 보고(daily_report)는 수집기 표가 아니라 따로 다룬다.
  const dailySync = classifyDailySync(noteOf.get("workflow"), today);
  if (dailySync.level !== "ok") {
    issues.push({
      key: "daily-sync",
      level: dailySync.level === "broken" ? "broken" : "warn",
      title: `자동 수집 daily-sync ${dailySync.verdict}`,
      since: null,
      impact: "Meta·네이버 광고비, GA4 세션 등 매일 자동으로 차는 숫자 전부",
      cause: dailySync.note,
      action: "GitHub Actions 의 daily-sync 실행 기록 확인",
      link: null,
    });
  }

  const collectorRows = collectors
    .filter((c) => c.source !== "workflow")
    .map((c) => classifyCollector(c, noteOf.get(c.source)?.note ?? null));
  for (const r of collectorRows) {
    if (r.level !== "broken") continue;
    const isReport = r.source === "daily_report";
    issues.push({
      key: `hb:${r.source}`,
      level: "broken",
      title: `${r.label} ${r.verdict}`,
      since: null,
      impact: isReport ? "대시보드 숫자는 영향 없음. 텔레그램 일일 보고가 안 옴" : "이 수집기가 채우는 숫자",
      cause: r.note || null,
      action: isReport && /401/.test(r.note) ? "텔레그램 봇 토큰(Vercel 환경변수) 확인" : "수집 로그 확인",
      link: null,
    });
  }

  // 소스와 짝이 없는 관제판 수집기 문제(소스와 짝이 있으면 위 소스 칸에 이미 합쳤다).
  const mapped = new Set(Object.values(OPS_KEYS_BY_SOURCE).flat());
  for (const o of ops) {
    if (mapped.has(o.item_key) || (o.signal !== "fail" && o.signal !== "warn")) continue;
    issues.push({
      key: `ops:${o.item_key}`,
      level: o.signal === "fail" ? "broken" : "warn",
      title: `${o.label} 자동 수집 ${o.signal === "fail" ? "실패" : "주의"}`,
      since: null,
      impact: "관제판 수집기",
      cause: o.summary || null,
      action: "관제판 수집기 로그 확인",
      link: null,
    });
  }

  const opsReportedAt = ops.map((o) => o.reported_at).filter(Boolean).sort().pop() || null;
  if (!opsReportedAt || (nowMs - Date.parse(opsReportedAt)) / 3_600_000 > OPS_STALE_HOURS) {
    issues.push({
      key: "ops-stale",
      level: "warn",
      title: "관제판 보고가 멈춤",
      since: day(opsReportedAt),
      impact: "쿠팡 광고비·GFA·카페24·스마트스토어 자동 수집 결과를 이 화면이 모름",
      cause: null,
      action: "로컬 관제판(org-dashboard) 실행 여부 확인",
      link: null,
    });
  }

  const sourceRows = classified.map((c) => c.row);
  const allLevels = [...sourceRows.map((r) => r.level), ...collectorRows.map((r) => r.level), dailySync.level];
  const order = { broken: 0, warn: 1 } as const;
  return {
    referenceDate,
    counts: {
      broken: issues.filter((i) => i.level === "broken").length,
      warn: issues.filter((i) => i.level === "warn").length,
      ok: allLevels.filter((l) => l === "ok").length,
      paused: allLevels.filter((l) => l === "paused").length,
    },
    issues: issues.sort((a, b) => order[a.level] - order[b.level]),
    sources: sourceRows,
    collectors: collectorRows,
    dailySync,
    inputs: classified.map((c) => c.input).filter((x): x is InputRow => !!x),
    opsReportedAt,
  };
}
