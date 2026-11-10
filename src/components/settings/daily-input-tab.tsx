"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { kstDate, kstNow } from "@/lib/date";
import { OpsStatusPanel } from "@/components/ops-status-panel";
import { ManualEntries } from "@/components/manual-entries";
import { freshFetch } from "@/lib/fresh-fetch";
import { useDataStatus } from "@/hooks/use-data-status";
import { API, type Tab, ManualRowTable } from "@/components/settings/shared";
import { GfaInputCard, MiscCostCard, EventInputCard } from "@/components/settings/daily-input-cards";

/*
 * 일일 입력 화면 배치 (2026-11-04 김호 결정: 속도 최우선, 입력 폼을 맨 위로).
 *   1) 미입력 날짜 띠 → 입력 폼 5개
 *   2) 그 아래 접힌 칸 3개: 체크리스트 / 데이터 수집 현황 / 자동 수집·사람이 넣은 값·보고 상태
 * 접힌 칸은 펼칠 때 비로소 그린다(<details> 만 씌우면 자식이 마운트돼 API 를 그대로 부른다).
 * 예전엔 「데이터 수집 현황」 카드가 두 개(옛 상태 키를 쓰는 DataStatusCard 포함)라
 * /api/data-status 를 세 번(상단 띠 포함), /api/missing-dates 를 두 번 불렀다. 지금은 각각 한 번이다.
 */

/* ── 데이터 수집 현황 ── */
interface SourceStatus { id: string; label: string; type: "auto" | "manual"; latestDate: string | null; ok: boolean; status?: string; lastSync?: string | null }
interface DataStatus { sources: SourceStatus[]; referenceDate: string }

/**
 * 소스 상태 배지.
 *
 * ★ 이 표의 키는 /api/data-status 가 실제로 내리는 값과 같아야 한다.
 *   예전 키(no_activity / disconnected / stale_manual)가 남아 있어서 API 가 보내는
 *   broken · input_needed · inactive 가 전부 폴백(ok)으로 떨어졌다. 즉 수집이 끊긴
 *   소스도 화면엔 🟢정상으로 보였다(2026-09-15 확인). 모르는 값은 초록으로 봐주지 않고
 *   물음표로 드러낸다. 감시 장치가 조용히 고장나는 게 제일 나쁘다.
 */
const STATUS_BADGE: Record<string, { icon: string; label: string; text: string }> = {
  ok: { icon: "🟢", label: "정상", text: "" },
  broken: { icon: "🔴", label: "수집 끊김", text: "text-red-600 dark:text-red-400" },
  input_needed: { icon: "⚪", label: "미입력", text: "text-muted-foreground" },
  inactive: { icon: "🟡", label: "미운영", text: "text-amber-600" },
};
const UNKNOWN_BADGE = { icon: "❓", label: "상태 불명", text: "text-amber-600" };
const sBadge = (status?: string) => (status ? STATUS_BADGE[status] || UNKNOWN_BADGE : UNKNOWN_BADGE);

/** 접힌 칸. 펼쳤을 때만 안쪽을 마운트한다(안쪽이 부르는 API 도 그때 나간다) */
/** tour: 가이드 투어 표식(data-tour). 접힌 칸은 안쪽이 그려지지 않으므로 표식은 칸 자체에 단다 */
function Fold({ title, summary, tour, children }: { title: string; summary?: React.ReactNode; tour?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details data-tour={tour} className="rounded-xl border bg-card" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold flex items-center gap-2 flex-wrap">
        <span>{title}</span>
        {summary && <span className="text-xs font-normal text-muted-foreground">{summary}</span>}
        <span className="ml-auto text-xs font-normal text-muted-foreground">{open ? "접기 ▴" : "펼치기 ▾"}</span>
      </summary>
      {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </details>
  );
}

function DataStatusList({ data, onRefresh }: { data: DataStatus; onRefresh: () => void }) {
  const auto = data.sources.filter(s => s.type === "auto");
  const manual = data.sources.filter(s => s.type === "manual");
  const row = (s: SourceStatus) => (
    <div key={s.id} className="flex items-center justify-between text-sm">
      <span className="flex items-center gap-1.5">
        <span title={sBadge(s.status).label}>{sBadge(s.status).icon}</span>
        <span className={sBadge(s.status).text}>{s.label}</span>
      </span>
      <span className="text-xs text-muted-foreground" title={s.lastSync ? `마지막 수집: ${s.lastSync}` : ""}>{s.latestDate || "없음"}</span>
    </div>
  );
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button onClick={onRefresh} className="text-xs text-muted-foreground hover:text-foreground">↻ 새로고침</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-muted-foreground mb-2">🤖 자동 수집</p>
          <div className="space-y-1">{auto.map(row)}</div>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-2">✍️ 수동 입력</p>
          <div className="space-y-1">{manual.map(row)}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * 접힌 「데이터 수집 현황」 제목 옆 한 줄. 정상·고장 개수는 화면 위 「데이터 상태」 띠가 이미 보여 주므로
 * 여기서 같은 숫자를 또 쓰지 않는다. 기준일과 원천 수만.
 */
function dataStatusSummary(data: DataStatus | null): React.ReactNode {
  if (!data) return "확인 중...";
  return `${data.referenceDate} 기준 · 원천 ${data.sources.length}개의 마지막 수집일 (정상·고장 개수는 위 「데이터 상태」 띠)`;
}

/* ── 일일 입력 체크리스트 (5단계). 접힌 칸 안에 들어가므로 자체 카드·제목은 없다 ── */
function DailyInputGuide({ onSwitchTab }: { onSwitchTab: (tab: Tab) => void }) {
  const today = kstDate();
  const [done, setDone] = useState<Set<number>>(() => {
    if (typeof window === "undefined") return new Set();
    try { const s = localStorage.getItem("daily-input-" + today); return s ? new Set(JSON.parse(s)) : new Set(); } catch { return new Set(); }
  });

  const toggle = (n: number) => setDone(prev => {
    const next = new Set(prev);
    if (next.has(n)) next.delete(n); else next.add(n);
    try { localStorage.setItem("daily-input-" + today, JSON.stringify([...next])); } catch {}
    return next;
  });

  const allDone = done.size >= STEPS.length;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        자동 수집 외에 매일 수동으로 넣어야 하는 항목입니다. 해당 없으면 체크하고 넘어가세요.
        {allDone && <span className="ml-2 text-emerald-600 font-medium">오늘 입력 완료</span>}
      </p>
      <div className="space-y-2">
        {STEPS.map(step => {
          const isDone = done.has(step.num);
          return (
            <div key={step.num} className={cn("flex items-start gap-3 p-3 rounded-lg border transition-all",
              isDone ? "bg-emerald-500/5 border-emerald-200 dark:border-emerald-800" : "border-border")}>
              <button type="button" onClick={() => toggle(step.num)}
                className={cn("mt-0.5 w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-all",
                  isDone ? "bg-emerald-500 border-emerald-500 text-white" : "border-muted-foreground hover:border-primary")}>
                {isDone && <span className="text-xs">✓</span>}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={cn("text-xs font-bold px-1.5 py-0.5 rounded",
                    isDone ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-primary/10 text-primary")}>STEP {step.num}</span>
                  <span className={cn("text-sm font-medium", isDone && "line-through text-muted-foreground")}>{step.title}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{step.desc}</p>
                {!isDone && step.action && (
                  <button type="button"
                    onClick={() => step.tab ? onSwitchTab(step.tab) : (window.location.href = "/")}
                    className="text-xs text-primary hover:underline mt-1 font-medium">{step.action}</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-3 pt-1">
        <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden">
          <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${(done.size / STEPS.length) * 100}%` }} />
        </div>
        <span className="text-xs text-muted-foreground font-medium">{done.size}/{STEPS.length}</span>
      </div>
    </div>
  );
}

const STEPS = [
  { num: 1, title: "쿠팡 광고비 파일 업로드", desc: "쿠팡 광고 관리 → 보고서 다운로드 → 엑셀 업로드 탭에서 업로드", action: "엑셀 업로드 탭으로 →", tab: "upload" as Tab },
  { num: 2, title: "GFA 광고비 입력", desc: "네이버 GFA 관리 → 어제 비용/노출/클릭 확인 → 위 GFA 입력폼에 입력", action: null, tab: null },
  { num: 3, title: "인플루언서/협찬 비용 입력", desc: "어제 집행한 인플루언서·체험단·공구 비용이 있으면 위 건별비용에 입력", action: null, tab: null },
  { num: 4, title: "스마트스토어 / 카페24 퍼널", desc: "스마트스토어 파트너센터 → 방문자/체류/알림 확인 후 위 입력폼 작성", action: null, tab: null },
  { num: 5, title: "대시보드 확인", desc: "Overview에서 매출/광고비/ROAS/통상이익 최종 확인", action: "Overview 보기 →", tab: null },
];

/* ── 일일 입력 탭 ── */
interface MissingGap { date: string; missing: string[] }
interface MissingDates { gaps: MissingGap[]; cafe24: string[]; smartstore: string[]; coupang_funnel: string[] }
const EMPTY_MISSING: MissingDates = { gaps: [], cafe24: [], smartstore: [], coupang_funnel: [] };

function MissingDatesBanner({ gaps }: { gaps: MissingGap[] }) {
  const uploadTabItems = new Set(["판매실적", "쿠팡광고보고서", "쿠팡퍼널"]);
  const filtered = gaps.map(g => ({
    date: g.date,
    missing: g.missing.filter(m => !uploadTabItems.has(m)),
  })).filter(g => g.missing.length > 0);

  if (filtered.length === 0) return null;

  return (
    <Card data-tour="daily-missing-banner" className="border-orange-300 bg-orange-50 dark:bg-orange-950/20">
      <CardContent className="p-4 space-y-2">
        <p className="text-sm font-medium text-orange-700 dark:text-orange-400">⚠️ 미입력 날짜: 아래 폼에서 해당 날짜를 추가해 입력하세요</p>
        <div className="space-y-1">
          {filtered.map(({ date, missing }) => (
            <div key={date} className="flex items-center gap-2 flex-wrap text-sm">
              <span className="font-medium w-24 shrink-0 text-orange-700 dark:text-orange-400">{date}</span>
              <div className="flex gap-1.5 flex-wrap">
                {missing.map(m => (
                  <span key={m} className="px-2 py-0.5 text-xs rounded bg-orange-200 dark:bg-orange-900/40 text-orange-800 dark:text-orange-300">{m}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function DailyInputTab({ onSwitchTab }: { onSwitchTab: (tab: Tab) => void }) {
  const today = kstDate();
  const [refreshKey, setRefreshKey] = useState(0);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const handleSaved = useCallback(() => {
    setRefreshKey(k => k + 1);
    setSavedMsg("✅ 저장 완료! 미입력 현황을 업데이트했습니다.");
    setTimeout(() => setSavedMsg(null), 4000);
  }, []);

  // 미입력 날짜: 위 띠와 폼의 '한 번에 채우기'가 같은 응답을 쓴다(예전엔 따로 두 번 불렀다).
  const [missing, setMissing] = useState<MissingDates>(EMPTY_MISSING);
  useEffect(() => {
    freshFetch("/api/missing-dates").then(r => r.json()).then(d => setMissing({
      gaps: d.gaps || [], cafe24: d.cafe24 || [], smartstore: d.smartstore || [], coupang_funnel: d.coupang_funnel || [],
    })).catch(() => {});
  }, [refreshKey]);

  // 데이터 수집 현황: 위쪽 상태 띠(page-shell 의 DataStatusRail)와 같은 모듈 캐시(useDataStatus)를 쓴다.
  // 그래서 화면 전체에서 /api/data-status 는 처음에 한 번만 나간다(예전 3번). 저장 뒤에는 강제로 다시 읽어
  // 띠와 이 칸이 함께 바뀐다(첫 렌더는 refreshKey=0 이라 다시 읽지 않는다).
  const { data: statusData, refresh: refreshStatus } = useDataStatus();
  const status: DataStatus | null = statusData
    ? { sources: statusData.sources || [], referenceDate: statusData.referenceDate || "" }
    : null;
  useEffect(() => { if (refreshKey > 0) refreshStatus(); }, [refreshKey, refreshStatus]);
  const loadStatus = useCallback(() => { refreshStatus(); }, [refreshStatus]);

  const saveCafe24 = async (row: { date: string } & Record<string, string>) => {
    const res = await fetch(API, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "cafe24_funnel", data: { date: row.date, cart_adds: row.cart_adds, purchases: row.purchases, repurchases: row.repurchases } }),
    });
    return res.json();
  };

  const saveSmartstore = async (row: { date: string } & Record<string, string>) => {
    const res = await fetch(API, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "smartstore_funnel", data: { date: row.date, brand: row.brand, sessions: row.sessions, avg_duration: row.avg_duration, subscribers: row.subscribers, repurchases: row.repurchases } }),
    });
    return res.json();
  };

  const todayLabel = kstNow().toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short", timeZone: "UTC" });

  return (
    <div className="space-y-4">
      {savedMsg && (
        <div className="px-4 py-3 rounded-lg bg-emerald-500/10 border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400 text-sm font-medium">
          {savedMsg}
        </div>
      )}

      <MissingDatesBanner gaps={missing.gaps} />

      {/* 카페24 퍼널 */}
      <Card data-tour="daily-cafe24">
        <CardContent className="p-4">
          <ManualRowTable
            title="카페24 퍼널"
            today={today}
            onSave={saveCafe24}
            onSaved={handleSaved}
            missingDates={missing.cafe24}
            fields={[
              { key: "cart_adds", label: "장바구니" },
              { key: "purchases", label: "회원가입" },
              { key: "repurchases", label: "재구매" },
            ]}
          />
        </CardContent>
      </Card>

      {/* 스마트스토어 퍼널 */}
      <Card data-tour="daily-smartstore">
        <CardContent className="p-4">
          <ManualRowTable
            title="스마트스토어 퍼널"
            today={today}
            onSave={saveSmartstore}
            onSaved={handleSaved}
            missingDates={missing.smartstore}
            fields={[
              { key: "brand", label: "브랜드", type: "select", options: [{ key: "nutty", label: "일반 (너티/아이언펫/사입)" }, { key: "balancelab", label: "밸런스랩" }] },
              { key: "sessions", label: "세션" },
              { key: "avg_duration", label: "체류(초)" },
              { key: "subscribers", label: "알림받기" },
              { key: "repurchases", label: "재구매" },
            ]}
          />
        </CardContent>
      </Card>

      <GfaInputCard today={today} onSaved={handleSaved} />
      <MiscCostCard onSaved={handleSaved} />
      <EventInputCard />

      {/* 상태·체크리스트는 접어 둔다. 펼칠 때 불러온다 */}
      <Fold tour="daily-checklist" title="📋 일일 입력 체크리스트" summary={todayLabel}>
        <DailyInputGuide onSwitchTab={onSwitchTab} />
      </Fold>
      <Fold tour="daily-collect-status" title="📡 데이터 수집 현황" summary={dataStatusSummary(status)}>
        {status ? <DataStatusList data={status} onRefresh={loadStatus} /> : <p className="text-sm text-muted-foreground">현황 로딩 중...</p>}
      </Fold>
      <Fold tour="daily-auto-collect" title="🤖 자동 수집 · 사람이 넣은 값 · 보고 상태">
        <OpsStatusPanel section="collector" title="🤖 자동 수집 상태"
          hint="매일 07:36 화면에서 읽어 이 대시보드에 넣는 수집기입니다. 못 읽은 날은 0 대신 실패로 남깁니다." />
        <ManualEntries />
        <div data-tour="daily-report-status">
          <OpsStatusPanel section="report" title="🗒️ 보고 상태"
            hint="일일 브리핑·주간/월간 회의록·팀 공지가 제때 나왔는지." />
        </div>
      </Fold>
    </div>
  );
}
