"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";

export default function MissingDataAlert({ className = "" }: { className?: string }) {
  const [issues, setIssues] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    async function check() {
      try {
        const res = await fetch("/api/data-status");
        if (!res.ok) return;
        const data = await res.json();
        const alerts: string[] = [];

        for (const s of data.sources || []) {
          if (!s.ok) {
            const days = s.latestDate
              ? Math.floor((Date.now() - new Date(s.latestDate).getTime()) / 86400000)
              : 99;
            if (days >= 2) {
              alerts.push(`${s.label}: ${days}일 미갱신 (최신: ${s.latestDate || "없음"})`);
            }
          }
        }

        setIssues(alerts);
      } catch { /* ignore */ }
    }
    check();
  }, []);

  if (issues.length === 0 || dismissed) return null;

  return (
    <Card className={`border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 ${className}`}>
      <CardContent className="p-3">
        <div className="flex items-start gap-2">
          <span className="text-amber-500 flex-shrink-0 mt-0.5">⚠️</span>
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400">데이터 입력 확인</p>
            <ul className="mt-1 space-y-0.5">
              {issues.map((issue, i) => (
                <li key={i} className="text-xs text-amber-600 dark:text-amber-300">• {issue}</li>
              ))}
            </ul>
            <a href="/settings" className="text-xs text-amber-500 hover:underline mt-1 inline-block">
              설정에서 확인 →
            </a>
          </div>
          <button onClick={() => setDismissed(true)} className="text-amber-400 hover:text-amber-600 text-sm">✕</button>
        </div>
      </CardContent>
    </Card>
  );
}
