// 화면 주소 → 이용 가이드. PageShell 의 「이용 가이드」 버튼이 쓴다.
//
// 가이드가 없는 화면은 null 이 아니라 공통 가이드만 돌려준다(버튼을 숨기지 않는다).
// 새 화면을 사이드바에 넣으면 여기 한 줄과 가이드 하나를 같이 넣는다.
import type { Guide } from "./types";
import {
  ADS_GUIDE, CHANNEL_GUIDE, COMMON_GUIDE, FUNNEL_GUIDE, INSIGHTS_GUIDE, OVERVIEW_GUIDE, SALES_GUIDE,
} from "./analysis";
import { CONTENT_GUIDE, KEYWORDS_GUIDE } from "./marketing";
import { BRAND_GUIDES } from "./brands";
import { BUDGET_GUIDE, MEDIA_BUDGET_GUIDE, MONTHLY_PNL_GUIDE, MONTHLY_SUMMARY_GUIDE, RAW_GUIDE } from "./plan";
import { DAILY_GUIDE, INFLUENCERS_GUIDE, SETTINGS_GUIDE, STATUS_GUIDE } from "./ops";

export type { Guide, GuideItem } from "./types";
export { COMMON_GUIDE };

const BY_PATH: Record<string, Guide> = {
  "/": OVERVIEW_GUIDE,
  "/insights": INSIGHTS_GUIDE,
  "/sales": SALES_GUIDE,
  "/ads": ADS_GUIDE,
  "/channel": CHANNEL_GUIDE,
  "/funnel": FUNNEL_GUIDE,
  "/content": CONTENT_GUIDE,
  "/keywords": KEYWORDS_GUIDE,
  "/budget": BUDGET_GUIDE,
  "/media-budget": MEDIA_BUDGET_GUIDE,
  "/raw": RAW_GUIDE,
  "/influencers": INFLUENCERS_GUIDE,
  "/daily": DAILY_GUIDE,
  "/settings": SETTINGS_GUIDE,
  "/status": STATUS_GUIDE,
};

/** 끝의 / 를 떼어 "/sales/" 와 "/sales" 를 같은 화면으로 본다. 루트는 그대로 둔다. */
function normalize(pathname: string): string {
  const p = (pathname || "/").split("?")[0];
  return p.length > 1 ? p.replace(/\/+$/, "") : p;
}

/**
 * 지금 화면의 가이드. 없으면 null (그때 드로어는 공통 가이드만 보여 준다).
 * view 는 /monthly 의 ?view= 값. 월별 요약은 같은 주소 안에서 요약 / 제품별 손익 두 보기로 갈린다.
 */
export function resolveGuide(pathname: string, view?: string | null): Guide | null {
  const p = normalize(pathname);
  if (p === "/monthly") return view === "pnl" ? MONTHLY_PNL_GUIDE : MONTHLY_SUMMARY_GUIDE;
  const brand = p.match(/^\/brand\/([^/]+)$/)?.[1];
  if (brand) return BRAND_GUIDES[brand] ?? null;
  return BY_PATH[p] ?? null;
}
