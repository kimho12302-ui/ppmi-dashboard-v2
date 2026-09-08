"use client";

import { Card } from "./card";
import { CONFIDENCE, type Confidence } from "@/lib/status-ui";

export interface KpiConfidence {
  level: Confidence;
  /** 왜 그 등급인지. 숫자 바로 아래에 그대로 인쇄된다. 툴팁에 숨기지 않는다. */
  note: string;
}

export interface KpiTarget {
  label: string;
  percent: number;
  /**
   * 기간 경과율(%). 달성률만 찍으면 "22.6%밖에 못 했다"로 읽히는데,
   * 실제로는 31일 중 15일차라 22.6%가 뒤처진 건지 아닌지 알 수 없다.
   * 분자와 분모의 기간이 다르다는 사실을 화면에 같이 둔다.
   */
  elapsedPercent?: number;
}

interface KpiCardProps {
  title: string;
  value: string;
  change?: number;
  /** 비교 대상을 명시한다. "전기간"은 캘린더 전월이 아니라 직전 동일 길이 구간이다. */
  changeLabel?: string;
  icon?: React.ReactNode;
  subtitle?: string;
  target?: KpiTarget;
  confidence?: KpiConfidence;
  onClick?: () => void;
  active?: boolean;
  /**
   * 카드 계층. 균일 그리드는 '무엇이 중요한지'를 지운다.
   *  hero    — 그 화면의 대표 지표(매출·광고비·ROAS). 크게, 떠 있게.
   *  default — 기존 동작. 지정하지 않은 모든 호출부가 여기 그대로 남는다.
   *  compact — 스캔용 보조 지표. 한 줄로 눌러 hero 와 경쟁하지 않게 한다.
   */
  size?: "hero" | "default" | "compact";
  /** 그리드 배치용(예: 모바일에서 매출만 전폭). 시각 스타일은 size 가 정한다. */
  className?: string;
}

export function KpiCard({
  title, value, change, changeLabel, icon, subtitle, target, confidence, onClick, active,
  size = "default",
  className = "",
}: KpiCardProps) {
  const conf = confidence ? CONFIDENCE[confidence.level] : null;
  // 측정 불가·부분 측정이면 카드 왼쪽에 레일을 세운다. 균일한 카드 그리드에서
  // '주의가 필요한 것'이 형태로 먼저 읽히게 하는 장치다.
  const railed = confidence && confidence.level !== "measured";

  const isHero = size === "hero";
  const isCompact = size === "compact";
  const tierClass = isHero ? "surface-hero kpi-hero" : isCompact ? "surface-sunken kpi-compact border-transparent" : "";
  const padClass = isHero ? "p-3 sm:p-6" : isCompact ? "p-3 sm:p-3.5" : "p-3 sm:p-5";
  const titleClass = isCompact ? "text-xs text-muted-foreground font-medium" : "text-sm text-muted-foreground font-medium";
  // hero 만 아이콘 배지를 키운다. compact 는 아이콘 자체를 버린다(스캔 방해).
  const showIcon = icon && !isCompact;

  return (
    <Card
      className={`relative overflow-hidden ${padClass} ${tierClass} ${onClick ? "cursor-pointer hover:ring-2 hover:ring-primary/30 hover:-translate-y-px transition-all" : ""} ${active ? "ring-2 ring-primary" : ""} ${className}`}
      onClick={onClick}
    >
      {railed && conf && (
        <span className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ backgroundColor: conf.color }} aria-hidden />
      )}
      <div className="flex items-start justify-between">
        <div className="space-y-1 min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className={titleClass}>{title}</p>
            {railed && conf && (
              <span
                className="stamp px-1.5 py-0.5 rounded border"
                style={{ color: conf.color, backgroundColor: conf.surface, borderColor: conf.border }}
              >
                {conf.label}
              </span>
            )}
          </div>
          <p
            className={`num kpi-value font-bold leading-tight tracking-tight ${confidence?.level === "unmeasurable" ? "opacity-60" : ""}`}
            style={{
              // hero/compact 는 CSS 클래스가 크기를 잡는다. default 만 기존 변수를 그대로 쓴다.
              ...(size === "default" ? { fontSize: "var(--kpi-font-size)" } : {}),
              ...(confidence?.level === "unmeasurable" ? { color: "var(--muted-foreground)" } : {}),
            }}
          >
            {value}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            {change !== undefined && (
              <span className={`num text-xs font-medium ${change >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(1)}%
              </span>
            )}
            {changeLabel && <span className="text-[11px] text-muted-foreground">{changeLabel}</span>}
            {subtitle && <span className="text-xs text-muted-foreground">{subtitle}</span>}
          </div>

          {/* 목표 대비. 달성률 옆에 기간 경과율을 같이 세워 '진척도'로 오독되는 걸 막는다. */}
          {target && (
            <div className="pt-1">
              <div className="flex items-center justify-between text-xs mb-1 gap-2">
                <span className="text-muted-foreground">{target.label}</span>
                <span className="num font-medium">{target.percent.toFixed(1)}%</span>
              </div>
              <div className="relative w-full h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(target.percent, 100)}%`,
                    backgroundColor:
                      target.elapsedPercent !== undefined
                        ? target.percent >= target.elapsedPercent ? "var(--sig-ok)" : "var(--sig-warn)"
                        : target.percent >= 100 ? "var(--sig-ok)" : target.percent >= 70 ? "var(--primary)" : "var(--sig-warn)",
                  }}
                />
                {target.elapsedPercent !== undefined && (
                  <div
                    className="absolute top-0 h-full w-0.5 bg-foreground/70"
                    style={{ left: `${Math.min(100, target.elapsedPercent)}%` }}
                  />
                )}
              </div>
              {target.elapsedPercent !== undefined && (
                <p className="stamp text-muted-foreground mt-1">
                  기간 경과 {target.elapsedPercent.toFixed(0)}% · 진척도 아님(분모는 월 전체)
                </p>
              )}
            </div>
          )}
        </div>
        {showIcon && (
          <div className={`${isHero ? "w-11 h-11" : "w-10 h-10"} rounded-lg bg-primary/10 flex items-center justify-center text-primary flex-shrink-0 ml-3`}>
            {icon}
          </div>
        )}
      </div>

      {/* ★ 각주 밴드. 오해가 실제로 발생한 항목은 툴팁이 아니라 숫자 밑에 인쇄한다. */}
      {railed && conf && (
        <div
          className={`stamp mt-2.5 py-1.5 border-t ${isHero ? "-mx-4 sm:-mx-6 -mb-4 sm:-mb-6 px-4 sm:px-6" : isCompact ? "-mx-3 sm:-mx-3.5 -mb-3 sm:-mb-3.5 px-3 sm:px-3.5" : "-mx-3 sm:-mx-5 -mb-3 sm:-mb-5 px-3 sm:px-5"}`}
          style={{ color: conf.color, backgroundColor: conf.surface, borderColor: conf.border }}
        >
          {confidence.note}
        </div>
      )}
    </Card>
  );
}
