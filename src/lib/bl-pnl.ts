// 밸런스랩 제품별 손익 (2026-10-28).
//
// 김호가 매달 손으로 채우던 구글시트 「★브랜드별 매출」(1B91e5Je…, gid 1912642671) 의
// 밸런스랩 제품 블록(N~AI 열)을 대시보드가 자동 계산한다. 이 파일이 **설정과 계산식의 단일 정본**이다.
// 단가·수수료·배송비를 바꾸려면 아래 PNL_PRODUCTS / 상수만 고친다.
//
// 시트 계산식과 다른 점 (화면은 재료비를 한 번만 뺀다)
//   시트 공구 블록은 마진(Q = 매출 − 수량×단가)에서 재료비를 한 번 빼고,
//   공헌이익(2)(W = T − 재료비)에서 또 뺀다. 자체 블록은 한 번만 뺀다.
//   시트의 밸런스랩 합계 행(AH23 = AE23 + T23)도 공구 쪽은 한 번 뺀 T 를 쓴다.
//   그래서 화면은 두 블록 모두 "한 번 차감"(= 시트 T·AE 열)으로 통일했다. 김호 확인 대기.

import { classifyBlProduct } from "@/lib/brand-groups";

export type PnlProductKey = "nutrition" | "heavy" | "saliva" | "food" | "supplement" | "etc";

export interface PnlProductConfig {
  key: PnlProductKey;
  label: string;
  /** 재료비 원가(1개당). 시트 수식에서 가져옴 */
  unitCost: number;
  /** 자체 판매 배송비 배수. 검사는 왕복 2회(키트 발송 + 검체 회수), 영양제는 1회 */
  selfShipTimes: number;
  /** 단가 출처·주의. 화면 설정 표에 그대로 보인다 */
  note: string;
}

export const PNL_PRODUCTS: PnlProductConfig[] = [
  { key: "nutrition", label: "큐모발검사 뉴트리션", unitCost: 10_000, selfShipTimes: 2, note: "시트 AG42 =수량×10,000" },
  { key: "heavy", label: "큐모발검사 중금속", unitCost: 10_000, selfShipTimes: 2, note: "시트 AG59 =수량×10,000" },
  { key: "saliva", label: "큐타액호르몬검사", unitCost: 36_650, selfShipTimes: 2, note: "김호 확정 2026-10-28 (시트 수식 10,000·30,000 대신)" },
  { key: "food", label: "큐음식물과민증검사", unitCost: 194_000, selfShipTimes: 2, note: "시트 AG80 =수량×194,000" },
  { key: "supplement", label: "메디넥스(영양제)", unitCost: 30_000, selfShipTimes: 1, note: "시트 AG103 =수량×30,000, 배송 1회(AD103)" },
  { key: "etc", label: "기타(구분 안 되는 상품)", unitCost: 10_000, selfShipTimes: 2, note: "옵션 없는 큐모발검사·큐모발검사 미네랄 등. 합계에만 들어감" },
];

/** 화면 제품 선택 순서. etc 는 합계에만 넣고 따로 고르지는 않는다 */
export const PNL_SELECTABLE: PnlProductKey[] = ["nutrition", "heavy", "saliva", "food", "supplement"];

/** 공구 수수료(마케팅비 칸). 시트 R21 "수수료 26.4%" */
export const GONGGU_COMMISSION_RATE = 0.264;
/** 1회 배송비. 시트 S21 "1회 부담 3000원" */
export const SHIP_FEE = 3_000;
/** 공구 배송비 배수. 시트 S42 =3000×주문건수 */
export const GONGGU_SHIP_TIMES = 1;

/**
 * 판매 원장에 공구 표식(lineup·공구 판매처)이 아예 없는 달.
 * 2026-01·02 공구는 smartstore·lineup 빈 행으로만 들어와 자체와 구분이 안 된다
 * (1월 16~30일 공구 441개, 메모리 project_qhair_jan2026_gonggu). 이 달은 공구 블록을
 * "구분 불가"로 두고 자체 블록에 공구가 섞여 있다고 표시한다. 원장에 lineup 을 채우면 이 목록에서 뺀다.
 */
export const GONGGU_UNTAGGED_MONTHS = ["2026-01", "2026-02"];

export function productConfig(key: PnlProductKey): PnlProductConfig {
  return PNL_PRODUCTS.find((p) => p.key === key) ?? PNL_PRODUCTS[PNL_PRODUCTS.length - 1];
}

// ── 판매 원장 행 → 손익 제품 ──
// 영양제를 먼저 본다. 판매 원장의 category "하루가꿈"(맞춤영양제)과 메디넥스 상품(10월~).
// ★ "큐모발검사 뉴트리션 + 맞춤 영양제" 묶음은 뉴트리션으로 간다(검사가 본품).
//   시트는 이 묶음에서 영양제 몫을 손으로 떼어 영양제 블록에 적었지만 DB 는 한 상품이라 뗄 근거가 없다.
const SUPPLEMENT = /메디넥스|하루가꿈/;
export function classifyPnlProduct(product: string, category?: string | null): PnlProductKey {
  const p = String(product || "");
  if (category === "하루가꿈" || SUPPLEMENT.test(p)) return "supplement";
  if (/영양제/.test(p) && !/검사/.test(p)) return "supplement";
  switch (classifyBlProduct(p)) {
    case "hair_nutrition": return "nutrition";
    case "hair_metal": return "heavy";
    case "saliva": return "saliva";
    case "food": return "food";
    default: return "etc";
  }
}

// ── 광고 캠페인명 → 손익 제품 ──
// marketing-dashboard/scripts/bl_campaign_map.py 를 옮긴 것. 순서가 우선순위다.
// "hair" = 큐모발 공통(파워링크 P01 등). 뉴트리션·중금속이 한 캠페인에 섞여 있다.
export type AdTarget = PnlProductKey | "hair" | "generic" | "excluded";
const CAMPAIGN_RULES: [RegExp, AdTarget][] = [
  [/음식물과민증|지연성|알러지|알레르기|IgG|사전예약/i, "food"],
  [/타액|호르몬/, "saliva"],
  [/모발.*뉴트리션|뉴트리션/, "nutrition"],
  [/모발.*중금속|중금속/, "heavy"],
  [/모발|영양실조|생로병사/, "hair"],
];
// 밸런스랩 계정에 얹힌 남의 캠페인. 밸런스랩 광고비로 세지 않는다.
// 경진대회는 2026-05 메타 계정에 섞인 "생분해 플라스틱 아이디어 경진대회".
const NOT_BALANCELAB = /아이언펫|벌크|와이에스환경|한국반려동물안전인증센터|수은세상|99\.브랜드|경진대회|생분해/;

export function classifyAdName(name: string | null | undefined): AdTarget {
  const n = String(name || "");
  if (NOT_BALANCELAB.test(n)) return "excluded";
  for (const [re, t] of CAMPAIGN_RULES) if (re.test(n)) return t;
  return "generic";
}

// 큐모발 파워링크 키워드의 검색 의도 (bl_product_spend_report.py keyword_intent 와 같은 정규식)
const HEAVY_KW = /중금속|납중독|수은/;
const NUTRI_KW = /미네랄|영양|결핍|부족|마그네슘|아연|칼슘|철분|나트륨|구리|셀레늄|대사|체질|기능의학/;
export function isHeavyIntentKeyword(kw: string): boolean {
  return HEAVY_KW.test(kw) && !NUTRI_KW.test(kw);
}

// ── API 응답 모양 ──
export interface SalesCell { revenue: number; quantity: number; orders: number }
export interface AdBreakdown { naverSearch: number; naverShopping: number; meta: number }
export interface PnlMonthInput {
  month: string; // YYYY-MM
  products: Record<PnlProductKey, { gonggu: SalesCell; self: SalesCell; ad: AdBreakdown }>;
  /** 이번 달이라 판매 동기화(최근 5일 지연)가 덜 들어왔을 수 있음 */
  lagWarning: boolean;
  /** 공구 표식이 원장에 없는 달 */
  gongguUntagged: boolean;
  /** 큐모발 파워링크를 중금속으로 가를 키워드 원장 유무 */
  keywordCoverage: "full" | "partial" | "none";
  /** 밸런스랩 광고비 합계(메타+네이버 검색+네이버 쇼핑, GFA 제외) */
  adTotal: number;
  /** 별도 표기: GFA(시트도 제외), 남의 캠페인 */
  gfa: number;
  excluded: Record<string, number>;
}
export interface PnlResponse { year: number; months: PnlMonthInput[]; asOf: string }

// ── 계산 ──
export interface PnlRow {
  revenue: number; quantity: number; orders: number;
  margin: number; marketing: number; shipping: number;
  contribution: number; contributionRate: number | null; materialCost: number;
}

export const ZERO_CELL: SalesCell = { revenue: 0, quantity: 0, orders: 0 };

export function computeGonggu(cell: SalesCell, cfg: PnlProductConfig): PnlRow {
  const materialCost = cell.quantity * cfg.unitCost;
  const margin = cell.revenue - materialCost;
  const marketing = Math.round(cell.revenue * GONGGU_COMMISSION_RATE);
  const shipping = SHIP_FEE * GONGGU_SHIP_TIMES * cell.orders;
  const contribution = margin - marketing - shipping;
  return { ...cell, margin, marketing, shipping, contribution, materialCost, contributionRate: rate(contribution, cell.revenue) };
}

export function computeSelf(cell: SalesCell, adSpend: number, cfg: PnlProductConfig): PnlRow {
  const materialCost = cell.quantity * cfg.unitCost;
  const margin = cell.revenue - materialCost;
  const marketing = Math.round(adSpend);
  const shipping = SHIP_FEE * cfg.selfShipTimes * cell.orders;
  const contribution = margin - marketing - shipping;
  return { ...cell, margin, marketing, shipping, contribution, materialCost, contributionRate: rate(contribution, cell.revenue) };
}

/** 여러 행을 더한다(합계 제품·연간 합계). 비율은 합친 값으로 다시 계산 */
export function sumRows(rows: PnlRow[]): PnlRow {
  const s = rows.reduce(
    (a, r) => ({
      revenue: a.revenue + r.revenue, quantity: a.quantity + r.quantity, orders: a.orders + r.orders,
      margin: a.margin + r.margin, marketing: a.marketing + r.marketing, shipping: a.shipping + r.shipping,
      contribution: a.contribution + r.contribution, materialCost: a.materialCost + r.materialCost, contributionRate: null,
    }),
    { revenue: 0, quantity: 0, orders: 0, margin: 0, marketing: 0, shipping: 0, contribution: 0, materialCost: 0, contributionRate: null } as PnlRow,
  );
  return { ...s, contributionRate: rate(s.contribution, s.revenue) };
}

/** 매출 0 이면 비율은 0 이 아니라 빈칸(null) */
function rate(num: number, den: number): number | null {
  return den > 0 ? num / den : null;
}

export function adSum(a: AdBreakdown): number {
  return a.naverSearch + a.naverShopping + a.meta;
}
