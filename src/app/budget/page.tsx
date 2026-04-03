"use client";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";

export default function BudgetPage() {
  return (
    <PageShell title="예산 현황" description="월별 예산 vs 실적 + 매체별 예산 분배">
      {/* P7에서 구현: 예산 vs 실적 테이블 + 매체별 일예산 */}
      <Card>
        <CardContent className="flex items-center justify-center h-48 text-muted-foreground">
          P7 — 매출/광고비/ROAS 타겟 대비 실적
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex items-center justify-center h-48 text-muted-foreground">
          P7 — 매체별 예산 분배 현황
        </CardContent>
      </Card>
    </PageShell>
  );
}
