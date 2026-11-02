"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { cn } from "@/lib/utils";
import { DAILY_TAB_KEYS, TABS, type Tab } from "@/components/settings/shared";
import { DailyInputTab } from "@/components/settings/daily-input-tab";
import { BrandConfigTab } from "@/components/settings/brand-config-tab";
import { ChannelConfigTab } from "@/components/settings/channel-config-tab";
import { CostTab } from "@/components/settings/cost-tab";
import { TargetsTab } from "@/components/settings/targets-tab";
import { UploadTab } from "@/components/settings/upload-tab";
import { EventsTab } from "@/components/settings/events-tab";

export type SettingsMode = "all" | "daily";

/** /settings 와 /daily 가 같은 구현을 공유한다. mode 로 노출 탭만 다르다. */
export function SettingsScreen({ mode = "all" }: { mode?: SettingsMode }) {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">로딩 중...</div>}>
      <SettingsInner mode={mode} />
    </Suspense>
  );
}

// 탭 상태를 URL(?tab=)에 둔다. 이전에는 로컬 state 라서 "설정 > 목표설정에서 등록" 같은
// 안내 링크를 눌러도 항상 일일 입력 탭이 열렸고, 특정 탭을 북마크/공유할 수 없었다(2026-08 리뷰).
function SettingsInner({ mode }: { mode: SettingsMode }) {
  const daily = mode === "daily";
  const basePath = daily ? "/daily" : "/settings";
  const visibleTabs = daily
    ? TABS.filter((t) => (DAILY_TAB_KEYS as readonly string[]).includes(t.key))
    : TABS;
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlTab = searchParams.get("tab") as Tab | null;
  const tab: Tab = TABS.some(t => t.key === urlTab) ? (urlTab as Tab) : "daily";
  const setTab = (key: Tab) => {
    const params = new URLSearchParams(searchParams.toString());
    if (key === "daily") params.delete("tab"); else params.set("tab", key);
    const qs = params.toString();
    router.replace(qs ? `${basePath}?${qs}` : basePath, { scroll: false });
  };

  return (
    <PageShell title={daily ? "일일 입력" : "설정"} description={daily ? "매일 넣는 광고비·퍼널 수치 (API 가 없어 사람이 넣는 항목)" : undefined} hideFilters>
      <div className="flex items-center gap-1 rounded-lg bg-muted p-1 overflow-x-auto">
        {visibleTabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={cn("px-3 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap",
              tab === t.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
          >{t.label}</button>
        ))}
      </div>

      {tab === "daily" && <DailyInputTab onSwitchTab={setTab} />}
      {tab === "upload" && <UploadTab />}
      {!daily && tab === "brands" && <BrandConfigTab />}
      {!daily && tab === "channels" && <ChannelConfigTab />}
      {!daily && tab === "costs" && <CostTab />}
      {!daily && tab === "targets" && <TargetsTab />}
      {!daily && tab === "events" && <EventsTab />}
    </PageShell>
  );
}
