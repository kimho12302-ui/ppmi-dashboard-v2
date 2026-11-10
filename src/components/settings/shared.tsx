"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export const API = "/api/settings";

// ★ IA(2026-09): 매일 하는 입력(daily/upload)과 어쩌다 만지는 설정(나머지)을 분리한다.
//   이전에는 7개가 한 줄에 섞여 있었고 진입점이 사이드바 최하단 "설정" 뿐이라,
//   최빈 작업이 configuration 뒤에 숨어 있었다. /daily 가 앞의 둘만 보여준다.
export const DAILY_TAB_KEYS = ["daily", "upload"] as const;

export const TABS = [
  { key: "daily", label: "📋 일일 입력" },
  { key: "upload", label: "📤 엑셀 업로드" },
  { key: "brands", label: "🏷️ 브랜드" },
  { key: "channels", label: "📡 채널" },
  { key: "costs", label: "💰 제품 원가" },
  { key: "targets", label: "🎯 목표 설정" },
  { key: "events", label: "📅 이벤트 관리" },
  { key: "inventory", label: "📦 재고" },
] as const;

export type Tab = (typeof TABS)[number]["key"];

/* ── 공통 ── */
export function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const isOk = status.includes("완료") || status.includes("성공");
  return <div className={`text-sm px-3 py-1.5 rounded ${isOk ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"}`}>{status}</div>;
}

/* ── 날짜 행 테이블 (v2 ManualAdInput 방식) ── */
let _rowIdCounter = 0;
type RowStatus = "pending" | "saving" | "done" | "error";
type ManualRow = { id: number; date: string; values: Record<string, string>; status: RowStatus; message?: string };
type FieldDef = { key: string; label: string; placeholder?: string; type?: "number" | "select" | "text"; options?: { key: string; label: string }[]; width?: string };

function makeRow(date: string): ManualRow {
  return { id: ++_rowIdCounter, date, values: {}, status: "pending" };
}

export function ManualRowTable({
  title, fields, onSave, today, onSaved, missingDates,
}: {
  title: string;
  fields: FieldDef[];
  onSave: (row: { date: string } & Record<string, string>) => Promise<{ ok?: boolean; message?: string; error?: string; sheetSyncTriggered?: boolean }>;
  today: string;
  onSaved?: () => void;
  /** 이 항목의 미입력 날짜. 주/월 단위로 몰아서 입력하는 운영 방식이라 한 번에 행을 깔 수 있게 한다. */
  missingDates?: string[];
}) {
  const [rows, setRows] = useState<ManualRow[]>([makeRow(today)]);
  // 저장 후 요약: 시트 자동반영 여부까지 표시 ("넣었는데 시트에 왜 없어?" 혼란 방지, 2026-07 사용성 리뷰)
  const [summary, setSummary] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);

  const update = (id: number, patch: Partial<ManualRow>) =>
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));

  const setVal = (id: number, key: string, val: string) =>
    setRows(prev => prev.map(r => r.id === id ? { ...r, values: { ...r.values, [key]: val } } : r));

  const removeRow = (id: number) => setRows(prev => prev.filter(r => r.id !== id));

  const saveAll = async () => {
    setSummary(null);
    let saved = 0, failed = 0;
    let syncTrue = 0, syncFalse = 0; // sheetSyncTriggered 값이 온 응답만 집계 (GFA 등 시트연동 폼)
    for (const row of rows) {
      if (row.status !== "pending") continue;
      update(row.id, { status: "saving" });
      try {
        const payload: Record<string, string> = { date: row.date };
        for (const f of fields) payload[f.key] = row.values[f.key] || "";
        const res = await onSave(payload as { date: string } & Record<string, string>);
        if (res.error) {
          update(row.id, { status: "error", message: res.error });
          failed++;
        } else {
          update(row.id, { status: "done", message: res.message || "저장 완료" });
          saved++;
          if (res.sheetSyncTriggered === true) syncTrue++;
          else if (res.sheetSyncTriggered === false) syncFalse++;
        }
      } catch {
        update(row.id, { status: "error", message: "네트워크 오류" });
        failed++;
      }
    }
    if (saved > 0) {
      if (syncFalse > 0) {
        setSummary({
          tone: "warn",
          text: `${saved}건 저장 완료 (대시보드 즉시 반영). ⚠️ 통계시트 즉시반영은 실패, 다음 자동싱크(매일 09시·21시)에 반영됩니다.`,
        });
      } else if (syncTrue > 0) {
        setSummary({ tone: "ok", text: `${saved}건 저장 완료 · 통계시트 자동반영 시작됨 (~1분 내)` });
      } else {
        setSummary({ tone: "ok", text: `${saved}건 저장 완료` });
      }
    } else if (failed > 0) {
      setSummary({ tone: "error", text: `저장 실패 ${failed}건: 각 행의 ❌에 마우스를 올리면 사유가 보입니다.` });
    }
    if (saved > 0) onSaved?.();
  };

  const pendingCount = rows.filter(r => r.status === "pending").length;

  return (
    <div className="space-y-2">
      <h3 className="font-medium text-sm">{title}</h3>
      {/* 헤더 */}
      <div className="flex items-center gap-1 text-xs text-muted-foreground px-0.5">
        <span className="w-32 shrink-0">날짜</span>
        {fields.map(f => <span key={f.key} className={cn("flex-1 min-w-0 truncate", f.width)}>{f.label}</span>)}
        <span className="w-8 shrink-0" />
      </div>
      {rows.map(row => {
        const isPending = row.status === "pending";
        return (
          <div key={row.id} className={cn("flex items-center gap-1 p-1.5 rounded-lg border transition-all",
            row.status === "done" ? "border-emerald-300 bg-emerald-500/5 dark:border-emerald-800" :
            row.status === "error" ? "border-red-300 bg-red-500/5 dark:border-red-800" :
            "border-border")}>
            <input type="date" value={row.date} onChange={e => update(row.id, { date: e.target.value })}
              disabled={!isPending}
              className="w-32 shrink-0 text-xs border rounded px-2 py-1 bg-transparent disabled:opacity-60" />
            {fields.map(f => (
              f.type === "select" && f.options ? (
                <select key={f.key} value={row.values[f.key] || ""} onChange={e => setVal(row.id, f.key, e.target.value)}
                  disabled={!isPending}
                  className={cn("flex-1 min-w-0 text-xs border rounded px-1 py-1 bg-transparent disabled:opacity-60", f.width)}>
                  {f.options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
              ) : (
                <input key={f.key} type={f.type || "number"} placeholder={f.placeholder || "0"}
                  value={row.values[f.key] || ""} onChange={e => setVal(row.id, f.key, e.target.value)}
                  disabled={!isPending}
                  className={cn("flex-1 min-w-0 text-xs border rounded px-2 py-1 bg-transparent disabled:opacity-60", f.width)} />
              )
            ))}
            <div className="w-8 shrink-0 flex items-center justify-center text-xs">
              {isPending && <button onClick={() => removeRow(row.id)} className="text-muted-foreground hover:text-red-500">✕</button>}
              {row.status === "saving" && <span className="animate-pulse text-blue-500">⏳</span>}
              {row.status === "done" && <span className="text-emerald-500" title={row.message}>✅</span>}
              {row.status === "error" && <span className="text-red-500" title={row.message}>❌</span>}
            </div>
          </div>
        );
      })}
      {summary && (
        <div className={cn("text-xs px-3 py-2 rounded-md border",
          summary.tone === "ok" ? "border-emerald-300 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 dark:border-emerald-800" :
          summary.tone === "warn" ? "border-amber-300 bg-amber-500/10 text-amber-700 dark:text-amber-400 dark:border-amber-800" :
          "border-red-300 bg-red-500/10 text-red-700 dark:text-red-400 dark:border-red-800")}>
          {summary.text}
        </div>
      )}
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-3">
          <button onClick={() => setRows(prev => [...prev, makeRow(today)])}
            className="text-xs text-primary hover:underline">+ 날짜 추가</button>
          {/* 몰아서 입력할 때 23~30개 행을 손으로 추가하고 날짜를 하나하나 고치는 게 실제 마찰 지점이었다. */}
          {missingDates && missingDates.length > 0 && (
            <button
              onClick={() => {
                const have = new Set(rows.map(r => r.date));
                const add = missingDates.filter(d => !have.has(d)).sort();
                if (add.length === 0) return;
                // 비어있는 기본 행(오늘, 값 미입력)만 있으면 치우고 누락 날짜로 대체
                const keep = rows.filter(r => r.status !== "pending" || Object.keys(r.values).length > 0);
                setRows([...keep, ...add.map(makeRow)]);
              }}
              className="text-xs text-orange-600 dark:text-orange-400 hover:underline">
              ⚡ 미입력 {missingDates.length}일 한 번에 채우기
            </button>
          )}
        </div>
        {pendingCount > 0 && (
          <button onClick={saveAll}
            className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-md font-medium hover:opacity-90">
            💾 저장 ({pendingCount}건)
          </button>
        )}
      </div>
    </div>
  );
}
