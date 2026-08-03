"use client";

import { cn } from "@/lib/utils";
import { BRAND_LABELS, BRANDS } from "@/lib/types";
import { DateRangeSelector } from "./ui/date-range-selector";
import type { DatePreset } from "@/lib/utils";

interface FiltersProps {
  brand: string;
  onBrandChange: (brand: string) => void;
  preset: DatePreset;
  onPresetChange: (preset: DatePreset) => void;
  onCustomRange?: (from: string, to: string) => void;
  from?: string;
  to?: string;
  isCustom?: boolean;
}

export function Filters({
  brand,
  onBrandChange,
  preset,
  onPresetChange,
  onCustomRange,
  from,
  to,
  isCustom,
}: FiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 overflow-x-auto">
      {/* 브랜드 필터 — 기본은 그룹(전체/펫/밸런스랩), 사이드바에서 개별 브랜드 진입 시 활성 칩 추가 표시 */}
      <div className="flex items-center gap-0.5 rounded-lg bg-muted p-1 flex-shrink-0">
        {BRANDS.map((b) => (
          <button
            key={b}
            onClick={() => onBrandChange(b)}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap",
              brand === b
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {b === "all" ? "전체" : BRAND_LABELS[b] || b}
          </button>
        ))}
        {!(BRANDS as readonly string[]).includes(brand) && (
          <button
            onClick={() => onBrandChange("all")}
            title="클릭하면 전체로 돌아갑니다"
            className="px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap bg-card text-foreground shadow-sm"
          >
            {BRAND_LABELS[brand] || brand} ✕
          </button>
        )}
      </div>

      {/* 날짜 프리셋 */}
      <DateRangeSelector preset={preset} onChange={onPresetChange} onCustomRange={onCustomRange} from={from} to={to} isCustom={isCustom} />
    </div>
  );
}
