"use client";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";

export default function KeywordsPage() {
  return (
    <PageShell title="키워드" description="키워드별 광고 성과 분석">
      {/* P5에서 구현: KPI 6개 + 키워드 테이블 + 그룹핑 + 버블 차트 */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {["총 비용", "총 클릭", "키워드 수", "평균 CTR", "전환수", "키워드 ROAS"].map(
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
          P5 — 키워드 테이블 + 버블 차트 영역
        </CardContent>
      </Card>
    </PageShell>
  );
}
