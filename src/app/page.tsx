"use client";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";

export default function OverviewPage() {
  return (
    <PageShell title="Overview" description="PPMI 마케팅 대시보드 전체 현황">
      {/* P4에서 구현: KPI 8개 + 누적 매출 그래프 + 브랜드 비중 + TOP 5 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {["매출", "광고비", "ROAS", "주문 수", "통상이익", "이익률", "전환율", "신규고객"].map(
          (label) => (
            <Card key={label} className="p-5">
              <CardContent className="p-0">
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="text-2xl font-bold mt-1">—</p>
              </CardContent>
            </Card>
          )
        )}
      </div>
      <Card>
        <CardContent className="flex items-center justify-center h-64 text-muted-foreground">
          P4 — Overview 차트 영역
        </CardContent>
      </Card>
    </PageShell>
  );
}
