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
  from?: string;
  to?: string;
}

export function Filters({
  brand,
  onBrandChange,
  preset,
  onPresetChange,
  from,
  to,
}: FiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 overflow-x-auto">
      {/* 브랜드 필터 */}
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
      </div>

      {/* 날짜 프리셋 */}
      <DateRangeSelector preset={preset} onChange={onPresetChange} from={from} to={to} />
    </div>
  );
}
