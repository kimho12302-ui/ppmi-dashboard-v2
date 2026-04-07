"use client";

import { useState, useEffect, useCallback } from "react";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const API = "/api/settings";

const TABS = [
  { key: "daily", label: "📋 일일 입력" },
  { key: "upload", label: "📤 엑셀 업로드" },
  { key: "brands", label: "🏷️ 브랜드" },
  { key: "channels", label: "📡 채널" },
  { key: "costs", label: "💰 제품 원가" },
  { key: "targets", label: "🎯 목표 설정" },
] as const;

type Tab = (typeof TABS)[number]["key"];

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("daily");

  return (
    <PageShell title="설정" hideFilters>
      <div className="flex items-center gap-1 rounded-lg bg-muted p-1 overflow-x-auto">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={cn("px-3 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap",
              tab === t.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
          >{t.label}</button>
        ))}
      </div>

      {tab === "daily" && <DailyInputTab onSwitchTab={setTab} />}
      {tab === "upload" && <UploadTab />}
      {tab === "brands" && <BrandConfigTab />}
      {tab === "channels" && <ChannelConfigTab />}
      {tab === "costs" && <CostTab />}
      {tab === "targets" && <TargetsTab />}
    </PageShell>
  );
}

/* ── 공통 ── */
function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const isOk = status.includes("완료") || status.includes("성공");
  return <div className={`text-sm px-3 py-1.5 rounded ${isOk ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"}`}>{status}</div>;
}

/* ── 데이터 수집 현황 ── */
interface SourceStatus { id: string; label: string; type: "auto" | "manual"; latestDate: string | null; ok: boolean }

function DataStatusPanel() {
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [refDate, setRefDate] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/data-status");
      const d = await res.json();
      setSources(d.sources || []);
      setRefDate(d.referenceDate || "");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="text-sm text-muted-foreground py-2">현황 로딩 중...</div>;

  const auto = sources.filter(s => s.type === "auto");
  const manual = sources.filter(s => s.type === "manual");

  return (
    <Card>
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
                    <span>{s.ok ? "✅" : "⚠️"}</span>
                    <span className={s.ok ? "" : "text-amber-600"}>{s.label}</span>
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
                    <span>{s.ok ? "✅" : "⚠️"}</span>
                    <span className={s.ok ? "" : "text-amber-600"}>{s.label}</span>
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
    <Card>
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

function MissingDatesBanner({ onSelectDate }: { onSelectDate: (date: string, type: "cafe24" | "smartstore" | "coupang") => void }) {
  const [gaps, setGaps] = useState<MissingGap[]>([]);

  useEffect(() => {
    fetch("/api/missing-dates").then(r => r.json()).then(d => setGaps(d.gaps || []));
  }, []);

  if (gaps.length === 0) return null;

  // 이 탭에서 직접 입력 가능한 항목 → 버튼
  const typeMap: Record<string, "cafe24" | "smartstore" | "coupang"> = {
    "카페24퍼널": "cafe24", "스마트스토어퍼널": "smartstore",
  };
  // 엑셀 업로드 탭에서 처리하는 항목 → 일일입력 배너에서 제외
  const uploadTabItems = new Set(["판매실적", "쿠팡광고보고서", "쿠팡퍼널"]);

  const filtered = gaps.map(g => ({
    date: g.date,
    missing: g.missing.filter(m => !uploadTabItems.has(m)),
  })).filter(g => g.missing.length > 0);

  if (filtered.length === 0) return null;

  return (
    <Card className="border-orange-300 bg-orange-50 dark:bg-orange-950/20">
      <CardContent className="p-4 space-y-2">
        <p className="text-sm font-medium text-orange-700 dark:text-orange-400">⚠️ 미입력 날짜</p>
        <div className="space-y-1.5">
          {filtered.map(({ date, missing }) => (
            <div key={date} className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium w-24 shrink-0 text-orange-700 dark:text-orange-400">{date}</span>
              <div className="flex gap-1.5 flex-wrap">
                {missing.map(m => typeMap[m] ? (
                  <button key={m} type="button" onClick={() => onSelectDate(date, typeMap[m])}
                    className="px-2 py-0.5 text-xs rounded bg-orange-300 dark:bg-orange-700 hover:bg-orange-400 dark:hover:bg-orange-600 text-orange-900 dark:text-orange-100 font-medium">
                    {m} 입력 →
                  </button>
                ) : (
                  <span key={m} className="px-2 py-0.5 text-xs rounded bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-400">
                    {m} 누락
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-orange-600 dark:text-orange-500">버튼 클릭 시 해당 날짜로 입력 폼 이동 / 판매실적·쿠팡 항목은 엑셀 업로드 탭에서 처리</p>
      </CardContent>
    </Card>
  );
}

function DailyInputTab({ onSwitchTab }: { onSwitchTab: (tab: Tab) => void }) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState<string | null>(null);
  const [inputType, setInputType] = useState<"cafe24" | "smartstore">("cafe24");

  const handleSelectMissing = (d: string, type: "cafe24" | "smartstore" | "coupang") => {
    setDate(d);
    if (type !== "coupang") setInputType(type);
  };

  // cafe24 필드
  const [c24Cart, setC24Cart] = useState("");
  const [c24Signup, setC24Signup] = useState("");
  const [c24Repurchase, setC24Repurchase] = useState("");

  // smartstore 필드
  const [ssBrand, setSsBrand] = useState("nutty");
  const [ssSessions, setSsSessions] = useState("");
  const [ssDuration, setSsDuration] = useState("");
  const [ssSubscribers, setSsSubscribers] = useState("");
  const [ssRepurchase, setSsRepurchase] = useState("");

  const save = async () => {
    setStatus(null);
    try {
      let payload;
      if (inputType === "cafe24") {
        payload = { type: "cafe24_funnel", data: { date, cart_adds: c24Cart, signups: c24Signup, repurchases: c24Repurchase } };
      } else {
        payload = { type: "smartstore_funnel", data: { date, brand: ssBrand, sessions: ssSessions, avg_duration: ssDuration, subscribers: ssSubscribers, repurchases: ssRepurchase } };
      }
      const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const json = await res.json();
      setStatus(res.ok ? `✅ ${json.message || "저장 완료"}` : `❌ ${json.error || json.message}`);
    } catch { setStatus("❌ 네트워크 오류"); }
  };

  return (
    <div className="space-y-4">
    <DailyInputGuide onSwitchTab={onSwitchTab} />
    <MissingDatesBanner onSelectDate={handleSelectMissing} />
    <DataStatusPanel />
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border rounded px-3 py-1.5 text-sm bg-transparent" />
          {(["cafe24", "smartstore"] as const).map((t) => (
            <button key={t} onClick={() => setInputType(t)}
              className={cn("px-3 py-1.5 text-sm rounded-md", inputType === t ? "bg-primary text-primary-foreground" : "bg-muted")}
            >{t === "cafe24" ? "카페24" : "스마트스토어"}</button>
          ))}
        </div>

        {inputType === "cafe24" && (
          <div className="grid grid-cols-3 gap-3">
            <Field label="장바구니" value={c24Cart} set={setC24Cart} />
            <Field label="회원가입" value={c24Signup} set={setC24Signup} />
            <Field label="재구매" value={c24Repurchase} set={setC24Repurchase} />
          </div>
        )}

        {inputType === "smartstore" && (
          <div className="space-y-3">
            <select value={ssBrand} onChange={(e) => setSsBrand(e.target.value)} className="border rounded px-3 py-1.5 text-sm bg-transparent">
              <option value="nutty">일반 (너티/아이언펫/사입)</option>
              <option value="balancelab">밸런스랩</option>
            </select>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Field label="세션" value={ssSessions} set={setSsSessions} />
              <Field label="체류시간(초)" value={ssDuration} set={setSsDuration} />
              <Field label="알림받기" value={ssSubscribers} set={setSsSubscribers} />
              <Field label="재구매" value={ssRepurchase} set={setSsRepurchase} />
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button onClick={save} className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90">저장</button>
          <StatusBadge status={status} />
        </div>
      </CardContent>
    </Card>

    <GfaInputCard />
    <MiscCostCard />
    <EventInputCard />
    </div>
  );
}

/* ── GFA 수동 광고비 입력 ── */
// 기획서 2.5절: GFA 브랜드 = 너티, 사입, 밸런스랩
const GFA_BRANDS = [
  { key: "nutty", label: "너티" },
  { key: "saip", label: "사입" },
  { key: "balancelab", label: "밸런스랩" },
];

function GfaInputCard() {
  const today = new Date(Date.now() + 32400000).toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [brand, setBrand] = useState("nutty");
  const [spend, setSpend] = useState("");
  const [impressions, setImpressions] = useState("");
  const [clicks, setClicks] = useState("");
  const [conversions, setConversions] = useState("");
  const [conversionValue, setConversionValue] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const doSave = async (forceOverride = false) => {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "manual_ad_spend",
        forceOverride,
        data: { date, channel: "gfa", brand, spend, impressions, clicks, conversions, conversion_value: conversionValue },
      }),
    });
    return { res, json: await res.json() };
  };

  const save = async () => {
    setStatus(null);
    try {
      const { res, json } = await doSave();
      if (res.status === 409) {
        if (window.confirm(`⚠️ ${json.message}\n덮어쓰시겠습니까?`)) {
          const { res: res2, json: j2 } = await doSave(true);
          setStatus(res2.ok ? `✅ ${j2.message || "저장 완료"}` : `❌ ${j2.error}`);
        }
      } else {
        setStatus(res.ok ? `✅ ${json.message || "저장 완료"}` : `❌ ${json.error || json.message}`);
      }
    } catch { setStatus("❌ 네트워크 오류"); }
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <h3 className="font-medium">GFA 광고비 수동 입력 <span className="text-xs text-muted-foreground font-normal">너티·사입·밸런스랩 브랜드별 입력</span></h3>
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className="text-xs text-muted-foreground">날짜</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="block border rounded px-3 py-1.5 text-sm bg-transparent mt-0.5" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">브랜드</label>
            <select value={brand} onChange={e => setBrand(e.target.value)}
              className="block border rounded px-3 py-1.5 text-sm bg-transparent mt-0.5">
              {GFA_BRANDS.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
            </select>
          </div>
          <div className="w-32">
            <label className="text-xs text-muted-foreground">광고비 (원)</label>
            <input type="number" value={spend} onChange={e => setSpend(e.target.value)}
              placeholder="0" className="w-full border rounded px-3 py-1.5 text-sm bg-transparent mt-0.5" />
          </div>
          <div className="w-28">
            <label className="text-xs text-muted-foreground">노출수</label>
            <input type="number" value={impressions} onChange={e => setImpressions(e.target.value)}
              placeholder="0" className="w-full border rounded px-3 py-1.5 text-sm bg-transparent mt-0.5" />
          </div>
          <div className="w-28">
            <label className="text-xs text-muted-foreground">클릭수</label>
            <input type="number" value={clicks} onChange={e => setClicks(e.target.value)}
              placeholder="0" className="w-full border rounded px-3 py-1.5 text-sm bg-transparent mt-0.5" />
          </div>
          <div className="w-28">
            <label className="text-xs text-muted-foreground">전환수</label>
            <input type="number" value={conversions} onChange={e => setConversions(e.target.value)}
              placeholder="0" className="w-full border rounded px-3 py-1.5 text-sm bg-transparent mt-0.5" />
          </div>
          <div className="w-32">
            <label className="text-xs text-muted-foreground">전환매출액 (원)</label>
            <input type="number" value={conversionValue} onChange={e => setConversionValue(e.target.value)}
              placeholder="0" className="w-full border rounded px-3 py-1.5 text-sm bg-transparent mt-0.5" />
          </div>
          <button onClick={save} className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 self-end">저장</button>
        </div>
        <StatusBadge status={status} />
      </CardContent>
    </Card>
  );
}

/* ── 건별 비용 입력 ── */
const MISC_CATEGORIES = ["인플루언서", "협찬", "공구", "체험단", "촬영비", "디자인비", "샘플비", "배송비", "수수료", "기타"];
const BRAND_MAP: Record<string, string> = { "아이언펫": "ironpet", "너티": "nutty", "사입": "saip", "밸런스랩": "balancelab" };

function MiscCostCard() {
  const today = new Date(Date.now() + 32400000).toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [brand, setBrand] = useState("아이언펫");
  const [category, setCategory] = useState("기타");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const save = async () => {
    setStatus(null);
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "misc_cost",
          data: { date, brand: BRAND_MAP[brand] || brand, category, description, amount: Number(amount) || 0, note },
        }),
      });
      const json = await res.json();
      if (res.status === 409) {
        if (window.confirm(`⚠️ ${json.message}\n덮어쓰시겠습니까?`)) {
          const res2 = await fetch(API, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "misc_cost", forceOverride: true, data: { date, brand: BRAND_MAP[brand] || brand, category, description, amount: Number(amount) || 0, note } }),
          });
          const j2 = await res2.json();
          setStatus(res2.ok ? "✅ 저장 완료" : `❌ ${j2.error}`);
          if (res2.ok) { setDescription(""); setAmount(""); setNote(""); }
        }
      } else {
        setStatus(res.ok ? "✅ 저장 완료" : `❌ ${json.error || json.message}`);
        if (res.ok) { setDescription(""); setAmount(""); setNote(""); }
      }
    } catch { setStatus("❌ 네트워크 오류"); }
  };

  const sel = "border rounded px-2 py-1.5 text-sm bg-transparent w-full";

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <h3 className="font-medium">🧾 건별 비용 입력 <span className="text-xs text-muted-foreground font-normal">인플루언서/협찬/촬영비/디자인비 등</span></h3>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">날짜</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className={`${sel} mt-0.5 block`} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">브랜드</label>
            <select value={brand} onChange={e => setBrand(e.target.value)} className={`${sel} mt-0.5`}>
              {Object.keys(BRAND_MAP).map(b => <option key={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">구분</label>
            <select value={category} onChange={e => setCategory(e.target.value)} className={`${sel} mt-0.5`}>
              {MISC_CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">사유</label>
            <input type="text" value={description} onChange={e => setDescription(e.target.value)}
              placeholder="업체명, 캠페인명 등" className={`${sel} mt-0.5`} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">금액 (원)</label>
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
              placeholder="0" className={`${sel} mt-0.5`} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">비고</label>
            <input type="text" value={note} onChange={e => setNote(e.target.value)}
              placeholder="선택사항" className={`${sel} mt-0.5`} />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={save} className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90">저장</button>
          <StatusBadge status={status} />
        </div>
      </CardContent>
    </Card>
  );
}

/* ── 마케팅 이벤트 입력 ── */
const EVENT_COLORS = [
  { label: "보라", value: "#6366f1" }, { label: "파랑", value: "#3b82f6" },
  { label: "초록", value: "#22c55e" }, { label: "주황", value: "#f97316" },
  { label: "빨강", value: "#ef4444" }, { label: "핑크", value: "#ec4899" },
];

function EventInputCard() {
  const today = new Date(Date.now() + 32400000).toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [brand, setBrand] = useState("all");
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [color, setColor] = useState("#6366f1");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [events, setEvents] = useState<{ id: number; date: string; brand: string; title: string; description?: string; color: string }[]>([]);

  useEffect(() => {
    fetch(`/api/events?from=${today}&to=${today}`)
      .then(r => r.json()).then(d => setEvents(d.events || []));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    if (!title.trim()) return;
    setSaving(true); setStatus(null);
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, brand, title: title.trim(), description: desc.trim() || null, color }),
      });
      const d = await res.json();
      if (d.ok) {
        setEvents(prev => [...prev, d.event]);
        setTitle(""); setDesc("");
        setStatus("✅ 이벤트 저장 완료");
      } else { setStatus(`❌ ${d.error}`); }
    } catch { setStatus("❌ 네트워크 오류"); }
    setSaving(false);
  };

  const remove = async (id: number) => {
    await fetch(`/api/events?id=${id}`, { method: "DELETE" });
    setEvents(prev => prev.filter(e => e.id !== id));
  };

  const brandLabels: Record<string, string> = { all: "전체", nutty: "너티", ironpet: "아이언펫", saip: "사입", balancelab: "밸런스랩" };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <h3 className="font-medium">📌 마케팅 이벤트 <span className="text-xs text-muted-foreground font-normal">캠페인·프로모션·신제품 출시 등 — 차트에 표시됨</span></h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">날짜</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className="block w-full border rounded px-2 py-1.5 text-sm bg-transparent mt-0.5" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">브랜드</label>
            <select value={brand} onChange={e => setBrand(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm bg-transparent mt-0.5">
              {Object.entries(brandLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="lg:col-span-2">
            <label className="text-xs text-muted-foreground">이벤트명 *</label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)}
              placeholder="프로모션 시작, 신제품 출시 등" className="w-full border rounded px-2 py-1.5 text-sm bg-transparent mt-0.5" />
          </div>
          <div className="lg:col-span-3">
            <label className="text-xs text-muted-foreground">설명 (선택)</label>
            <input type="text" value={desc} onChange={e => setDesc(e.target.value)}
              placeholder="상세 내용" className="w-full border rounded px-2 py-1.5 text-sm bg-transparent mt-0.5" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">색상</label>
            <div className="flex items-center gap-1.5 mt-1.5">
              {EVENT_COLORS.map(c => (
                <button key={c.value} type="button" onClick={() => setColor(c.value)}
                  className={cn("w-5 h-5 rounded-full border-2 transition-all", color === c.value ? "border-foreground scale-110" : "border-transparent")}
                  style={{ background: c.value }} title={c.label} />
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={save} disabled={saving || !title.trim()}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50">
            {saving ? "저장 중..." : "📌 추가"}
          </button>
          <StatusBadge status={status} />
        </div>
        {events.length > 0 && (
          <div className="border-t pt-3 space-y-1.5">
            <p className="text-xs text-muted-foreground">오늘 등록된 이벤트</p>
            {events.map(e => (
              <div key={e.id} className="flex items-center gap-2 text-xs bg-muted/50 rounded px-2 py-1.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: e.color }} />
                <span className="text-muted-foreground">{e.date.slice(5)}</span>
                <span className="text-muted-foreground">[{brandLabels[e.brand] || e.brand}]</span>
                <span className="font-medium flex-1">{e.title}</span>
                {e.description && <span className="text-muted-foreground truncate max-w-32">{e.description}</span>}
                <button type="button" onClick={() => remove(e.id)} className="text-muted-foreground hover:text-red-500 px-1">✕</button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, value, set }: { label: string; value: string; set: (v: string) => void }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      <input type="number" value={value} onChange={(e) => set(e.target.value)}
        className="w-full border rounded px-3 py-1.5 text-sm bg-transparent mt-0.5" placeholder="0" />
    </div>
  );
}

/* ── 브랜드 설정 탭 ── */
interface BrandRow { id: number; key: string; label: string; color: string; order: number; active: boolean; parent_key: string | null; category: string | null }

function BrandConfigTab() {
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ key: "", label: "", color: "#6b7280", order: 0, active: true, category: "" });

  const load = useCallback(async () => {
    const res = await fetch(`${API}?type=brand_config`);
    const json = await res.json();
    setBrands(json.brandConfig || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    const payload = { type: "brand_config", data: { ...form, order: Number(form.order) } };
    const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    setStatus(res.ok ? "✅ 저장 완료" : "❌ 저장 실패");
    if (res.ok) { load(); setEditId(null); setForm({ key: "", label: "", color: "#6b7280", order: 0, active: true, category: "" }); }
  };

  const del = async (id: number) => {
    if (!confirm("삭제하시겠습니까?")) return;
    await fetch(`${API}?type=brand_config&id=${id}`, { method: "DELETE" });
    load();
  };

  const startEdit = (b: BrandRow) => {
    setEditId(b.id);
    setForm({ key: b.key, label: b.label, color: b.color, order: b.order, active: b.active, category: b.category || "" });
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <h3 className="font-semibold">브랜드 관리</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left">
              <th className="py-2 px-2">색상</th><th className="py-2 px-2">키</th><th className="py-2 px-2">라벨</th>
              <th className="py-2 px-2">카테고리</th><th className="py-2 px-2">순서</th><th className="py-2 px-2">활성</th><th className="py-2 px-2"></th>
            </tr></thead>
            <tbody>
              {brands.map((b) => (
                <tr key={b.id} className="border-b hover:bg-muted/50">
                  <td className="py-2 px-2"><div className="w-4 h-4 rounded" style={{ backgroundColor: b.color }} /></td>
                  <td className="py-2 px-2 font-mono text-xs">{b.key}</td>
                  <td className="py-2 px-2">{b.label}</td>
                  <td className="py-2 px-2 text-muted-foreground">{b.category || "—"}</td>
                  <td className="py-2 px-2">{b.order}</td>
                  <td className="py-2 px-2">{b.active ? "✅" : "❌"}</td>
                  <td className="py-2 px-2 space-x-2">
                    <button onClick={() => startEdit(b)} className="text-xs text-primary hover:underline">수정</button>
                    <button onClick={() => del(b.id)} className="text-xs text-red-500 hover:underline">삭제</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="border-t pt-4">
          <h4 className="text-sm font-medium mb-2">{editId ? "브랜드 수정" : "브랜드 추가"}</h4>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div><label className="text-xs text-muted-foreground">키</label>
              <input value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} className="w-full border rounded px-2 py-1.5 text-sm bg-transparent mt-0.5" disabled={!!editId} /></div>
            <div><label className="text-xs text-muted-foreground">라벨</label>
              <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} className="w-full border rounded px-2 py-1.5 text-sm bg-transparent mt-0.5" /></div>
            <div><label className="text-xs text-muted-foreground">색상</label>
              <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="w-full h-9 border rounded mt-0.5" /></div>
            <div><label className="text-xs text-muted-foreground">카테고리</label>
              <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full border rounded px-2 py-1.5 text-sm bg-transparent mt-0.5" /></div>
          </div>
          <div className="flex items-center gap-3 mt-3">
            <button onClick={save} className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90">
              {editId ? "수정" : "추가"}
            </button>
            {editId && <button onClick={() => { setEditId(null); setForm({ key: "", label: "", color: "#6b7280", order: 0, active: true, category: "" }); }} className="text-sm text-muted-foreground hover:underline">취소</button>}
            <StatusBadge status={status} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ── 채널 설정 탭 ── */
interface ChannelRow { id: number; key: string; label: string; color: string; type: string; auto: boolean; order: number; active: boolean }

function ChannelConfigTab() {
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ key: "", label: "", color: "#6b7280", type: "ad", auto: false, order: 0, active: true });

  const load = useCallback(async () => {
    const res = await fetch(`${API}?type=channel_config`);
    const json = await res.json();
    setChannels(json.channelConfig || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    const payload = { type: "channel_config", data: { ...form, order: Number(form.order) } };
    const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    setStatus(res.ok ? "✅ 저장 완료" : "❌ 저장 실패");
    if (res.ok) { load(); setEditId(null); setForm({ key: "", label: "", color: "#6b7280", type: "ad", auto: false, order: 0, active: true }); }
  };

  const del = async (id: number) => {
    if (!confirm("삭제하시겠습니까?")) return;
    await fetch(`${API}?type=channel_config&id=${id}`, { method: "DELETE" });
    load();
  };

  const startEdit = (c: ChannelRow) => {
    setEditId(c.id);
    setForm({ key: c.key, label: c.label, color: c.color, type: c.type, auto: c.auto, order: c.order, active: c.active });
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <h3 className="font-semibold">채널 관리</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left">
              <th className="py-2 px-2">색상</th><th className="py-2 px-2">키</th><th className="py-2 px-2">라벨</th>
              <th className="py-2 px-2">타입</th><th className="py-2 px-2">자동</th><th className="py-2 px-2">순서</th><th className="py-2 px-2">활성</th><th className="py-2 px-2"></th>
            </tr></thead>
            <tbody>
              {channels.map((c) => (
                <tr key={c.id} className="border-b hover:bg-muted/50">
                  <td className="py-2 px-2"><div className="w-4 h-4 rounded" style={{ backgroundColor: c.color }} /></td>
                  <td className="py-2 px-2 font-mono text-xs">{c.key}</td>
                  <td className="py-2 px-2">{c.label}</td>
                  <td className="py-2 px-2"><span className={`px-1.5 py-0.5 rounded text-xs ${c.type === "ad" ? "bg-blue-500/10 text-blue-500" : "bg-green-500/10 text-green-500"}`}>{c.type === "ad" ? "광고" : "매출"}</span></td>
                  <td className="py-2 px-2">{c.auto ? "🤖" : "✍️"}</td>
                  <td className="py-2 px-2">{c.order}</td>
                  <td className="py-2 px-2">{c.active ? "✅" : "❌"}</td>
                  <td className="py-2 px-2 space-x-2">
                    <button onClick={() => startEdit(c)} className="text-xs text-primary hover:underline">수정</button>
                    <button onClick={() => del(c.id)} className="text-xs text-red-500 hover:underline">삭제</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="border-t pt-4">
          <h4 className="text-sm font-medium mb-2">{editId ? "채널 수정" : "채널 추가"}</h4>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div><label className="text-xs text-muted-foreground">키</label>
              <input value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} className="w-full border rounded px-2 py-1.5 text-sm bg-transparent mt-0.5" disabled={!!editId} /></div>
            <div><label className="text-xs text-muted-foreground">라벨</label>
              <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} className="w-full border rounded px-2 py-1.5 text-sm bg-transparent mt-0.5" /></div>
            <div><label className="text-xs text-muted-foreground">색상</label>
              <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="w-full h-9 border rounded mt-0.5" /></div>
            <div><label className="text-xs text-muted-foreground">타입</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full border rounded px-2 py-1.5 text-sm bg-transparent mt-0.5">
                <option value="ad">광고</option><option value="sales">매출</option>
              </select></div>
          </div>
          <div className="flex items-center gap-3 mt-3">
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={form.auto} onChange={(e) => setForm({ ...form, auto: e.target.checked })} /> 자동 수집
            </label>
            <button onClick={save} className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90">
              {editId ? "수정" : "추가"}
            </button>
            {editId && <button onClick={() => { setEditId(null); setForm({ key: "", label: "", color: "#6b7280", type: "ad", auto: false, order: 0, active: true }); }} className="text-sm text-muted-foreground hover:underline">취소</button>}
            <StatusBadge status={status} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ── 제품 원가 탭 ── */
interface CostRow { product: string; brand: string; cost_price: number; manufacturing_cost: number; shipping_cost: number; category: string }
interface ShippingRow { id: number; month: string; brand: string; total_cost: number; total_orders: number; note: string }

const BRAND_OPTIONS = [
  { key: "nutty", label: "너티" }, { key: "ironpet", label: "아이언펫" },
  { key: "saip", label: "사입" }, { key: "balancelab", label: "밸런스랩" },
];
const BRAND_LABEL: Record<string, string> = { nutty: "너티", ironpet: "아이언펫", saip: "사입", balancelab: "밸런스랩" };

function CostTab() {
  const [subtab, setSubtab] = useState<"product" | "shipping">("product");
  const [costs, setCosts] = useState<CostRow[]>([]);
  const [missing, setMissing] = useState<{ product: string; brand: string }[]>([]);
  const [editKey, setEditKey] = useState<string | null>(null); // "product|brand"
  const [form, setForm] = useState({ product: "", brand: "nutty", cost_price: "", manufacturing_cost: "", shipping_cost: "", category: "" });
  const [status, setStatus] = useState<string | null>(null);

  const [ships, setShips] = useState<ShippingRow[]>([]);
  const [shipForm, setShipForm] = useState({ month: new Date().toISOString().slice(0, 7), brand: "nutty", total_cost: "", total_orders: "", note: "" });
  const [shipStatus, setShipStatus] = useState<string | null>(null);

  const loadCosts = useCallback(async () => {
    const [costsRes, allRes] = await Promise.all([
      fetch(`${API}?type=product_costs`).then(r => r.json()),
      fetch(API).then(r => r.json()),
    ]);
    setCosts(costsRes.productCosts || []);
    setMissing(allRes.missingProducts || []);
  }, []);

  const loadShipping = useCallback(async () => {
    const res = await fetch(`${API}?type=shipping_costs`).then(r => r.json());
    setShips(res.shippingCosts || []);
  }, []);

  useEffect(() => { loadCosts(); }, [loadCosts]);
  useEffect(() => { if (subtab === "shipping") loadShipping(); }, [subtab, loadShipping]);

  const startEdit = (c: CostRow) => {
    setEditKey(`${c.product}|${c.brand}`);
    setForm({ product: c.product, brand: c.brand, cost_price: String(c.cost_price), manufacturing_cost: String(c.manufacturing_cost || ""), shipping_cost: String(c.shipping_cost || ""), category: c.category || "" });
    setStatus(null);
  };

  const cancelEdit = () => { setEditKey(null); setForm({ product: "", brand: "nutty", cost_price: "", manufacturing_cost: "", shipping_cost: "", category: "" }); setStatus(null); };

  const saveCost = async () => {
    setStatus(null);
    const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "product_cost", data: { product: form.product, brand: form.brand, cost_price: Number(form.cost_price) || 0, manufacturing_cost: Number(form.manufacturing_cost) || 0, shipping_cost: Number(form.shipping_cost) || 0, category: form.category } }) });
    const json = await res.json();
    if (res.ok) { setStatus("✅ 저장 완료"); cancelEdit(); loadCosts(); }
    else setStatus(`❌ ${json.error || "저장 실패"}`);
  };

  const delCost = async (product: string, brand: string) => {
    if (!confirm(`${product} 원가를 삭제하시겠습니까?`)) return;
    await fetch(`${API}?type=product_cost&product=${encodeURIComponent(product)}&brand=${encodeURIComponent(brand)}`, { method: "DELETE" });
    loadCosts();
  };

  const saveShipping = async () => {
    setShipStatus(null);
    const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "shipping_cost", data: { month: shipForm.month, brand: shipForm.brand, total_cost: Number(shipForm.total_cost) || 0, total_orders: Number(shipForm.total_orders) || 0, note: shipForm.note } }) });
    const json = await res.json();
    if (res.status === 409) {
      if (window.confirm(`⚠️ ${json.message}\n덮어쓰시겠습니까?`)) {
        const res2 = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "shipping_cost", forceOverride: true, data: { month: shipForm.month, brand: shipForm.brand, total_cost: Number(shipForm.total_cost) || 0, total_orders: Number(shipForm.total_orders) || 0, note: shipForm.note } }) });
        if (res2.ok) { setShipStatus("✅ 저장 완료"); loadShipping(); }
        else setShipStatus("❌ 저장 실패");
      }
    } else if (res.ok) { setShipStatus("✅ 저장 완료"); loadShipping(); }
    else setShipStatus(`❌ ${json.error || "저장 실패"}`);
  };

  const delShipping = async (id: number) => {
    if (!confirm("삭제하시겠습니까?")) return;
    await fetch(`${API}?type=shipping_cost&id=${id}`, { method: "DELETE" });
    loadShipping();
  };

  const inp = "w-full border rounded px-2 py-1.5 text-sm bg-transparent mt-0.5";

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["product", "shipping"] as const).map(t => (
          <button key={t} onClick={() => setSubtab(t)}
            className={cn("px-3 py-1.5 text-sm rounded-md", subtab === t ? "bg-primary text-primary-foreground" : "bg-muted")}>
            {t === "product" ? "💰 제품 원가" : "🚚 배송비"}
          </button>
        ))}
      </div>

      {subtab === "product" && (
        <Card>
          <CardContent className="p-4 space-y-4">
            <h3 className="font-semibold">제품 원가 ({costs.length}개 등록)</h3>
            {missing.length > 0 && (
              <div className="text-sm bg-amber-500/10 text-amber-600 p-3 rounded">
                ⚠️ 원가 미등록 제품 {missing.length}개: {missing.slice(0, 5).map(m => m.product).join(", ")}{missing.length > 5 ? ` 외 ${missing.length - 5}개` : ""}
                <button onClick={() => { setEditKey(null); setForm(f => ({ ...f, product: missing[0].product, brand: missing[0].brand })); }} className="ml-2 underline text-xs">첫 번째 등록</button>
              </div>
            )}
            <div className="overflow-x-auto max-h-80">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card"><tr className="border-b text-left">
                  <th className="py-2 px-2">브랜드</th><th className="py-2 px-2">제품</th><th className="py-2 px-2">카테고리</th>
                  <th className="py-2 px-2 text-right">원가</th><th className="py-2 px-2 text-right">제조원가</th><th className="py-2 px-2 text-right">배송비</th><th className="py-2 px-2"></th>
                </tr></thead>
                <tbody>
                  {costs.map((c) => (
                    <tr key={`${c.product}|${c.brand}`} className={cn("border-b hover:bg-muted/50", editKey === `${c.product}|${c.brand}` && "bg-primary/5")}>
                      <td className="py-1.5 px-2 text-xs">{BRAND_LABEL[c.brand] || c.brand}</td>
                      <td className="py-1.5 px-2 text-xs">{c.product}</td>
                      <td className="py-1.5 px-2 text-xs text-muted-foreground">{c.category || "—"}</td>
                      <td className="py-1.5 px-2 text-right">{c.cost_price?.toLocaleString()}원</td>
                      <td className="py-1.5 px-2 text-right text-muted-foreground">{c.manufacturing_cost ? `${c.manufacturing_cost.toLocaleString()}원` : "—"}</td>
                      <td className="py-1.5 px-2 text-right">{c.shipping_cost?.toLocaleString()}원</td>
                      <td className="py-1.5 px-2 space-x-2 whitespace-nowrap">
                        <button onClick={() => startEdit(c)} className="text-xs text-primary hover:underline">수정</button>
                        <button onClick={() => delCost(c.product, c.brand)} className="text-xs text-red-500 hover:underline">삭제</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="border-t pt-4">
              <h4 className="text-sm font-medium mb-3">{editKey ? "원가 수정" : "원가 추가"}</h4>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                <div><label className="text-xs text-muted-foreground">브랜드</label>
                  <select value={form.brand} onChange={e => setForm({...form, brand: e.target.value})} className={inp} disabled={!!editKey}>
                    {BRAND_OPTIONS.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
                  </select></div>
                <div><label className="text-xs text-muted-foreground">제품명</label>
                  <input value={form.product} onChange={e => setForm({...form, product: e.target.value})} className={inp} disabled={!!editKey} placeholder="제품명 (이카운트와 동일)" /></div>
                <div><label className="text-xs text-muted-foreground">카테고리</label>
                  <input value={form.category} onChange={e => setForm({...form, category: e.target.value})} className={inp} placeholder="사료, 영양제, 간식 등" /></div>
                <div><label className="text-xs text-muted-foreground">원가 (원)</label>
                  <input type="number" value={form.cost_price} onChange={e => setForm({...form, cost_price: e.target.value})} className={inp} placeholder="0" /></div>
                <div><label className="text-xs text-muted-foreground">제조원가 (원)</label>
                  <input type="number" value={form.manufacturing_cost} onChange={e => setForm({...form, manufacturing_cost: e.target.value})} className={inp} placeholder="0" /></div>
                <div><label className="text-xs text-muted-foreground">배송비 (원)</label>
                  <input type="number" value={form.shipping_cost} onChange={e => setForm({...form, shipping_cost: e.target.value})} className={inp} placeholder="0" /></div>
              </div>
              <div className="flex items-center gap-3 mt-3">
                <button onClick={saveCost} className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90">{editKey ? "수정" : "추가"}</button>
                {editKey && <button onClick={cancelEdit} className="text-sm text-muted-foreground hover:underline">취소</button>}
                <StatusBadge status={status} />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {subtab === "shipping" && (
        <Card>
          <CardContent className="p-4 space-y-4">
            <h3 className="font-semibold">월별 배송비</h3>
            <div className="overflow-x-auto max-h-80">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card"><tr className="border-b text-left">
                  <th className="py-2 px-2">월</th><th className="py-2 px-2">브랜드</th>
                  <th className="py-2 px-2 text-right">총배송비</th><th className="py-2 px-2 text-right">총주문수</th>
                  <th className="py-2 px-2 text-right">주문당배송비</th><th className="py-2 px-2">비고</th><th className="py-2 px-2"></th>
                </tr></thead>
                <tbody>
                  {ships.map(s => (
                    <tr key={s.id} className="border-b hover:bg-muted/50">
                      <td className="py-1.5 px-2">{s.month}</td>
                      <td className="py-1.5 px-2">{BRAND_LABEL[s.brand] || s.brand}</td>
                      <td className="py-1.5 px-2 text-right">{s.total_cost?.toLocaleString()}원</td>
                      <td className="py-1.5 px-2 text-right">{s.total_orders?.toLocaleString()}건</td>
                      <td className="py-1.5 px-2 text-right">{s.total_orders ? Math.round(s.total_cost / s.total_orders).toLocaleString() : "—"}원</td>
                      <td className="py-1.5 px-2 text-xs text-muted-foreground">{s.note || "—"}</td>
                      <td className="py-1.5 px-2">
                        <button onClick={() => delShipping(s.id)} className="text-xs text-red-500 hover:underline">삭제</button>
                      </td>
                    </tr>
                  ))}
                  {ships.length === 0 && <tr><td colSpan={7} className="py-4 text-center text-sm text-muted-foreground">등록된 배송비 없음</td></tr>}
                </tbody>
              </table>
            </div>

            <div className="border-t pt-4">
              <h4 className="text-sm font-medium mb-3">배송비 추가</h4>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                <div><label className="text-xs text-muted-foreground">월</label>
                  <input type="month" value={shipForm.month} onChange={e => setShipForm({...shipForm, month: e.target.value})} className={inp} /></div>
                <div><label className="text-xs text-muted-foreground">브랜드</label>
                  <select value={shipForm.brand} onChange={e => setShipForm({...shipForm, brand: e.target.value})} className={inp}>
                    {BRAND_OPTIONS.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
                  </select></div>
                <div><label className="text-xs text-muted-foreground">총 배송비 (원)</label>
                  <input type="number" value={shipForm.total_cost} onChange={e => setShipForm({...shipForm, total_cost: e.target.value})} className={inp} placeholder="0" /></div>
                <div><label className="text-xs text-muted-foreground">총 주문수</label>
                  <input type="number" value={shipForm.total_orders} onChange={e => setShipForm({...shipForm, total_orders: e.target.value})} className={inp} placeholder="0" /></div>
                <div><label className="text-xs text-muted-foreground">비고</label>
                  <input value={shipForm.note} onChange={e => setShipForm({...shipForm, note: e.target.value})} className={inp} placeholder="선택사항" /></div>
              </div>
              <div className="flex items-center gap-3 mt-3">
                <button onClick={saveShipping} className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90">추가</button>
                <StatusBadge status={shipStatus} />
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ── 목표 설정 탭 (monthly_targets가 없으면 안내 표시) ── */
function TargetsTab() {
  const [targets, setTargets] = useState<Record<string, { revenue_target: number; ad_budget_target: number; roas_target: number }>>({});
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [brand, setBrand] = useState("all");
  const [revenue, setRevenue] = useState("");
  const [adBudget, setAdBudget] = useState("");
  const [roas, setRoas] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [tableExists, setTableExists] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/targets");
      if (!res.ok) { setTableExists(false); return; }
      const json = await res.json();
      setTargets(json.targets || {});
    } catch { setTableExists(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setStatus(null);
    const res = await fetch("/api/targets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month, brand, revenue_target: revenue, ad_budget_target: adBudget, roas_target: roas }),
    });
    setStatus(res.ok ? "✅ 저장 완료" : "❌ 저장 실패");
    if (res.ok) load();
  };

  if (!tableExists) {
    return (
      <Card><CardContent className="p-4 text-sm text-muted-foreground">
        ⚠️ monthly_targets 테이블이 아직 생성되지 않았습니다. Supabase에서 CREATE TABLE을 실행해주세요.
      </CardContent></Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <h3 className="font-semibold">월별 목표 설정</h3>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <div><label className="text-xs text-muted-foreground">월</label>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm bg-transparent mt-0.5" /></div>
          <div><label className="text-xs text-muted-foreground">브랜드</label>
            <select value={brand} onChange={(e) => setBrand(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm bg-transparent mt-0.5">
              <option value="all">전체</option><option value="nutty">너티</option><option value="ironpet">아이언펫</option><option value="balancelab">밸런스랩</option><option value="saip">사입</option>
            </select></div>
          <div><label className="text-xs text-muted-foreground">매출 목표</label>
            <input type="number" value={revenue} onChange={(e) => setRevenue(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm bg-transparent mt-0.5" placeholder="0" /></div>
          <div><label className="text-xs text-muted-foreground">광고비 예산</label>
            <input type="number" value={adBudget} onChange={(e) => setAdBudget(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm bg-transparent mt-0.5" placeholder="0" /></div>
          <div><label className="text-xs text-muted-foreground">ROAS 목표</label>
            <input type="number" value={roas} onChange={(e) => setRoas(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm bg-transparent mt-0.5" placeholder="0" step="0.1" /></div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={save} className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90">저장</button>
          <StatusBadge status={status} />
        </div>

        {Object.keys(targets).length > 0 && (
          <div className="border-t pt-3">
            <h4 className="text-sm font-medium mb-2">등록된 목표</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left">
                  <th className="py-2 px-2">월</th><th className="py-2 px-2">브랜드</th><th className="py-2 px-2 text-right">매출 목표</th><th className="py-2 px-2 text-right">광고비 예산</th><th className="py-2 px-2 text-right">ROAS 목표</th>
                </tr></thead>
                <tbody>
                  {Object.entries(targets).map(([key, t]) => {
                    const [m, b] = key.split("_");
                    return (
                      <tr key={key} className="border-b">
                        <td className="py-1.5 px-2">{m}</td>
                        <td className="py-1.5 px-2">{b}</td>
                        <td className="py-1.5 px-2 text-right">{t.revenue_target?.toLocaleString()}원</td>
                        <td className="py-1.5 px-2 text-right">{t.ad_budget_target?.toLocaleString()}원</td>
                        <td className="py-1.5 px-2 text-right">{t.roas_target}x</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ── 배치 업로드 row 타입 ── */
type BatchRow = { id: number; date: string; file: File | null; status: "pending" | "uploading" | "done" | "error"; result?: string };
let _batchRowId = 0;

/* ── 배치 업로드 섹션 ── */
function BatchUploadSection({
  title, description, accept, missingDates,
  onUpload, onSuccess,
}: {
  title: string; description: string; accept: string; missingDates: string[];
  onUpload: (date: string, file: File) => Promise<{ ok: boolean; message?: string; error?: string }>;
  onSuccess?: () => void;
}) {
  const today = new Date(Date.now() + 32400000).toISOString().slice(0, 10);
  const makeRow = (date: string): BatchRow => ({ id: ++_batchRowId, date, file: null, status: "pending" });

  const [rows, setRows] = useState<BatchRow[]>([]);

  useEffect(() => {
    if (missingDates.length > 0) {
      setRows(missingDates.map(makeRow));
    } else {
      setRows([makeRow(today)]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingDates.join(",")]);

  const update = (id: number, patch: Partial<BatchRow>) =>
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));

  const uploadAll = async () => {
    for (const row of rows) {
      if (!row.file || row.status !== "pending") continue;
      update(row.id, { status: "uploading" });
      const res = await onUpload(row.date, row.file);
      update(row.id, { status: res.ok ? "done" : "error", result: res.message || res.error });
      if (res.ok) onSuccess?.();
    }
  };

  const pendingWithFile = rows.filter(r => r.file && r.status === "pending");

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div>
        <h4 className="font-medium">{title}</h4>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>

      <div className="space-y-2">
        {rows.map(row => (
          <div key={row.id} className="flex items-center gap-2">
            <input
              type="date" value={row.date}
              onChange={e => update(row.id, { date: e.target.value })}
              disabled={row.status !== "pending"}
              className="border rounded px-2 py-1 text-sm w-36 shrink-0"
            />
            {row.status === "pending" ? (
              <label className="flex-1 flex items-center gap-2 border border-dashed rounded px-3 py-1.5 text-xs cursor-pointer hover:bg-muted/50 text-muted-foreground">
                {row.file ? <span className="text-foreground truncate">{row.file.name}</span> : <span>파일 선택...</span>}
                <input type="file" accept={accept} className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) update(row.id, { file: f }); e.target.value = ""; }} />
              </label>
            ) : (
              <div className={cn("flex-1 text-xs px-3 py-1.5 rounded",
                row.status === "done" ? "bg-emerald-500/10 text-emerald-600" :
                row.status === "uploading" ? "bg-blue-500/10 text-blue-500" :
                "bg-red-500/10 text-red-500"
              )}>
                {row.status === "uploading" ? "⏳ 업로드 중..." : row.result}
              </div>
            )}
            {row.status === "pending" && (
              <button type="button" onClick={() => setRows(prev => prev.filter(r => r.id !== row.id))}
                className="text-muted-foreground hover:text-red-500 text-sm px-1">✕</button>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button type="button"
          onClick={() => setRows(prev => [...prev, makeRow(today)])}
          className="text-xs text-primary hover:underline">+ 날짜 추가</button>
        {pendingWithFile.length > 0 && (
          <button type="button" onClick={uploadAll}
            className="px-3 py-1.5 bg-primary text-primary-foreground rounded text-xs font-medium hover:opacity-90">
            💾 전체 업로드 ({pendingWithFile.length}건)
          </button>
        )}
      </div>
    </div>
  );
}

/* ── 📤 엑셀 업로드 탭 ── */
function UploadTab() {
  const today = new Date(Date.now() + 32400000).toISOString().slice(0, 10);
  const [missingSales, setMissingSales] = useState<string[]>([]);
  const [missingCoupangFunnel, setMissingCoupangFunnel] = useState<string[]>([]);
  const [missingCoupangAds, setMissingCoupangAds] = useState<string[]>([]);
  const [coupangAdsDate, setCoupangAdsDate] = useState(today);
  const [coupangAdsStatus, setCoupangAdsStatus] = useState<string | null>(null);
  const [coupangAdsUploading, setCoupangAdsUploading] = useState(false);

  const refreshMissing = useCallback(() => {
    fetch("/api/missing-dates")
      .then(r => r.json())
      .then(d => {
        setMissingSales(d.sales || []);
        setMissingCoupangFunnel(d.coupang_funnel || []);
        setMissingCoupangAds(d.coupang_ads || []);
        if (d.coupang_ads?.length) setCoupangAdsDate(d.coupang_ads[0]);
      });
  }, []);

  useEffect(() => { refreshMissing(); }, [refreshMissing]);

  const uploadSales = async (_date: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/upload-sales", { method: "POST", body: form });
    const data = await res.json();
    if (data.ok) {
      const brands = data.brandSummary
        ? Object.entries(data.brandSummary as Record<string, { count: number }>).map(([b, info]) =>
            `${({ nutty: "너티", ironpet: "아이언펫", saip: "사입", balancelab: "밸런스랩" } as Record<string,string>)[b] || b} ${info.count}건`
          ).join(", ")
        : "";
      let msg = `✅ ${data.parsed}건 파싱 | ${brands}`;
      if (data.unmatchedProducts?.length) {
        const list = (data.unmatchedProducts as { code: string; name?: string; count: number }[])
          .map(p => `${p.code}${p.name ? `(${p.name})` : ""} ${p.count}건`)
          .join(", ");
        msg += ` | ⚠️ 미등록 품목코드 ${data.totalUnmatched}개: ${list}`;
      }
      return { ok: true, message: msg };
    }
    // 에러인 경우에도 미등록 코드가 있으면 표시
    if (data.unmatchedProducts?.length) {
      const list = (data.unmatchedProducts as { code: string; name?: string; count: number }[])
        .map(p => `${p.code}${p.name ? `(${p.name})` : ""} ${p.count}건`)
        .join(", ");
      return { ok: false, error: `${data.error} | 미등록 품목코드 ${data.totalUnmatched}개: ${list}` };
    }
    return { ok: false, error: data.error || "업로드 실패" };
  };

  const uploadCoupangFunnel = async (date: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    form.append("date", date);
    const res = await fetch("/api/upload-coupang-funnel", { method: "POST", body: form });
    const data = await res.json();
    if (data.ok) return { ok: true, message: `✅ ${data.funnel}일 퍼널 반영` };
    return { ok: false, error: data.error || "업로드 실패" };
  };

  const uploadCoupangAds = async (file: File) => {
    setCoupangAdsUploading(true);
    setCoupangAdsStatus(null);
    const form = new FormData();
    form.append("file", file);
    form.append("date", coupangAdsDate);
    const res = await fetch("/api/upload-coupang-ads", { method: "POST", body: form });
    const data = await res.json();
    setCoupangAdsStatus(data.ok ? `✅ ${data.message}` : `❌ ${data.error || "업로드 실패"}`);
    if (data.ok) refreshMissing();
    setCoupangAdsUploading(false);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-4">
          <h3 className="text-lg font-semibold">📤 엑셀 업로드</h3>

          {/* 판매 실적 */}
          <BatchUploadSection
            title="판매 실적 (이카운트)"
            description="이카운트 엑셀 → 제품별/일별 매출 (DB + 시트 동시 기록). 파일 내 날짜 자동 인식."
            accept=".xlsx,.xls"
            missingDates={missingSales}
            onUpload={uploadSales}
            onSuccess={refreshMissing}
          />

          {/* 쿠팡 퍼널 */}
          <BatchUploadSection
            title="쿠팡 퍼널"
            description="쿠팡 퍼널 엑셀 → 조회/방문자/장바구니/구매"
            accept=".xlsx,.xls,.csv"
            missingDates={missingCoupangFunnel}
            onUpload={uploadCoupangFunnel}
            onSuccess={refreshMissing}
          />

          {/* 쿠팡 광고 보고서 */}
          <div className="border rounded-lg p-4 space-y-3">
            <div>
              <h4 className="font-medium">쿠팡 광고 보고서</h4>
              <p className="text-xs text-muted-foreground">쿠팡 광고 엑셀 → 광고비/노출/클릭/전환</p>
              {missingCoupangAds.length > 0 && (
                <p className="text-xs text-amber-600 mt-1">⚠️ 미입력: {missingCoupangAds.join(", ")}</p>
              )}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <input type="date" value={coupangAdsDate}
                onChange={e => setCoupangAdsDate(e.target.value)}
                className="border rounded px-2 py-1 text-sm w-36" />
              <label className={cn("px-4 py-2 text-sm font-medium rounded-md cursor-pointer transition-colors",
                coupangAdsUploading ? "bg-muted text-muted-foreground cursor-wait" : "bg-primary text-primary-foreground hover:bg-primary/90"
              )}>
                {coupangAdsUploading ? "업로드 중..." : "파일 선택"}
                <input type="file" accept=".xlsx,.xls,.csv" className="hidden" disabled={coupangAdsUploading}
                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadCoupangAds(f); e.target.value = ""; }} />
              </label>
            </div>
            {coupangAdsStatus && (
              <div className={cn("text-sm px-3 py-2 rounded",
                coupangAdsStatus.startsWith("✅") ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-500"
              )}>{coupangAdsStatus}</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

