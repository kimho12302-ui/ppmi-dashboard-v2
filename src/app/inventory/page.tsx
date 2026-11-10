import { PageShell } from "@/components/page-shell";
import { InventoryScreen } from "@/components/inventory/inventory-screen";

// 재고 (2026-11-10). 「2026 재고·출고 통합관리」 시트가 하던 판단을 옮긴 화면. 기간 필터는 안 쓴다(오늘 재고 기준).
export default function InventoryPage() {
  return (
    <PageShell title="재고" description="위킵 재고 기준 품절 · 발주 필요 · 과재고 · 예상 소진일 · 재고 가치" hideFilters>
      <InventoryScreen />
    </PageShell>
  );
}
