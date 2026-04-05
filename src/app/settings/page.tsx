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

      {tab === "daily" && <DailyInputTab />}
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

/* ── 일일 입력 탭 ── */
function DailyInputTab() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState<string | null>(null);
  const [inputType, setInputType] = useState<"cafe24" | "smartstore" | "coupang">("cafe24");

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

  // coupang 필드
  const [cpImpressions, setCpImpressions] = useState("");
  const [cpSessions, setCpSessions] = useState("");
  const [cpCart, setCpCart] = useState("");
  const [cpPurchases, setCpPurchases] = useState("");

  const save = async () => {
    setStatus(null);
    try {
      let payload;
      if (inputType === "cafe24") {
        payload = { type: "cafe24_funnel", data: { date, cart_adds: c24Cart, signups: c24Signup, repurchases: c24Repurchase } };
      } else if (inputType === "smartstore") {
        payload = { type: "smartstore_funnel", data: { date, brand: ssBrand, sessions: ssSessions, avg_duration: ssDuration, subscribers: ssSubscribers, repurchases: ssRepurchase } };
      } else {
        payload = { type: "coupang_funnel", data: { date, impressions: cpImpressions, sessions: cpSessions, cart_adds: cpCart, purchases: cpPurchases } };
      }
      const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const json = await res.json();
      setStatus(res.ok ? `✅ ${json.message || "저장 완료"}` : `❌ ${json.error || json.message}`);
    } catch { setStatus("❌ 네트워크 오류"); }
  };

  return (
    <div className="space-y-4">
    <DataStatusPanel />
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border rounded px-3 py-1.5 text-sm bg-transparent" />
          {(["cafe24", "smartstore", "coupang"] as const).map((t) => (
            <button key={t} onClick={() => setInputType(t)}
              className={cn("px-3 py-1.5 text-sm rounded-md", inputType === t ? "bg-primary text-primary-foreground" : "bg-muted")}
            >{t === "cafe24" ? "카페24" : t === "smartstore" ? "스마트스토어" : "쿠팡"}</button>
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
              <option value="nutty">너티</option>
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

        {inputType === "coupang" && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Field label="조회수" value={cpImpressions} set={setCpImpressions} />
            <Field label="방문자" value={cpSessions} set={setCpSessions} />
            <Field label="장바구니" value={cpCart} set={setCpCart} />
            <Field label="구매" value={cpPurchases} set={setCpPurchases} />
          </div>
        )}

        <div className="flex items-center gap-3">
          <button onClick={save} className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90">저장</button>
          <StatusBadge status={status} />
        </div>
      </CardContent>
    </Card>
    </div>
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
function CostTab() {
  const [costs, setCosts] = useState<{ product: string; brand: string; cost_price: number; shipping_cost: number }[]>([]);
  const [missing, setMissing] = useState<{ product: string; brand: string }[]>([]);

  const load = useCallback(async () => {
    const res = await fetch(`${API}?type=product_costs`);
    const json = await res.json();
    setCosts(json.productCosts || []);
  }, []);

  useEffect(() => {
    load();
    fetch(API).then((r) => r.json()).then((j) => setMissing(j.missingProducts || []));
  }, [load]);

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <h3 className="font-semibold">제품 원가 ({costs.length}개 등록)</h3>
        {missing.length > 0 && (
          <div className="text-sm bg-amber-500/10 text-amber-600 p-3 rounded">
            ⚠️ 원가 미등록 제품 {missing.length}개: {missing.slice(0, 3).map((m) => m.product).join(", ")}{missing.length > 3 ? "..." : ""}
          </div>
        )}
        <div className="overflow-x-auto max-h-96">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left">
              <th className="py-2 px-2">브랜드</th><th className="py-2 px-2">제품</th><th className="py-2 px-2 text-right">원가</th><th className="py-2 px-2 text-right">배송비</th>
            </tr></thead>
            <tbody>
              {costs.map((c, i) => (
                <tr key={i} className="border-b hover:bg-muted/50">
                  <td className="py-1.5 px-2 text-xs">{c.brand}</td>
                  <td className="py-1.5 px-2 text-xs">{c.product}</td>
                  <td className="py-1.5 px-2 text-right">{c.cost_price?.toLocaleString()}원</td>
                  <td className="py-1.5 px-2 text-right">{c.shipping_cost?.toLocaleString()}원</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
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

/* ── 📤 엑셀 업로드 탭 ── */
function UploadTab() {
  const [status, setStatus] = useState<Record<string, string | null>>({});
  const [uploading, setUploading] = useState<string | null>(null);

  const uploadTypes = [
    {
      key: "sales",
      label: "판매 실적 (이카운트)",
      description: "이카운트 판매입력 엑셀 → 제품별/일별 매출 데이터",
      api: "/api/upload-sales",
      accept: ".xlsx,.xls",
    },
    {
      key: "coupang-ads",
      label: "쿠팡 광고 보고서",
      description: "쿠팡 광고 엑셀 → 쿠팡 광고비/노출/클릭/전환",
      api: "/api/upload-coupang-ads",
      accept: ".xlsx,.xls,.csv",
    },
    {
      key: "coupang-funnel",
      label: "쿠팡 퍼널",
      description: "쿠팡 퍼널 데이터 → 조회/방문자/장바구니/구매",
      api: "/api/upload-coupang-funnel",
      accept: ".xlsx,.xls,.csv",
    },
  ];

  const handleUpload = async (type: typeof uploadTypes[0], file: File) => {
    setUploading(type.key);
    setStatus((prev) => ({ ...prev, [type.key]: null }));
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(type.api, { method: "POST", body: formData });
      const data = await res.json();
      if (res.ok) {
        const msg = data.message || data.summary || "업로드 완료";
        setStatus((prev) => ({ ...prev, [type.key]: `✅ ${msg}` }));
      } else {
        setStatus((prev) => ({ ...prev, [type.key]: `❌ ${data.error || "업로드 실패"}` }));
      }
    } catch (err) {
      setStatus((prev) => ({ ...prev, [type.key]: `❌ 네트워크 오류: ${err}` }));
    } finally {
      setUploading(null);
    }
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <h3 className="text-lg font-semibold">📤 엑셀 업로드</h3>
        <p className="text-sm text-muted-foreground">엑셀 파일을 선택하면 자동으로 DB에 반영됩니다.</p>
        
        {uploadTypes.map((type) => (
          <div key={type.key} className="border rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium">{type.label}</h4>
                <p className="text-xs text-muted-foreground">{type.description}</p>
              </div>
              <label className={cn(
                "px-4 py-2 text-sm font-medium rounded-md cursor-pointer transition-colors",
                uploading === type.key
                  ? "bg-muted text-muted-foreground cursor-wait"
                  : "bg-primary text-primary-foreground hover:bg-primary/90"
              )}>
                {uploading === type.key ? "업로드 중..." : "파일 선택"}
                <input
                  type="file"
                  accept={type.accept}
                  className="hidden"
                  disabled={uploading !== null}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUpload(type, file);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            {status[type.key] && (
              <div className={cn(
                "text-sm px-3 py-2 rounded",
                status[type.key]?.startsWith("✅") ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-500"
              )}>
                {status[type.key]}
              </div>
            )}
          </div>
        ))}

        <div className="border-t pt-4 mt-4">
          <h4 className="font-medium mb-2">자동 수집 현황</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            {[
              { time: "01:00", label: "Meta 광고", status: "자동" },
              { time: "02:00", label: "시트 → DB 동기화", status: "자동" },
              { time: "02:30", label: "DB → 시트 역동기화", status: "자동" },
              { time: "08:00", label: "네이버 검색광고", status: "자동" },
              { time: "08:05", label: "Google Ads", status: "자동" },
              { time: "08:30", label: "GA4 퍼널", status: "자동" },
              { time: "10:00", label: "쿠팡 광고 (오전)", status: "자동" },
              { time: "14:00", label: "쿠팡 광고 (오후)", status: "자동" },
            ].map((cron) => (
              <div key={cron.time} className="flex items-center gap-2 p-2 bg-muted/50 rounded">
                <span className="font-mono text-muted-foreground">{cron.time}</span>
                <span className="flex-1">{cron.label}</span>
                <span className="text-emerald-500">🟢 {cron.status}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t pt-4">
          <h4 className="font-medium mb-2">수동 입력 필요 항목</h4>
          <div className="text-xs text-muted-foreground space-y-1">
            <p>• <strong>판매 실적</strong> — 이카운트 엑셀 (위에서 업로드)</p>
            <p>• <strong>cafe24 퍼널</strong> — 일일입력 탭에서 수동 입력</p>
            <p>• <strong>스마트스토어 퍼널</strong> — 일일입력 탭에서 수동 입력</p>
            <p>• <strong>쿠팡 퍼널</strong> — 쿠팡 엑셀 업로드 또는 일일입력</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
