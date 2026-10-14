"use client";

// 차트를 숫자보다 한 박자 늦게 그린다 (2026-10-14).
//
// 매출 화면 올해 전체는 데이터가 도착한 뒤에도 0.3~0.6초 동안 스켈레톤이 남았다. 원인은 브라우저 안
// 그리기였다: 브랜드별 일 매출 막대(287일 × 4브랜드 ≈ 1,150개 사각형)를 Recharts 가 한 번에 만들면서
// KPI 카드까지 같은 렌더에 묶여 함께 늦게 떴다(2026-10-14 CPU 프로파일: Bar·Rectangle 렌더가 최다).
// recharts 의 ResponsiveContainer 대신 이걸 쓰면, 첫 화면(KPI·표)을 먼저 그려 보여 준 다음
// 차트마다 따로 작업을 나눠 그린다. 자리는 같은 높이로 잡아 두어 화면이 덜컹이지 않는다.
// 그리는 데이터·해상도는 그대로다. 언제 그리느냐만 바뀐다.
import { useEffect, useState } from "react";
import { ResponsiveContainer } from "recharts";

type Props = React.ComponentProps<typeof ResponsiveContainer>;

export function DeferredResponsiveContainer(props: Props) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // 브라우저가 지금 화면을 한 번 칠한 뒤(requestAnimationFrame) 다음 작업(setTimeout)에서 그린다.
    // 차트마다 다른 작업이라 긴 작업 하나로 뭉치지 않는다.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(() => setReady(true), 0);
    });
    return () => {
      cancelAnimationFrame(frame);
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (ready) return <ResponsiveContainer {...props} />;
  const { width = "100%", height = "100%" } = props;
  return <div style={{ width, height }} aria-hidden />;
}
