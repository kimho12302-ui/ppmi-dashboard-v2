"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * /api/data-status 를 화면 여러 곳이 함께 쓴다(상단 레일 + KPI 신뢰도 배지 + 설정 패널).
 * 컴포넌트마다 fetch 하면 한 페이지에서 3~4번 같은 쿼리가 나가므로 모듈 단위로 캐시한다.
 * 실패는 삼키지 않는다. 상태를 못 읽는 것과 '이상 없음'은 다르다.
 */

export interface StatusSource {
  id: string;
  label: string;
  mode: "auto" | "manual" | "inactive";
  type: "auto" | "manual";
  latestDate: string | null;
  ok: boolean;
  status: "ok" | "broken" | "input_needed" | "inactive";
  reason: string | null;
  action: string | null;
  lastSync: string | null;
  lastRun: string | null;
  heartbeatDataDate: string | null;
  staleDays: number | null;
  measurable: boolean;
  inactiveNote: string | null;
  metrics: string[];
  entry: string | null;
}

export interface CollectorHealth {
  source: string;
  lastRun: string | null;
  lastSuccess: string | null;
  latestDataDate: string | null;
  rowsWritten: number | null;
  ok: boolean;
  health: "running" | "frozen" | "failing" | "stopped";
  dataLagDays: number | null;
}

export interface DataStatus {
  sources: StatusSource[];
  collectors: CollectorHealth[];
  referenceDate: string;
  impactedMetrics: Record<string, { label: string; latestDate: string | null; reason: string | null }[]>;
  summary: {
    total: number; ok: number; broken: number; inputNeeded: number; inactive: number;
    unhealthyCollectors: number; stale: number;
  };
}

let cache: DataStatus | null = null;
let inflight: Promise<DataStatus> | null = null;
const listeners = new Set<() => void>();

async function load(force = false): Promise<DataStatus> {
  if (!force && cache) return cache;
  if (!force && inflight) return inflight;
  inflight = fetch("/api/data-status")
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then((d: DataStatus) => {
      cache = d;
      inflight = null;
      listeners.forEach((fn) => fn());
      return d;
    })
    .catch((e) => {
      inflight = null;
      throw e;
    });
  return inflight;
}

export function useDataStatus() {
  const [data, setData] = useState<DataStatus | null>(cache);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    setFailed(false);
    try {
      setData(await load(true));
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const onChange = () => { if (alive) setData(cache); };
    listeners.add(onChange);
    load()
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; listeners.delete(onChange); };
  }, []);

  return { data, failed, refresh };
}
