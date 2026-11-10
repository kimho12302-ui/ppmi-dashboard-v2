// 화면 주소 → 가이드·매뉴얼. PageShell 오른쪽 위 「가이드」·「매뉴얼」 버튼이 쓴다.
// 새 화면을 사이드바에 넣으면 screens/ 에 파일 하나와 여기 한 줄을 같이 넣는다.
import type { ScreenGuide } from "./types";
import common from "./screens/common";
import overview from "./screens/overview";
import insights from "./screens/insights";
import sales from "./screens/sales";
import ads from "./screens/ads";
import channel from "./screens/channel";
import funnel from "./screens/funnel";
import content from "./screens/content";
import keywords from "./screens/keywords";
import brand_pet from "./screens/brand-pet";
import brand_nutty from "./screens/brand-nutty";
import brand_ironpet from "./screens/brand-ironpet";
import brand_saip from "./screens/brand-saip";
import brand_balancelab from "./screens/brand-balancelab";
import budget from "./screens/budget";
import media_budget from "./screens/media-budget";
import monthly_summary from "./screens/monthly-summary";
import monthly_pnl from "./screens/monthly-pnl";
import raw from "./screens/raw";
import influencers from "./screens/influencers";
import daily from "./screens/daily";
import settings from "./screens/settings";
import status from "./screens/status";

export type { ScreenGuide, TourStep, ManualSection, Block } from "./types";
export const COMMON = common;

const BY_PATH: Record<string, ScreenGuide> = {
  "/": overview,
  "/insights": insights,
  "/sales": sales,
  "/ads": ads,
  "/channel": channel,
  "/funnel": funnel,
  "/content": content,
  "/keywords": keywords,
  "/budget": budget,
  "/media-budget": media_budget,
  "/raw": raw,
  "/influencers": influencers,
  "/daily": daily,
  "/settings": settings,
  "/status": status,
};

const BRANDS: Record<string, ScreenGuide> = {
  pet: brand_pet, nutty: brand_nutty, ironpet: brand_ironpet, saip: brand_saip, balancelab: brand_balancelab,
};

function normalize(pathname: string): string {
  const p = (pathname || "/").split("?")[0];
  return p.length > 1 ? p.replace(/\/+$/, "") : p;
}

/** 지금 화면의 가이드. 없으면 null(그때는 기본 사용법만). view 는 /monthly 의 ?view= 값. */
export function resolveScreenGuide(pathname: string, view?: string | null): ScreenGuide | null {
  const p = normalize(pathname);
  if (p === "/monthly") return view === "pnl" ? monthly_pnl : monthly_summary;
  const brand = p.match(/^\/brand\/([^/]+)$/)?.[1];
  if (brand) return BRANDS[brand] ?? null;
  return BY_PATH[p] ?? null;
}
