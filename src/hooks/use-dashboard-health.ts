"use client";

import { useCallback, useEffect, useState } from "react";
import type { DashboardHealth } from "@/lib/dashboard-health";

// /api/dashboard-health 를 사이드바(로고 빨간 점)와 /status 화면이 같이 쓴다.
// 화면마다 따로 부르지 않게 모듈 단위로 한 번만 받는다. 실패는 삼키지 않는다(못 읽음 ≠ 이상 없음).

let cache: DashboardHealth | null = null;
let inflight: Promise<DashboardHealth> | null = null;
const listeners = new Set<() => void>();

async function load(force = false): Promise<DashboardHealth> {
  if (!force && cache) return cache;
  if (!force && inflight) return inflight;
  inflight = fetch("/api/dashboard-health", force ? { headers: { "x-cache-bypass": "1" } } : undefined)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then((d: DashboardHealth) => {
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

export function useDashboardHealth() {
  const [data, setData] = useState<DashboardHealth | null>(cache);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setFailed(false);
    setLoading(true);
    try {
      setData(await load(true));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
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

  return { data, failed, loading, refresh };
}
