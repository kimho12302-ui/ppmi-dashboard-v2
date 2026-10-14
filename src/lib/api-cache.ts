// 읽기 API 5분 서버 캐시 + 쓰기 후 무효화 (2026-10-14 김호 결정).
//
// 옛 원칙 "캐시 안 씀(수기 업로드 직후 즉시 반영)"을 이 방식으로 대신한다.
//   1) 읽기 API 응답을 주소(경로+파라미터)별로 5분 동안 Vercel 데이터 캐시에 둔다.
//   2) 대시보드 안의 쓰기 API 가 성공하면 그 표의 태그를 지운다 → 다음 조회는 새 값.
//   3) 바깥 수집기(daily-sync 등)는 끝날 때 POST /api/revalidate 로 지운다.
//   4) 화면의 "새로고침" 버튼은 POST /api/refresh 로 그 화면 태그를 지우고 다시 부른다.
//
// 태그 = 원천 표 이름. 읽는 쪽은 읽는 표를, 쓰는 쪽은 쓰는 표를 적는다. 모든 항목에 "all" 이 붙는다.
// 응답 헤더 X-Data-As-Of = 캐시를 만든 시각(ISO). 화면이 "데이터 기준 시각"으로 보여 준다.
//
// 200 이 아닌 응답은 캐시하지 않는다(일시 오류가 5분 동안 박히지 않게).
import { unstable_cache, revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

export const CACHE_SECONDS = 300;
export const ALL_TAG = "all";

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

function cacheKeyOf(req: NextRequest): string {
  const sp = new URLSearchParams(req.nextUrl.searchParams);
  sp.sort();
  return `${req.nextUrl.pathname}?${sp.toString()}`;
}

type Handler = (req: NextRequest) => Promise<Response>;

/**
 * GET 핸들러를 5분 캐시로 감싼다. 핸들러 본문은 그대로 두고 export 만 바꾼다.
 *   export const GET = cachedGET(getImpl, ["daily_sales", "product_sales"]);
 */
export function cachedGET(handler: Handler, tags: DataTag[]): Handler {
  const allTags = [...tags, ALL_TAG];
  return async (req: NextRequest) => {
    const key = cacheKeyOf(req);
    const run = unstable_cache(
      async (): Promise<CachedBody> => {
        const res = await handler(req);
        const body = await res.text();
        const contentType = res.headers.get("content-type") || "application/json";
        if (res.status !== 200) throw new UncachedResponse(res.status, body, contentType);
        return { body, contentType, asOf: new Date().toISOString() };
      },
      ["api-cache-v1", key],
      { revalidate: CACHE_SECONDS, tags: allTags },
    );
    try {
      const hit = await run();
      return new Response(hit.body, {
        status: 200,
        headers: {
          "Content-Type": hit.contentType,
          "X-Data-As-Of": hit.asOf,
          "X-Cache-Tags": tags.join(","),
          // 브라우저·CDN 은 따로 들고 있지 않는다. 지우는 길이 서버 캐시 하나여야 무효화가 먹힌다.
          "Cache-Control": "private, no-store",
        },
      });
    } catch (e) {
      if (e instanceof UncachedResponse) {
        return new Response(e.body, { status: e.status, headers: { "Content-Type": e.contentType, "Cache-Control": "no-store" } });
      }
      throw e;
    }
  };
}

/** 태그 여러 개를 지운다. 알 수 없는 태그는 건너뛴다. 지운 목록을 돌려준다. */
export function revalidateTags(tags: string[]): string[] {
  const done: string[] = [];
  for (const t of tags) {
    if (!isKnownTag(t)) continue;
    revalidateTag(t);
    done.push(t);
  }
  return done;
}

/**
 * 쓰기 핸들러(POST·PUT·PATCH·DELETE)를 감싼다. 성공(2xx)으로 끝나면 쓰는 표의 태그를 지운다.
 *   export const POST = revalidateAfter(postImpl, ["daily_ad_spend"]);
 */
export function revalidateAfter(handler: Handler, tags: DataTag[]): Handler {
  return async (req: NextRequest) => {
    const res = await handler(req);
    if (res.status >= 200 && res.status < 300) revalidateTags(tags);
    return res;
  };
}

export const jsonError = (status: number, error: string) => NextResponse.json({ error }, { status });
