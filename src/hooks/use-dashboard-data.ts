"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { freshFetch } from "@/lib/fresh-fetch";
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

/* ── 미리 부르기 (2026-10-14 속도 개선) ── */
//
// 화면이 대시보드 응답을 기다리는 동안 로딩 화면만 그리면, 그 아래 칸(페이싱·판매처 차트 등)은
// 아직 마운트되지 않아 요청도 안 나간다. 응답이 온 뒤에야 칸이 붙고 그때 두 번째 요청이 나가
// 왕복이 한 번 더 쌓였다(실측: 오버뷰 0.3~0.66초, 매출 화면 0.6~2.8초).
// 부모 화면이 칸의 주소를 미리 불러 두고, 칸이 마운트될 때 그 요청을 넘겨받는다.
//
// ★ 데이터 캐시가 아니다. 응답은 한 번 넘겨주면 지우고, 아무도 안 가져가면 PREFETCH_TTL_MS 뒤 버린다.
//   "수기 업로드 직후 바로 반영" 원칙은 그대로다. 같은 화면을 여는 그 순간 부른 응답만 쓴다.
const PREFETCH_TTL_MS = 30_000;
const prefetched = new Map<string, { res: Promise<Response>; at: number }>();

function dropExpiredPrefetches(now: number) {
  prefetched.forEach((v, k) => {
    if (now - v.at > PREFETCH_TTL_MS) prefetched.delete(k);
  });
}

/** 미리 부른 요청이 있으면 꺼내 준다(한 번만). 없거나 오래됐으면 null. */
function takePrefetched(url: string): Promise<Response> | null {
  const hit = prefetched.get(url);
  if (!hit) return null;
  prefetched.delete(url);
  return Date.now() - hit.at > PREFETCH_TTL_MS ? null : hit.res;
}

/**
 * 아직 마운트되지 않은 칸의 API 를 지금 같이 부른다. 주소는 `@/lib/api-urls` 의 함수로 만들어
 * 칸이 실제로 부르는 주소와 글자까지 같게 할 것(다르면 넘겨받지 못하고 한 번 더 부른다).
 * 렌더 중에 호출하는 이유: useEffect 는 자식 → 부모 순서로 돌아서, 자식이 이미 마운트된 경우
 * 부모 effect 가 뒤늦게 같은 요청을 한 번 더 보내게 된다. 주소 묶음이 바뀔 때만 1회 부른다.
 */
export function usePrefetch(urls: (string | null | undefined)[]) {
  const list = urls.filter((u): u is string => !!u);
  const key = list.join("|");
  const doneRef = useRef<string | null>(null);
  if (typeof window !== "undefined" && doneRef.current !== key) {
    doneRef.current = key;
    const now = Date.now();
    dropExpiredPrefetches(now);
    for (const u of list) {
      if (prefetched.has(u)) continue;
      const res = fetch(u);
      res.catch(() => { /* 넘겨받는 쪽이 다시 부른다 */ });
      prefetched.set(u, { res, at: now });
    }
  }
}

/* ── 직전 응답 즉시 표시 (2026-10-14, SWR 방식) ── */
//
// 같은 주소를 이 탭에서 한 번이라도 받았으면, 다시 열 때 그 응답을 **바로 그리고** 뒤에서 새로 부른다.
// 새 응답이 오면 갈아 끼운다. 그동안 화면 위 "갱신 중" 이 뜬다(DataFreshness).
// 메모리에 두고, 작은 응답(LAST_STORE_MAX 이하)은 sessionStorage 에도 둬 새로고침(F5) 뒤에도 바로 뜬다.
// 탭을 닫으면 사라진다. 서버 쪽 5분 캐시와는 별개이고, 이 값은 늘 뒤에서 다시 확인한다.
const LAST_STORE_PREFIX = "ppmi:last:";
// 문자 수. 브라우저 sessionStorage 는 보통 주소(origin)당 약 5MB(문자 약 250만 자) 라 한 응답에 넉넉히 준다.
// 차면 다른 주소의 직전 응답을 지우고 한 번 더 넣는다. 그래도 안 들어가면 메모리에만 둔다
// (메모리는 탭을 닫거나 새로고침(F5) 할 때까지 남는다. 같은 탭 안 화면 이동은 메모리로 바로 뜬다).
const LAST_STORE_MAX = 1_500_000;
interface LastResponse { data: unknown; asOf: string | null; tags: string[] }
const lastResponses = new Map<string, LastResponse>();

function readLast(url: string): LastResponse | null {
  const hit = lastResponses.get(url);
  if (hit) return hit;
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(LAST_STORE_PREFIX + url);
    if (!raw) return null;
    const v = JSON.parse(raw) as LastResponse;
    lastResponses.set(url, v);
    return v;
  } catch {
    return null;
  }
}

const LAST_MEMORY_MAX = 40; // 주소 개수. 넘치면 가장 오래 안 쓴 것부터 버린다

function writeLast(url: string, v: LastResponse, text: string) {
  lastResponses.delete(url);
  lastResponses.set(url, v);
  while (lastResponses.size > LAST_MEMORY_MAX) {
    const oldest = lastResponses.keys().next().value;
    if (oldest === undefined) break;
    lastResponses.delete(oldest);
  }
  if (typeof window === "undefined" || text.length > LAST_STORE_MAX) return;
  const key = LAST_STORE_PREFIX + url;
  const value = JSON.stringify(v);
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // 저장 공간이 찼다. 내 다른 직전 응답을 지우고 한 번만 더 넣어 본다. 그래도 안 되면 메모리에만.
    try {
      const mine: string[] = [];
      for (let i = 0; i < window.sessionStorage.length; i++) {
        const k = window.sessionStorage.key(i);
        if (k && k.startsWith(LAST_STORE_PREFIX) && k !== key) mine.push(k);
      }
      mine.forEach((k) => window.sessionStorage.removeItem(k));
      window.sessionStorage.setItem(key, value);
    } catch { /* 메모리에만 */ }
  }
}

/* ── 데이터 기준 시각·새로고침 (화면 위 DataFreshness 가 구독) ── */
//
// 지금 화면에 붙어 있는 useFetch 들이 각자 받은 응답의 기준 시각(서버 캐시를 만든 시각, X-Data-As-Of)과
// 태그(X-Cache-Tags)를 여기 올린다. 화면은 그중 **가장 오래된 시각**을 "데이터 기준"으로 보여 준다.
interface FreshnessEntry { asOf: string | null; tags: string[]; refreshing: boolean; failed: boolean; refetch: () => Promise<void> }
interface FreshnessSnapshot { version: number; oldestAsOf: string | null; refreshing: boolean; failed: boolean; tags: string[] }
const freshEntries = new Map<number, FreshnessEntry>();
const freshListeners = new Set<() => void>();
let freshVersion = 0;
let freshSnapshot: FreshnessSnapshot = { version: 0, oldestAsOf: null, refreshing: false, failed: false, tags: [] };
let nextFreshId = 1;

function setFreshEntry(id: number, e: FreshnessEntry | null) {
  if (e) freshEntries.set(id, e);
  else freshEntries.delete(id);
  freshVersion += 1;
  freshListeners.forEach((l) => l());
}

export function subscribeFreshness(l: () => void) {
  freshListeners.add(l);
  return () => { freshListeners.delete(l); };
}

export function getFreshnessSnapshot(): FreshnessSnapshot {
  if (freshSnapshot.version === freshVersion) return freshSnapshot;
  let oldest: string | null = null;
  let refreshing = false;
  let failed = false;
  const tags = new Set<string>();
  freshEntries.forEach((e) => {
    if (e.refreshing) refreshing = true;
    if (e.failed) failed = true;
    if (e.asOf && (oldest === null || e.asOf < oldest)) oldest = e.asOf;
    e.tags.forEach((t) => tags.add(t));
  });
  freshSnapshot = { version: freshVersion, oldestAsOf: oldest, refreshing, failed, tags: Array.from(tags).sort() };
  return freshSnapshot;
}

const EMPTY_FRESHNESS: FreshnessSnapshot = { version: -1, oldestAsOf: null, refreshing: false, failed: false, tags: [] };
export const getFreshnessServerSnapshot = () => EMPTY_FRESHNESS;

/** "새로고침": 이 화면이 읽은 태그의 서버 캐시를 지우고, 붙어 있는 조회를 전부 캐시를 건너뛰어 다시 부른다. */
export async function refreshVisibleData() {
  const { tags } = getFreshnessSnapshot();
  if (tags.length > 0) {
    try {
      await fetch("/api/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tags }) });
    } catch { /* 지우기에 실패해도 다시 부르기는 한다(5분 안의 값이 올 수 있음) */ }
  }
  const jobs: Promise<void>[] = [];
  freshEntries.forEach((e) => jobs.push(e.refetch()));
  await Promise.all(jobs);
}

/* ── 범용 fetch 훅 ── */

export function useFetch<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ asOf: string | null; tags: string[] }>({ asOf: null, tags: [] });
  const idRef = useRef(0);
  if (idRef.current === 0) idRef.current = nextFreshId++;

  // ★ 응답 경합 가드 (2026-09-30).
  //   브랜드 칩을 누르면 URL 이 바뀌며 새 요청이 나가는데, 먼저 나간 요청이 늦게 끝나면
  //   그 응답이 최신 응답을 덮어썼다. 전체(285행)가 밸런스랩(86행)보다 느려서, 밸런스랩을
  //   눌러도 화면엔 전 브랜드 합계가 남았다(광고 분석 총광고비 10,867,959 vs 실제 2,087,438,
  //   밸런스랩이 안 쓰는 GFA·쿠팡이 표에 그대로 떴다). 새로고침하면 정상이라 더 안 보였다.
  //   요청마다 번호를 붙여 **마지막 요청의 응답만** 상태에 반영하고, 이전 요청은 취소한다.
  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  // bypass=true: 서버 5분 캐시를 건너뛴다(저장 직후 refetch·새로고침 버튼). 첫 조회는 캐시를 쓴다.
  const fetchData = useCallback(async (allowPrefetched = false, bypass = false) => {
    const get = (signal: AbortSignal) => (bypass ? freshFetch(url, { signal }) : fetch(url, { signal }));
    const seq = ++seqRef.current;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    // 같은 주소의 직전 응답이 있으면 먼저 그린다. 로딩 화면 대신 "갱신 중".
    const last = readLast(url);
    if (last) {
      setData(last.data as T);
      setMeta({ asOf: last.asOf, tags: last.tags });
      setLoading(false);
    } else {
      setLoading(true);
    }
    setRefreshing(true);
    setError(null);
    try {
      // 5xx 는 한 번 더 부른다. DB 게이트웨이 타임아웃이 순간적으로 나는데, 그걸 그대로 받으면
      // 화면이 "기간 내 판매 없음" 같은 빈 상태로 그려졌다(2026-10-13, 밸런스랩 상세 매출 구성).
      const pre = allowPrefetched ? takePrefetched(url) : null;
      let res = pre
        ? await pre.catch(() => get(ac.signal))
        : await get(ac.signal);
      if (ac.signal.aborted || seq !== seqRef.current) return;
      if (res.status >= 500 && !ac.signal.aborted) {
        await new Promise((r) => setTimeout(r, 700));
        if (ac.signal.aborted || seq !== seqRef.current) return;
        res = await get(ac.signal);
      }
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
      const text = await res.text();
      const json = JSON.parse(text);
      if (seq !== seqRef.current) return; // 뒤처진 응답 — 버린다
      const next = {
        asOf: res.headers.get("x-data-as-of"),
        tags: (res.headers.get("x-cache-tags") || "").split(",").filter(Boolean),
      };
      writeLast(url, { data: json, ...next }, text);
      setMeta(next);
      setData(json);
    } catch (err) {
      // 내가 취소한 요청은 오류가 아니다. 뒤처진 요청의 오류도 최신 화면에 띄우지 않는다.
      if (ac.signal.aborted || seq !== seqRef.current) return;
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      // 최신 요청만 로딩을 내린다. 뒤처진 요청이 내리면 아직 받는 중인데 다 받은 것처럼 보인다.
      if (seq === seqRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [url]);

  useEffect(() => {
    fetchData(true);
  }, [fetchData]);

  // 다시 불러오기(저장 직후 등)는 미리 부른 응답도, 서버 5분 캐시도 쓰지 않고 DB 에서 바로 읽는다.
  const refetch = useCallback(() => fetchData(false, true), [fetchData]);

  // 화면 위 "데이터 기준 시각·새로고침" 에 내 상태를 올린다. 화면에서 빠지면 지운다.
  useEffect(() => {
    // 직전 값을 보여 주는 중에 다시 받기가 실패하면 화면 위에 "갱신 실패" 를 띄운다(옛 숫자를 새 것으로 오해하지 않게).
    setFreshEntry(idRef.current, { asOf: meta.asOf, tags: meta.tags, refreshing, failed: !!error && data !== null, refetch });
  }, [meta, refreshing, refetch, error, data]);
  useEffect(() => {
    const id = idRef.current;
    return () => setFreshEntry(id, null);
  }, []);

  return { data, loading, error, refetch, refreshing, asOf: meta.asOf };
}
