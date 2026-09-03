// 브랜드 그룹 뷰 (2026-07-29): 펫 = 너티+아이언펫+사입 통합, 밸런스랩 = 검사 라인별 분해.
// 광고비/퍼널 원천에는 제품 구분이 없으므로 검사별 분해는 매출(product_sales)에만 적용.

export const PET_BRANDS = ["nutty", "ironpet", "saip"];

// 필터 파라미터("pet" 포함) → 실제 brand 목록. "all"은 호출부에서 이미 분기하므로 여기선 개별/그룹만.
export function expandBrands(brand: string): string[] {
  return brand === "pet" ? PET_BRANDS : [brand];
}

// 브랜드 → 그룹 키 (오버뷰 그룹 합산용)
export function brandGroup(brand: string): "pet" | "balancelab" | "other" {
  if (PET_BRANDS.includes(brand)) return "pet";
  if (brand === "balancelab") return "balancelab";
  return "other";
}

export const GROUP_LABELS: Record<string, string> = {
  pet: "펫 (너티·아이언펫·사입)",
  balancelab: "밸런스랩",
};

// ── 밸런스랩 검사 라인 분류 (product 문자열 키워드 기반) ──
// 타액·음식물과민증은 런칭 전(판매 0)이어도 항상 라인이 표시되도록 목록을 고정한다.
// 밸런스랩 검사 라인 4종 (2026-09 확정).
//
// ★ 순서가 중요하다. 위에서부터 첫 매칭이 이긴다.
//   "큐모발검사 뉴트리션"과 "큐모발검사 중금속"이 둘 다 "모발"을 포함하므로,
//   포괄 패턴(/모발/)을 먼저 두면 두 제품이 한 덩어리로 합쳐진다.
//   실제 제품명(DB 실측): "큐모발검사 뉴트리션", "큐모발검사 뉴트리션 + 종이결과지",
//   "큐모발검사 중금속", "큐모발검사 중금속 + 종이결과지", "큐음식물 과민증 검사 식단관리"
//   → 옵션(+종이결과지 / +맞춤 영양제)이 붙어도 같은 라인으로 묶인다.
//
// preLaunch = 아직 판매 개시 전. 화면에서 "런칭 전"으로 표시하고 매출 0을 정상으로 본다.
//   음식물과민증은 2026-09 기준 실제 매출이 발생해(170만원/7건) preLaunch 를 내렸다.
export const BL_TEST_LINES: { key: string; label: string; match: RegExp; preLaunch?: boolean }[] = [
  { key: "hair_nutrition", label: "큐모발검사 뉴트리션", match: /뉴트리션/ },
  { key: "hair_metal", label: "큐모발검사 중금속", match: /중금속/ },
  { key: "saliva", label: "큐타액호르몬검사", match: /타액|호르몬/, preLaunch: true },
  { key: "food", label: "큐음식물과민증검사", match: /과민증|지연성|알러지|알레르기|음식물|IgG/i },
  // 위 4종에 안 걸리는 모발검사(옵션 없는 "큐모발검사" 등)가 "기타"로 사라지지 않도록 하는 안전망.
  { key: "hair_etc", label: "큐모발검사 (기타)", match: /모발/ },
];

export function classifyBlProduct(product: string): string {
  const p = String(product || "");
  for (const line of BL_TEST_LINES) if (line.match.test(p)) return line.key;
  return "etc";
}
