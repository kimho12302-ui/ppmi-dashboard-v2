"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { freshFetch } from "@/lib/fresh-fetch";
import { API, StatusBadge } from "@/components/settings/shared";

/* ── 제품 원가 탭 ── */
interface CostRow { product: string; brand: string; cost_price: number; manufacturing_cost: number; shipping_cost: number; category: string }
interface ShippingRow { id: number; month: string; brand: string; total_cost: number; total_orders: number; note: string }

const BRAND_OPTIONS = [
  { key: "nutty", label: "너티" }, { key: "ironpet", label: "아이언펫" },
  { key: "saip", label: "사입" }, { key: "balancelab", label: "밸런스랩" },
];
const BRAND_LABEL: Record<string, string> = { nutty: "너티", ironpet: "아이언펫", saip: "사입", balancelab: "밸런스랩" };

export function CostTab() {
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
      freshFetch(`${API}?type=product_costs`).then(r => r.json()),
      freshFetch(API).then(r => r.json()),
    ]);
    setCosts(costsRes.productCosts || []);
    setMissing(allRes.missingProducts || []);
  }, []);

  const loadShipping = useCallback(async () => {
    const res = await freshFetch(`${API}?type=shipping_costs`).then(r => r.json());
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
      <div data-tour="settings-cost-subtabs" className="flex gap-2">
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
              <div data-tour="settings-cost-missing" className="text-sm bg-amber-500/10 text-amber-600 p-3 rounded">
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
                      <td className="py-1.5 px-2 text-xs text-muted-foreground">{c.category || "-"}</td>
                      <td className="py-1.5 px-2 text-right">{c.cost_price?.toLocaleString()}원</td>
                      <td className="py-1.5 px-2 text-right text-muted-foreground">{c.manufacturing_cost ? `${c.manufacturing_cost.toLocaleString()}원` : "-"}</td>
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

            <div data-tour="settings-cost-form" className="border-t pt-4">
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
                      <td className="py-1.5 px-2 text-right">{s.total_orders ? `${Math.round(s.total_cost / s.total_orders).toLocaleString()}원` : "-"}</td>
                      <td className="py-1.5 px-2 text-xs text-muted-foreground">{s.note || "-"}</td>
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
