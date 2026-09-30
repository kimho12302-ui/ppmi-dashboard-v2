import { NextRequest, NextResponse } from "next/server";

// Pexels 사진 검색. 2026-09-30 신설.
//
// 왜 서버를 거치는가
// ─────────────────
// 열쇠(PEXELS_API_KEY)를 브라우저로 내보내지 않기 위해서다. Pexels 는 API 키를
// Authorization 헤더로 그냥 받으므로, 브라우저에서 직접 부르면 키가 네트워크 탭에
// 그대로 노출된다. 그래서 이 경로만 키를 알고, 화면은 이 경로만 부른다.
// NEXT_PUBLIC_ 접두사를 쓰면 빌드 산출물에 값이 박히므로 절대 쓰지 않는다.
//
// 한도는 방어할 거리가 아니다
// ──────────────────────────
// Pexels 한도는 시간당 200회다. 사람이 손으로 두드리는 검색에는 넉넉하다(김호 2026-09-30).
// 그래서 호출 카운터·시간당 상한·쿨다운 같은 것을 두지 않는다. 쓰는 사람을 막는 장치가 된다.
// 여기 있는 것은 두 개뿐이고 둘 다 한도용이 아니다.
//   최소 글자 수 재검사 : 화면을 안 믿는다. 클라이언트 검사는 우회될 수 있다
//   같은 질의 10분 캐시 : 뒤로가기·새로고침·같은 낱말 다시 찾기가 곧바로 뜨게 한다
// 한도에 닿으면 429 를 사람이 읽는 문구로 돌려주는 것으로 끝낸다. 미리 막지 않는다.
//
// ★ 열쇠는 캐러셀 스크립트(볼트 pexels.mjs)와 같은 것이다. 주간 자료조사 크론이 캐러셀을
//   굽는 시간과 겹치면 같은 바구니에서 꺼낸다. 크론은 회차당 5~15회라 합쳐도 여유롭다.
//
// 사진 파일 자체는 이 경로를 거치지 않는다. images.pexels.com 이
// Access-Control-Allow-Origin: * 을 주므로(2026-09-30 실측) 브라우저가 직접 받는다.
// 이미지 CDN 은 API 키가 필요 없어서 한도도 깎이지 않는다.
//
// 출처 표기는 선택이 아니다. Pexels 지침: "Whenever you are doing an API request make sure
// to show a prominent link to Pexels" · "Always credit our photographers".
// 그래서 사진마다 credit 문구를 같이 돌려준다. 쓰는 쪽이 그걸 버리면 약관 위반이다.
// 문구는 볼트 pexels.mjs 와 한 글자도 다르지 않게 맞췄다(`Photo by {이름} on Pexels`).

const API = "https://api.pexels.com/v1/search";

/** 세로가 기본이다. 캐러셀이 1080x1350 이라 가로 사진은 위아래가 잘린다. */
const ORIENTATIONS = ["portrait", "landscape", "square"] as const;
type Orientation = (typeof ORIENTATIONS)[number];
const DEFAULT_ORIENTATION: Orientation = "portrait";

/**
 * 최소 2글자. 한 글자로는 결과가 사실상 무의미해서 보여 줄 값이 없다.
 * 화면에도 같은 값이 있지만 여기서 한 번 더 본다. 클라이언트 검사는 우회될 수 있다.
 */
const MIN_QUERY_LEN = 2;

const MAX_PER_PAGE = 40;
const DEFAULT_PER_PAGE = 24;
const MAX_PAGE = 50;

/**
 * 같은 질의를 10분 동안 기억한다. 사진 검색 결과는 분 단위로 바뀌지 않으므로
 * 뒤로가기·새로고침·같은 낱말 다시 찾기가 왕복 없이 곧바로 뜬다. 속도 때문에 있는 것이다.
 *
 * 서버리스라 인스턴스마다 따로 산다. 적중률은 100% 가 아니고 그래도 상관없다.
 * 못 맞히면 그냥 Pexels 에 한 번 더 물어보면 된다.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 200;
const cache = new Map<string, { at: number; body: SearchResponse }>();

const UPSTREAM_TIMEOUT_MS = 8000;

interface PhotoOut {
  id: number;
  alt: string;
  photographer: string;
  photographerUrl: string;
  pageUrl: string;
  /** 내려받기용. large2x 는 대략 1880px 폭이라 1080 카드에 넉넉하다 */
  src: string;
  /** 격자에 뿌리는 작은 판. 목록에 large2x 를 깔면 한 화면에 40MB 를 받는다 */
  thumb: string;
  width: number;
  height: number;
  /** 캡션에 그대로 넣을 한 줄. 이걸 빼고 쓰면 안 된다 */
  credit: string;
  avgColor: string | null;
}

interface SearchResponse {
  photos: PhotoOut[];
  total: number;
  page: number;
  perPage: number;
  hasMore: boolean;
  /**
   * Pexels 가 알려 준 남은 호출 수. 화면에는 일부러 안 띄운다(계기판이 있으면 눈치를 본다).
   * "검색이 왜 안 되지" 를 curl 한 번으로 가려내려고 응답에만 남겨 둔다.
   */
  quotaRemaining: number | null;
  cached: boolean;
}

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  url: string;
  photographer: string;
  photographer_url: string;
  avg_color: string | null;
  alt: string | null;
  src: Record<string, string>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function clampInt(raw: string | null, fallback: number, min: number, max: number) {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * 재시도는 5xx 와 네트워크 사고(타임아웃·연결 끊김)에만 한 번.
 * 429 는 절대 다시 두드리지 않는다. 남은 한도만 더 깎고 결과는 같다.
 */
async function fetchPexels(url: string, key: string): Promise<Response> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: key },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        cache: "no-store",
      });
      if (res.status === 429) return res;
      if (res.status >= 500 && attempt === 0) {
        await sleep(400);
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt === 0) {
        await sleep(400);
        continue;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Pexels 호출 실패");
}

/**
 * 밖으로 나가는 문구에서 키를 지운다. 지금 경로로는 키가 섞일 일이 없지만,
 * 남의 응답 본문을 그대로 실어 보내는 자리라 한 겹 덧대 둔다.
 */
function scrub(text: string, key: string) {
  return key ? text.split(key).join("[REDACTED]") : text;
}

function putCache(cacheKey: string, body: SearchResponse) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(cacheKey, { at: Date.now(), body });
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") || "").trim();
  const rawOrientation = sp.get("orientation");
  const orientation: Orientation = ORIENTATIONS.includes(rawOrientation as Orientation)
    ? (rawOrientation as Orientation)
    : DEFAULT_ORIENTATION;
  const page = clampInt(sp.get("page"), 1, 1, MAX_PAGE);
  const perPage = clampInt(sp.get("per_page"), DEFAULT_PER_PAGE, 1, MAX_PER_PAGE);

  // 2글자 미만은 Pexels 를 부르지 않는다. 0건과 구분되게 note 를 같이 준다.
  if (q.length < MIN_QUERY_LEN) {
    return NextResponse.json<SearchResponse & { note: string }>({
      photos: [],
      total: 0,
      page,
      perPage,
      hasMore: false,
      quotaRemaining: null,
      cached: false,
      note: `검색어를 ${MIN_QUERY_LEN}글자 이상 적어 주세요`,
    });
  }

  const key = process.env.PEXELS_API_KEY;
  if (!key) {
    // 조용히 빈손으로 돌려보내면 "0건" 으로 읽힌다. 설정이 빠진 것과 결과가 없는 것은 다르다.
    return NextResponse.json(
      { error: "서버에 PEXELS_API_KEY 가 없습니다. Vercel 환경변수를 확인하세요.", photos: [] },
      { status: 500 },
    );
  }

  const cacheKey = `${q}|${orientation}|${page}|${perPage}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json({ ...hit.body, cached: true });
  }

  const url = new URL(API);
  url.searchParams.set("query", q);
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("page", String(page));
  url.searchParams.set("orientation", orientation);
  // locale 은 켜지 않는다. 2026-09-22 실측: locale=ko-KR 이면 한국어 태그 쪽으로 쏠려
  // 'senior woman exercise balance training' 에 제주 돌하르방이 1순위로 왔다.

  let res: Response;
  try {
    res = await fetchPexels(url.toString(), key);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Pexels 에 연결하지 못했습니다: ${scrub(msg, key)}`, photos: [] },
      { status: 502 },
    );
  }

  if (res.status === 429) {
    return NextResponse.json(
      {
        error: "Pexels 한도 초과(시간당 200회). 잠시 뒤 다시 시도하세요.",
        rateLimited: true,
        photos: [],
      },
      { status: 429 },
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return NextResponse.json(
      { error: `Pexels ${res.status}: ${scrub(text.slice(0, 200), key)}`, photos: [] },
      { status: 502 },
    );
  }

  let json: { photos?: PexelsPhoto[]; total_results?: number; next_page?: string };
  try {
    json = await res.json();
  } catch {
    return NextResponse.json({ error: "Pexels 응답을 읽지 못했습니다", photos: [] }, { status: 502 });
  }

  const remainingHeader = res.headers.get("x-ratelimit-remaining");
  const quotaRemaining = remainingHeader === null ? null : Number.parseInt(remainingHeader, 10);

  const photos: PhotoOut[] = (json.photos || []).map((p) => ({
    id: p.id,
    alt: p.alt || "",
    photographer: p.photographer,
    photographerUrl: p.photographer_url,
    pageUrl: p.url,
    src: p.src?.large2x || p.src?.large || p.src?.original,
    thumb: p.src?.medium || p.src?.small || p.src?.large,
    width: p.width,
    height: p.height,
    credit: `Photo by ${p.photographer} on Pexels`,
    avgColor: p.avg_color || null,
  }));

  const body: SearchResponse = {
    photos,
    total: json.total_results ?? photos.length,
    page,
    perPage,
    hasMore: Boolean(json.next_page),
    quotaRemaining: Number.isFinite(quotaRemaining as number) ? (quotaRemaining as number) : null,
    cached: false,
  };

  putCache(cacheKey, body);
  return NextResponse.json(body);
}
