// 읽기 API 5분 서버 캐시 + 쓰기 후 무효화 (2026-10-14 김호 결정).
//
// 옛 원칙 "캐시 안 씀(수기 업로드 직후 즉시 반영)"을 이 방식으로 대신한다.
//   1) 읽기 API 응답을 주소(경로+허용 파라미터)별로 5분 동안 Vercel 데이터 캐시에 둔다.
//   2) 대시보드 안의 쓰기 API 가 성공하면 그 표의 태그를 지우고, **지운 뒤에** 응답한다.
//   3) 바깥 수집기(daily-sync 등)는 끝날 때 POST /api/revalidate 로 지운다.
//   4) 화면의 "새로고침"·저장 직후 재조회는 x-cache-bypass: 1 헤더로 캐시를 건너뛰고 DB 에서 바로 읽는다.
//
// 태그 = 원천 표 이름. 읽는 쪽은 읽는 표를, 쓰는 쪽은 쓰는 표를 적는다. 모든 항목에 "all" 이 붙는다.
// 응답 헤더 X-Data-As-Of = 이 숫자를 DB 에서 읽은 시각(ISO). 화면이 "데이터 기준 시각"으로 보여 준다.
//
// ★ Next 14.2 의 unstable_cache 는 만료된 항목을 **나이 제한 없이** 먼저 내주고 뒤에서 새로 읽는다
//   (stale-while-revalidate). 뒤에서 새로 읽은 값은 캐시에 들어가 다음 조회부터 쓰인다.
//   2026-11-09 속도 수정: 예전엔 5분 넘은 값이면 버리고 DB 에서 그 자리에서 다시 읽었다. 그런데 뒤의 재조회도
//   따로 돌아 DB 를 두 번 읽었고, 그 자리에서 읽은 값은 캐시에 안 들어가 연달아 온 조회가 전부 다시 읽었다
//   (측정: 개요 API 6개가 전부 expired 3초대). 지금 규칙(아래 cachedGET):
//   - 5분 안: 그대로 준다(X-Cache: hit).
//   - 5분 ~ 15분(MAX_STALE_SECONDS) 이고 같은 날(KST): 옛 값을 바로 주고(X-Cache: stale) 뒤의 재조회 한 번에 맡긴다.
//     2026-11-10 QA2 M1: 3시간이던 한도를 15분으로 줄였다. 뒤의 재조회가 실패해도(일시 오류는 캐시 안 됨) 옛 값이
//     200 으로 3시간 나가 화면에 「갱신 실패」가 보이지 않았다.
//   - 15분을 넘었거나 날짜가 바뀐 값(어제 기준 "어제 날짜" 판정이 섞인 응답): 그 자리에서 다시 읽는다(X-Cache: expired).
//   - 이 서버 인스턴스가 그 태그를 지운 뒤(revalidateTagsNow) 읽은 값이 아니면: 나이와 상관없이 그 자리에서 다시 읽는다
//     (X-Cache: invalidated). 태그 무효화 직후 저장 전 값이 stale 이나 hit 으로 나가는 것을 막는다.
//     한계: 이 표식은 모듈 메모리라 같은 인스턴스 안에서만 유효하다. 다른 인스턴스가 무효화했다면 Next 캐시 저장소의
//     태그 무효화에 맡긴다(로컬 파일 캐시는 무효화된 항목을 아예 안 준다. Vercel 원격 캐시가 옛 값을 stale 로
//     돌려주는 경우가 남는데, 이때도 15분 한도 안에서만이다).
//   화면의 "데이터 기준 시각"은 X-Data-As-Of(실제로 DB 에서 읽은 시각)라 옛 값이면 옛 시각이 그대로 보인다.
//
// 200 이 아닌 응답은 캐시하지 않는다(일시 오류가 5분 동안 박히지 않게).
import { timingSafeEqual } from "node:crypto";
import { unstable_cache, revalidateTag } from "next/cache";
import { NextRequest } from "next/server";
import { CACHE_BYPASS_HEADER } from "@/lib/fresh-fetch";
import { KST_OFFSET_MS } from "@/lib/date";

export const CACHE_SECONDS = 300;
/** 만료된 값을 그대로 내줄 수 있는 최대 나이(15분, QA2 M1 2026-11-10). 업무 시간엔 warm 워크플로가 10분마다 데운다. */
export const MAX_STALE_SECONDS = 15 * 60;
/** 핸들러가 200 이지만 캐시하면 안 되는 응답(일부 조회 실패 등)에 붙이는 응답 헤더. 값 "1". 2026-11-10 */
export const NO_CACHE_HEADER = "x-no-cache";
export const ALL_TAG = "all";

/** 배포마다 키가 달라진다. 옛 배포가 만든 응답 모양이 새 코드에 섞이지 않게. */
const DEPLOY_KEY = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.VERCEL_DEPLOYMENT_ID ?? "local";

/** 대시보드가 읽는 원천 표(= 태그). 새 표를 읽으면 여기에도 적는다. */
export const DATA_TAGS = [
  "daily_sales", "product_sales", "daily_ad_spend", "daily_funnel", "keyword_performance",
  "monthly_targets", "misc_costs", "shipping_costs", "product_costs", "product_list", "gonggu_targets",
  "brand_config", "channel_config", "marketing_events",
  "content_board", "content_candidates", "content_performance", "ops_status", "utm_analytics",
  "naver_campaign_daily", "meta_ad_daily", "ad_product_performance", "sa_change_log",
  "raw_coupang_keyword", "raw_gfa_campaign", "raw_naver_search_term", "sync_heartbeat",
  "naver_sa_keyword", "sa_keyword_hold", "sa_keyword_candidate", "sa_shopping_rank",
  "bl_gonggu_schedule", "bl_pnl_manual_cost", "product_components",
  "ext_gsc", "ext_meta",
] as const;
export type DataTag = (typeof DATA_TAGS)[number];

const TAG_SET = new Set<string>([...DATA_TAGS, ALL_TAG]);
export const isKnownTag = (t: string) => TAG_SET.has(t);

class UncachedResponse extends Error {
  constructor(readonly status: number, readonly body: string, readonly contentType: string) {
    super(`uncached ${status}`);
  }
}

interface CachedBody { body: string; contentType: string; asOf: string }

/** 캐시 키 = 배포 + 경로 + **이 라우트가 읽는 파라미터만**(정렬). 모르는 파라미터로 키가 갈라지지 않게. */
function cacheKeyOf(req: NextRequest, params: readonly string[]): string {
  const src = req.nextUrl.searchParams;
  const kept = new URLSearchParams();
  for (const p of [...params].sort()) {
    for (const v of src.getAll(p)) kept.append(p, v);
  }
  return `${DEPLOY_KEY}:${req.nextUrl.pathname}?${kept.toString()}`;
}

type Handler = (req: NextRequest) => Promise<Response>;

async function render(handler: Handler, req: NextRequest): Promise<CachedBody> {
  // asOf 는 읽기를 시작한 시각으로 적는다. 끝난 시각으로 적으면 읽는 도중 태그가 지워졌을 때
  // 지우기 전 데이터가 "지운 뒤에 읽은 값"으로 보인다(invalidatedSince).
  const startedAt = new Date().toISOString();
  const res = await handler(req);
  const body = await res.text();
  const contentType = res.headers.get("content-type") || "application/json";
  // 200 이 아니거나, 200 이어도 핸들러가 "캐시 말 것"을 표시했으면 이번 한 번만 내보낸다.
  if (res.status !== 200 || res.headers.get(NO_CACHE_HEADER) === "1") throw new UncachedResponse(res.status, body, contentType);
  return { body, contentType, asOf: startedAt };
}

function respond(hit: CachedBody, tags: readonly string[], source: "hit" | "miss" | "bypass" | "stale" | "expired" | "invalidated") {
  return new Response(hit.body, {
    status: 200,
    headers: {
      "Content-Type": hit.contentType,
      "X-Data-As-Of": hit.asOf,
      "X-Cache-Tags": tags.join(","),
      "X-Cache": source,
      // 브라우저·CDN 은 따로 들고 있지 않는다. 지우는 길이 서버 캐시 하나여야 무효화가 먹힌다.
      "Cache-Control": "private, no-store",
    },
  });
}

const ageSeconds = (iso: string) => (Date.now() - new Date(iso).getTime()) / 1000;

/** 이 인스턴스에서 태그를 지운 시각(ms). revalidateTagsNow 가 적는다. */
const tagInvalidatedAt = new Map<string, number>();

/** 이 값(asOf 에 읽음)을 읽은 뒤에 그 태그 중 하나라도 지워졌는가 */
function invalidatedSince(asOf: string, tags: readonly string[]): boolean {
  const readAt = new Date(asOf).getTime();
  if (!Number.isFinite(readAt)) return true;
  return tags.some((t) => (tagInvalidatedAt.get(t) ?? 0) > readAt);
}

/** KST 날짜(YYYY-MM-DD). 날짜가 바뀌면 "어제"가 달라지는 응답이 있어 옛 값을 넘기지 않는다. */
const kstDay = (ms: number) => new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);

/** 만료됐지만 그대로 내줘도 되는 값인가: 나이 제한 안 + 같은 KST 날짜. */
function canServeStale(asOf: string): boolean {
  const readAt = new Date(asOf).getTime();
  if (!Number.isFinite(readAt)) return false;
  return ageSeconds(asOf) <= MAX_STALE_SECONDS && kstDay(readAt) === kstDay(Date.now());
}

/**
 * GET 핸들러를 5분 캐시로 감싼다. 핸들러 본문은 그대로 두고 export 만 바꾼다.
 *   export const GET = cachedGET(getImpl, ["daily_sales"], ["brand", "from", "to"]);
 * params = 이 라우트가 읽는 쿼리 파라미터. 캐시 키에는 이것만 들어간다.
 */
export function cachedGET(handler: Handler, tags: DataTag[], params: readonly string[] = []): Handler {
  const allTags = [...tags, ALL_TAG];
  return async (req: NextRequest) => {
    try {
      // 저장 직후 재조회·새로고침 버튼: 캐시를 건너뛰고 DB 에서 바로 읽는다.
      if (req.headers.get(CACHE_BYPASS_HEADER) === "1") {
        return respond(await render(handler, req), tags, "bypass");
      }
      const run = unstable_cache(() => render(handler, req), ["api-cache-v2", cacheKeyOf(req, params)], {
        revalidate: CACHE_SECONDS,
        tags: allTags,
      });
      let source: "hit" | "miss" = "hit";
      const t0 = Date.now();
      const hit = await run();
      if (new Date(hit.asOf).getTime() >= t0) source = "miss"; // 방금 새로 만든 값
      // 이 인스턴스가 태그를 지운 뒤에 읽은 값이 아니면 나이와 상관없이 다시 읽는다(파일 머리 주석).
      if (source === "hit" && invalidatedSince(hit.asOf, allTags)) {
        return respond(await render(handler, req), tags, "invalidated");
      }
      // 만료 항목: unstable_cache 가 이미 뒤에서 한 번 새로 읽고 있다. 제한 안이면 지금 값을 바로 준다(파일 머리 주석).
      if (ageSeconds(hit.asOf) > CACHE_SECONDS) {
        if (canServeStale(hit.asOf)) return respond(hit, tags, "stale");
        return respond(await render(handler, req), tags, "expired");
      }
      return respond(hit, tags, source);
    } catch (e) {
      if (e instanceof UncachedResponse) {
        return new Response(e.body, { status: e.status, headers: { "Content-Type": e.contentType, "Cache-Control": "no-store" } });
      }
      throw e;
    }
  };
}

/**
 * 태그 여러 개를 지우고 **실제로 지워질 때까지 기다린다.**
 * revalidateTag 는 표시만 하고 실제 무효화는 응답을 보낸 뒤(waitUntil) 나간다. 그 틈에 저장 직후
 * 조회가 옛 값을 받을 수 있어, 같은 요청 안에서 캐시 저장소에 바로 지우라고 한 번 더 부른다.
 * Next 내부 저장소를 쓰는 부분이 실패해도 revalidateTag 경로는 그대로 남는다.
 */
export async function revalidateTagsNow(tags: string[]): Promise<string[]> {
  const done = Array.from(new Set(tags)).filter(isKnownTag);
  // 지운 시각을 적어 둔다. 이보다 먼저 읽은 캐시 값은 이 인스턴스가 다시 내주지 않는다(cachedGET).
  // "all" 을 지우면 모든 항목이 걸린다(모든 항목에 all 태그가 붙어 있다).
  const now = Date.now();
  for (const t of done) tagInvalidatedAt.set(t, now);
  for (const t of done) revalidateTag(t);
  if (done.length === 0) return done;
  try {
    const mod = await import("next/dist/client/components/static-generation-async-storage.external");
    const store = mod.staticGenerationAsyncStorage.getStore() as { incrementalCache?: { revalidateTag(tags: string[]): Promise<void> } } | undefined;
    await store?.incrementalCache?.revalidateTag(done);
  } catch (e) {
    console.warn("[api-cache] 즉시 무효화 실패, 응답 뒤 무효화에 맡김:", e instanceof Error ? e.message : e);
  }
  return done;
}

/**
 * 쓰기 핸들러(POST·PUT·PATCH·DELETE)를 감싼다. 성공(2xx)이면 쓰는 표의 태그를 지운 **뒤에** 응답한다.
 *   export const POST = revalidateAfter(postImpl, ["daily_ad_spend"]);
 */
export function revalidateAfter(handler: Handler, tags: DataTag[]): Handler {
  return async (req: NextRequest) => {
    const res = await handler(req);
    if (res.status >= 200 && res.status < 300) await revalidateTagsNow(tags);
    return res;
  };
}

/** 길이가 달라도 시간 차로 새지 않게 비교한다. */
export function secretMatches(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}
