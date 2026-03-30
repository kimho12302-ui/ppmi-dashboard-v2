"use client";

import { useState, useCallback } from "react";
import { useFetch } from "@/hooks/use-dashboard-data";
import { Loading } from "@/components/ui/loading";
import { Card } from "@/components/ui/card";
import { BRAND_LABELS, BRAND_COLORS } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import type { ProductCost } from "@/lib/types";

interface SettingsData {
  costs: ProductCost[];
  allProducts: { product: string; brand: string }[];
  missingProducts: { product: string; brand: string }[];
}

export default function SettingsPage() {
  const { data, loading, refetch } = useFetch<SettingsData>("/api/settings");
  const [form, setForm] = useState({ product: "", brand: "", cost_price: "", shipping_cost: "", category: "" });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadingSales, setUploadingSales] = useState(false);
  const [message, setMessage] = useState("");
  const [salesMessage, setSalesMessage] = useState("");
  const [salesDate, setSalesDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split("T")[0];
  });

  const handleSave = useCallback(async () => {
    if (!form.product || !form.brand) return;
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product: form.product,
          brand: form.brand,
          cost_price: Number(form.cost_price) || 0,
          shipping_cost: Number(form.shipping_cost) || 0,
          category: form.category,
        }),
      });
      if (!res.ok) throw new Error("저장 실패");
      setMessage("✅ 저장 완료");
      setForm({ product: "", brand: "", cost_price: "", shipping_cost: "", category: "" });
      refetch();
    } catch {
      setMessage("❌ 저장 실패");
    } finally {
      setSaving(false);
    }
  }, [form, refetch]);

  const handleDelete = useCallback(async (product: string, brand: string) => {
    if (!confirm(`"${product}" 원가 정보를 삭제하시겠습니까?`)) return;
    try {
      await fetch(`/api/settings?product=${encodeURIComponent(product)}&brand=${encodeURIComponent(brand)}`, { method: "DELETE" });
      refetch();
    } catch {
      alert("삭제 실패");
    }
  }, [refetch]);

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setMessage("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("type", "product_costs");
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "업로드 실패");
      setMessage(`✅ ${json.count}건 업로드 완료`);
      refetch();
    } catch (err) {
      setMessage(`❌ ${err instanceof Error ? err.message : "업로드 실패"}`);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }, [refetch]);

  const handleSalesUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!salesDate) {
      setSalesMessage("❌ 날짜를 선택하세요");
      return;
    }
    setUploadingSales(true);
    setSalesMessage("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("type", "sales");
      formData.append("fileDate", salesDate);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const json = await res.json();
      if (!res.ok) {
        // 미등록 품목코드가 있는 경우
        if (json.unmatchedProducts && json.unmatchedProducts.length > 0) {
          const unmatchedList = json.unmatchedProducts
            .map((p: any) => `${p.code} (${p.name}) - ${p.count}건`)
            .join("\n");
          const message = `${json.error}\n\n미등록 품목코드 (${json.totalUnmatched}개):\n${unmatchedList}\n\n상품 목록 탭에 먼저 등록해주세요.`;
          alert(message);
          throw new Error(json.error);
        }
        throw new Error(json.error || "업로드 실패");
      }
      setSalesMessage(`✅ ${json.date} 매출 ${json.count}건 업로드 완료`);
    } catch (err) {
      setSalesMessage(`❌ ${err instanceof Error ? err.message : "업로드 실패"}`);
    } finally {
      setUploadingSales(false);
      e.target.value = "";
    }
  }, [salesDate]);

  const handleMissingClick = (product: string, brand: string) => {
    setForm((prev) => ({ ...prev, product, brand }));
  };

  if (loading) return <Loading />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">설정</h1>
        <p className="text-sm text-muted-foreground">제품 원가 관리 및 데이터 업로드</p>
      </div>

      {/* Missing Products Warning */}
      {data && data.missingProducts.length > 0 && (
        <Card className="border-amber-500/50 bg-amber-500/5">
          <div className="px-6 py-4">
            <h3 className="text-sm font-semibold text-amber-600 dark:text-amber-400 mb-2">
              ⚠️ 원가 미등록 제품 ({data.missingProducts.length}건)
            </h3>
            <div className="flex flex-wrap gap-2">
              {data.missingProducts.slice(0, 20).map((p, i) => (
                <button
                  key={i}
                  onClick={() => handleMissingClick(p.product, p.brand)}
                  className="text-xs px-2 py-1 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 transition-colors"
                >
                  {p.product}
                </button>
              ))}
              {data.missingProducts.length > 20 && (
                <span className="text-xs text-muted-foreground py-1">... 외 {data.missingProducts.length - 20}건</span>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Cost Entry Form */}
      <Card>
        <div className="px-6 py-4 border-b">
          <h3 className="text-sm font-semibold text-muted-foreground">제품 원가 등록</h3>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">제품</label>
              <select
                value={form.product}
                onChange={(e) => {
                  const p = data?.allProducts.find((ap) => ap.product === e.target.value);
                  setForm((prev) => ({ ...prev, product: e.target.value, brand: p?.brand || prev.brand }));
                }}
                className="w-full px-3 py-2 rounded-lg border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="">제품 선택</option>
                {data?.allProducts.map((p, i) => (
                  <option key={i} value={p.product}>{p.product} ({BRAND_LABELS[p.brand] || p.brand})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">브랜드</label>
              <select
                value={form.brand}
                onChange={(e) => setForm((prev) => ({ ...prev, brand: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="">브랜드 선택</option>
                {Object.entries(BRAND_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">카테고리</label>
              <input
                type="text"
                value={form.category}
                onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
                placeholder="간식, 사료, 영양제..."
                className="w-full px-3 py-2 rounded-lg border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">원가 (원)</label>
              <input
                type="number"
                value={form.cost_price}
                onChange={(e) => setForm((prev) => ({ ...prev, cost_price: e.target.value }))}
                placeholder="0"
                className="w-full px-3 py-2 rounded-lg border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">배송비 (원)</label>
              <input
                type="number"
                value={form.shipping_cost}
                onChange={(e) => setForm((prev) => ({ ...prev, shipping_cost: e.target.value }))}
                placeholder="0"
                className="w-full px-3 py-2 rounded-lg border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={handleSave}
                disabled={saving || !form.product || !form.brand}
                className="w-full px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {saving ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
          {message && <p className="text-sm">{message}</p>}
        </div>
      </Card>

      {/* CSV Upload (원가) */}
      <Card>
        <div className="px-6 py-4 border-b">
          <h3 className="text-sm font-semibold text-muted-foreground">제품 원가 CSV/XLSX 업로드</h3>
        </div>
        <div className="px-6 py-4">
          <p className="text-xs text-muted-foreground mb-3">
            컬럼: product(제품), brand(브랜드), cost_price(원가), shipping_cost(배송비), category(카테고리)
          </p>
          <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border bg-card text-sm font-medium cursor-pointer hover:bg-muted transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            {uploading ? "업로드 중..." : "파일 선택"}
            <input type="file" accept=".csv,.xlsx,.xls" onChange={handleUpload} className="hidden" disabled={uploading} />
          </label>
        </div>
      </Card>

      {/* 매출 파일 업로드 */}
      <Card>
        <div className="px-6 py-4 border-b">
          <h3 className="text-sm font-semibold text-muted-foreground">매출 파일 업로드</h3>
        </div>
        <div className="px-6 py-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            판매정리 엑셀 업로드 (거래처명, 브랜드명, 제품, 수량, 구매자 수, 매출)
          </p>
          <div className="flex items-center gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">날짜</label>
              <input
                type="date"
                value={salesDate}
                onChange={(e) => setSalesDate(e.target.value)}
                className="px-3 py-2 rounded-lg border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-muted-foreground mb-1">파일</label>
              <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border bg-card text-sm font-medium cursor-pointer hover:bg-muted transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                {uploadingSales ? "업로드 중..." : "매출 파일 선택"}
                <input type="file" accept=".xlsx,.xls" onChange={handleSalesUpload} className="hidden" disabled={uploadingSales} />
              </label>
            </div>
          </div>
          {salesMessage && <p className="text-sm">{salesMessage}</p>}
        </div>
      </Card>

      {/* Registered Costs Table */}
      <Card>
        <div className="px-6 py-4 border-b">
          <h3 className="text-sm font-semibold text-muted-foreground">등록된 제품 원가 ({data?.costs.length || 0}건)</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="px-6 py-3 font-medium text-muted-foreground">제품</th>
                <th className="px-6 py-3 font-medium text-muted-foreground">브랜드</th>
                <th className="px-6 py-3 font-medium text-muted-foreground">카테고리</th>
                <th className="px-6 py-3 font-medium text-muted-foreground text-right">원가</th>
                <th className="px-6 py-3 font-medium text-muted-foreground text-right">배송비</th>
                <th className="px-6 py-3 font-medium text-muted-foreground text-right">작업</th>
              </tr>
            </thead>
            <tbody>
              {(data?.costs || []).map((row, i) => (
                <tr key={i} className="border-b last:border-b-0 hover:bg-muted/50 transition-colors">
                  <td className="px-6 py-3">{row.product}</td>
                  <td className="px-6 py-3">
                    <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ backgroundColor: BRAND_COLORS[row.brand] || "#888" }} />
                    {BRAND_LABELS[row.brand] || row.brand}
                  </td>
                  <td className="px-6 py-3 text-muted-foreground">{row.category}</td>
                  <td className="px-6 py-3 text-right">{formatCurrency(row.cost_price)}</td>
                  <td className="px-6 py-3 text-right">{formatCurrency(row.shipping_cost)}</td>
                  <td className="px-6 py-3 text-right">
                    <button
                      onClick={() => handleDelete(row.product, row.brand)}
                      className="text-red-500 hover:text-red-400 text-xs"
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
              {(data?.costs || []).length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">
                    등록된 원가 정보가 없습니다
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
