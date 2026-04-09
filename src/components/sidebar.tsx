"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";

interface NavItem {
  href: string;
  label: string;
  icon: string;
  separator?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Overview", icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
  { href: "/sales", label: "매출 분석", icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
  { href: "/ads", label: "광고 분석", icon: "M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" },
  { href: "/funnel", label: "퍼널", icon: "M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" },
  { href: "/content", label: "콘텐츠/SNS", icon: "M7 4V2a1 1 0 011-1h8a1 1 0 011 1v2m-5 6v4m-2-2h4M5 8h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2v-8a2 2 0 012-2z" },
  { href: "/keywords", label: "키워드", icon: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" },
  { href: "/monthly", label: "월별 요약", icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
  { href: "/budget", label: "예산 현황", icon: "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" },
  { href: "/media-budget", label: "매체예산 분배", icon: "M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" },
  { href: "/raw", label: "Raw Data", icon: "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4", separator: true },
  { href: "/insights", label: "인사이트", icon: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" },
  { href: "/settings", label: "설정", icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" },
];

/** 모바일 하단 탭에 표시할 항목 (4개 + 더보기) */
const MOBILE_NAV_ITEMS = NAV_ITEMS.filter((item) =>
  ["/", "/sales", "/ads", "/funnel"].includes(item.href)
);
const MORE_NAV_ITEMS = NAV_ITEMS.filter((item) =>
  !["/", "/sales", "/ads", "/funnel"].includes(item.href)
);

import { useState } from "react";

export function Sidebar() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className="hidden lg:flex lg:flex-col lg:w-60 lg:fixed lg:inset-y-0 border-r"
        style={{ backgroundColor: "var(--sidebar-bg)", borderColor: "var(--sidebar-border)" }}
      >
        {/* Logo */}
        <div
          className="flex items-center gap-2 px-6 h-16 border-b"
          style={{ borderColor: "var(--sidebar-border)" }}
        >
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-sm">P</span>
          </div>
          <span className="font-semibold text-lg">PPMI</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const isActive =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <div key={item.href}>
                {item.separator && (
                  <div className="my-3 border-t" style={{ borderColor: "var(--sidebar-border)" }} />
                )}
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                    isActive
                      ? "text-[var(--sidebar-active-text)]"
                      : "text-[var(--muted-foreground)] hover:text-foreground hover:bg-[var(--sidebar-hover)]"
                  )}
                  style={isActive ? { backgroundColor: "var(--sidebar-active)" } : undefined}
                >
                  <svg
                    className="w-5 h-5 flex-shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                  </svg>
                  {item.label}
                </Link>
              </div>
            );
          })}
        </nav>

        {/* Footer */}
        <div
          className="px-4 py-3 border-t flex items-center justify-between"
          style={{ borderColor: "var(--sidebar-border)" }}
        >
          <span className="text-xs text-muted-foreground">v3.0</span>
          <ThemeToggle />
        </div>
      </aside>

      {/* Mobile Bottom Nav */}
      <nav
        className="lg:hidden fixed bottom-0 inset-x-0 z-50 border-t flex items-center justify-around h-16 px-2"
        style={{ backgroundColor: "var(--sidebar-bg)", borderColor: "var(--sidebar-border)" }}
      >
        {MOBILE_NAV_ITEMS.map((item) => {
          const isActive =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center gap-1 py-1 px-2 rounded-lg text-xs transition-colors",
                isActive
                  ? "text-[var(--sidebar-active-text)]"
                  : "text-[var(--muted-foreground)]"
              )}
              onClick={() => setMoreOpen(false)}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
              </svg>
              {item.label}
            </Link>
          );
        })}
        {/* 더보기 */}
        <button
          onClick={() => setMoreOpen(!moreOpen)}
          className={cn(
            "flex flex-col items-center gap-1 py-1 px-2 rounded-lg text-xs transition-colors",
            moreOpen || MORE_NAV_ITEMS.some((i) => pathname.startsWith(i.href))
              ? "text-[var(--sidebar-active-text)]"
              : "text-[var(--muted-foreground)]"
          )}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          더보기
        </button>
      </nav>

      {/* 더보기 패널 */}
      {moreOpen && (
        <div
          className="lg:hidden fixed bottom-16 inset-x-0 z-50 border-t p-3 grid grid-cols-3 gap-2"
          style={{ backgroundColor: "var(--sidebar-bg)", borderColor: "var(--sidebar-border)" }}
        >
          {MORE_NAV_ITEMS.map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMoreOpen(false)}
                className={cn(
                  "flex flex-col items-center gap-1.5 py-2.5 px-2 rounded-lg text-xs transition-colors",
                  isActive
                    ? "text-[var(--sidebar-active-text)] bg-[var(--sidebar-active)]"
                    : "text-[var(--muted-foreground)] hover:bg-[var(--sidebar-hover)]"
                )}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                </svg>
                {item.label}
              </Link>
            );
          })}
          <div className="col-span-3 flex justify-end pt-1">
            <ThemeToggle />
          </div>
        </div>
      )}
    </>
  );
}
