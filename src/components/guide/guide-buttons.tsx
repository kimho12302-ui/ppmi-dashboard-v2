"use client";

// 화면 머리말 오른쪽의 「가이드」·「매뉴얼」 버튼 (2026-11-09 v2).
//
// 김호: "이용 가이드 존나 성의없이도 만들었네. https://qha.co.kr/track/ 여기서 가이드/매뉴얼 수준으로 만들어라".
// - 가이드: 화면 위 실제 요소를 하나씩 강조하며 말풍선으로 설명하는 투어 (guide-tour.tsx)
// - 매뉴얼: 왼쪽 목차 + 오른쪽 본문의 큰 설명서 창 (guide-manual.tsx)
// 문구는 src/lib/guides/screens/*.ts 에 있고, 이 파일은 지금 화면의 가이드를 골라 열고 닫기만 한다.
// 화면 전용 내용이 비어 있으면 「기본 사용법」(COMMON) 으로, 그것도 비어 있으면 "준비 중" 한 줄로 대신한다.
// 버튼은 어느 화면에서도 숨기지 않는다.
import { useCallback, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { COMMON, resolveScreenGuide } from "@/lib/guides";
import { GuideTour } from "./guide-tour";
import { GuideManual } from "./guide-manual";

const BTN =
  "inline-flex items-center gap-1 px-2 py-0.5 rounded-md border bg-card text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors whitespace-nowrap";

export function GuideButtons() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const screen = resolveScreenGuide(pathname, searchParams.get("view"));
  const [mode, setMode] = useState<"tour" | "manual" | null>(null);
  const tourRef = useRef<HTMLButtonElement>(null);
  const manualRef = useRef<HTMLButtonElement>(null);

  const closeTour = useCallback(() => {
    setMode(null);
    requestAnimationFrame(() => tourRef.current?.focus());
  }, []);
  const closeManual = useCallback(() => {
    setMode(null);
    requestAnimationFrame(() => manualRef.current?.focus());
  }, []);

  const tour = screen && screen.tour.length > 0 ? screen.tour : COMMON.tour;
  const tourTitle = screen && screen.tour.length > 0 ? screen.title : COMMON.title;

  return (
    <>
      <button
        ref={tourRef}
        type="button"
        data-tour="shell-guide"
        onClick={() => setMode("tour")}
        aria-haspopup="dialog"
        aria-expanded={mode === "tour"}
        className={BTN}
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.5 9.5a2.5 2.5 0 114 2c-.9.6-1.5 1.1-1.5 2.2" />
          <path strokeLinecap="round" d="M12 17h.01" />
        </svg>
        가이드
      </button>
      <button
        ref={manualRef}
        type="button"
        data-tour="shell-manual"
        onClick={() => setMode("manual")}
        aria-haspopup="dialog"
        aria-expanded={mode === "manual"}
        className={BTN}
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.5C10.5 5.3 8.3 4.8 4 5v13c4.3-.2 6.5.3 8 1.5m0-13c1.5-1.2 3.7-1.7 8-1.5v13c-4.3-.2-6.5.3-8 1.5m0-13v13" />
        </svg>
        매뉴얼
      </button>
      {mode === "tour" && <GuideTour title={tourTitle} steps={tour} onClose={closeTour} />}
      {mode === "manual" && <GuideManual screen={screen} common={COMMON} onClose={closeManual} />}
    </>
  );
}
