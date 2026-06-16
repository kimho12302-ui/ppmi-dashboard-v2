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

// 스트립에 항상 노출하는 핵심 소스(순서). 나머지는 비정상일 때만 노출.
const KEY_SOURCES = ["sales", "naver_sa", "naver_shopping", "meta_ads", "coupang_ads", "coupang_funnel"];

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

  useEffect(() => {
    let alive = true;
    fetch("/api/data-status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d) { setSources(d.sources || []); setRefDate(d.referenceDate || ""); } })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!sources || sources.length === 0) return null;

  const byId = new Map(sources.map((s) => [s.id, s]));
  const keyShown = KEY_SOURCES.map((id) => byId.get(id)).filter((s): s is Source => !!s);
  // 비핵심이라도 비정상(운영중지/연결끊김/수기미입력)이면 항상 노출
  const extraAbnormal = sources.filter((s) => !KEY_SOURCES.includes(s.id) && s.status !== "ok");
  const shown = expanded ? sources : [...keyShown, ...extraAbnormal];

  // 카테고리별 집계 (장애와 운영중지를 분리해서 보여줌)
  const disconnected = sources.filter((s) => s.status === "disconnected").length;
  const staleManual = sources.filter((s) => s.status === "stale_manual").length;
  const noActivity = sources.filter((s) => s.status === "no_activity").length;

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
        {disconnected > 0 && <span className="text-red-600 dark:text-red-400 font-medium">연결끊김 {disconnected}</span>}
        {staleManual > 0 && <span className="text-amber-600 dark:text-amber-400 font-medium">수기미입력 {staleManual}</span>}
        {noActivity > 0 && <span className="text-muted-foreground/70">운영중지 {noActivity}</span>}
        <button onClick={() => setExpanded((v) => !v)} className="text-muted-foreground/60 hover:text-foreground">
          {expanded ? "접기" : "전체"}
        </button>
        <Link href="/settings" className="text-primary/70 hover:text-primary hover:underline">상세 →</Link>
      </div>
    </div>
  );
}
