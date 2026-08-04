"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

// 소스 id → 짧은 라벨 (스트립 칩용)
const SHORT: Record<string, string> = {
  sales: "판매",
  meta_ads: "메타",
  google_ads: "구글",
  naver_sa: "네이버검색",
  naver_shopping: "네이버쇼핑",
  ga4: "GA4",
  coupang_ads: "쿠팡광고",
  coupang_funnel: "쿠팡퍼널",
  gfa: "GFA",
  smartstore_ironpet: "SS아이언펫",
  smartstore_balancelab: "SS밸런스",
  cafe24_funnel: "카페24",
};

// status → 표시 규칙. 운영중지(no_activity)는 장애 아님(회색), 연결끊김(disconnected)만 빨강.
const STATUS_META: Record<string, { dot: string; text: string; tag: string | null }> = {
  ok: { dot: "#10b981", text: "text-muted-foreground", tag: null },
  no_activity: { dot: "#9ca3af", text: "text-muted-foreground", tag: "운영중지" }, // 수집 정상, 집행 0
  disconnected: { dot: "#ef4444", text: "text-red-600 dark:text-red-400 font-medium", tag: "연결끊김" },
  stale_manual: { dot: "#f59e0b", text: "text-amber-600 dark:text-amber-400 font-medium", tag: "수기미입력" },
};

interface Source {
  id: string;
  label: string;
  type: "auto" | "manual";
  latestDate: string | null;
  ok: boolean;
  status: string;
}

function meta(s: Source) {
  return STATUS_META[s.status] || STATUS_META.ok;
}

function mmdd(d: string | null): string {
  return d ? d.slice(5) : "없음";
}

export function FreshnessStrip() {
  const [sources, setSources] = useState<Source[] | null>(null);
  const [refDate, setRefDate] = useState<string>("");
  const [expanded, setExpanded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/data-status")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { if (alive && d) { setSources(d.sources || []); setRefDate(d.referenceDate || ""); } })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  // 조회 자체가 실패하면 조용히 사라지면 안 된다 — 사라진 스트립은 "이상 없음"으로 오독된다.
  if (failed) {
    return (
      <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border border-red-300 bg-red-500/10 text-red-700 dark:text-red-400 dark:border-red-800">
        <span>⚠️</span>
        <span>데이터 최신성 확인 실패 — 아래 숫자의 신선도를 보증할 수 없습니다</span>
      </div>
    );
  }

  if (!sources || sources.length === 0) return null;

  // 카테고리별 집계 (장애와 운영중지를 분리해서 보여줌)
  const disconnectedList = sources.filter((s) => s.status === "disconnected");
  const disconnected = disconnectedList.length;
  const staleManual = sources.filter((s) => s.status === "stale_manual").length;
  const noActivity = sources.filter((s) => s.status === "no_activity").length;
  const okCount = sources.filter((s) => s.status === "ok").length;

  // ★ 기본은 요약 한 줄. 이전에는 핵심 6개 + 비정상 전부를 칩으로 뿌려 12개가 깔렸고,
  //   대시보드를 열 때마다 사업 숫자보다 정비 상태가 먼저 보였다(2026-07 사용성 리뷰).
  //   실제 장애(연결끊김)만 접힌 상태에서도 칩으로 노출한다. 수기미입력은 카운트로 충분하다.
  const shown = expanded ? sources : disconnectedList;

  const Chip = ({ s }: { s: Source }) => {
    const m = meta(s);
    return (
      <span className={`inline-flex items-center gap-1 whitespace-nowrap ${m.text}`}>
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: m.dot }} />
        {SHORT[s.id] || s.label} {mmdd(s.latestDate)}
        {m.tag && <span className="opacity-80">({m.tag})</span>}
      </span>
    );
  };

  return (
    <div className="flex items-center gap-2 flex-wrap text-[11px] rounded-lg border border-border/60 bg-muted/30 px-3 py-1.5">
      <span className="text-muted-foreground/80 font-medium flex-shrink-0">
        데이터 최신성{refDate && <span className="text-muted-foreground/50"> · {refDate.slice(5)} 기준</span>}
      </span>
      <div className="flex items-center gap-x-3 gap-y-1 flex-wrap">
        {shown.map((s) => <Chip key={s.id} s={s} />)}
      </div>
      <div className="flex items-center gap-2 ml-auto flex-shrink-0">
        {okCount > 0 && <span className="text-muted-foreground/70">정상 {okCount}</span>}
        {disconnected > 0 && <span className="text-red-600 dark:text-red-400 font-medium">연결끊김 {disconnected}</span>}
        {staleManual > 0 && <span className="text-amber-600 dark:text-amber-400 font-medium">수기미입력 {staleManual}</span>}
        {noActivity > 0 && <span className="text-muted-foreground/70">운영중지 {noActivity}</span>}
        <button onClick={() => setExpanded((v) => !v)} className="text-muted-foreground/60 hover:text-foreground">
          {expanded ? "접기" : "펼치기"}
        </button>
        <Link href="/settings" className="text-primary/70 hover:text-primary hover:underline">상세 →</Link>
      </div>
    </div>
  );
}
