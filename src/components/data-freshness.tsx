"use client";

// 화면 머리말의 "데이터 기준 시각 · 새로고침" (2026-10-14).
//
// 서버는 읽기 응답을 5분까지 들고 있다(src/lib/api-cache.ts). 그래서 지금 보는 숫자가
// 언제 것인지 보여 주고, 기다리기 싫으면 바로 새로 받을 수 있게 버튼을 둔다.
// 시각은 이 화면이 받은 응답 중 가장 오래된 것. 직전 응답을 먼저 그리고 뒤에서 다시 받는 동안은 "갱신 중".
import { useState, useSyncExternalStore } from "react";
import { getFreshnessServerSnapshot, getFreshnessSnapshot, refreshVisibleData, subscribeFreshness } from "@/hooks/use-dashboard-data";

function kstClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // 서버 시각(UTC ISO)을 KST 로. 오늘이 아니면 날짜도 붙인다.
  const kst = new Date(d.getTime() + 9 * 3600 * 1000).toISOString();
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const hm = kst.slice(11, 16);
  return kst.slice(0, 10) === today ? hm : `${kst.slice(5, 10)} ${hm}`;
}

export function DataFreshness() {
  const snap = useSyncExternalStore(subscribeFreshness, getFreshnessSnapshot, getFreshnessServerSnapshot);
  const [busy, setBusy] = useState(false);
  const working = busy || snap.refreshing;

  const onClick = async () => {
    if (working) return;
    setBusy(true);
    try {
      await refreshVisibleData();
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="num inline-flex items-center gap-2 self-start sm:self-auto text-xs text-muted-foreground whitespace-nowrap">
      {working ? (
        <span className="inline-flex items-center gap-1" aria-live="polite">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" aria-hidden />
          갱신 중
        </span>
      ) : snap.oldestAsOf ? (
        <span title="서버가 이 숫자를 DB 에서 읽은 시각입니다. 최대 5분 지난 값일 수 있고, 수집·업로드가 끝나면 바로 새로 읽습니다.">
          데이터 기준 {kstClock(snap.oldestAsOf)}
        </span>
      ) : null}
      <button
        type="button"
        onClick={onClick}
        disabled={working}
        className="px-2 py-0.5 rounded-md border bg-card hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        새로고침
      </button>
    </span>
  );
}
