"use client";

import { Suspense } from "react";
import { usePathname } from "next/navigation";
import { Filters } from "./filters";
import { DataStatusRail } from "./data-status-rail";
import { useFilterParams } from "@/hooks/use-dashboard-data";

interface PageShellProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  /** 필터 바 숨기기 (설정 등) */
  hideFilters?: boolean;
}

function PageShellInner({ title, description, children, hideFilters }: PageShellProps) {
  const { brand, preset, from, to, isCustom, setBrand, setPreset, setCustomRange } = useFilterParams();
  const pathname = usePathname();
  // ★ 데이터 상태 레일은 '입력하는 화면'에서만 띄운다 (2026-09).
  //   전 페이지 최상단에 있으니 자리를 크게 먹고, 분석하러 들어온 화면에서는
  //   사업 숫자보다 정비 상태가 먼저 읽혔다. 조치할 수 있는 곳에서만 보이면 충분하다.
  const showStatusRail = pathname === "/daily" || pathname === "/settings";

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">{title}</h1>
          {description && (
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">{description}</p>
          )}
          {!hideFilters && from && to && (
            <p className="text-xs text-muted-foreground/70 mt-0.5">{from} ~ {to}</p>
          )}
        </div>
      </div>
      {showStatusRail && <DataStatusRail />}
      {!hideFilters && (
        <Filters
          brand={brand}
          onBrandChange={setBrand}
          preset={preset}
          onPresetChange={setPreset}
          onCustomRange={setCustomRange}
          from={from}
          to={to}
          isCustom={isCustom}
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
