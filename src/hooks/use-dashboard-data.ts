"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { getDateRangeFromPreset, type DatePreset } from "@/lib/utils";

/* ── URL 기반 필터 상태 ── */

export function useFilterParams() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const brand = searchParams.get("brand") || "all";
  const preset = (searchParams.get("preset") || "30d") as DatePreset;
  const from = searchParams.get("from") || "";
  const to = searchParams.get("to") || "";

  const dateRange = useMemo(() => {
    if (from && to) return { from, to };
    return getDateRangeFromPreset(preset);
  }, [from, to, preset]);

  const setParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      // 기본값(brand=all, preset=30d)은 URL에서 제거, 나머지는 유지
      const isDefault = (key === "brand" && value === "all") || (key === "preset" && value === "30d");
      if (value && !isDefault) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      // 프리셋 변경 시 커스텀 날짜 제거
      if (key === "preset") {
        params.delete("from");
        params.delete("to");
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [searchParams, router, pathname]
  );

  const setBrand = useCallback((b: string) => setParam("brand", b), [setParam]);
  const setPreset = useCallback((p: DatePreset) => setParam("preset", p), [setParam]);
  const setCustomRange = useCallback((f: string, t: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("from", f);
    params.set("to", t);
    params.delete("preset");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [searchParams, router, pathname]);

  // 커스텀 날짜 직접 입력 여부 (URL에 from/to가 있으면 custom)
  const isCustom = !!(searchParams.get("from") && searchParams.get("to"));

  return {
    brand,
    preset,
    from: dateRange.from,
    to: dateRange.to,
    isCustom,
    setBrand,
    setPreset,
    setCustomRange,
  };
}

/* ── 기존 호환: useDateRange ── */

export function useDateRange(initialDays: number = 30) {
  const [days, setDays] = useState(initialDays);

  const { from, to } = useMemo(() => {
    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);
    return {
      from: fromDate.toISOString().split("T")[0],
      to: toDate.toISOString().split("T")[0],
    };
  }, [days]);

  return { from, to, days, setDays };
}

/* ── 범용 fetch 훅 ── */

export function useFetch<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
