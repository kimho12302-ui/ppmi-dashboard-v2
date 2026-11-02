"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { SalesCoverage } from "@/components/sales-coverage";
import { freshFetch } from "@/lib/fresh-fetch";

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

  // 업로드 중 재클릭 차단. 두 번 누르면 같은 파일이 두 줄로 동시에 올라가 통계시트가 줄 번호 경합으로
  // 깨졌다(2026-07-11·09-04 전 브랜드 2배, 08-28·08-30 스마트스토어 행 소실). state 는 재렌더 전에
  // 두 번째 클릭을 못 막으므로 ref 로 잡는다.
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const uploadAll = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await uploadPending();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const uploadPending = async () => {
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
              <div className={cn("flex-1 text-xs px-3 py-1.5 rounded whitespace-pre-line leading-relaxed",
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
          <button type="button" onClick={uploadAll} disabled={busy}
            className="px-3 py-1.5 bg-primary text-primary-foreground rounded text-xs font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed">
            {busy ? "⏳ 업로드 중..." : `💾 전체 업로드 (${pendingWithFile.length}건)`}
          </button>
        )}
      </div>
    </div>
  );
}

/* ── 📤 엑셀 업로드 탭 ── */
export function UploadTab() {
  const today = new Date(Date.now() + 32400000).toISOString().slice(0, 10);
  const [missingSales, setMissingSales] = useState<string[]>([]);
  const [missingCoupangFunnel, setMissingCoupangFunnel] = useState<string[]>([]);
  const [missingCoupangAds, setMissingCoupangAds] = useState<string[]>([]);
  const [coupangAdsDate, setCoupangAdsDate] = useState(today);
  const [coupangAdsStatus, setCoupangAdsStatus] = useState<string | null>(null);
  const [coupangAdsUploading, setCoupangAdsUploading] = useState(false);

  const refreshMissing = useCallback(() => {
    freshFetch("/api/missing-dates")
      .then(r => r.json())
      .then(d => {
        setMissingSales(d.sales || []);
        setMissingCoupangFunnel(d.coupang_funnel || []);
        setMissingCoupangAds(d.coupang_ads || []);
        if (d.coupang_ads?.length) setCoupangAdsDate(d.coupang_ads[0]);
      });
  }, []);

  useEffect(() => { refreshMissing(); }, [refreshMissing]);

  // 업로드 성공 후 DB를 다시 읽어 실제 반영을 증명 (응답 메시지가 아니라 재조회한 값).
  // + 대시보드/통계시트 반영 시점 안내로 "안 들어갔다" 착시 제거.
  const verifyUpload = async (sourceId: string): Promise<string> => {
    try {
      const r = await freshFetch("/api/data-status");
      if (!r.ok) return "";
      const d = await r.json();
      const s = (d.sources || []).find((x: { id: string }) => x.id === sourceId);
      const tail = " · 새로고침 시 대시보드 즉시 반영, 통계시트는 다음 싱크";
      if (!s) return tail;
      return `\n🔎 DB 재확인: ${s.label} 최신 ${s.latestDate ? s.latestDate.slice(5) : "없음"}${tail}`;
    } catch { return ""; }
  };

  const uploadSales = async (_date: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/upload-sales", { method: "POST", body: form });
    const data = await res.json();
    const formatUnmatched = (items: { code: string; name?: string; count: number; firstRow?: number; rowSample?: string[] }[]) =>
      items.map(p => {
        const hasName = p.name && p.name !== p.code;
        // 상품명을 앞세움 → '상품 목록' 탭에 이 이름으로 등록하면 됨. 행번호로 때우지 않는다.
        if (hasName) return `  · ${p.name}  (코드 ${p.code}, ${p.count}건)`;
        // 파일에 상품명 컬럼이 정말 없을 때만 행 내용을 보여 식별을 돕는다 (행번호 X)
        const rowContent = p.rowSample && p.rowSample.filter(Boolean).length > 0
          ? ` — 행 내용: ${p.rowSample.filter(Boolean).join(" | ")}`
          : "";
        return `  · 코드 ${p.code}  (${p.count}건)${rowContent}`;
      }).join("\n");
    if (data.ok) {
      const brands = data.brandSummary
        ? Object.entries(data.brandSummary as Record<string, { count: number }>).map(([b, info]) =>
            `${({ nutty: "너티", ironpet: "아이언펫", saip: "사입", balancelab: "밸런스랩" } as Record<string,string>)[b] || b} ${info.count}건`
          ).join(", ")
        : "";
      let msg = `✅ ${data.parsed}건 파싱 | ${brands}`;
      if (data.unmatchedProducts?.length) {
        msg += `\n⚠️ 미등록 품목코드 ${data.totalUnmatched}개:\n${formatUnmatched(data.unmatchedProducts)}`;
      }
      if (data.sheetError) {
        msg += `\n⚠️ DB 는 저장됐지만 통계시트 기록 실패: ${data.sheetError}`;
      }
      if (data.sheetMismatch?.length) {
        const lines = (data.sheetMismatch as { date: string; expectedRows: number; sheetRows: number }[])
          .map(m => `${m.date.slice(5)} 기대 ${m.expectedRows}행 · 시트 ${m.sheetRows}행`).join(", ");
        msg += `\n⚠️ 통계시트가 DB 와 다릅니다 (${lines}). 같은 파일을 한 번 더 올리면 그 날짜가 다시 쓰입니다.`;
      }
      msg += await verifyUpload("sales");
      return { ok: true, message: msg };
    }
    // 에러인 경우에도 미등록 코드가 있으면 표시
    if (data.unmatchedProducts?.length) {
      return {
        ok: false,
        error: `${data.error}\n미등록 품목코드 ${data.totalUnmatched}개:\n${formatUnmatched(data.unmatchedProducts)}`,
      };
    }
    return { ok: false, error: data.error || "업로드 실패" };
  };

  const uploadCoupangFunnel = async (date: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    form.append("date", date);
    const res = await fetch("/api/upload-coupang-funnel", { method: "POST", body: form });
    const data = await res.json();
    if (data.ok) {
      let msg = `✅ ${data.message || `${data.funnel}일 퍼널 반영`}`;
      if (Array.isArray(data.warnings) && data.warnings.length > 0) msg += ` | ${data.warnings.join(" / ")}`;
      msg += await verifyUpload("coupang_funnel");
      return { ok: true, message: msg };
    }
    let err = data.error || "업로드 실패";
    if (data.hint) err += ` — ${data.hint}`;
    if (Array.isArray(data.detectedHeaders)) err += ` | 헤더 ${data.detectedHeaders.length}개: [${data.detectedHeaders.slice(0, 20).join(", ")}]`;
    return { ok: false, error: err };
  };

  const uploadCoupangAds = async (file: File) => {
    setCoupangAdsUploading(true);
    setCoupangAdsStatus(null);
    const form = new FormData();
    form.append("file", file);
    form.append("date", coupangAdsDate);
    const res = await fetch("/api/upload-coupang-ads", { method: "POST", body: form });
    const data = await res.json();
    if (data.ok) {
      const v = await verifyUpload("coupang_ads");
      setCoupangAdsStatus(`✅ ${data.message}${v}`);
      refreshMissing();
    } else {
      setCoupangAdsStatus(`❌ ${data.error || "업로드 실패"}`);
    }
    setCoupangAdsUploading(false);
  };

  return (
    <div className="space-y-4">
      <SalesCoverage />
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
