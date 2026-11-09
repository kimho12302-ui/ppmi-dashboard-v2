"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { OpsStatusPanel } from "@/components/ops-status-panel";
import { ManualEntries } from "@/components/manual-entries";
import { freshFetch } from "@/lib/fresh-fetch";
import { API, type Tab, ManualRowTable } from "@/components/settings/shared";
import { GfaInputCard, MiscCostCard, EventInputCard } from "@/components/settings/daily-input-cards";

/* ── 데이터 수집 현황 ── */
interface SourceStatus { id: string; label: string; type: "auto" | "manual"; latestDate: string | null; ok: boolean; status?: string; lastSync?: string | null }

/**
 * 소스 상태 배지.
 *
 * ★ 이 표의 키는 /api/data-status 가 실제로 내리는 값과 같아야 한다.
 *   예전 키(no_activity / disconnected / stale_manual)가 남아 있어서 API 가 보내는
 *   broken · input_needed · inactive 가 전부 폴백(ok)으로 떨어졌다. 즉 수집이 끊긴
 *   소스도 화면엔 🟢정상으로 보였다(2026-09-15 확인). 모르는 값은 초록으로 봐주지 않고
 *   물음표로 드러낸다 — 감시 장치가 조용히 고장나는 게 제일 나쁘다.
 */
const STATUS_BADGE: Record<string, { icon: string; label: string; text: string }> = {
  ok: { icon: "🟢", label: "정상", text: "" },
  broken: { icon: "🔴", label: "수집 끊김", text: "text-red-600 dark:text-red-400" },
  input_needed: { icon: "⚪", label: "미입력", text: "text-muted-foreground" },
  inactive: { icon: "🟡", label: "미운영", text: "text-amber-600" },
};
const UNKNOWN_BADGE = { icon: "❓", label: "상태 불명", text: "text-amber-600" };
const sBadge = (status?: string) => (status ? STATUS_BADGE[status] || UNKNOWN_BADGE : UNKNOWN_BADGE);

function DataStatusPanel({ refreshKey }: { refreshKey?: number }) {
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [refDate, setRefDate] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await freshFetch("/api/data-status");
      const d = await res.json();
      setSources(d.sources || []);
      setRefDate(d.referenceDate || "");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  if (loading) return <div className="text-sm text-muted-foreground py-2">현황 로딩 중...</div>;

  const auto = sources.filter(s => s.type === "auto");
  const manual = sources.filter(s => s.type === "manual");

  return (
    <Card data-tour="daily-collect-detail">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">데이터 수집 현황 <span className="text-muted-foreground font-normal">({refDate} 기준)</span></h3>
          <button onClick={load} className="text-xs text-muted-foreground hover:text-foreground">↻ 새로고침</button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground mb-2">🤖 자동 수집</p>
            <div className="space-y-1">
              {auto.map(s => (
                <div key={s.id} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1.5">
                    <span title={sBadge(s.status).label}>{sBadge(s.status).icon}</span>
                    <span className={sBadge(s.status).text}>{s.label}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{s.latestDate || "없음"}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-2">✍️ 수동 입력</p>
            <div className="space-y-1">
              {manual.map(s => (
                <div key={s.id} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1.5">
                    <span title={sBadge(s.status).label}>{sBadge(s.status).icon}</span>
                    <span className={sBadge(s.status).text}>{s.label}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{s.latestDate || "없음"}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ── 일일 입력 가이드 (5단계 체크리스트) ── */
/* ── 데이터 수집 현황 카드 (P7 SyncButton 역할) ── */
function DataStatusCard() {
  const [data, setData] = useState<{ sources: { id: string; label: string; type: string; latestDate: string | null; ok: boolean; status?: string; lastSync?: string | null }[]; referenceDate: string; summary: { total: number; ok: number; stale: number } } | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await freshFetch("/api/data-status");
      setData(await res.json());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <Card data-tour="daily-collect-status">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold">📡 데이터 수집 현황</h3>
            {data && <p className="text-xs text-muted-foreground">기준일: {data.referenceDate} · {data.summary.ok}/{data.summary.total}개 정상</p>}
          </div>
          <button onClick={refresh} disabled={loading}
            className={cn("px-3 py-1.5 text-xs font-medium rounded-md border transition-colors",
              loading ? "opacity-50 cursor-not-allowed" : "hover:bg-muted")}>
            {loading ? "확인 중..." : "새로고침"}
          </button>
        </div>
        {data && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {data.sources.map(s => (
              <div key={s.id} className={cn("flex items-center justify-between px-3 py-2 rounded-lg text-sm border",
                s.status === "ok" ? "bg-emerald-500/5 border-emerald-200 dark:border-emerald-800" :
                s.status === "disconnected" ? "bg-red-500/5 border-red-200 dark:border-red-800" :
                s.status === "no_activity" ? "bg-amber-500/5 border-amber-200 dark:border-amber-800" :
                "bg-muted/30 border-border")}>
                <div className="flex items-center gap-2">
                  <span title={sBadge(s.status).label}>{sBadge(s.status).icon}</span>
                  <span className={cn("font-medium", sBadge(s.status).text)}>{s.label}</span>
                  <span className={cn("text-[10px] px-1 rounded", s.type === "auto" ? "bg-blue-100 text-blue-600 dark:bg-blue-900/30" : "bg-gray-100 text-gray-600 dark:bg-gray-800")}>
                    {s.type === "auto" ? "자동" : "수동"}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground" title={s.lastSync ? `마지막 수집: ${s.lastSync}` : ""}>
                  {s.latestDate || "없음"}
                </span>
              </div>
            ))}
          </div>
        )}
        {!data && !loading && <p className="text-sm text-muted-foreground">새로고침을 눌러 현황을 확인하세요.</p>}
      </CardContent>
    </Card>
  );
}

function DailyInputGuide({ onSwitchTab }: { onSwitchTab: (tab: Tab) => void }) {
  const today = new Date(Date.now() + 32400000).toISOString().slice(0, 10);
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

  const steps = [
    { num: 1, title: "쿠팡 광고비 파일 업로드", desc: "쿠팡 광고 관리 → 보고서 다운로드 → 엑셀 업로드 탭에서 업로드", action: "엑셀 업로드 탭으로 →", tab: "upload" as Tab },
    { num: 2, title: "GFA 광고비 입력", desc: "네이버 GFA 관리 → 어제 비용/노출/클릭 확인 → 아래 GFA 입력폼에 입력", action: null, tab: null },
    { num: 3, title: "인플루언서/협찬 비용 입력", desc: "어제 집행한 인플루언서·체험단·공구 비용이 있으면 아래 건별비용에 입력", action: null, tab: null },
    { num: 4, title: "스마트스토어 / 카페24 퍼널", desc: "스마트스토어 파트너센터 → 방문자/체류/알림 확인 후 아래 입력폼 작성", action: null, tab: null },
    { num: 5, title: "대시보드 확인", desc: "Overview에서 매출/광고비/ROAS/통상이익 최종 확인", action: "Overview 보기 →", tab: null },
  ];

  const allDone = done.size >= steps.length;
  const todayLabel = new Date(Date.now() + 32400000).toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });

  return (
    <Card data-tour="daily-checklist">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">📋 일일 입력 체크리스트 <span className="text-muted-foreground font-normal text-sm">({todayLabel})</span></h3>
          {allDone && <span className="text-sm text-emerald-500 font-medium">✅ 오늘 입력 완료!</span>}
        </div>
        <p className="text-xs text-muted-foreground">자동 수집 외에 매일 수동으로 넣어야 하는 항목입니다. 해당 없으면 체크하고 넘어가세요.</p>
        <div className="space-y-2">
          {steps.map(step => {
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
            <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${(done.size / steps.length) * 100}%` }} />
          </div>
          <span className="text-xs text-muted-foreground font-medium">{done.size}/{steps.length}</span>
        </div>
      </CardContent>
    </Card>
  );
}

/* ── 일일 입력 탭 ── */
interface MissingGap { date: string; missing: string[] }

function MissingDatesBanner({ refreshKey }: { refreshKey?: number }) {
  const [gaps, setGaps] = useState<MissingGap[]>([]);

  useEffect(() => {
    freshFetch("/api/missing-dates").then(r => r.json()).then(d => setGaps(d.gaps || []));
  }, [refreshKey]);

  if (gaps.length === 0) return null;

  const uploadTabItems = new Set(["판매실적", "쿠팡광고보고서", "쿠팡퍼널"]);
  const filtered = gaps.map(g => ({
    date: g.date,
    missing: g.missing.filter(m => !uploadTabItems.has(m)),
  })).filter(g => g.missing.length > 0);

  if (filtered.length === 0) return null;

  return (
    <Card data-tour="daily-missing-banner" className="border-orange-300 bg-orange-50 dark:bg-orange-950/20">
      <CardContent className="p-4 space-y-2">
        <p className="text-sm font-medium text-orange-700 dark:text-orange-400">⚠️ 미입력 날짜 — 아래 폼에서 해당 날짜를 추가해 입력하세요</p>
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
  const today = new Date(Date.now() + 32400000).toISOString().slice(0, 10);
  const [refreshKey, setRefreshKey] = useState(0);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const handleSaved = useCallback(() => {
    setRefreshKey(k => k + 1);
    setSavedMsg("✅ 저장 완료! 미입력 현황을 업데이트했습니다.");
    setTimeout(() => setSavedMsg(null), 4000);
  }, []);

  // 항목별 미입력 날짜 — 폼에서 '한 번에 채우기'로 쓴다.
  const [missing, setMissing] = useState<{ cafe24: string[]; smartstore: string[]; coupang_funnel: string[] }>(
    { cafe24: [], smartstore: [], coupang_funnel: [] }
  );
  useEffect(() => {
    freshFetch("/api/missing-dates").then(r => r.json()).then(d => setMissing({
      cafe24: d.cafe24 || [], smartstore: d.smartstore || [], coupang_funnel: d.coupang_funnel || [],
    })).catch(() => {});
  }, [refreshKey]);

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

  return (
    <div className="space-y-4">
      <DailyInputGuide onSwitchTab={onSwitchTab} />
      <DataStatusCard />
      <div data-tour="daily-auto-collect">
      <OpsStatusPanel section="collector" title="🤖 자동 수집 상태"
        hint="매일 07:36 화면에서 읽어 이 대시보드에 넣는 수집기입니다. 못 읽은 날은 0 대신 실패로 남깁니다." />
      </div>
      <ManualEntries />
      <div data-tour="daily-report-status">
      <OpsStatusPanel section="report" title="🗒️ 보고 상태"
        hint="일일 브리핑·주간/월간 회의록·팀 공지가 제때 나왔는지." />
      </div>

      {savedMsg && (
        <div className="px-4 py-3 rounded-lg bg-emerald-500/10 border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400 text-sm font-medium">
          {savedMsg}
        </div>
      )}

      <MissingDatesBanner refreshKey={refreshKey} />
      <DataStatusPanel refreshKey={refreshKey} />

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
    </div>
  );
}
