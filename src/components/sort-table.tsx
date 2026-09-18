"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

// 머리글을 누르면 내림차순, 한 번 더 누르면 오름차순. 행은 자르지 않고 전부 그린다(스크롤 상자 안).
// 2026-09-18 김호 요청(표는 전체·전 칸 정렬). 네이버 검색어 탭이 쓴다.

export interface SortCol<R> {
  key: string;
  label: string;
  value: (r: R) => number | string;
  render: (r: R) => string;
  left?: boolean;
  danger?: (r: R) => boolean;
}

export function SortTable<R extends { name: string }>({ rows, cols, initial, onRowClick, activeName, maxHeight }: {
  rows: R[]; cols: SortCol<R>[]; initial: string;
  onRowClick?: (r: R) => void; activeName?: string | null; maxHeight?: number;
}) {
  const [sort, setSort] = useState<{ key: string; desc: boolean }>({ key: initial, desc: true });
  const sorted = useMemo(() => {
    const col = cols.find((c) => c.key === sort.key) || cols[0];
    const dir = sort.desc ? -1 : 1;
    return [...rows].sort((a, b) => {
      const x = col.value(a), y = col.value(b);
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "ko");
      return c * dir;
    });
  }, [rows, cols, sort]);
  const clickHead = (key: string) => setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: true }));

  return (
    <div className="overflow-auto rounded border" style={maxHeight ? { maxHeight } : undefined}>
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-card z-10">
          <tr className="text-muted-foreground border-b">
            {cols.map((c) => (
              <th key={c.key} onClick={() => clickHead(c.key)}
                className={cn("py-1.5 px-2 cursor-pointer select-none whitespace-nowrap hover:text-foreground", c.left ? "text-left" : "text-right")}
                aria-sort={sort.key === c.key ? (sort.desc ? "descending" : "ascending") : "none"}>
                {c.label}{sort.key === c.key ? (sort.desc ? " ▼" : " ▲") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.name} onClick={onRowClick ? () => onRowClick(r) : undefined}
              className={cn("border-b last:border-0", onRowClick && "cursor-pointer hover:bg-muted/60", activeName === r.name && "bg-muted font-medium")}>
              {cols.map((c) => (
                <td key={c.key} className={cn("py-1.5 px-2", c.left ? "text-left" : "text-right whitespace-nowrap")}
                  style={c.danger?.(r) ? { color: "var(--sig-danger)" } : undefined}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
