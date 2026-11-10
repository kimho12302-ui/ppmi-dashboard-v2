"use client";

// 불릿 그래프 (2026-11-10, Stephen Few 형식). 한 줄에 목표 대비 현재와 「이 속도면 월말」을 같이 둔다.
//  - 옅은 바탕 = 목표의 0~50%, 50~100%, 100~120% 세 구간(멀고 가까움을 읽는 눈금)
//  - 진한 막대 = 지금까지 실적
//  - 세로 굵은 선 = 목표
//  - 속 빈 마름모 = 지금 일평균으로 남은 날을 채웠을 때의 월말 예상(판단 보류 구간이면 그리지 않는다)
//  - 가는 세로선(선택) = 날짜 진행률 위치(판매가 들어온 날 기준), 「이만큼은 와 있어야」 기준
export function BulletChart({
  actual, target, projected, marker, color, label,
}: {
  actual: number;
  target: number;
  /** null 이면 예상을 그리지 않는다(초반·일평균 0) */
  projected: number | null;
  /** 0~1, 목표 대비 「지금쯤 와 있어야 할」 위치. 없으면 안 그림 */
  marker?: number;
  color: string;
  label: string;
}) {
  if (target <= 0) return null;
  const top = Math.max(target * 1.2, actual, projected ?? 0) * 1.02;
  const x = (v: number) => `${Math.max(0, Math.min(100, (v / top) * 100))}%`;
  const say = `${label}: 실적 목표의 ${Math.round((actual / target) * 100)}%${projected != null ? `, 이 속도면 월말 목표의 ${Math.round((projected / target) * 100)}%` : ""}`;
  return (
    <div className="relative h-5" role="img" aria-label={say} title={say}>
      {/* 질적 구간 */}
      <div className="absolute inset-y-0 left-0 rounded-l-[4px] bg-[var(--bullet-band-1)]" style={{ width: x(target * 0.5) }} />
      <div className="absolute inset-y-0 bg-[var(--bullet-band-2)]" style={{ left: x(target * 0.5), width: `calc(${x(target)} - ${x(target * 0.5)})` }} />
      <div className="absolute inset-y-0 rounded-r-[4px] bg-[var(--bullet-band-3)]" style={{ left: x(target), right: 0 }} />
      {/* 실적 막대 */}
      <div className="absolute top-1/2 -translate-y-1/2 h-2 rounded-r-[3px]" style={{ left: 0, width: x(actual), backgroundColor: color }} />
      {/* 날짜 진행률 위치 */}
      {marker != null && (
        <div className="absolute inset-y-0 w-[2px] -translate-x-1/2" style={{ left: x(target * marker), backgroundColor: "color-mix(in srgb, var(--foreground) 45%, transparent)" }} title="판매가 들어온 날 기준 진행률 위치" />
      )}
      {/* 목표 */}
      <div className="absolute -top-0.5 -bottom-0.5 w-[3px] -translate-x-1/2 rounded-full bg-foreground" style={{ left: x(target) }} title="목표" />
      {/* 월말 예상 */}
      {projected != null && (
        <div className="absolute top-1/2 w-2.5 h-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border-2 bg-card" style={{ left: x(projected), borderColor: color }} title="이 속도면 월말" />
      )}
    </div>
  );
}
