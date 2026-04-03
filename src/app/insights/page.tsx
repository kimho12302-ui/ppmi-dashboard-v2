"use client";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";

export default function InsightsPage() {
  return (
    <PageShell title="인사이트" description="자동 감지 이상치 및 트렌드">
      {/* P8에서 구현: 인사이트 카드 (Critical/Warning/Opportunity/Info) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[
          { emoji: "🔴", label: "Critical", desc: "즉시 대응 필요" },
          { emoji: "🟡", label: "Warning", desc: "주의 필요" },
          { emoji: "🟢", label: "Opportunity", desc: "기회 포착" },
          { emoji: "🔵", label: "Info", desc: "참고 사항" },
        ].map((item) => (
          <Card key={item.label}>
            <CardContent className="flex items-center gap-3 py-8 text-muted-foreground">
              <span className="text-2xl">{item.emoji}</span>
              <div>
                <p className="font-medium text-foreground">{item.label}</p>
                <p className="text-sm">{item.desc}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="flex items-center justify-center h-48 text-muted-foreground">
          P8 — 인사이트 목록 영역
        </CardContent>
      </Card>
    </PageShell>
  );
}
