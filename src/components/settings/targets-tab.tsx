"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { freshFetch } from "@/lib/fresh-fetch";
import { StatusBadge } from "@/components/settings/shared";

/* ── 목표 설정 탭 (monthly_targets가 없으면 안내 표시) ── */
export function TargetsTab() {
  const [targets, setTargets] = useState<Record<string, { revenue_target: number; ad_budget_target: number; roas_target: number; cac_target?: number }>>({});
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [brand, setBrand] = useState("all");
  const [revenue, setRevenue] = useState("");
  const [adBudget, setAdBudget] = useState("");
  const [roas, setRoas] = useState("");
  const [cac, setCac] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [tableExists, setTableExists] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await freshFetch("/api/targets");
      if (!res.ok) { setTableExists(false); return; }
      const json = await res.json();
      setTargets(json.targets || {});
    } catch { setTableExists(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // 월/브랜드 선택 시 기존 목표 자동 채움 (추가가 아닌 편집)
  useEffect(() => {
    const t = targets[`${month}_${brand}`];
    if (t) {
      setRevenue(String(t.revenue_target || ""));
      setAdBudget(String(t.ad_budget_target || ""));
      setRoas(String(t.roas_target || ""));
      setCac(String(t.cac_target || ""));
    } else {
      setRevenue(""); setAdBudget(""); setRoas(""); setCac("");
    }
  }, [month, brand, targets]);

  // ROAS 자동 계산 (매출/광고비). 직접 입력값 있으면 우선.
  const autoRoas = revenue && adBudget && Number(adBudget) > 0 ? (Number(revenue) / Number(adBudget)) : 0;
  const adRatio = revenue && adBudget && Number(revenue) > 0 ? (Number(adBudget) / Number(revenue) * 100) : 0;

  const save = async () => {
    setStatus(null);
    const roasToSave = roas || (autoRoas ? autoRoas.toFixed(4) : "0");
    const res = await fetch("/api/targets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month, brand, revenue_target: revenue, ad_budget_target: adBudget, roas_target: roasToSave, cac_target: cac, note: "운영자 입력" }),
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
    <Card data-tour="settings-targets">
      <CardContent className="p-4 space-y-4">
        <h3 className="font-semibold">월별 목표 설정</h3>
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
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
          <div><label className="text-xs text-muted-foreground">ROAS 목표 {autoRoas > 0 && !roas && <span className="text-primary">(자동 {autoRoas.toFixed(2)}x)</span>}</label>
            <input type="number" value={roas} onChange={(e) => setRoas(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm bg-transparent mt-0.5" placeholder={autoRoas > 0 ? autoRoas.toFixed(2) : "0"} step="0.1" /></div>
          <div><label className="text-xs text-muted-foreground">CAC 목표 <span className="text-muted-foreground/60">(주문당 광고비)</span></label>
            <input type="number" value={cac} onChange={(e) => setCac(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm bg-transparent mt-0.5" placeholder="0" /></div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={save} className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90">저장</button>
          <StatusBadge status={status} />
          {adRatio > 0 && <span className="text-xs text-muted-foreground">광고비 비중 {adRatio.toFixed(1)}% · ROAS {autoRoas.toFixed(2)}x (매출/광고비 자동)</span>}
        </div>

        {Object.keys(targets).length > 0 && (
          <div className="border-t pt-3">
            <h4 className="text-sm font-medium mb-2">등록된 목표</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left">
                  <th className="py-2 px-2">월</th><th className="py-2 px-2">브랜드</th><th className="py-2 px-2 text-right">매출 목표</th><th className="py-2 px-2 text-right">광고비 예산</th><th className="py-2 px-2 text-right">ROAS 목표</th><th className="py-2 px-2 text-right">CAC 목표</th>
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
                        <td className="py-1.5 px-2 text-right">{t.cac_target ? `${t.cac_target.toLocaleString()}원` : "-"}</td>
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
