"use client";

import { useState } from "react";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "daily", label: "📋 일일 입력" },
  { key: "targets", label: "🎯 목표 설정" },
  { key: "costs", label: "💰 제품 원가" },
  { key: "brands", label: "🏷️ 브랜드/채널" },
  { key: "sources", label: "📡 데이터 소스" },
] as const;

type SettingsTab = (typeof TABS)[number]["key"];

export default function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>("daily");

  return (
    <PageShell title="설정" hideFilters>
      {/* 탭 네비게이션 */}
      <div className="flex items-center gap-1 rounded-lg bg-muted p-1 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "px-3 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap",
              tab === t.key
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 탭 콘텐츠 (P6에서 구현) */}
      <Card>
        <CardContent className="flex items-center justify-center h-64 text-muted-foreground">
          P6 — {TABS.find((t) => t.key === tab)?.label} 영역
        </CardContent>
      </Card>
    </PageShell>
  );
}
