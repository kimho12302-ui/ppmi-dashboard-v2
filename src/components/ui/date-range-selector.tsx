"use client";

import type { DatePreset } from "@/lib/utils";

interface DateRangeSelectorProps {
  preset: DatePreset;
  onChange: (preset: DatePreset) => void;
  from?: string;
  to?: string;
}

const PRESETS: { label: string; value: DatePreset }[] = [
  { label: "어제", value: "yesterday" },
  { label: "7일", value: "7d" },
  { label: "14일", value: "14d" },
  { label: "30일", value: "30d" },
  { label: "이번 달", value: "this_month" },
  { label: "지난 달", value: "last_month" },
  { label: "전체", value: "all" },
];

export function DateRangeSelector({ preset, onChange, from, to }: DateRangeSelectorProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {from && to && (
        <span className="text-xs text-muted-foreground hidden sm:inline">
          📅 {from} ~ {to}
        </span>
      )}
      <div className="flex items-center gap-0.5 rounded-lg bg-muted p-1">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            onClick={() => onChange(p.value)}
            className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
              preset === p.value
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
