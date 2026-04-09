"use client";

import { useState } from "react";
import type { DatePreset } from "@/lib/utils";

interface DateRangeSelectorProps {
  preset: DatePreset;
  onChange: (preset: DatePreset) => void;
  onCustomRange?: (from: string, to: string) => void;
  from?: string;
  to?: string;
  isCustom?: boolean;
}

const PRESETS: { label: string; value: DatePreset }[] = [
  { label: "어제", value: "yesterday" },
  { label: "7일", value: "7d" },
  { label: "14일", value: "14d" },
  { label: "30일", value: "30d" },
  { label: "이번 달", value: "this_month" },
  { label: "지난 달", value: "last_month" },
  { label: "올해", value: "this_year" },
  { label: "전체", value: "all" },
];

export function DateRangeSelector({ preset, onChange, onCustomRange, from, to, isCustom }: DateRangeSelectorProps) {
  const [showCustom, setShowCustom] = useState(false);
  const [customFrom, setCustomFrom] = useState(from || "");
  const [customTo, setCustomTo] = useState(to || "");

  const handleCustomApply = () => {
    if (customFrom && customTo && onCustomRange) {
      onCustomRange(customFrom, customTo);
      setShowCustom(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-0.5 rounded-lg bg-muted p-1 flex-wrap">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            onClick={() => { onChange(p.value); setShowCustom(false); }}
            className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
              !isCustom && preset === p.value
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => setShowCustom(v => !v)}
          className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
            isCustom || showCustom
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          직접 입력
        </button>
      </div>

      {(showCustom || isCustom) && (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={customFrom || from || ""}
            onChange={e => setCustomFrom(e.target.value)}
            className="text-xs px-2 py-1.5 rounded-md border bg-card text-foreground"
          />
          <span className="text-xs text-muted-foreground">~</span>
          <input
            type="date"
            value={customTo || to || ""}
            onChange={e => setCustomTo(e.target.value)}
            className="text-xs px-2 py-1.5 rounded-md border bg-card text-foreground"
          />
          <button
            onClick={handleCustomApply}
            className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground"
          >
            적용
          </button>
        </div>
      )}
    </div>
  );
}
