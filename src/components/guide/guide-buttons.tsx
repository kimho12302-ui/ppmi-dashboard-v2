"use client";

// 화면 머리말 오른쪽의 「가이드」·「매뉴얼」 버튼 (2026-11-09 v2).
//
// 김호: "이용 가이드 존나 성의없이도 만들었네. https://qha.co.kr/track/ 여기서 가이드/매뉴얼 수준으로 만들어라".
// - 가이드: 화면 위 실제 요소를 하나씩 강조하며 말풍선으로 설명하는 투어 (guide-tour.tsx)
// - 매뉴얼: 왼쪽 목차 + 오른쪽 본문의 큰 설명서 창 (guide-manual.tsx)
// 문구는 src/lib/guides/screens/*.ts 에 있고, 이 파일은 지금 화면의 가이드를 골라 열고 닫기만 한다.
// 화면 전용 내용이 비어 있으면 「기본 사용법」(COMMON) 으로, 그것도 비어 있으면 "준비 중" 한 줄로 대신한다.
// 버튼은 어느 화면에서도 숨기지 않는다.
// 2026-11-27: 가이드 본문(화면 26개, 소스 약 936KB)을 버튼을 누를 때만 불러온다. 전에는 모든 화면의 첫 JS 에
//   통째로 붙어 화면마다 gzip 약 210KB 를 더 받았다(전체 진단 2-3). 한 번 불러오면 모듈 캐시라 두 번째부터 즉시.
import { useCallback, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { GuideTour } from "./guide-tour";
import { GuideManual } from "./guide-manual";

const BTN =
  "inline-flex items-center gap-1 px-2 py-0.5 rounded-md border bg-card text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors whitespace-nowrap disabled:opacity-60 disabled:cursor-wait";

export function GuideButtons() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view = searchParams.get("view");
  const [mode, setMode] = useState<"tour" | "manual" | null>(null);
  // 고른 결과가 아니라 모듈을 담는다. 그래야 ?view= 가 바뀌어도 렌더할 때 지금 보기로 다시 고른다(Fable 검수 L4).
  const [mod, setMod] = useState<typeof import("@/lib/guides") | null>(null);
  const [loading, setLoading] = useState(false);
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

  // 마우스를 올리거나 포커스가 오면 미리 받아 둔다(첫 클릭이 무반응처럼 보이지 않게, Fable 검수 L5).
  const prefetch = useCallback(() => { void import("@/lib/guides").catch(() => {}); }, []);
  const open = useCallback(async (next: "tour" | "manual") => {
    setLoading(true);
    try {
      setMod(await import("@/lib/guides"));
      setMode(next);
    } catch (e) {
      console.error("가이드 불러오기 실패", e);
      window.alert("가이드를 불러오지 못했습니다. 새로고침 뒤 다시 눌러 주세요.");
      requestAnimationFrame(() => (next === "tour" ? tourRef : manualRef).current?.focus());
    } finally {
      setLoading(false);
    }
  }, []);

  const screen = mod ? mod.resolveScreenGuide(pathname, view) : null;
  const common = mod?.COMMON;
  const tour = screen && screen.tour.length > 0 ? screen.tour : common?.tour ?? [];
  const tourTitle = screen && screen.tour.length > 0 ? screen.title : common?.title ?? "";

  return (
    <>
      <button
        ref={tourRef}
        type="button"
        data-tour="shell-guide"
        onClick={() => open("tour")}
        onPointerEnter={prefetch}
        onFocus={prefetch}
        disabled={loading}
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
        onClick={() => open("manual")}
        onPointerEnter={prefetch}
        onFocus={prefetch}
        disabled={loading}
        aria-haspopup="dialog"
        aria-expanded={mode === "manual"}
        className={BTN}
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.5C10.5 5.3 8.3 4.8 4 5v13c4.3-.2 6.5.3 8 1.5m0-13c1.5-1.2 3.7-1.7 8-1.5v13c-4.3-.2-6.5.3-8 1.5m0-13v13" />
        </svg>
        매뉴얼
      </button>
      {mode === "tour" && mod && <GuideTour title={tourTitle} steps={tour} onClose={closeTour} />}
      {mode === "manual" && mod && common && <GuideManual screen={screen} common={common} onClose={closeManual} />}
    </>
  );
}
