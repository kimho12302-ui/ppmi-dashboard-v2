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
//   (stale-while-revalidate). 한동안 아무도 안 본 화면은 몇 시간 전 값이 뜰 수 있다. 그래서 꺼낸 값의
//   asOf 가 CACHE_SECONDS 를 넘었으면 버리고 DB 에서 바로 읽는다. 뒤에서 도는 재조회가 캐시를 채운다.
//
// 200 이 아닌 응답은 캐시하지 않는다(일시 오류가 5분 동안 박히지 않게).
import { timingSafeEqual } from "node:crypto";
import { unstable_cache, revalidateTag } from "next/cache";
import { NextRequest } from "next/server";
import { CACHE_BYPASS_HEADER } from "@/lib/fresh-fetch";

export const CACHE_SECONDS = 300;
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
  const res = await handler(req);
  const body = await res.text();
  const contentType = res.headers.get("content-type") || "application/json";
  if (res.status !== 200) throw new UncachedResponse(res.status, body, contentType);
  return { body, contentType, asOf: new Date().toISOString() };
}

function respond(hit: CachedBody, tags: readonly string[], source: "hit" | "miss" | "bypass" | "expired") {
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
      // 만료 항목을 나이 제한 없이 내주는 동작을 막는다(파일 머리 주석).
      if (ageSeconds(hit.asOf) > CACHE_SECONDS) {
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
