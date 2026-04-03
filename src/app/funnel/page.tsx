"use client";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";

export default function FunnelPage() {
  return (
    <PageShell title="퍼널" description="채널별 전환 퍼널 분석">
      {/* P3에서 구현: 전체 퍼널 시각화 + 채널별 독립 퍼널 + 일별 트렌드 */}
      <Card>
        <CardContent className="flex items-center justify-center h-48 text-muted-foreground">
          P3 — 전체 퍼널 시각화 (노출 → 유입 → 장바구니 → 구매 → 재구매)
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {["카페24", "스마트스토어", "쿠팡", "Meta 광고"].map((ch) => (
          <Card key={ch}>
            <CardContent className="flex items-center justify-center h-36 text-muted-foreground">
              P3 — {ch} 퍼널
            </CardContent>
          </Card>
        ))}
      </div>
    </PageShell>
  );
}
