"use client";

import { Suspense } from "react";
import { Filters } from "./filters";
import { useFilterParams } from "@/hooks/use-dashboard-data";

interface PageShellProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  /** 필터 바 숨기기 (설정 등) */
  hideFilters?: boolean;
}

function PageShellInner({ title, description, children, hideFilters }: PageShellProps) {
  const { brand, preset, from, to, setBrand, setPreset } = useFilterParams();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{title}</h1>
          {description && (
            <p className="text-sm text-muted-foreground mt-1">{description}</p>
          )}
        </div>
      </div>
      {!hideFilters && (
        <Filters
          brand={brand}
          onBrandChange={setBrand}
          preset={preset}
          onPresetChange={setPreset}
          from={from}
          to={to}
        />
      )}
      {children}
    </div>
  );
}

export function PageShell(props: PageShellProps) {
  return (
    <Suspense fallback={<PageShellFallback title={props.title} />}>
      <PageShellInner {...props} />
    </Suspense>
  );
}

function PageShellFallback({ title }: { title: string }) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{title}</h1>
      <div className="h-10 w-64 bg-muted rounded-lg animate-pulse" />
    </div>
  );
}
