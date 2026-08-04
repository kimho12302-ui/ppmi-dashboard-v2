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
  // 기본 기간 = 이번 달. 목표/페이싱이 달력 월 기준이라 30d를 기본으로 두면
  // 진입 화면에서 페이싱의 매출과 KPI 카드의 매출이 서로 다른 값으로 보였다.
  const preset = (searchParams.get("preset") || "this_month") as DatePreset;
  const from = searchParams.get("from") || "";
  const to = searchParams.get("to") || "";

  const dateRange = useMemo(() => {
    if (from && to) return { from, to };
    return getDateRangeFromPreset(preset);
  }, [from, to, preset]);

  const setParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      // 기본값(brand=all, preset=this_month)은 URL에서 제거, 나머지는 유지
      const isDefault = (key === "brand" && value === "all") || (key === "preset" && value === "this_month");
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
      if (!res.ok) {
        // 라우트가 { error } 를 실어 보내면 그 문구를 그대로 노출 (HTTP 500 보다 원인이 보인다)
        let msg = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          if (body?.error) msg = String(body.error);
        } catch { /* JSON 아님 → 상태코드만 */ }
        throw new Error(msg);
      }
      // ★ 200 + body.error 를 실패로 취급하지 않는다.
      //   일부 라우트(creatives / creative-trend / video-source)는 "META_ADS_TOKEN 미설정" 같은
      //   **안내**를 의도적으로 200 + { data: [], error } 로 내리고, 화면이 그 문구를 배너로 띄운다.
      //   이를 throw 하면 안내가 "소재 데이터가 없습니다"로 둔갑한다(2026-08 회귀).
      //   실제 장애는 위에서 4xx/5xx 로 걸러진다(감시 라우트는 fail-closed 로 500 반환).
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
