import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/db";
import { cachedGET } from "@/lib/api-cache";
import { kstDate } from "@/lib/date";
import {
  GROUP_CAMPAIGNS, SHOP_MIN_PURCHASES, PL_MIN_CLICKS_OWN, COUPANG_MIN_ORDERS,
  buildRegIndex, buildHolds, buildShopping, buildPowerlink, buildCoupang,
  type NaverAccount, type RegKeyword, type HoldRule, type ChangeLogRow, type SourceEntry,
  type NaverCandidate, type CoupangSource,
} from "@/lib/add-keywords";

// 키워드 탭 「추가할 키워드」 칸. 2026-10-20 신설.
//   channel=naver   네이버 쇼핑 구매어 → 파워링크 등록 후보 + 파워링크 클릭어 → 등록 후보
//   channel=coupang 쿠팡 검색 영역 주문어 → 수동 키워드 후보(등록 여부 미확인)
// 규칙은 src/lib/add-keywords.ts, 정본은 Work/PPMI/projects/검색광고-운영/reports/2026-10-20-추가키워드-기준.md
// SQL: docs/sql/2026-10-20-add-keyword-candidates.sql (표 naver_sa_keyword·sa_keyword_hold, 함수 2개)
//
// ★ 등록 목록(naver_sa_keyword)이 없거나 비면 네이버 후보를 아예 계산하지 않는다.
//   등록 대조 없이 계산하면 이미 운영 중인 검색어까지 전부 "미등록"으로 나와 거짓 후보가 된다.
// ★ 등록 대조는 계정별 최신 seen_on 행만 쓴다. 계정에서 지워진 키워드는 옛 seen_on 에 남아 있다.
// ★ RPC 는 하나씩 부른다(병렬이면 서로 물려 statement timeout, naver-search-terms 라우트와 같은 교훈).

const PET_BRANDS = ["nutty", "saip", "ironpet"] as const;
const KNOWN = new Set<string>(["all", "pet", "balancelab", ...PET_BRANDS]);

function brandsOf(brand: string): string[] {
  if (brand === "all") return [...PET_BRANDS, "balancelab"];
  if (brand === "pet") return [...PET_BRANDS];
  return [brand];
}
const accountOf = (b: string): NaverAccount => (b === "balancelab" ? "balancelab" : "main");

type PgErr = { code?: string; message?: string } | null;
const isMissing = (e: PgErr) => !!e && (e.code === "PGRST205" || e.code === "PGRST202" || e.code === "42P01" || e.code === "42883");
const isTimeout = (e: PgErr) => !!e && (e.code === "57014" || (e.message || "").includes("statement timeout"));

/** 판정을 못 하는 사유. 화면이 그대로 안내한다. */
type NotReady = "sql" | "empty";

const REG_COLS = "account,keyword_norm,brand,campaign,adgroup,campaign_status,adgroup_status,status_reason,keyword_lock,is_live,imp_30d,bid";

async function loadRegistry(account: NaverAccount): Promise<{ seenOn: string; rows: RegKeyword[] } | NotReady> {
  const head = await supabase.from("naver_sa_keyword").select("seen_on").eq("account", account)
    .order("seen_on", { ascending: false }).limit(1);
  if (isMissing(head.error)) return "sql";
  if (head.error) throw head.error;
  const seenOn = head.data?.[0]?.seen_on as string | undefined;
  if (!seenOn) return "empty";
  const rows = await fetchAll<RegKeyword>(
    supabase.from("naver_sa_keyword").select(REG_COLS)
      .eq("account", account).eq("seen_on", seenOn).eq("campaign_tp", "WEB_SITE"),
    "keyword_id",
  );
  return { seenOn, rows };
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<{ data: T | null; error: PgErr }> {
  let r = await supabase.rpc(fn, args);
  if (isTimeout(r.error)) r = await supabase.rpc(fn, args); // 찬 상태(cold) 첫 질의만 넘길 때가 있다
  return { data: r.data as T | null, error: r.error };
}

interface SourceResp { entries: SourceEntry[]; norms: number; rows: number; latest: string | null }

async function naverSource(account: NaverAccount, adType: "shopping" | "powerlink", from: string, to: string, brand: string | null) {
  return rpc<SourceResp>("naver_search_term_add_source", {
    p_account: account, p_from: from, p_to: to, p_ad_type: adType, p_brand: brand,
    p_exclude_campaigns: account === "balancelab" ? GROUP_CAMPAIGNS : [],
    p_min_purchases: SHOP_MIN_PURCHASES,
    // DB 는 가장 낮은 문턱(자사 1클릭)으로만 거르고, 자사/그 외 구분은 add-keywords.ts 가 한다.
    p_min_clicks: PL_MIN_CLICKS_OWN,
  });
}

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

async function naver(brand: string, from: string, to: string) {
  const brands = brandsOf(brand);
  const accounts = Array.from(new Set(brands.map(accountOf)));

  // 1) 등록 목록. 하나라도 없으면 판정하지 않는다.
  const registry: { account: NaverAccount; seenOn: string; rows: number }[] = [];
  const regRows: RegKeyword[] = [];
  for (const a of accounts) {
    const r = await loadRegistry(a);
    if (r === "sql" || r === "empty") return json({ channel: "naver", ready: false, reason: r, account: a });
    registry.push({ account: a, seenOn: r.seenOn, rows: r.rows.length });
    regRows.push(...r.rows);
  }

  // 2) 보류: 보류표 + 직접 조정 기록(마지막 행동이 delete·pause 이고 검토일이 남은 것).
  const holdQ = await supabase.from("sa_keyword_hold").select("account,brand,pattern,match,reason,review_on");
  if (isMissing(holdQ.error)) return json({ channel: "naver", ready: false, reason: "sql" as NotReady });
  if (holdQ.error) throw holdQ.error;
  const logs = await fetchAll<ChangeLogRow>(
    supabase.from("sa_change_log").select("account,keyword,action,review_on,applied_at").in("account", accounts),
  );
  const today = kstDate();
  const hold = buildHolds((holdQ.data || []) as HoldRule[], logs, today);
  const reg = buildRegIndex(regRows);

  // 3) 검색어. 쇼핑은 계정 전체(브랜드를 상품명으로 다시 정하므로), 파워링크는 브랜드별.
  const out: NaverCandidate[] = [];
  let latest: string | null = null;
  const seen = (l: string | null) => { if (l && (!latest || l > latest)) latest = l; };
  for (const a of accounts) {
    const s = await naverSource(a, "shopping", from, to, null);
    if (isMissing(s.error)) return json({ channel: "naver", ready: false, reason: "sql" as NotReady });
    if (s.error) throw new Error(`쇼핑 ${a}: ${s.error.message}`);
    seen(s.data?.latest ?? null);
    out.push(...buildShopping(a, s.data?.entries || [], reg, hold));
  }
  for (const b of brands) {
    const a = accountOf(b);
    const p = await naverSource(a, "powerlink", from, to, b);
    if (isMissing(p.error)) return json({ channel: "naver", ready: false, reason: "sql" as NotReady });
    if (p.error) throw new Error(`파워링크 ${b}: ${p.error.message}`);
    seen(p.data?.latest ?? null);
    out.push(...buildPowerlink(a, p.data?.entries || [], reg, hold));
  }

  // 쇼핑은 상품명으로 정한 대상 브랜드로, 파워링크는 행 브랜드로 고른 브랜드만 남긴다.
  const allowed = new Set(brands);
  const kept = out.filter((c) => allowed.has(c.brand));
  return json({
    channel: "naver", ready: true, today, registry, latestCollected: latest,
    shopping: kept.filter((c) => c.channel === "shopping"),
    powerlink: kept.filter((c) => c.channel === "powerlink"),
  });
}

interface CoupangResp {
  candidates: CoupangSource[]; rows: number; dates: number; latest: string | null;
  search_total: { impressions: number; clicks: number; spend: number; orders_14d: number; conv_sales_14d: number };
}

async function coupang(from: string, to: string) {
  const r = await rpc<CoupangResp>("coupang_keyword_add_source", { p_from: from, p_to: to, p_min_orders: COUPANG_MIN_ORDERS });
  if (isMissing(r.error)) return json({ channel: "coupang", ready: false, reason: "sql" as NotReady });
  if (r.error) throw new Error(r.error.message);
  const d = r.data;
  return json({
    channel: "coupang", ready: true,
    candidates: buildCoupang(d?.candidates || []),
    searchTotal: d?.search_total ?? null, rows: d?.rows ?? 0, dates: d?.dates ?? 0, latestCollected: d?.latest ?? null,
  });
}

async function getImpl(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const channel = sp.get("channel") || "";
  const brand = sp.get("brand") || "all";
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";
  if (channel !== "naver" && channel !== "coupang") return json({ error: "channel 은 naver|coupang" }, 400);
  if (!KNOWN.has(brand)) return json({ error: `brand 는 ${[...KNOWN].join("|")}` }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    return json({ error: "from·to 는 YYYY-MM-DD, from <= to" }, 400);
  }
  try {
    return channel === "naver" ? await naver(brand, from, to) : await coupang(from, to);
  } catch (e) {
    const msg = e instanceof Error ? e.message : (e as PgErr)?.message || String(e);
    return json({ error: msg }, 500);
  }
}

// 5분 캐시·쓰기 후 무효화 (src/lib/api-cache.ts)
export const GET = cachedGET(
  getImpl,
  ["raw_naver_search_term", "raw_coupang_keyword", "naver_sa_keyword", "sa_keyword_hold", "sa_change_log"],
  ["channel", "brand", "from", "to"],
);
