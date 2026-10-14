"use client";

// 화면에 보일 때(또는 곧 보일 때) 비로소 안쪽을 그린다 (2026-10-14).
//
// 아래쪽 칸이 처음부터 큰 데이터를 부르면 위쪽 숫자가 뜨는 것까지 같이 늦어진다.
// 그런 칸을 이걸로 감싸면, 스크롤해 다가갈 때(margin 만큼 미리) 마운트돼 그때 요청한다.
// 자리는 minHeight 로 잡아 두어 나중에 그려질 때 화면이 덜컹이지 않게 한다.
import { useEffect, useRef, useState } from "react";

export function LazyMount({ children, minHeight = 320, margin = "400px" }: { children: React.ReactNode; minHeight?: number; margin?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        io.disconnect();
      }
    }, { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [visible, margin]);

  if (visible) return <>{children}</>;
  return <div ref={ref} style={{ minHeight }} aria-hidden />;
}
