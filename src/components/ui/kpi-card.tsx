"use client";

import { Card } from "./card";

interface KpiCardProps {
  title: string;
  value: string;
  change?: number;
  icon?: React.ReactNode;
  subtitle?: string;
  target?: { label: string; percent: number };
}

export function KpiCard({ title, value, change, icon, subtitle, target }: KpiCardProps) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div className="space-y-1 min-w-0 flex-1">
          <p className="text-sm text-muted-foreground font-medium">{title}</p>
          <p className="text-2xl font-bold tracking-tight">{value}</p>
          <div className="flex items-center gap-2 flex-wrap">
            {change !== undefined && (
              <span
                className={`text-xs font-medium ${
                  change >= 0 ? "text-emerald-500" : "text-red-500"
                }`}
              >
                {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(1)}%
              </span>
            )}
            {subtitle && (
              <span className="text-xs text-muted-foreground">{subtitle}</span>
            )}
          </div>
          {/* 목표 대비 진행률 */}
          {target && (
            <div className="pt-1">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-muted-foreground">{target.label}</span>
                <span className="font-medium">{target.percent.toFixed(1)}%</span>
              </div>
              <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(target.percent, 100)}%`,
                    backgroundColor:
                      target.percent >= 100
                        ? "#16a34a"
                        : target.percent >= 70
                        ? "var(--primary)"
                        : "#f59e0b",
                  }}
                />
              </div>
            </div>
          )}
        </div>
        {icon && (
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary flex-shrink-0 ml-3">
            {icon}
          </div>
        )}
      </div>
    </Card>
  );
}
