"use client";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";

export default function AdsPage() {
  return (
    <PageShell title="광고 분석" description="채널별 광고 효율 및 ROAS">
      {/* P2에서 구현: KPI 6개 + 채널별 카드 + 트렌드 차트 + 전환 테이블 */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {["총 광고비", "통합 ROAS", "총 클릭", "평균 CTR", "전환수", "CPA"].map(
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
          P2 — 광고 차트 영역
        </CardContent>
      </Card>
    </PageShell>
  );
}
