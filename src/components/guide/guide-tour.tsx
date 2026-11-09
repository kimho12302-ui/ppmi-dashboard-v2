"use client";

// 「가이드」 단계별 투어 (2026-11-09 v2). 기준: qha.co.kr/track 의 「가이드」.
//
// - 단계마다 화면 요소 [data-tour="<target>"] 을 찾아 보이게 스크롤하고, 그 요소에 링을 두르고
//   나머지는 어둡게 한 뒤 옆에 말풍선(제목 · 「3 / 11」 · 본문 · 닫기 / 이전 / 다음)을 띄운다.
// - target 이 빈 문자열이면 화면 가운데 카드. 요소가 없거나 지금 화면에 안 보이면(휴대폰에서 숨는
//   사이드바 등) 그 단계는 빼고, 단계 수도 실제로 보이는 것만 센다.
// - ← → 로 이동, Enter 는 다음, Esc 는 닫기. 투어 중에는 페이지를 누를 수 없고 말풍선만 눌린다.
//   스크롤·창 크기 변화·내용 변화가 있으면 위치를 다시 잰다. 말풍선은 아래 → 위 → 오른쪽 → 왼쪽
//   순으로 들어갈 자리를 찾고, 어디에도 안 들어가면 화면 안쪽으로 끌어들인다.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TourStep } from "@/lib/guides";
import { RichText } from "./rich-text";

const MARGIN = 8; // 말풍선과 화면 가장자리 사이
const GAP = 12; // 말풍선과 강조 요소 사이
const PAD = 6; // 강조 링이 요소 바깥으로 나오는 폭
const FOCUSABLE = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

const READY: TourStep = {
  target: "",
  title: "가이드 준비 중",
  body: "이 화면의 가이드는 아직 준비 중입니다. 「매뉴얼」 버튼에서 대시보드 기본 사용법을 볼 수 있습니다.",
};

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

function findTarget(name: string): HTMLElement | null {
  if (!name) return null;
  const sel = `[data-tour="${typeof CSS !== "undefined" && CSS.escape ? CSS.escape(name) : name}"]`;
  const nodes = Array.from(document.querySelectorAll<HTMLElement>(sel));
  for (const n of nodes) {
    const r = n.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return n;
  }
  return null;
}

function visibleSteps(steps: TourStep[]): TourStep[] {
  const shown = steps.filter((s) => s.target === "" || findTarget(s.target) !== null);
  return shown.length > 0 ? shown : [READY];
}

function viewport() {
  return { vw: document.documentElement.clientWidth, vh: window.innerHeight };
}

/** 말풍선 자리: 아래 → 위 → 오른쪽 → 왼쪽, 안 되면 화면 안으로 끌어들인다 */
function placeBubble(spot: Box | null, bw: number, bh: number): { top: number; left: number } {
  const { vw, vh } = viewport();
  const clampLeft = (x: number) => Math.min(Math.max(x, MARGIN), Math.max(MARGIN, vw - bw - MARGIN));
  const clampTop = (y: number) => Math.min(Math.max(y, MARGIN), Math.max(MARGIN, vh - bh - MARGIN));
  if (!spot) return { left: clampLeft((vw - bw) / 2), top: clampTop((vh - bh) / 2) };

  // 화면보다 큰 요소는 보이는 부분만 기준으로 삼는다.
  const top = Math.max(spot.top, 0);
  const bottom = Math.min(spot.top + spot.height, vh);
  const left = Math.max(spot.left, 0);
  const right = Math.min(spot.left + spot.width, vw);
  const midX = (left + right) / 2;
  const midY = (top + bottom) / 2;

  if (bottom + GAP + bh <= vh - MARGIN) return { top: bottom + GAP, left: clampLeft(midX - bw / 2) };
  if (top - GAP - bh >= MARGIN) return { top: top - GAP - bh, left: clampLeft(midX - bw / 2) };
  if (right + GAP + bw <= vw - MARGIN) return { left: right + GAP, top: clampTop(midY - bh / 2) };
  if (left - GAP - bw >= MARGIN) return { left: left - GAP - bw, top: clampTop(midY - bh / 2) };
  // 어디에도 안 들어가면(아주 큰 요소, 좁은 화면) 화면 아래쪽에 겹쳐 띄운다.
  return { left: clampLeft(midX - bw / 2), top: clampTop(vh - bh - MARGIN) };
}

export function GuideTour({ title, steps, onClose }: { title: string; steps: TourStep[]; onClose: () => void }) {
  const source = steps.length > 0 ? steps : [READY];
  const [list, setList] = useState<TourStep[]>(() => visibleSteps(source));
  const [index, setIndex] = useState(0);
  const [spot, setSpot] = useState<Box | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const frame = useRef(0);
  const titleId = useId();
  const bodyId = useId();

  const step = list[Math.min(index, list.length - 1)];
  const last = index >= list.length - 1;

  // 지금 단계의 요소 위치와 말풍선 자리를 잰다.
  const measure = useCallback(() => {
    const el = findTarget(step.target);
    let box: Box | null = null;
    if (el) {
      const r = el.getBoundingClientRect();
      box = { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
    }
    setSpot((prev) =>
      prev && box && prev.top === box.top && prev.left === box.left && prev.width === box.width && prev.height === box.height
        ? prev
        : box,
    );
    const b = bubbleRef.current;
    if (b) {
      const next = placeBubble(box, b.offsetWidth, b.offsetHeight);
      setPos((prev) => (prev && prev.top === next.top && prev.left === next.left ? prev : next));
    }
  }, [step]);

  const schedule = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(measure);
  }, [measure]);

  // 단계가 바뀌면 요소를 화면 안으로 데려온 뒤 잰다.
  useLayoutEffect(() => {
    const el = findTarget(step.target);
    if (el) {
      const r = el.getBoundingClientRect();
      const { vh } = viewport();
      if (r.top < 0 || r.bottom > vh) {
        el.scrollIntoView({ block: r.height > vh * 0.6 ? "start" : "center", inline: "nearest", behavior: "auto" });
      }
    }
    measure();
    schedule();
  }, [step, measure, schedule]);

  // 스크롤·창 크기·내용 변화 때 다시 잰다. 창 크기가 바뀌면 보이는 단계도 다시 센다.
  const listRef = useRef(list);
  const indexRef = useRef(index);
  listRef.current = list;
  indexRef.current = index;
  const sourceRef = useRef(source);
  useEffect(() => {
    const onResize = () => {
      const prevList = listRef.current;
      const fresh = visibleSteps(sourceRef.current);
      const same = fresh.length === prevList.length && fresh.every((s, i) => s === prevList[i]);
      if (!same) {
        const cur = prevList[Math.min(indexRef.current, prevList.length - 1)];
        const at = fresh.indexOf(cur);
        setList(fresh);
        setIndex(at >= 0 ? at : Math.min(indexRef.current, fresh.length - 1));
      }
      schedule();
    };
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", onResize);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    ro?.observe(document.body);
    return () => {
      window.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", onResize);
      ro?.disconnect();
      cancelAnimationFrame(frame.current);
    };
  }, [schedule]);

  const next = useCallback(() => {
    if (last) onClose();
    else setIndex((i) => Math.min(i + 1, list.length - 1));
  }, [last, list.length, onClose]);
  const prev = useCallback(() => setIndex((i) => Math.max(i - 1, 0)), []);

  // 키보드: ← → 이동, Enter 다음(말풍선 버튼에 초점이 있으면 그 버튼이 처리), Esc 닫기, Tab 은 말풍선 안에서만.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const bubble = bubbleRef.current;
      const active = document.activeElement as HTMLElement | null;
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      } else if (e.key === "Enter") {
        if (active && bubble?.contains(active) && active.tagName === "BUTTON") return;
        e.preventDefault();
        next();
      } else if (e.key === "Tab" && bubble) {
        const items = Array.from(bubble.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (items.length === 0) return;
        const first = items[0];
        const lastItem = items[items.length - 1];
        if (!active || !bubble.contains(active)) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && active === first) {
          e.preventDefault();
          lastItem.focus();
        } else if (!e.shiftKey && active === lastItem) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [next, prev, onClose]);

  // 처음 열 때, 그리고 초점이 말풍선 밖이거나 막힌 버튼에 있으면 「다음」으로 초점을 옮긴다.
  useEffect(() => {
    const active = document.activeElement as HTMLButtonElement | null;
    if (!active || !bubbleRef.current?.contains(active) || active.disabled) nextRef.current?.focus();
  }, [index]);

  const btn =
    "px-3 py-1.5 rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 disabled:cursor-not-allowed";

  return createPortal(
    <div className="fixed inset-0 z-[80]">
      {/* 페이지 클릭을 막는 투명 막. 강조 요소가 없을 때는 이 막이 화면 전체를 어둡게 한다. */}
      <div aria-hidden className={spot ? "absolute inset-0" : "absolute inset-0 bg-black/50"} />
      {spot && (
        <div
          aria-hidden
          className="fixed pointer-events-none rounded-[10px]"
          style={{
            top: spot.top,
            left: spot.left,
            width: spot.width,
            height: spot.height,
            boxShadow: "0 0 0 2px #ffffff, 0 0 0 5px rgb(59 130 246 / 0.45), 0 0 0 9999px rgb(0 0 0 / 0.5)",
          }}
        />
      )}
      <div
        ref={bubbleRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="fixed w-[min(360px,calc(100vw-16px))] rounded-xl border shadow-2xl p-4"
        style={{
          top: pos?.top ?? 0,
          left: pos?.left ?? 0,
          visibility: pos ? "visible" : "hidden",
          backgroundColor: "var(--card)",
          color: "var(--card-foreground)",
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="section-eyebrow">{title} 가이드</p>
            <h2 id={titleId} className="mt-0.5 text-base font-semibold tracking-tight leading-snug">
              <RichText text={step.title} />
            </h2>
          </div>
          <span className="num shrink-0 mt-0.5 text-xs font-medium text-muted-foreground" aria-hidden>
            {index + 1} / {list.length}
          </span>
        </div>
        <p id={bodyId} className="mt-2 text-sm leading-relaxed text-muted-foreground">
          <RichText text={step.body} />
        </p>
        <p className="sr-only" aria-live="polite">
          {list.length}단계 중 {index + 1}단계. {step.title}
        </p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <button type="button" onClick={onClose} className={`${btn} text-muted-foreground hover:bg-muted hover:text-foreground`}>
            닫기
          </button>
          <div className="flex items-center gap-2">
            <button type="button" onClick={prev} disabled={index === 0} className={`${btn} border bg-card hover:bg-muted`}>
              이전
            </button>
            <button
              ref={nextRef}
              type="button"
              onClick={next}
              className={`${btn} hover:opacity-90`}
              style={{ backgroundColor: "var(--primary)", color: "var(--primary-foreground)" }}
            >
              {last ? "마침" : "다음"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
