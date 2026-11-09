"use client";

// 화면 머리말 오른쪽의 「이용 가이드」 버튼과, 누르면 오른쪽에서 열리는 설명서 패널 (2026-11-06).
//
// 김호: "각 화면마다 오른쪽 상단쯤에 이용 가이드 및 사용 메뉴얼 만들어줘".
// 가이드 문구는 src/lib/guides 한 곳에 있다. 이 파일은 그리기와 열고 닫기만 한다.
//
// - 가이드가 없는 화면에서도 버튼은 숨기지 않는다. 그때는 「기본 사용법」만 보여 준다.
// - Esc·바깥(어두운 배경) 클릭·닫기 버튼으로 닫힌다. 열리면 닫기 버튼에 초점이 가고,
//   Tab 은 패널 안에서만 돈다. 닫으면 초점이 다시 「이용 가이드」 버튼으로 돌아온다.
// - 휴대폰 하단 탭이 z-50 이라 패널은 그 위(z-[70])에 띄운다. 폭은 화면을 넘지 않는다.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { COMMON_GUIDE, resolveGuide, type Guide, type GuideItem } from "@/lib/guides/v1";

type GuideTab = "screen" | "basics";

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function GuideButton() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const guide = resolveGuide(pathname, searchParams.get("view"));
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    // 패널이 사라진 다음 프레임에 초점을 돌려준다.
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border bg-card text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors whitespace-nowrap"
      >
        <span aria-hidden className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-current text-[9px] font-bold leading-none">?</span>
        이용 가이드
      </button>
      {open && <GuideDrawer guide={guide} onClose={close} />}
    </>
  );
}

function GuideDrawer({ guide, onClose }: { guide: Guide | null; onClose: () => void }) {
  const [tab, setTab] = useState<GuideTab>(guide ? "screen" : "basics");
  const [shown, setShown] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  // 들어오는 움직임은 한 프레임 뒤에 시작한다(처음부터 제자리면 미끄러지지 않는다).
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    closeRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      cancelAnimationFrame(id);
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  // Esc 는 문서 전체에서 받는다. 패널 안 글자를 눌러 초점이 패널 밖(body)으로 빠져도 닫혀야 한다.
  useEffect(() => {
    const onDocKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onDocKey);
    return () => document.removeEventListener("keydown", onDocKey);
  }, [onClose]);

  // 탭을 바꾸면 패널을 맨 위로 올린다.
  useEffect(() => {
    panelRef.current?.querySelector("[data-guide-scroll]")?.scrollTo({ top: 0 });
  }, [tab]);

  // Tab 은 패널 안에서만 돈다.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !panelRef.current) return;
    const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
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

  const active = tab === "screen" && guide ? guide : COMMON_GUIDE;

  return createPortal(
    <div className="fixed inset-0 z-[70]" onKeyDown={onKeyDown}>
      {/* 어두운 배경. 누르면 닫힌다. */}
      <div
        aria-hidden
        onClick={onClose}
        className={cn(
          "absolute inset-0 bg-black/40 backdrop-blur-[1px] transition-opacity duration-200 motion-reduce:transition-none",
          shown ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "absolute right-0 top-0 h-dvh w-full sm:w-[440px] max-w-full flex flex-col border-l shadow-2xl",
          "transition-transform duration-200 ease-out motion-reduce:transition-none",
          shown ? "translate-x-0" : "translate-x-full",
        )}
        style={{ backgroundColor: "var(--card)" }}
      >
        <header className="shrink-0 px-5 pt-4 pb-3 border-b">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="section-eyebrow">이용 가이드</p>
              <h2 id={titleId} className="mt-0.5 text-lg font-semibold tracking-tight leading-snug">{active.title}</h2>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="이용 가이드 닫기"
              className="shrink-0 -mr-1 w-8 h-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <div className="mt-3 flex gap-0.5 rounded-lg bg-muted p-1 w-fit" role="group" aria-label="가이드 고르기">
            {guide && (
              <TabButton on={tab === "screen"} onClick={() => setTab("screen")}>이 화면</TabButton>
            )}
            <TabButton on={tab === "basics" || !guide} onClick={() => setTab("basics")}>기본 사용법</TabButton>
          </div>
          {!guide && (
            <p className="mt-2 text-xs text-muted-foreground">이 화면 전용 설명은 아직 없어 대시보드 기본 사용법을 보여 드립니다.</p>
          )}
        </header>

        <div data-guide-scroll className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 space-y-6">
          <GuideBody guide={active} />
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

function GuideBody({ guide }: { guide: Guide }) {
  return (
    <>
      <Part n="01" title="이 화면은 무엇을 보나">
        <div className="space-y-1.5 text-sm leading-relaxed">
          {guide.what.map((t) => <p key={t}>{t}</p>)}
        </div>
      </Part>

      <Part n="02" title="화면 구성" note="위에서부터">
        <ol className="space-y-2.5">
          {guide.layout.map((it) => <LayoutRow key={it.name} item={it} />)}
        </ol>
      </Part>

      <Part n="03" title="이렇게 쓰세요">
        <ol className="space-y-2">
          {guide.howTo.map((it, i) => (
            <li key={it.name} className="flex gap-3">
              <span className="num shrink-0 mt-0.5 w-5 h-5 rounded-full text-[11px] font-semibold inline-flex items-center justify-center"
                style={{ backgroundColor: "var(--primary)", color: "var(--primary-foreground)" }}>
                {i + 1}
              </span>
              <div className="min-w-0 text-sm leading-relaxed">
                <p className="font-medium">{it.name}</p>
                <p className="text-muted-foreground">{it.desc}</p>
              </div>
            </li>
          ))}
        </ol>
      </Part>

      <Part n="04" title="숫자 읽을 때 주의">
        <ul className="rounded-lg border-l-4 px-3 py-2.5 space-y-2 text-sm leading-relaxed"
          style={{ borderLeftColor: "var(--sig-warn)", backgroundColor: "var(--sig-warn-surface)" }}>
          {guide.caveats.map((t) => (
            <li key={t} className="flex gap-2">
              <span aria-hidden className="shrink-0 mt-[0.55em] w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "var(--sig-warn)" }} />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </Part>

      <Part n="05" title="데이터 출처·갱신">
        <ul className="surface-sunken px-3 py-2.5 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
          {guide.sources.map((t) => <li key={t}>{t}</li>)}
        </ul>
      </Part>
    </>
  );
}

function Part({ n, title, note, children }: { n: string; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-baseline gap-2 mb-2">
        <span className="num text-[11px] font-semibold text-muted-foreground">{n}</span>
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        {note && <span className="text-[11px] text-muted-foreground">{note}</span>}
      </div>
      <div className="section-rule mb-3" />
      {children}
    </section>
  );
}

function LayoutRow({ item }: { item: GuideItem }) {
  return (
    <li className="pl-3 border-l-2 text-sm leading-relaxed" style={{ borderLeftColor: "var(--rule, var(--border))" }}>
      <p className="font-medium">{item.name}</p>
      <p className="text-muted-foreground">{item.desc}</p>
    </li>
  );
}
