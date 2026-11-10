"use client";

import { Card, CardContent } from "@/components/ui/card";
import { EventManagerPanel } from "@/components/event-markers";

/* ── 이벤트 관리 탭 ── */
export function EventsTab() {
  return (
    <div className="space-y-4">
      <Card data-tour="settings-events">
        <CardContent className="p-4">
          <h3 className="font-semibold mb-1">마케팅 이벤트 관리</h3>
          <p className="text-xs text-muted-foreground mb-4">
            이벤트를 등록하면 Overview 트렌드 차트에 마커로 표시됩니다. (프로모션, 캠페인, 이슈 등)
          </p>
          <EventManagerPanel />
        </CardContent>
      </Card>
    </div>
  );
}
