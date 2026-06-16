"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";

const BRAND_LABEL: Record<string, string> = {
  nutty: "너티", ironpet: "아이언펫", saip: "사입", balancelab: "밸런스랩",
};

interface Cell { date: string; revenue: number | null; uploaded: boolean; }
interface Row { brand: string; cells: Cell[]; }
interface Coverage { days: string[]; brands: string[]; rows: Row[]; notUploaded: string[]; }

function compact(v: number): string {
  if (v >= 10000) return `${Math.round(v / 10000)}만`;
  return String(Math.round(v));
}

export function SalesCoverage() {
  const [data, setData] = useState<Coverage | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/sales-coverage")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d) setData(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!data || data.rows.length === 0) return null;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-sm">판매 업로드 커버리지 <span className="text-xs font-normal text-muted-foreground">최근 14일 · 브랜드별</span></h3>
          {data.notUploaded.length > 0 ? (
            <span className="text-xs text-red-600 dark:text-red-400 font-medium">미업로드 {data.notUploaded.length}일: {data.notUploaded.map(d => d.slice(5)).join(", ")}</span>
          ) : (
            <span className="text-xs text-emerald-600">14일 전부 업로드됨</span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="text-[10px] border-collapse">
            <thead>
              <tr>
                <th className="sticky left-0 bg-card text-left pr-2 font-medium text-muted-foreground">브랜드</th>
                {data.days.map((d) => {
                  const notUp = data.notUploaded.includes(d);
                  return (
                    <th key={d} className={`px-1 py-0.5 text-center font-normal ${notUp ? "text-red-500 font-semibold" : "text-muted-foreground"}`} title={d}>
                      {d.slice(8)}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.brand}>
                  <td className="sticky left-0 bg-card pr-2 font-medium whitespace-nowrap">{BRAND_LABEL[row.brand] || row.brand}</td>
                  {row.cells.map((c) => {
                    let bg = "", txt = "", content = "";
                    if (!c.uploaded) { bg = "bg-red-500/15"; txt = "text-red-500"; content = "—"; }
                    else if (!c.revenue) { bg = "bg-muted/40"; txt = "text-muted-foreground/50"; content = "0"; }
                    else { bg = "bg-emerald-500/10"; txt = "text-foreground"; content = compact(c.revenue); }
                    return (
                      <td key={c.date} className={`px-1 py-0.5 text-center border border-border/30 ${bg} ${txt}`} title={`${c.date} ${BRAND_LABEL[row.brand]}: ${c.revenue?.toLocaleString() ?? "행없음"}`}>
                        {content}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-muted-foreground/70 mt-2">
          <span className="text-red-500">빨강 —</span> 그 날 판매 파일 미업로드(진짜 공백) · <span className="text-muted-foreground/50">회색 0</span> 업로드됐고 그 브랜드 매출 0(정상) · 초록 매출(만원). 공구 제외 기준.
        </p>
      </CardContent>
    </Card>
  );
}
