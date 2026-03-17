"use client";

import { Card } from "./card";

interface KpiCardProps {
  title: string;
  value: string;
  change?: number;
  icon?: React.ReactNode;
  subtitle?: string;
}

export function KpiCard({ title, value, change, icon, subtitle }: KpiCardProps) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground font-medium">{title}</p>
          <p className="text-2xl font-bold tracking-tight">{value}</p>
          {change !== undefined && (
            <p className={`text-xs font-medium ${change >= 0 ? "text-emerald-500" : "text-red-500"}`}>
              {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(1)}%
              {subtitle && <span className="text-muted-foreground ml-1">{subtitle}</span>}
            </p>
          )}
        </div>
        {icon && (
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
            {icon}
          </div>
        )}
      </div>
    </Card>
  );
}
