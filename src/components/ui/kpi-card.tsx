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
}

export function KpiCard({
  title, value, change, changeLabel, icon, subtitle, target, confidence, onClick, active,
}: KpiCardProps) {
  const conf = confidence ? CONFIDENCE[confidence.level] : null;
  // 측정 불가·부분 측정이면 카드 왼쪽에 레일을 세운다. 균일한 카드 그리드에서
  // '주의가 필요한 것'이 형태로 먼저 읽히게 하는 장치다.
  const railed = confidence && confidence.level !== "measured";

  return (
    <Card
      className={`relative overflow-hidden p-3 sm:p-5 ${onClick ? "cursor-pointer hover:ring-2 hover:ring-primary/30 transition-all" : ""} ${active ? "ring-2 ring-primary" : ""}`}
      onClick={onClick}
    >
      {railed && conf && (
        <span className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ backgroundColor: conf.color }} aria-hidden />
      )}
      <div className="flex items-start justify-between">
        <div className="space-y-1 min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-sm text-muted-foreground font-medium">{title}</p>
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
            className={`num text-lg sm:text-2xl font-bold ${confidence?.level === "unmeasurable" ? "opacity-60" : ""}`}
            style={confidence?.level === "unmeasurable" ? { color: "var(--muted-foreground)" } : undefined}
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
        {icon && (
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary flex-shrink-0 ml-3">
            {icon}
          </div>
        )}
      </div>

      {/* ★ 각주 밴드. 오해가 실제로 발생한 항목은 툴팁이 아니라 숫자 밑에 인쇄한다. */}
      {railed && conf && (
        <div
          className="stamp mt-2.5 -mx-3 sm:-mx-5 -mb-3 sm:-mb-5 px-3 sm:px-5 py-1.5 border-t"
          style={{ color: conf.color, backgroundColor: conf.surface, borderColor: conf.border }}
        >
          {confidence.note}
        </div>
      )}
    </Card>
  );
}
