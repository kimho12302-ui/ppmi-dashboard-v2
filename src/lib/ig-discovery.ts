// 공구 인플루언서 발굴 — 인스타 공식 API(business_discovery) 로 남의 계정을 읽고 점수를 매긴다.
//
// 왜 이 방식인가 (2026-10-14 공식 문서 확인)
// - 첫 DM 은 API 로 못 보낸다(상대가 먼저 보낸 뒤 24시간만). 그래서 이번 범위는 '찾기·분석'이다.
// - 해시태그 검색(ig_hashtag_search)은 게시물만 주고 올린 사람(username)을 주지 않는다.
//   그래서 사람을 찾는 길은 둘이다: ① 팀원이 핸들을 붙여넣는다 ② 비슷한 브랜드 계정의 캡션에서
//   @언급된 계정을 뽑는다(브랜드가 공구 진행자를 태그한다).
// - business_discovery 는 비즈니스·크리에이터 계정만 읽힌다. 개인 계정은 '분석 불가'로 표시한다.

const GRAPH = "https://graph.facebook.com/v23.0";
const MEDIA_LIMIT = 25;

// 공구 이력 판단. 캡션에 이게 있으면 공구를 돌려 본 사람이다.
const GONGGU_RE = /공구|공동구매|공구\s*오픈|오픈\s*예정|마감\s*임박|구매\s*링크|프로필\s*링크|스토리\s*링크/;
// 큐모발검사와 닿는 주제. 화면에서 바꿀 수 있다.
export const DEFAULT_KEYWORDS = ["탈모", "두피", "모발", "헤어", "머리숱", "영양", "건강", "다이어트", "육아", "뷰티", "피부"];

export interface IgMedia {
  caption?: string;
  permalink?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
}

export interface Contacts {
  emails: string[];
  kakao: string[];
  links: string[];
}

export interface Analysis {
  handle: string;
  ok: boolean;
  error?: string;
  name?: string;
  biography?: string;
  website?: string;
  followers?: number;
  mediaCount?: number;
  lastPostAt?: string | null;
  daysSinceLastPost?: number | null;
  avgLikes?: number | null;
  avgComments?: number;
  engagementPct?: number | null;
  gongguPosts?: number;
  gongguExamples?: string[];
  keywordHits?: Record<string, number>;
  contacts?: Contacts;
  score?: number;
  scoreParts?: Record<string, number>;
}

let cachedIgId: string | null = null;

/** 우리 IG 비즈니스 계정 id. business_discovery 는 '누구 이름으로' 조회하는지가 필요하다. */
async function myIgId(token: string): Promise<string> {
  if (cachedIgId) return cachedIgId;
  const u = new URL(`${GRAPH}/me/accounts`);
  u.searchParams.set("fields", "instagram_business_account{id,username}");
  u.searchParams.set("limit", "50");
  u.searchParams.set("access_token", token);
  const j = await (await fetch(u, { cache: "no-store" })).json();
  if (j.error) throw new Error(`메타 토큰 오류: ${j.error.message}`);
  const igs = (j.data || []).map((p: { instagram_business_account?: { id: string; username: string } }) => p.instagram_business_account).filter(Boolean);
  const pick = igs.find((x: { username: string }) => x.username === "balancelab_official") || igs[0];
  if (!pick) throw new Error("토큰에 연결된 인스타 비즈니스 계정이 없다");
  cachedIgId = pick.id as string;
  return cachedIgId;
}

export function normalizeHandle(raw: string): string | null {
  let s = raw.trim();
  const m = s.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  if (m) s = m[1];
  s = s.replace(/^@/, "").replace(/\/+$/, "").replace(/\.+$/, "").toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(s) && !["p", "reel", "explore", "stories"].includes(s) ? s : null;
}

export function extractMentions(text: string): string[] {
  const out = new Set<string>();
  for (const m of (text || "").matchAll(/(?:^|[^A-Za-z0-9._@])@([A-Za-z0-9._]{2,30})/g)) {
    const h = normalizeHandle(m[1]);
    if (h) out.add(h);
  }
  return Array.from(out);
}

export function extractContacts(bio: string, website?: string): Contacts {
  const text = bio || "";
  const emails = Array.from(new Set((text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).map((e) => e.toLowerCase())));
  const kakao = Array.from(new Set([
    ...(text.match(/(?:https?:\/\/)?(?:open|pf)\.kakao\.com\/[^\s)]+/gi) || []),
    // "카톡 ID: abc" 같은 표기
    // (open.kakao.com 주소 안의 'kakao' 를 잡지 않게 앞이 . / 인 경우는 뺀다)
    ...Array.from(text.matchAll(/(?<![./])(?:카톡|카카오톡|kakao)\s*(?:id|아이디)?\s*[:：]?\s*([A-Za-z0-9_-][A-Za-z0-9._-]{2,})/gi)).map((m) => `카톡 ${m[1]}`),
  ]));
  const links = Array.from(new Set([
    ...(website ? [website] : []),
    ...(text.match(/(?:https?:\/\/)?(?:linktr\.ee|litt\.ly|lnk\.bio|link\.inpock\.co\.kr|inpock\.co\.kr|smartstore\.naver\.com|blog\.naver\.com)\/[^\s)]+/gi) || []),
  ]));
  return { emails, kakao, links };
}

/** 점수 0~100. 화면에 항목별로 보여 준다. 기준을 숨기지 않는다. */
export function scoreOf(a: Analysis): { score: number; parts: Record<string, number> } {
  const f = a.followers || 0;
  // 공구는 마이크로(3천~10만)가 효율이 좋다. 너무 크면 단가가 맞지 않는다.
  const followers = f < 1000 ? 0 : f < 3000 ? 8 : f <= 100000 ? 20 : f <= 300000 ? 12 : 6;
  const er = a.engagementPct ?? 0;
  const engagement = er >= 3 ? 25 : er >= 1.5 ? 18 : er >= 0.7 ? 10 : er > 0 ? 4 : 0;
  const g = a.gongguPosts || 0;
  const gonggu = g >= 3 ? 25 : g === 2 ? 20 : g === 1 ? 12 : 0;
  const hits = Object.values(a.keywordHits || {}).reduce((s, n) => s + n, 0);
  const relevance = hits >= 6 ? 20 : hits >= 3 ? 14 : hits >= 1 ? 7 : 0;
  const d = a.daysSinceLastPost;
  const recency = d == null ? 0 : d <= 14 ? 5 : d <= 45 ? 3 : 0;
  const c = a.contacts;
  const contact = c && (c.emails.length || c.kakao.length) ? 5 : c && c.links.length ? 2 : 0;
  const parts = { followers, engagement, gonggu, relevance, recency, contact };
  return { score: Object.values(parts).reduce((s, n) => s + n, 0), parts };
}

async function discovery(token: string, igId: string, handle: string, fields: string) {
  const u = new URL(`${GRAPH}/${igId}`);
  u.searchParams.set("fields", `business_discovery.username(${handle}){${fields}}`);
  u.searchParams.set("access_token", token);
  const j = await (await fetch(u, { cache: "no-store" })).json();
  if (j.error) {
    const msg = String(j.error.message || "");
    // 개인 계정·없는 계정은 같은 오류(110/100)로 온다
    if (j.error.code === 110 || /Invalid user id|Cannot find User|does not exist/i.test(msg)) {
      throw new Error("개인 계정이거나 없는 계정 (비즈니스·크리에이터만 분석 가능)");
    }
    if (j.error.code === 190) throw new Error(`메타 토큰 오류: ${msg}`);
    throw new Error(msg);
  }
  return j.business_discovery;
}

export async function analyzeHandle(token: string, rawHandle: string, keywords: string[] = DEFAULT_KEYWORDS): Promise<Analysis> {
  const handle = normalizeHandle(rawHandle) || rawHandle;
  try {
    const igId = await myIgId(token);
    const bd = await discovery(token, igId, handle,
      `username,name,biography,website,followers_count,media_count,media.limit(${MEDIA_LIMIT}){caption,permalink,timestamp,like_count,comments_count}`);
    const media: IgMedia[] = bd?.media?.data || [];
    const followers: number = bd.followers_count || 0;
    const liked = media.filter((m) => typeof m.like_count === "number");
    const avgLikes = liked.length ? liked.reduce((s, m) => s + (m.like_count || 0), 0) / liked.length : null;
    const avgComments = media.length ? media.reduce((s, m) => s + (m.comments_count || 0), 0) / media.length : 0;
    // 좋아요를 숨긴 계정은 댓글만으로 계산한다(낮게 나온다)
    const engagementPct = followers > 0 ? (((avgLikes ?? 0) + avgComments) / followers) * 100 : null;
    const lastPostAt = media[0]?.timestamp || null;
    const daysSinceLastPost = lastPostAt ? Math.floor((Date.now() - Date.parse(lastPostAt)) / 86400000) : null;
    const gongguMedia = media.filter((m) => GONGGU_RE.test(m.caption || ""));
    const corpus = [bd.biography || "", ...media.map((m) => m.caption || "")].join("\n");
    const keywordHits: Record<string, number> = {};
    for (const k of keywords) {
      const n = corpus.split(k).length - 1;
      if (n > 0) keywordHits[k] = n;
    }
    const a: Analysis = {
      handle, ok: true,
      name: bd.name, biography: bd.biography, website: bd.website,
      followers, mediaCount: bd.media_count,
      lastPostAt, daysSinceLastPost,
      avgLikes: avgLikes == null ? null : Math.round(avgLikes),
      avgComments: Math.round(avgComments * 10) / 10,
      engagementPct: engagementPct == null ? null : Math.round(engagementPct * 100) / 100,
      gongguPosts: gongguMedia.length,
      gongguExamples: gongguMedia.slice(0, 3).map((m) => m.permalink || "").filter(Boolean),
      keywordHits,
      contacts: extractContacts(bd.biography || "", bd.website),
    };
    const { score, parts } = scoreOf(a);
    return { ...a, score, scoreParts: parts };
  } catch (e) {
    return { handle, ok: false, error: (e as Error).message };
  }
}

/** 시드 계정(비슷한 브랜드·공구 계정)의 최근 캡션에서 @언급된 계정을 뽑는다. */
export async function mentionsFromSeed(token: string, rawSeed: string, limit = 50): Promise<{ seed: string; ok: boolean; error?: string; mentions: { handle: string; count: number; example?: string }[] }> {
  const seed = normalizeHandle(rawSeed) || rawSeed;
  try {
    const igId = await myIgId(token);
    const bd = await discovery(token, igId, seed, `username,media.limit(${limit}){caption,permalink}`);
    const tally = new Map<string, { count: number; example?: string }>();
    for (const m of (bd?.media?.data || []) as IgMedia[]) {
      for (const h of extractMentions(m.caption || "")) {
        if (h === seed) continue;
        const t = tally.get(h) || { count: 0, example: m.permalink };
        t.count += 1;
        tally.set(h, t);
      }
    }
    const mentions = Array.from(tally.entries()).map(([handle, v]) => ({ handle, ...v })).sort((a, b) => b.count - a.count);
    return { seed, ok: true, mentions };
  } catch (e) {
    return { seed, ok: false, error: (e as Error).message, mentions: [] };
  }
}

/** 동시 n 개씩 돌린다. business_discovery 는 우리 계정 호출 한도(시간당)를 같이 쓴다. */
export async function mapLimit<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]);
    }
  }));
  return out;
}
