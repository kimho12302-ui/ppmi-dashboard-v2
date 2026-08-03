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
export const BL_TEST_LINES: { key: string; label: string; match: RegExp; preLaunch?: boolean }[] = [
  { key: "hair", label: "모발검사", match: /모발/ },
  { key: "saliva", label: "타액검사", match: /타액|호르몬/, preLaunch: true },
  { key: "food", label: "음식물과민증검사", match: /과민증|지연성|알러지|알레르기|음식물|IgG/i, preLaunch: true },
];

export function classifyBlProduct(product: string): string {
  const p = String(product || "");
  for (const line of BL_TEST_LINES) if (line.match.test(p)) return line.key;
  return "etc";
}
