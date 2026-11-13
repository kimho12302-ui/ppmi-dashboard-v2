"use client";

// 키워드 분석 탭 원천 상태 띠. 2026-11-10 신설, 2026-11-13 판정 교체.
// 판정은 src/lib/sa-balancelab.ts classifyKeywordSources (키워드 단위 원천 × 광고비).
//   - 주황: 키워드 원천인데 광고비가 이어지는 동안 키워드 기록이 끊김 = 「수집 멈춤」
//   - 회색: 광고를 끈 원천(「광고 집행 없음」), 쇼핑검색 안내, 옛 캠페인 단위 기록을 뺐다는 안내
// 메타·GFA·구글은 키워드 원천이 아니라 여기 나오지 않는다(구글은 일부러 끈 것).

import { useMemo } from "react";
import { BRAND_LABELS } from "@/lib/types";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { classifyKeywordSources, periodNotice, type KeywordSourceStatus as Status, type SourceLatest, type SpendLatest } from "@/lib/sa-balancelab";

export function useSourceStatus(sources: SourceLatest[] | undefined, spend: SpendLatest[] | undefined, today: string): Status {
  return useMemo(() => classifyKeywordSources(sources || [], spend || [], today), [sources, spend, today]);
}

/** 플랫폼 칩 옆에 붙일 말. 그 플랫폼 브랜드가 전부 멈췄으면 "수집 멈춤", 일부만이면 "일부 멈춤" */
export function stalledChipNote(platform: string, status: Status, sources: SourceLatest[] | undefined): string {
  const n = status.stalled.filter((s) => s.platform === platform).length;
  if (n === 0) return "";
  const all = (sources || []).filter((s) => s.platform === platform).length;
  return n >= all ? " · 수집 멈춤" : " · 일부 멈춤";
}

export interface LegacyRow { platform: string; keyword: string | null; cost?: number | null }

const brandName = (b: string) => BRAND_LABELS[b] || b;

export function KeywordSourceStatus({ status, sources, labels, from, to, latestCollected, sourcesError, shoppingBrands, legacy, onOpenNaverTab }: {
  status: Status; sources: SourceLatest[] | undefined; labels: Record<string, string>; from: string; to: string; latestCollected: string | null | undefined;
  /** 원천 상태(마지막 수집일·광고비) 조회 실패. 이때 띠가 없는 것은 "멈춘 곳 없음"이 아니라 "모름"이다 */
  sourcesError?: boolean;
  /** 고른 기간에 쇼핑검색 광고비가 있는 브랜드 */
  shoppingBrands?: string[];
  /** 고른 기간의 옛 캠페인 단위 기록(표·KPI 에서 뺀 것) */
  legacy?: LegacyRow[];
  onOpenNaverTab?: () => void;
}) {
  if (sourcesError) {
    return (
      <div className="rounded-lg border-l-4 border-amber-500 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-500" data-tour="keywords-stalled">
        수집 상태를 확인하지 못했습니다. 멈춘 원천이 있는지 지금은 알 수 없으니, 비어 있는 플랫폼을 성과 0으로 읽지 말고 잠시 뒤 「새로고침」을 눌러 주세요.
      </div>
    );
  }
  const { stalled, adsOff } = status;
  // 기간 전체가 마지막 키워드 기록보다 뒤: 멈춘 원천이 있으면 주황 목록, 전부 광고를 껐으면 "쉬는 기간",
  // 그 밖(동기화 전 「어제」 등)은 "아직 수집 전일 수 있음". 광고비가 나가는데 쉰다고 단정하지 않는다.
  const notice = periodNotice(sources || [], status, from);
  const allBefore = notice === "adsOff" || notice === "pending";
  const shopping = shoppingBrands || [];
  const legacyRows = legacy || [];
  const legacyCost = legacyRows.reduce((s, r) => s + (Number(r.cost) || 0), 0);
  const warn = stalled.length > 0;
  const info = adsOff.length > 0 || shopping.length > 0 || legacyRows.length > 0 || allBefore;
  if (!warn && !info) return null;

  return (
    <div
      className={warn
        ? "rounded-lg border-l-4 border-amber-500 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-500 space-y-1.5"
        : "rounded-lg border-l-4 border-border bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground space-y-1.5"}
      data-tour="keywords-stalled"
    >
      {warn && (
        <div className="space-y-1">
          <p>
            아래 키워드 원천은 <b>수집 멈춤</b>입니다. 광고비는 계속 나가는데 키워드 기록이 끊겨, 그 뒤 기간에는 그 키워드가 표·칩에 나오지 않습니다(성과 0이 아님).
          </p>
          <ul className="list-disc pl-4">
            {stalled.map((s) => (
              <li key={`${s.platform}|${s.brand}`}>
                {labels[s.platform] || s.platform} · {brandName(s.brand)}: 수집 멈춤(키워드 마지막 {s.latest}, 광고비는 {s.lastSpend}까지)
              </li>
            ))}
          </ul>
        </div>
      )}
      {notice === "adsOff" && (
        <p className="text-muted-foreground">
          고른 기간({from} ~ {to})에는 이 브랜드의 키워드 광고 기록이 없습니다. 마지막 키워드 기록은 <b>{latestCollected}</b>이고, 그 뒤로 광고비도 없어 광고를 쉬는 기간으로 봅니다.
        </p>
      )}
      {notice === "pending" && (
        <p className="text-muted-foreground">
          고른 기간({from} ~ {to})에는 아직 키워드 기록이 없습니다. 마지막 키워드 기록은 <b>{latestCollected}</b>입니다. 아직 수집 전일 수 있으니(매일 아침 들어옴) 성과 0으로 읽지 말고 기간을 앞으로 넓히거나 나중에 다시 보세요.
        </p>
      )}
      {adsOff.length > 0 && (
        <p className="text-muted-foreground">
          광고 집행 없음:{" "}
          {adsOff.map((s, i) => (
            <span key={`${s.platform}|${s.brand}`}>
              {i > 0 && " · "}
              {labels[s.platform] || s.platform} {brandName(s.brand)}(키워드 마지막 {s.latest}{s.lastSpend ? `, 광고비 마지막 ${s.lastSpend}` : ""})
            </span>
          ))}
          . 광고를 끈 것이라 수집 멈춤이 아닙니다.
        </p>
      )}
      {shopping.length > 0 && (
        <p className="text-muted-foreground">
          네이버 쇼핑검색 광고({shopping.map(brandName).join(" · ")})는 키워드가 아니라 상품 단위라 이 표에 없습니다. 실제로 친 검색어는{" "}
          {onOpenNaverTab
            ? <button type="button" onClick={onOpenNaverTab} className="underline underline-offset-2 hover:text-foreground">「네이버 검색어」 탭</button>
            : "「네이버 검색어」 탭"}
          에서 봅니다.
        </p>
      )}
      {legacyRows.length > 0 && (
        <details className="text-muted-foreground">
          <summary className="cursor-pointer select-none">
            2026-05-04 이전 <b>옛 캠페인 단위 기록</b> {formatNumber(legacyRows.length)}줄(광고비 {formatCurrency(legacyCost)})은 키워드가 아니라 표·KPI 에서 뺐습니다. 펼쳐 보기
          </summary>
          <ul className="list-disc pl-4 mt-1">
            {legacyRows.map((r) => (
              <li key={`${r.platform}|${r.keyword}`}>
                {labels[r.platform] || r.platform} · {r.keyword || "(이름 없음)"}: 광고비 {formatCurrency(Number(r.cost) || 0)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
