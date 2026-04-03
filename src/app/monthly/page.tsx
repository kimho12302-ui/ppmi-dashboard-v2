"use client";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";

export default function MonthlyPage() {
  return (
    <PageShell title="월별 요약" description="월별·주별 매출/광고비/ROAS 요약">
      {/* P4에서 구현: 월별/주별 토글 + 차트 + 시트형 테이블 */}
      <Card>
        <CardContent className="flex items-center justify-center h-48 text-muted-foreground">
          P4 — 월별 매출 vs 광고비 차트
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex items-center justify-center h-64 text-muted-foreground">
          P4 — 월별 요약 테이블 (브랜드별 매출, 채널별 광고비, ROAS)
        </CardContent>
      </Card>
    </PageShell>
  );
}
