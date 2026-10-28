"use client";

import { cn } from "@/lib/utils";
import type { PnlRow } from "@/lib/bl-pnl";

// 밸런스랩 제품별 손익 표 한 블록(공구 또는 자체). 시트 「★브랜드별 매출」 N~AI 열과 같은 칸 순서.
// 시트의 두 번째 "공헌 이익·공헌 이익율" 칸은 화면이 재료비를 한 번만 빼므로 첫 칸과 같아 생략했다.

export interface PnlTableRow {
  month: string;
  /** null = 아직 오지 않은 달(빈칸으로 둔다. 행은 빼지 않는다) */
  row: PnlRow | null;
  /** 이 블록의 이 달 칸을 숫자 대신 보여 줄 문구 (예: "공구 구분 불가") */
  blockedText?: string;
  notes: string[];
  /** 마케팅비 칸에 마우스를 올리면 보이는 내역 */
  marketingTitle?: string;
}

const COLS: { key: keyof PnlRow; label: string; kind: "won" | "count" | "rate" }[] = [
  { key: "revenue", label: "매출", kind: "won" },
  { key: "quantity", label: "판매수량", kind: "count" },
  { key: "orders", label: "주문건수", kind: "count" },
  { key: "margin", label: "마진", kind: "won" },
  { key: "marketing", label: "마케팅비", kind: "won" },
  { key: "shipping", label: "배송비", kind: "won" },
  { key: "contribution", label: "공헌 이익", kind: "won" },
  { key: "contributionRate", label: "공헌 이익율", kind: "rate" },
  { key: "materialCost", label: "재료비 원가", kind: "won" },
];

function fmt(v: number | null, kind: "won" | "count" | "rate"): string {
  if (v === null || v === undefined) return "";
  if (kind === "rate") return (v * 100).toFixed(1) + "%";
  return Math.round(v).toLocaleString("ko-KR");
}

export function PnlBlockTable({ title, subtitle, rows, total, marketingLabel, totalNote }: {
  title: string;
  totalNote?: string;
  subtitle: string;
  rows: PnlTableRow[];
  total: PnlRow;
  marketingLabel: string;
}) {
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse min-w-[1100px]">
          <thead>
            <tr className="bg-muted/50">
              <th className="sticky left-0 z-10 bg-muted py-2 px-3 text-left text-xs font-semibold text-muted-foreground border-b border-r">월</th>
              {COLS.map((c) => (
                <th key={c.key} className="py-2 px-3 text-right text-xs font-semibold text-muted-foreground border-b border-r whitespace-nowrap">
                  {c.key === "marketing" ? marketingLabel : c.label}
                </th>
              ))}
              <th className="py-2 px-3 text-left text-xs font-semibold text-muted-foreground border-b whitespace-nowrap">비고</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.month} className="border-b hover:bg-muted/30">
                <td className="sticky left-0 z-10 bg-card py-1.5 px-3 font-medium border-r whitespace-nowrap">{Number(r.month.slice(5))}월</td>
                {r.blockedText ? (
                  <td colSpan={COLS.length} className="py-1.5 px-3 text-center text-xs text-amber-700 dark:text-amber-400 border-r">{r.blockedText}</td>
                ) : (
                  COLS.map((c) => {
                    const v = r.row ? (r.row[c.key] as number | null) : null;
                    return (
                      <td
                        key={c.key}
                        title={c.key === "marketing" ? r.marketingTitle : undefined}
                        className={cn(
                          "py-1.5 px-3 text-right tabular-nums border-r whitespace-nowrap",
                          typeof v === "number" && v < 0 && "text-red-600 dark:text-red-400",
                          c.key === "contribution" && "font-semibold",
                          c.key === "marketing" && r.marketingTitle && "underline decoration-dotted cursor-help",
                        )}
                      >
                        {fmt(v, c.kind)}
                      </td>
                    );
                  })
                )}
                <td className="py-1.5 px-3 text-xs text-muted-foreground">{r.notes.join(" · ")}</td>
              </tr>
            ))}
            <tr className="bg-muted/40 font-semibold">
              <td className="sticky left-0 z-10 bg-muted py-2 px-3 border-r">합계</td>
              {COLS.map((c) => {
                const v = total[c.key] as number | null;
                return (
                  <td key={c.key} className={cn("py-2 px-3 text-right tabular-nums border-r whitespace-nowrap", typeof v === "number" && v < 0 && "text-red-600 dark:text-red-400")}>
                    {fmt(v, c.kind)}
                  </td>
                );
              })}
              <td className="py-2 px-3 text-xs text-muted-foreground font-normal">{totalNote}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export const PNL_EXPORT_COLS = COLS;
