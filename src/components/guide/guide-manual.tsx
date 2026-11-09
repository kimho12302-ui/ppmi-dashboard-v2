"use client";

// 「매뉴얼」 큰 설명서 창 (2026-11-09 v2). 기준: qha.co.kr/track 의 「매뉴얼」.
//
// - 가운데 큰 창(폭 ~820px, 높이 화면의 85%). 휴대폰에서는 화면 전체.
// - 머리: 「<화면 제목> 매뉴얼」 + 한 줄 소개 + 닫기. 탭 「이 화면」·「기본 사용법」, 매뉴얼 안 검색 칸.
// - 왼쪽 목차(누르면 그 절로 이동, 스크롤하면 지금 읽는 절이 강조), 오른쪽 본문. 휴대폰에서는 목차가 위쪽 칩 줄.
// - 본문 덩어리(Block) 는 p · h · list · steps · table · note · qa 일곱 가지. 문구 안 **굵게** 는 굵은 글자로.
// - Esc·닫기·바깥(어두운 배경)으로 닫힌다. 열면 첫 요소(닫기)로 초점, Tab 은 창 안에서만, 닫으면 버튼으로 돌아간다.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import type { Block, ManualSection, ScreenGuide } from "@/lib/guides";
import { RichText, plainText } from "./rich-text";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

type Tab = "screen" | "common";

function blockText(b: Block): string {
  switch (b.kind) {
    case "p":
    case "h":
    case "note":
      return b.text;
    case "list":
    case "steps":
      return b.items.join(" ");
    case "table":
      return [...b.head, ...b.rows.flat()].join(" ");
    case "qa":
      return `${b.q} ${b.a}`;
  }
}

function filterSections(sections: ManualSection[], query: string): ManualSection[] {
  const q = query.trim().toLowerCase();
  if (!q) return sections;
  const hit = (t: string) => plainText(t).toLowerCase().includes(q);
  const out: ManualSection[] = [];
  for (const sec of sections) {
    if (hit(sec.title)) {
      out.push(sec);
      continue;
    }
    const blocks = sec.blocks.filter((b) => hit(blockText(b)));
    if (blocks.length > 0) out.push({ ...sec, blocks });
  }
  return out;
}

export function GuideManual({
  screen,
  common,
  onClose,
}: {
  screen: ScreenGuide | null;
  common: ScreenGuide;
  onClose: () => void;
}) {
  const hasScreen = !!screen && screen.manual.length > 0;
  const [tab, setTab] = useState<Tab>(hasScreen ? "screen" : "common");
  const [query, setQuery] = useState("");
  const guide = tab === "screen" && hasScreen && screen ? screen : common;
  const sections = useMemo(() => filterSections(guide.manual, query), [guide, query]);
  const [activeId, setActiveId] = useState<string>(sections[0]?.id ?? "");

  const dialogRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const sectionRefs = useRef(new Map<string, HTMLElement>());
  const chipRefs = useRef(new Map<string, HTMLButtonElement>());
  const pinned = useRef<{ id: string; until: number } | null>(null);
  const uid = useId().replace(/:/g, "");
  const titleId = `${uid}-title`;
  const searchId = `${uid}-search`;

  const headTitle = screen ? `${screen.title} 매뉴얼` : "대시보드 매뉴얼";

  // 열릴 때: 첫 요소에 초점, 뒤쪽 페이지 스크롤 잠금.
  useEffect(() => {
    closeRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Esc 는 문서 전체에서 받는다(본문 글자를 눌러 초점이 빠져도 닫혀야 한다).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 탭이나 검색어가 바뀌면 본문을 맨 위로, 강조는 첫 절로.
  useEffect(() => {
    paneRef.current?.scrollTo({ top: 0 });
    setActiveId(sections[0]?.id ?? "");
    // sections 는 tab·query 로 정해진다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, query]);

  // 휴대폰 목차 칩: 지금 절의 칩이 보이게 가로로 민다.
  useEffect(() => {
    chipRefs.current.get(activeId)?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [activeId]);

  // 스크롤하면 지금 읽는 절을 목차에 표시한다.
  const onPaneScroll = useCallback(() => {
    const pane = paneRef.current;
    if (!pane) return;
    const pin = pinned.current;
    if (pin && Date.now() < pin.until) return;
    pinned.current = null;
    const paneTop = pane.getBoundingClientRect().top;
    let current = sections[0]?.id ?? "";
    for (const sec of sections) {
      const el = sectionRefs.current.get(sec.id);
      if (el && el.getBoundingClientRect().top - paneTop <= 32) current = sec.id;
    }
    if (pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 2 && sections.length > 0) {
      current = sections[sections.length - 1].id;
    }
    setActiveId(current);
  }, [sections]);

  const goTo = (id: string) => {
    const pane = paneRef.current;
    const el = sectionRefs.current.get(id);
    if (!pane || !el) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    pinned.current = { id, until: Date.now() + (reduce ? 50 : 700) };
    setActiveId(id);
    pane.scrollTo({ top: Math.max(0, el.offsetTop - 16), behavior: reduce ? "auto" : "smooth" });
  };

  // Tab 은 창 안에서만 돈다.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !dialogRef.current) return;
    const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.getClientRects().length > 0,
    );
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const empty = guide.manual.length === 0;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center sm:p-4" onKeyDown={onKeyDown}>
      <div aria-hidden onClick={onClose} className="absolute inset-0 bg-black/50 backdrop-blur-[1px]" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex flex-col w-full h-dvh sm:w-[min(820px,calc(100vw-32px))] sm:h-[85dvh] sm:rounded-xl sm:border shadow-2xl overflow-hidden"
        style={{ backgroundColor: "var(--card)", color: "var(--card-foreground)" }}
      >
        {/* 머리 */}
        <header className="shrink-0 px-4 sm:px-6 pt-4 pb-3 border-b">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="section-eyebrow">매뉴얼</p>
              <h2 id={titleId} className="mt-0.5 text-lg sm:text-xl font-semibold tracking-tight leading-snug">
                {headTitle}
              </h2>
              {guide.summary && (
                <p className="mt-1 text-xs sm:text-sm text-muted-foreground leading-relaxed">
                  <RichText text={guide.summary} />
                </p>
              )}
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="매뉴얼 닫기"
              className="shrink-0 -mr-1 w-8 h-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="flex gap-0.5 rounded-lg bg-muted p-1" role="group" aria-label="매뉴얼 고르기">
              {hasScreen && (
                <TabButton on={tab === "screen"} onClick={() => setTab("screen")}>
                  이 화면
                </TabButton>
              )}
              <TabButton on={tab === "common"} onClick={() => setTab("common")}>
                기본 사용법
              </TabButton>
            </div>
            <div className="relative flex-1 min-w-[160px] max-w-xs">
              <label htmlFor={searchId} className="sr-only">
                매뉴얼에서 찾기
              </label>
              <svg
                className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden
              >
                <circle cx="11" cy="11" r="6.5" />
                <path strokeLinecap="round" d="M20 20l-4-4" />
              </svg>
              <input
                id={searchId}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="매뉴얼에서 찾기"
                className="w-full pl-7 pr-2 py-1.5 rounded-md border bg-card text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>
          {screen && !hasScreen && (
            <p className="mt-2 text-xs text-muted-foreground">
              이 화면 전용 설명은 준비 중이라 대시보드 기본 사용법을 보여 드립니다.
            </p>
          )}
        </header>

        {/* 휴대폰 목차: 칩 줄 */}
        {sections.length > 1 && (
          <nav aria-label="목차" className="sm:hidden shrink-0 flex gap-1.5 overflow-x-auto px-4 py-2 border-b">
            {sections.map((sec) => (
              <button
                key={sec.id}
                ref={(el) => {
                  if (el) chipRefs.current.set(sec.id, el);
                  else chipRefs.current.delete(sec.id);
                }}
                type="button"
                onClick={() => goTo(sec.id)}
                aria-current={activeId === sec.id ? "true" : undefined}
                className={cn(
                  "shrink-0 px-2.5 py-1 rounded-full border text-xs whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  activeId === sec.id ? "font-semibold" : "text-muted-foreground",
                )}
                style={
                  activeId === sec.id
                    ? { backgroundColor: "var(--sidebar-active)", color: "var(--sidebar-active-text)", borderColor: "transparent" }
                    : undefined
                }
              >
                {sec.title}
              </button>
            ))}
          </nav>
        )}

        <div className="flex-1 min-h-0 flex">
          {/* 데스크톱 목차 */}
          <nav aria-label="목차" className="hidden sm:block w-52 shrink-0 border-r overflow-y-auto py-4 px-2">
            <p className="px-2 pb-2 text-[11px] font-semibold text-muted-foreground">목차</p>
            <ul className="space-y-0.5">
              {sections.map((sec, i) => (
                <li key={sec.id}>
                  <button
                    type="button"
                    onClick={() => goTo(sec.id)}
                    aria-current={activeId === sec.id ? "true" : undefined}
                    className={cn(
                      "w-full text-left flex gap-2 px-2 py-1.5 rounded-md text-[13px] leading-snug transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      activeId === sec.id
                        ? "font-semibold"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted",
                    )}
                    style={
                      activeId === sec.id
                        ? { backgroundColor: "var(--sidebar-active)", color: "var(--sidebar-active-text)" }
                        : undefined
                    }
                  >
                    <span className="num shrink-0 w-5 text-[11px] opacity-70 pt-px">{String(i + 1).padStart(2, "0")}</span>
                    <span className="min-w-0">{sec.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {/* 본문 */}
          <div
            ref={paneRef}
            onScroll={onPaneScroll}
            className="relative flex-1 min-w-0 overflow-y-auto overscroll-contain px-4 sm:px-8 py-5 sm:py-6"
          >
            {empty ? (
              <p className="text-sm text-muted-foreground">매뉴얼을 준비 중입니다.</p>
            ) : sections.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                「{query.trim()}」 이(가) 들어간 설명이 없습니다. 다른 낱말로 찾아 보세요.
              </p>
            ) : (
              <div className="space-y-10 pb-[40vh] sm:pb-[30vh]">
                {sections.map((sec, i) => (
                  <section
                    key={sec.id}
                    ref={(el) => {
                      if (el) sectionRefs.current.set(sec.id, el);
                      else sectionRefs.current.delete(sec.id);
                    }}
                    aria-labelledby={`${uid}-${tab}-${sec.id}`}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="num text-xs font-semibold text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                      <h3 id={`${uid}-${tab}-${sec.id}`} className="text-lg font-semibold tracking-tight">
                        {sec.title}
                      </h3>
                    </div>
                    <div className="section-rule mt-2 mb-4" />
                    <div className="space-y-3">
                      {sec.blocks.map((b, j) => (
                        <BlockView key={j} block={b} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function TabButton({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "px-3 py-1 text-xs font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        on ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "p":
      return (
        <p className="text-sm leading-relaxed">
          <RichText text={block.text} />
        </p>
      );
    case "h":
      return (
        <h4 className="pt-3 text-[15px] font-semibold tracking-tight">
          <RichText text={block.text} />
        </h4>
      );
    case "list":
      return (
        <ul className="space-y-1.5 text-sm leading-relaxed">
          {block.items.map((t, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden className="shrink-0 mt-[0.6em] w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "var(--primary)" }} />
              <span className="min-w-0">
                <RichText text={t} />
              </span>
            </li>
          ))}
        </ul>
      );
    case "steps":
      return (
        <ol className="space-y-2 text-sm leading-relaxed">
          {block.items.map((t, i) => (
            <li key={i} className="flex gap-3">
              <span
                className="num shrink-0 mt-0.5 w-5 h-5 rounded-full text-[11px] font-semibold inline-flex items-center justify-center"
                style={{ backgroundColor: "var(--primary)", color: "var(--primary-foreground)" }}
                aria-hidden
              >
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className="sr-only">{i + 1}. </span>
                <RichText text={t} />
              </span>
            </li>
          ))}
        </ol>
      );
    case "table":
      return (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm border-collapse" style={{ minWidth: block.head.length * 130 }}>
            <thead>
              <tr style={{ backgroundColor: "var(--surface-sunken)" }}>
                {block.head.map((h, i) => (
                  <th key={i} scope="col" className="text-left align-bottom px-3 py-2 text-xs font-semibold text-muted-foreground whitespace-nowrap">
                    <RichText text={h} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} className="border-t">
                  {row.map((cell, c) =>
                    c === 0 ? (
                      <th key={c} scope="row" className="text-left align-top px-3 py-2 font-medium">
                        <RichText text={cell} />
                      </th>
                    ) : (
                      <td key={c} className="align-top px-3 py-2 leading-relaxed text-muted-foreground">
                        <RichText text={cell} />
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "note": {
      const warn = block.tone === "warn";
      return (
        <div
          className="flex gap-2.5 rounded-lg border-l-4 px-3 py-2.5 text-sm leading-relaxed"
          style={
            warn
              ? { borderLeftColor: "var(--sig-warn)", backgroundColor: "var(--sig-warn-surface)" }
              : { borderLeftColor: "var(--primary)", backgroundColor: "color-mix(in srgb, var(--primary) 9%, transparent)" }
          }
        >
          <span className="shrink-0 font-semibold" style={{ color: warn ? "var(--sig-warn)" : "var(--primary)" }}>
            {warn ? "주의" : "참고"}
          </span>
          <span className="min-w-0">
            <RichText text={block.text} />
          </span>
        </div>
      );
    }
    case "qa":
      return (
        <div className="rounded-lg border px-4 py-3">
          <p className="flex gap-2 text-sm font-semibold leading-relaxed">
            <span aria-hidden style={{ color: "var(--primary)" }}>Q</span>
            <span className="min-w-0">
              <RichText text={block.q} />
            </span>
          </p>
          <p className="mt-1.5 flex gap-2 text-sm leading-relaxed text-muted-foreground">
            <span aria-hidden className="font-semibold">A</span>
            <span className="min-w-0">
              <RichText text={block.a} />
            </span>
          </p>
        </div>
      );
  }
}
