"use client";

import { cn } from "@/lib/utils";
import { BRAND_LABELS } from "@/lib/types";
import { DateRangeSelector } from "./ui/date-range-selector";

const BRANDS = ["all", "nutty", "ironpet", "saip", "balancelab"];

interface FiltersProps {
  brand: string;
  onBrandChange: (brand: string) => void;
  days: number;
  onDaysChange: (days: number) => void;
}

export function Filters({ brand, onBrandChange, days, onDaysChange }: FiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
        {BRANDS.map((b) => (
          <button
            key={b}
            onClick={() => onBrandChange(b)}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
              brand === b
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {b === "all" ? "전체" : BRAND_LABELS[b] || b}
          </button>
        ))}
      </div>
      <DateRangeSelector days={days} onChange={onDaysChange} />
    </div>
  );
}
