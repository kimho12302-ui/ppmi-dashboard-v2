"use client";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";

export default function SalesPage() {
  return (
    <PageShell title="매출 분석" description="채널별·브랜드별 매출 트렌드">
      {/* P2에서 구현: KPI 4개 + 일별 매출 차트 + 채널별 바차트 + 제품 테이블 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {["매출", "주문 수", "평균 객단가", "전월 대비"].map((label) => (
          <Card key={label} className="p-5">
            <CardContent className="p-0">
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className="text-2xl font-bold mt-1">—</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="flex items-center justify-center h-64 text-muted-foreground">
          P2 — 매출 차트 영역
        </CardContent>
      </Card>
    </PageShell>
  );
}
