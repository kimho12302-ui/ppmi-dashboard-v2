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
      {/* ── 머리말 ──
          제목과 기간이 같은 회색 잔글씨로 쌓여 있어 어디가 화면 이름인지 안 읽혔다.
          기간은 칩으로 떼어내 '지금 보고 있는 범위'를 한눈에 세운다. */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 pb-3 border-b">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-[28px] font-bold tracking-tight leading-none">{title}</h1>
          {description && (
            <p className="text-xs sm:text-sm text-muted-foreground mt-1.5">{description}</p>
          )}
        </div>
        {!hideFilters && from && to && (
          <span className="num inline-flex items-center gap-1.5 self-start sm:self-auto px-2.5 py-1 rounded-md text-xs font-medium border bg-muted/60 text-muted-foreground whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--primary)" }} aria-hidden />
            {from} ~ {to}
          </span>
        )}
      </div>
      {showStatusRail && <DataStatusRail />}
      {!hideFilters && (
        // 스크롤을 내려도 '무슨 브랜드 / 무슨 기간'이 화면에 남아 있어야 한다.
        <div className="filter-dock -mx-3 sm:-mx-4 px-3 sm:px-4 py-2">
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
        </div>
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
