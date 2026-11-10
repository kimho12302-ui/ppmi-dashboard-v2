"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { freshFetch } from "@/lib/fresh-fetch";
import { API, StatusBadge } from "@/components/settings/shared";
import { BRAND_COLORS } from "@/lib/types";

/* ── 브랜드 설정 탭 ── */
interface BrandRow { id: number; key: string; label: string; color: string; order: number; active: boolean; parent_key: string | null; category: string | null }

export function BrandConfigTab() {
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ key: "", label: "", color: "#6b7280", order: 0, active: true, category: "" });

  const load = useCallback(async () => {
    const res = await freshFetch(`${API}?type=brand_config`);
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
    <Card data-tour="settings-brands">
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
                  <td className="py-2 px-2"><div className="w-4 h-4 rounded" style={{ backgroundColor: BRAND_COLORS[b.key] || b.color }} title={BRAND_COLORS[b.key] ? "고정 색(화면에 쓰이는 색)" : "설정 색"} /></td>
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
          {/* 색 정본은 src/lib/types.ts 다(2026-11-09). useConfig 는 거기 있는 키엔 상수 색을 써서, 기본 브랜드 색은 여기서 바꿔도 화면에 반영되지 않는다. */}
          <p className="text-xs text-muted-foreground mt-2">색상: 기본 브랜드(너티·아이언펫·사입·밸런스랩) 색은 모든 화면에서 같게 고정되어 여기서 바꿔도 반영되지 않습니다. 새로 추가한 브랜드에만 적용됩니다.</p>
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

