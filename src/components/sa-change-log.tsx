"use client";

// 밸런스랩 검색광고 직접 조정 이력 (2026-10-13). 원천 /api/sa-changes (sa_change_log + keyword_performance).
// 조정 전 7일과 조정 후 성과를 **일평균**으로 나란히 본다. 기간 길이가 달라 합계끼리 비교하면 틀린다.
// 조정 후가 7일이 안 됐으면 판단이 이르다고 표시한다.

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useFetch } from "@/hooks/use-dashboard-data";
import { saChangesUrl } from "@/lib/api-urls";
import { formatCurrency, formatNumber, cn } from "@/lib/utils";

interface Change {
  id: number; applied_at: string; keyword: string; device: string | null; action: string;
  bid_before: number | null; bid_after: number | null; reason: string | null; review_on: string | null;
  adgroup: string | null; source_doc: string | null;
}
interface Perf { impressions: number; clicks: number; cost: number; conversions: number; days: number }
interface Resp {
  changes: Change[]; perf: Record<string, { before: Perf; after: Perf; changedOn: string; afterUntil: string }>;
  today?: string; latestData?: string | null; beforeDays?: number; error?: string; note?: string;
}

const ACTION_LABEL: Record<string, string> = { bid: "입찰", resume: "재개", pause: "중지", add: "신규", delete: "삭제" };
const MIN_JUDGE_DAYS = 7;

const per = (v: number, d: number) => (d > 0 ? v / d : 0);
const won = (v: number) => formatCurrency(Math.round(v));

function adjust(c: Change) {
  if (c.action === "bid") return `${formatNumber(c.bid_before || 0)} → ${formatNumber(c.bid_after || 0)}`;
  if (c.action === "add") return `신규 ${formatNumber(c.bid_after || 0)}`;
  if (c.action === "resume") return `재개${c.bid_after ? ` ${formatNumber(c.bid_after)}` : ""}`;
  return ACTION_LABEL[c.action] || c.action;
}

export function SaChangeLog({ brand }: { brand: string }) {
  const { data, loading, error } = useFetch<Resp>(saChangesUrl(brand));
  const [onlyDue, setOnlyDue] = useState(false);
  const today = data?.today || "";

  const rows = useMemo(() => {
    const list = data?.changes || [];
    return onlyDue ? list.filter((c) => c.review_on && c.review_on <= today) : list;
  }, [data, onlyDue, today]);

  const due = (data?.changes || []).filter((c) => c.review_on && c.review_on <= today).length;
  const upcoming = (data?.changes || []).filter((c) => c.review_on && c.review_on > today)
    .map((c) => c.review_on as string).sort()[0];

  if (brand !== "balancelab" && brand !== "all") return null;
  if (loading) return <Card><CardContent className="p-6 text-sm text-muted-foreground">검색광고 조정 이력 불러오는 중...</CardContent></Card>;
  if (error || data?.error) return <Card><CardContent className="p-4 text-sm" style={{ color: "var(--sig-danger)" }}>조정 이력을 불러오지 못했습니다 ({error || data?.error})</CardContent></Card>;
  if (!data?.changes?.length) return null;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">밸런스랩 검색광고 직접 조정 이력</h3>
          <div className="flex items-center gap-2 text-xs">
            {due > 0
              ? <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-400">검토일 지난 조정 {due}건</span>
              : upcoming && <span className="text-muted-foreground">다음 검토일 {upcoming}</span>}
            <button onClick={() => setOnlyDue((v) => !v)}
              className={cn("px-2 py-1 rounded", onlyDue ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
              검토일 지난 것만
            </button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          조정 전 {data.beforeDays ?? 7}일과 조정 후를 <b>일평균</b>으로 비교합니다. 성과는 키워드 단위(PC·MO 합산)라 같은 키워드의 기기별 조정은 같은 값을 씁니다.
          조정 후 {MIN_JUDGE_DAYS}일이 안 찬 키워드는 판단 보류로 표시합니다{data.latestData ? ` · 키워드 성과는 ${data.latestData}까지` : ""}.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left border-b text-muted-foreground">
                <th className="py-2 pr-3">조정일</th>
                <th className="py-2 pr-3">키워드</th>
                <th className="py-2 pr-3">기기</th>
                <th className="py-2 pr-3">조정</th>
                <th className="py-2 pr-3 text-right">전 · 일평균 클릭</th>
                <th className="py-2 pr-3 text-right">후 · 일평균 클릭</th>
                <th className="py-2 pr-3 text-right">전 · 일평균 비용</th>
                <th className="py-2 pr-3 text-right">후 · 일평균 비용</th>
                <th className="py-2 pr-3 text-right">전환 (전 / 후)</th>
                <th className="py-2 pr-3">검토일</th>
                <th className="py-2">사유</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const p = data.perf?.[c.keyword];
                const early = !p || p.after.days < MIN_JUDGE_DAYS;
                const isDue = !!c.review_on && c.review_on <= today;
                return (
                  <tr key={c.id} className="border-b border-border/50 align-top">
                    <td className="py-1.5 pr-3 whitespace-nowrap">{p?.changedOn?.slice(5) || c.applied_at.slice(5, 10)}</td>
                    <td className="py-1.5 pr-3 font-medium whitespace-nowrap">{c.keyword}</td>
                    <td className="py-1.5 pr-3">{c.device || "-"}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      <span className="px-1.5 py-0.5 rounded bg-muted mr-1">{ACTION_LABEL[c.action] || c.action}</span>{adjust(c)}
                    </td>
                    <td className="py-1.5 pr-3 text-right">{p ? per(p.before.clicks, p.before.days).toFixed(1) : "-"}</td>
                    <td className="py-1.5 pr-3 text-right">
                      {p && p.after.days > 0 ? per(p.after.clicks, p.after.days).toFixed(1) : "-"}
                      {p && <span className={cn("ml-1", early ? "text-amber-600" : "text-muted-foreground")}>({p.after.days}일{early ? " · 판단 보류" : ""})</span>}
                    </td>
                    <td className="py-1.5 pr-3 text-right">{p ? won(per(p.before.cost, p.before.days)) : "-"}</td>
                    <td className="py-1.5 pr-3 text-right">{p && p.after.days > 0 ? won(per(p.after.cost, p.after.days)) : "-"}</td>
                    <td className="py-1.5 pr-3 text-right">{p ? `${formatNumber(p.before.conversions)} / ${formatNumber(p.after.conversions)}` : "-"}</td>
                    <td className={cn("py-1.5 pr-3 whitespace-nowrap", isDue && "text-amber-700 dark:text-amber-400 font-medium")}>
                      {c.review_on ? `${c.review_on.slice(5)}${isDue ? " 도래" : ""}` : "-"}
                    </td>
                    <td className="py-1.5 text-muted-foreground min-w-[220px]">{c.reason || "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
