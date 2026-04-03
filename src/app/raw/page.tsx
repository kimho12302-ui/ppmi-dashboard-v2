"use client";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";

export default function RawDataPage() {
  return (
    <PageShell title="Raw Data" description="DB 테이블 직접 조회">
      {/* P7에서 구현: 테이블 선택 드롭다운 + DataTable + CSV 다운로드 */}
      <div className="flex items-center gap-3">
        <select
          className="px-3 py-2 text-sm rounded-lg border bg-card text-foreground"
          disabled
        >
          <option>daily_sales</option>
          <option>daily_ad_spend</option>
          <option>product_sales</option>
          <option>daily_funnel</option>
          <option>keyword_performance</option>
        </select>
        <button
          className="px-3 py-2 text-sm rounded-lg border text-muted-foreground"
          disabled
        >
          CSV 다운로드
        </button>
      </div>
      <Card>
        <CardContent className="flex items-center justify-center h-64 text-muted-foreground">
          P7 — Raw Data 테이블 영역
        </CardContent>
      </Card>
    </PageShell>
  );
}
