"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { freshFetch } from "@/lib/fresh-fetch";
import { API, StatusBadge, ManualRowTable } from "@/components/settings/shared";

/* ── GFA 수동 광고비 입력 ── */
// 기획서 2.5절: GFA 브랜드 = 너티, 사입, 밸런스랩
export function GfaInputCard({ today, onSaved }: { today: string; onSaved?: () => void }) {
  const saveGfa = async (row: { date: string } & Record<string, string>) => {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "manual_ad_spend",
        forceOverride: false,
        data: { date: row.date, channel: "gfa", brand: row.brand || "nutty", spend: row.spend, impressions: row.impressions, clicks: row.clicks, conversions: row.conversions, conversion_value: row.conversion_value },
      }),
    });
    const json = await res.json();
    if (res.status === 409) {
      if (window.confirm(`⚠️ ${json.message}\n덮어쓰시겠습니까?`)) {
        const res2 = await fetch(API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "manual_ad_spend",
            forceOverride: true,
            data: { date: row.date, channel: "gfa", brand: row.brand || "nutty", spend: row.spend, impressions: row.impressions, clicks: row.clicks, conversions: row.conversions, conversion_value: row.conversion_value },
          }),
        });
        return res2.json();
      }
      return { error: "취소됨" };
    }
    return json;
  };

  return (
    <Card data-tour="daily-gfa">
      <CardContent className="p-4">
        <ManualRowTable
          title="GFA 광고비 (너티·사입·밸런스랩 브랜드별)"
          today={today}
          onSave={saveGfa}
          onSaved={onSaved}
          fields={[
            { key: "brand", label: "브랜드", type: "select", options: [{ key: "nutty", label: "너티" }, { key: "saip", label: "사입" }, { key: "balancelab", label: "밸런스랩" }] },
            { key: "spend", label: "광고비" },
            { key: "impressions", label: "노출수" },
            { key: "clicks", label: "클릭수" },
            { key: "conversions", label: "전환수" },
            { key: "conversion_value", label: "전환매출" },
          ]}
        />
      </CardContent>
    </Card>
  );
}

/* ── 건별 비용 입력 ── */
const MISC_CATEGORIES = ["인플루언서", "협찬", "공구", "체험단", "촬영비", "디자인비", "샘플비", "배송비", "수수료", "기타"];
const BRAND_MAP: Record<string, string> = { "아이언펫": "ironpet", "너티": "nutty", "사입": "saip", "밸런스랩": "balancelab" };

export function MiscCostCard({ onSaved }: { onSaved?: () => void }) {
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
          // 덮어쓰기는 기존 줄의 금액·비고를 바꾼다(서버가 id 로 update). 새 줄이 생기지 않는다.
          setStatus(res2.ok ? (j2.updated ? "✅ 저장 완료 (기존 비용을 새 값으로 바꿈)" : "✅ 저장 완료") : `❌ ${j2.error || j2.message}`);
          if (res2.ok) { setDescription(""); setAmount(""); setNote(""); onSaved?.(); }
        } else {
          setStatus("취소됨: 저장하지 않았습니다");
        }
      } else {
        setStatus(res.ok ? "✅ 저장 완료" : `❌ ${json.error || json.message}`);
        if (res.ok) { setDescription(""); setAmount(""); setNote(""); onSaved?.(); }
      }
    } catch { setStatus("❌ 네트워크 오류"); }
  };

  const sel = "border rounded px-2 py-1.5 text-sm bg-transparent w-full";

  return (
    <Card data-tour="daily-misc-cost">
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

export function EventInputCard() {
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
    freshFetch(`/api/events?from=${today}&to=${today}`)
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
    <Card data-tour="daily-event">
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
