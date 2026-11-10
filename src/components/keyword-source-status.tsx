"use client";

// 키워드 분석 탭 「수집 멈춤」 띠. 2026-11-10 신설.
// /api/keywords 가 돌려주는 (플랫폼, 브랜드)별 마지막 수집일로 판정한다(src/lib/sa-balancelab.ts stalledSources).
// 멈춘 플랫폼은 고른 기간에 행이 없어 플랫폼 칩에서 아예 사라진다. 그래서 칩이 아니라 이 띠에 남긴다(지우지 않는다).
// 원인(캠페인을 껐는지, 수집기가 멈췄는지)은 이 데이터로 가를 수 없어 적지 않는다.

import { useMemo } from "react";
import { BRAND_LABELS } from "@/lib/types";
import { stalledSources, type SourceLatest } from "@/lib/sa-balancelab";

export function useStalled(sources: SourceLatest[] | undefined, today: string) {
  return useMemo(() => stalledSources(sources || [], today), [sources, today]);
}

/** 플랫폼 칩 옆에 붙일 말. 그 플랫폼 브랜드가 전부 멈췄으면 "수집 멈춤", 일부만이면 "일부 멈춤"(예: 펫 네이버 검색은 아이언펫만 멈춤) */
export function stalledChipNote(platform: string, stalled: SourceLatest[], sources: SourceLatest[] | undefined): string {
  const n = stalled.filter((s) => s.platform === platform).length;
  if (n === 0) return "";
  const all = (sources || []).filter((s) => s.platform === platform).length;
  return n >= all ? " · 수집 멈춤" : " · 일부 멈춤";
}

export function KeywordSourceStatus({ stalled, labels, from, to, latestCollected }: {
  stalled: SourceLatest[]; labels: Record<string, string>; from: string; to: string; latestCollected: string | null | undefined;
}) {
  const allBefore = !!latestCollected && latestCollected < from;
  if (stalled.length === 0 && !allBefore) return null;
  return (
    <div className="rounded-lg border-l-4 border-amber-500 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-500 space-y-1" data-tour="keywords-stalled">
      {allBefore && (
        <p>
          이 브랜드의 키워드 수집이 <b>{latestCollected}</b> 이후 멈춰 선택하신 기간({from} ~ {to})에는 데이터가 없습니다.
          아래가 비어 있는 것은 성과가 0이어서가 아니라 <b>수집이 멈춘 것</b>입니다.
        </p>
      )}
      {stalled.length > 0 && (
        <>
          <p>아래 원천은 <b>수집 멈춤</b>입니다. 그 뒤 기간에는 그 플랫폼 키워드가 표·칩에 나오지 않습니다(성과 0이 아님).</p>
          <ul className="list-disc pl-4">
            {stalled.map((s) => (
              <li key={`${s.platform}|${s.brand}`}>
                {labels[s.platform] || s.platform} · {BRAND_LABELS[s.brand] || s.brand}: 수집 멈춤(마지막 {s.latest})
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
