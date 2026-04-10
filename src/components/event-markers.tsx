"use client";

import { useState, useEffect } from "react";
import { useFilterParams } from "@/hooks/use-dashboard-data";  // used in useEvents()

export interface MarketingEvent {
  id: number;
  date: string;
  brand: string;
  title: string;
  description?: string;
  color: string;
}

/** 이벤트 데이터 fetcher hook */
export function useEvents() {
  const { from, to, brand } = useFilterParams();
  const [events, setEvents] = useState<MarketingEvent[]>([]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    // brand "all"이면 전체 조회
    if (brand && brand !== "all") params.set("brand", brand);
    fetch(`/api/events?${params}`)
      .then((r) => r.json())
      .then((d) => setEvents(d.events || []))
      .catch(() => setEvents([]));
  }, [from, to, brand]);

  return events;
}

/** Recharts ReferenceLine props 배열로 변환 (LineChart/AreaChart에 ...spread해서 사용) */
export function buildEventReferenceLines(events: MarketingEvent[]) {
  return events.map((e) => ({
    x: e.date,
    stroke: e.color || "#6366f1",
    strokeDasharray: "4 4",
    strokeWidth: 1.5,
    label: {
      value: e.title.length > 8 ? e.title.slice(0, 8) + "…" : e.title,
      position: "top" as const,
      fill: e.color || "#6366f1",
      fontSize: 9,
      fontWeight: 600,
    },
  }));
}

/** 차트 아래에 표시되는 이벤트 뱃지 목록 */
export function EventBadges({ events }: { events: MarketingEvent[] }) {
  if (!events.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {events.map((e) => (
        <span
          key={e.id}
          className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border"
          style={{ borderColor: e.color, color: e.color }}
          title={e.description || e.title}
        >
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: e.color }} />
          {e.date.slice(5)} {e.title}
        </span>
      ))}
    </div>
  );
}

/** 이벤트 추가/삭제 패널 (settings에서 사용) */
export function EventManagerPanel() {
  const events = useEvents();
  const [localEvents, setLocalEvents] = useState<MarketingEvent[]>([]);
  const [form, setForm] = useState({ date: "", brand: "all", title: "", description: "", color: "#6366f1" });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => { setLocalEvents(events); }, [events]);

  async function addEvent() {
    if (!form.title.trim() || !form.date) { setMsg("날짜와 이벤트명을 입력하세요"); return; }
    setSaving(true);
    try {
      const r = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const d = await r.json();
      if (d.ok) {
        setLocalEvents((prev) => [...prev, d.event].sort((a, b) => a.date.localeCompare(b.date)));
        setForm({ date: "", brand: "all", title: "", description: "", color: "#6366f1" });
        setMsg("이벤트 추가됨");
      } else {
        setMsg(d.error || "오류");
      }
    } catch {
      setMsg("저장 실패");
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(""), 2000);
    }
  }

  async function deleteEvent(id: number) {
    await fetch(`/api/events?id=${id}`, { method: "DELETE" });
    setLocalEvents((prev) => prev.filter((e) => e.id !== id));
  }

  const BRAND_OPTIONS = [
    { value: "all", label: "전체" },
    { value: "nutty", label: "너티" },
    { value: "ironpet", label: "아이언펫" },
    { value: "balancelab", label: "밸런스랩" },
    { value: "saip", label: "사입" },
  ];

  const COLORS = ["#6366f1", "#22c55e", "#f97316", "#ec4899", "#3b82f6", "#ef4444", "#eab308", "#14b8a6"];

  return (
    <div className="space-y-4">
      {/* 추가 폼 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <input
          type="date" value={form.date}
          onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
          className="text-sm px-2 py-1.5 rounded bg-muted border border-border"
        />
        <select
          value={form.brand}
          onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
          className="text-sm px-2 py-1.5 rounded bg-muted border border-border"
        >
          {BRAND_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <input
          type="text" placeholder="이벤트명 (예: 카카오 프로모션)" value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          className="text-sm px-2 py-1.5 rounded bg-muted border border-border col-span-2 md:col-span-1"
        />
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {COLORS.map(c => (
              <button key={c} onClick={() => setForm(f => ({ ...f, color: c }))}
                className="w-5 h-5 rounded-full border-2 transition-all"
                style={{ background: c, borderColor: form.color === c ? "white" : c }}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text" placeholder="설명 (선택)" value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          className="text-sm px-2 py-1.5 rounded bg-muted border border-border flex-1"
        />
        <button
          onClick={addEvent} disabled={saving}
          className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded disabled:opacity-50"
        >
          {saving ? "저장 중…" : "이벤트 추가"}
        </button>
        {msg && <span className="text-xs text-green-600">{msg}</span>}
      </div>

      {/* 목록 */}
      {localEvents.length === 0 ? (
        <p className="text-sm text-muted-foreground">등록된 이벤트가 없습니다.</p>
      ) : (
        <div className="space-y-1">
          {localEvents.map((e) => (
            <div key={e.id} className="flex items-center gap-3 py-1.5 border-b border-border/50">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: e.color }} />
              <span className="text-xs text-muted-foreground w-20 flex-shrink-0">{e.date}</span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-muted flex-shrink-0">
                {BRAND_OPTIONS.find(b => b.value === e.brand)?.label || e.brand}
              </span>
              <span className="text-sm font-medium flex-1 truncate">{e.title}</span>
              {e.description && <span className="text-xs text-muted-foreground truncate max-w-[140px]">{e.description}</span>}
              <button
                onClick={() => deleteEvent(e.id)}
                className="text-red-500 hover:text-red-600 text-xs px-1 flex-shrink-0"
              >
                삭제
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
