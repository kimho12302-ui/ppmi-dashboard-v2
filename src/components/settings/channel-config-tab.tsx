"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { freshFetch } from "@/lib/fresh-fetch";
import { API, StatusBadge } from "@/components/settings/shared";

/* ── 채널 설정 탭 ── */
interface ChannelRow { id: number; key: string; label: string; color: string; type: string; auto: boolean; order: number; active: boolean }

export function ChannelConfigTab() {
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ key: "", label: "", color: "#6b7280", type: "ad", auto: false, order: 0, active: true });

  const load = useCallback(async () => {
    const res = await freshFetch(`${API}?type=channel_config`);
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
