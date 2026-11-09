"use client";

// 밸런스랩 검색광고 직접 조정 이력 (2026-10-13). 원천 /api/sa-changes (sa_change_log + keyword_performance).
// 조정 전 7일과 조정 후 성과를 **일평균**으로 나란히 본다. 기간 길이가 달라 합계끼리 비교하면 틀린다.
// 조정 후가 7일이 안 됐으면 판단 보류로 표시한다.
//
// ★ 2026-11-03 다시 짬(김호 "표 존내 깨지네, 개길어"). 192건이 한 표에 쭉 깔리고, 행마다 최대 425자
//   사유가 붙어 숫자 칸이 한 글자씩 세로로 깨졌다. 사유는 묶음마다 같은 문장이 반복된다(192건에 57종).
//   → 날짜 → 묶음(사유 첫 문장) → 키워드 행 3단으로 접는다. 기본은 최신 날짜의 묶음 줄까지만 보인다.
//   숫자 칸은 줄바꿈 금지, 표는 table-fixed 로 칸 폭을 고정한다.
//   전·후 4칸은 "전 → 후" 한 칸씩으로 합쳤다. 자르는 건 없다. 접힌 날짜·긴 사유는 눌러서 다 볼 수 있다.

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
const ACTION_ORDER = ["add", "bid", "resume", "pause", "delete"];
const ACTION_TONE: Record<string, string> = {
  add: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  bid: "bg-muted text-foreground",
  resume: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  pause: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  delete: "bg-red-500/10 text-red-700 dark:text-red-300",
};
const MIN_JUDGE_DAYS = 7;

const per = (v: number, d: number) => (d > 0 ? v / d : 0);
const won = (v: number) => formatCurrency(Math.round(v));
// 조정일은 한국 시각 기준 날짜
const kstDay = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10);
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

function adjust(c: Change) {
  if (c.action === "bid") return `${formatNumber(c.bid_before || 0)} → ${formatNumber(c.bid_after || 0)}`;
  if (c.action === "add") return c.bid_after ? formatNumber(c.bid_after) : "";
  if (c.action === "resume") return c.bid_after ? formatNumber(c.bid_after) : "";
  return "";
}

// 사유 첫 문장. 묶음 기준이자 묶음 줄 제목이다. 같은 작업(예: "메디넥스 파워링크 신규 시험(P10).")은
// 키워드마다 뒤 문장만 조금씩 달라 전체 문장으로 묶으면 하루 24묶음이 됐다. 첫 문장으로 묶으면 하루 최대 8.
const headline = (r: string) => {
  const m = r.match(/^(.{0,120}?[.。)])\s/);
  return m ? m[1] : r.slice(0, 120);
};

function ActionChips({ list }: { list: Change[] }) {
  const n = new Map<string, number>();
  for (const c of list) n.set(c.action, (n.get(c.action) || 0) + 1);
  return (
    <span className="flex flex-wrap gap-1">
      {ACTION_ORDER.filter((a) => n.get(a)).map((a) => (
        <span key={a} className={cn("px-1.5 py-0.5 rounded text-[11px] whitespace-nowrap", ACTION_TONE[a])}>
          {ACTION_LABEL[a]} {n.get(a)}
        </span>
      ))}
    </span>
  );
}

export function SaChangeLog({ brand }: { brand: string }) {
  const { data, loading, error } = useFetch<Resp>(saChangesUrl(brand));
  const [onlyDue, setOnlyDue] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [openReason, setOpenReason] = useState<Record<string, boolean>>({});
  const today = data?.today || "";

  const rows = useMemo(() => {
    const list = data?.changes || [];
    return onlyDue ? list.filter((c) => c.review_on && c.review_on <= today) : list;
  }, [data, onlyDue, today]);

  // 날짜 → 사유 묶음 → 행
  const days = useMemo(() => {
    const byDay = new Map<string, Change[]>();
    for (const c of rows) {
      const d = kstDay(c.applied_at);
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d)!.push(c);
    }
    return Array.from(byDay.entries()).sort((a, b) => b[0].localeCompare(a[0])).map(([day, list]) => {
      const byHead = new Map<string, Change[]>();
      for (const c of list) {
        const k = headline(c.reason || "(사유 없음)");
        if (!byHead.has(k)) byHead.set(k, []);
        byHead.get(k)!.push(c);
      }
      const batches = Array.from(byHead.entries()).map(([head, items]) => ({
        head,
        reasons: Array.from(new Set(items.map((i) => i.reason || "(사유 없음)"))),
        items: [...items].sort((a, b) => ACTION_ORDER.indexOf(a.action) - ACTION_ORDER.indexOf(b.action) || a.keyword.localeCompare(b.keyword)),
        review: items.map((i) => i.review_on).filter(Boolean).sort()[0] as string | undefined,
      })).sort((a, b) => b.items.length - a.items.length);
      const due = list.filter((c) => c.review_on && c.review_on <= today).length;
      return { day, list, batches, due };
    });
  }, [rows, today]);

  const due = (data?.changes || []).filter((c) => c.review_on && c.review_on <= today).length;
  const upcoming = (data?.changes || []).filter((c) => c.review_on && c.review_on > today)
    .map((c) => c.review_on as string).sort()[0];
  const latestDay = days[0]?.day;
  const isOpen = (d: string) => open[d] ?? d === latestDay;

  if (brand !== "balancelab" && brand !== "all") return null;
  if (loading) return <Card><CardContent className="p-6 text-sm text-muted-foreground">검색광고 조정 이력 불러오는 중...</CardContent></Card>;
  if (error || data?.error) return <Card><CardContent className="p-4 text-sm" style={{ color: "var(--sig-danger)" }}>조정 이력을 불러오지 못했습니다 ({error || data?.error})</CardContent></Card>;
  if (!data?.changes?.length) return null;

  return (
    <Card data-tour="keywords-sa-log">
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold">밸런스랩 검색광고 직접 조정 이력</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {formatNumber(data.changes.length)}건 · 조정한 날 {new Set(data.changes.map((c) => kstDay(c.applied_at))).size}일
              {data.latestData ? ` · 키워드 성과 ${md(data.latestData)}까지` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            {due > 0
              ? <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-400">검토일 지난 조정 {due}건</span>
              : upcoming && <span className="text-muted-foreground">다음 검토일 {md(upcoming)}</span>}
            <button onClick={() => setOnlyDue((v) => !v)}
              className={cn("px-2 py-1 rounded", onlyDue ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
              검토일 지난 것만
            </button>
          </div>
        </div>

        <div className="rounded-md border divide-y">
          {days.map(({ day, list, batches, due: dayDue }) => (
            <div key={day}>
              <button onClick={() => setOpen((o) => ({ ...o, [day]: !isOpen(day) }))}
                className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-muted/40">
                <span className="text-muted-foreground w-3">{isOpen(day) ? "▾" : "▸"}</span>
                <span className="font-medium w-12 whitespace-nowrap">{md(day)}</span>
                <span className="text-xs text-muted-foreground whitespace-nowrap">{list.length}건 · 묶음 {batches.length}</span>
                <ActionChips list={list} />
                {dayDue > 0 && <span className="ml-auto text-[11px] text-amber-700 dark:text-amber-400 whitespace-nowrap">검토일 지남 {dayDue}</span>}
              </button>

              {isOpen(day) && (
                <div className="pb-1">
                  {batches.map((b) => {
                    const bk = `${day}|${b.head}`;
                    const bOpen = !!openReason[bk];
                    const bDue = !!b.review && b.review <= today;
                    return (
                      <div key={bk} className="border-t border-border/40">
                        <button onClick={() => setOpenReason((o) => ({ ...o, [bk]: !bOpen }))}
                          className="w-full flex items-center gap-3 pl-9 pr-3 py-1.5 text-left text-xs hover:bg-muted/30">
                          <span className="text-muted-foreground w-3 flex-shrink-0">{bOpen ? "▾" : "▸"}</span>
                          <span className="flex-1 min-w-0 truncate" title={b.head}>{b.head}</span>
                          <ActionChips list={b.items} />
                          <span className="w-10 text-right text-muted-foreground whitespace-nowrap flex-shrink-0">{b.items.length}건</span>
                          <span className={cn("w-20 text-right whitespace-nowrap flex-shrink-0",
                            bDue ? "text-amber-700 dark:text-amber-400 font-medium" : "text-muted-foreground")}>
                            {b.review ? `검토 ${md(b.review)}${bDue ? " 지남" : ""}` : ""}
                          </span>
                        </button>
                        {bOpen && (
                          <div className="pl-9 pr-3 pb-2 space-y-2">
                            <div className="max-h-40 overflow-y-auto rounded bg-muted/30 px-3 py-2 space-y-1.5 text-xs text-muted-foreground">
                              {b.reasons.map((r) => <p key={r} className="leading-relaxed">{r}</p>)}
                            </div>
                            <div className="overflow-x-auto">
                              <table className="w-full min-w-[720px] table-fixed text-xs">
                                <colgroup>
                                  <col />
                                  <col className="w-12" />
                                  <col className="w-32" />
                                  <col className="w-28" />
                                  <col className="w-36" />
                                  <col className="w-20" />
                                  <col className="w-24" />
                                </colgroup>
                                <thead>
                                  <tr className="text-muted-foreground border-b">
                                    <th className="py-1 pr-2 text-left font-normal">키워드</th>
                                    <th className="py-1 px-2 text-left font-normal">기기</th>
                                    <th className="py-1 px-2 text-left font-normal">조정</th>
                                    <th className="py-1 px-2 text-right font-normal whitespace-nowrap">클릭/일 전→후</th>
                                    <th className="py-1 px-2 text-right font-normal whitespace-nowrap">비용/일 전→후</th>
                                    <th className="py-1 px-2 text-right font-normal whitespace-nowrap">전환 전→후</th>
                                    <th className="py-1 px-2 text-right font-normal">판단</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {b.items.map((c) => {
                                    const p = data.perf?.[c.keyword];
                                    const early = !p || p.after.days < MIN_JUDGE_DAYS;
                                    const after = p && p.after.days > 0;
                                    return (
                                      <tr key={c.id} className="border-b border-border/40 last:border-0">
                                        <td className="py-1 pr-2 truncate" title={c.keyword}>{c.keyword}</td>
                                        <td className="py-1 px-2 text-muted-foreground">{c.device || "-"}</td>
                                        <td className="py-1 px-2 whitespace-nowrap truncate">
                                          <span className={cn("px-1.5 py-0.5 rounded mr-1", ACTION_TONE[c.action])}>{ACTION_LABEL[c.action] || c.action}</span>
                                          {adjust(c)}
                                        </td>
                                        <td className="py-1 px-2 text-right tabular-nums whitespace-nowrap">
                                          {p ? per(p.before.clicks, p.before.days).toFixed(1) : "-"} → {after ? per(p!.after.clicks, p!.after.days).toFixed(1) : "-"}
                                        </td>
                                        <td className="py-1 px-2 text-right tabular-nums whitespace-nowrap">
                                          {p ? won(per(p.before.cost, p.before.days)) : "-"} → {after ? won(per(p!.after.cost, p!.after.days)) : "-"}
                                        </td>
                                        <td className="py-1 px-2 text-right tabular-nums whitespace-nowrap">
                                          {p ? `${formatNumber(p.before.conversions)} → ${formatNumber(p.after.conversions)}` : "-"}
                                        </td>
                                        <td className={cn("py-1 px-2 text-right whitespace-nowrap", early ? "text-amber-600" : "text-muted-foreground")}>
                                          {p ? (early ? `보류 (${p.after.days}일)` : `${p.after.days}일`) : "-"}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

        <p className="text-[11px] text-muted-foreground">
          전은 조정 전 {data.beforeDays ?? 7}일, 후는 조정 뒤 쌓인 날까지의 일평균입니다. 성과는 키워드 단위(PC·MO 합산)라 같은 키워드의 기기별 행은 같은 값입니다.
          조정 후 {MIN_JUDGE_DAYS}일이 안 차면 보류로 표시합니다. 묶음 줄을 누르면 사유 전문과 키워드별 성과가 펼쳐집니다.
        </p>
      </CardContent>
    </Card>
  );
}
