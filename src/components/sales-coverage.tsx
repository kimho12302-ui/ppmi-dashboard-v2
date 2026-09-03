"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";

const BRAND_LABEL: Record<string, string> = {
  nutty: "너티", ironpet: "아이언펫", saip: "사입", balancelab: "밸런스랩",
};

type CoverageState = "filled" | "zero" | "brand_missing" | "not_uploaded";
interface Cell { date: string; revenue: number | null; state: CoverageState; uploaded: boolean }
interface Row { brand: string; cells: Cell[] }
interface Coverage {
  days: string[]; brands: string[]; rows: Row[];
  notUploaded: string[];
  brandGaps: { brand: string; dates: string[] }[];
}

// 칸 하나가 답해야 하는 질문은 "이 숫자를 믿어도 되나" 하나다.
// 0매출(사실)과 결번(모름)을 같은 회색으로 칠하면 그 질문에 답이 안 된다.
const CELL: Record<CoverageState, { bg: string; color: string; text: (v: number | null) => string; legend: string }> = {
  filled: { bg: "var(--sig-ok-surface)", color: "var(--foreground)", text: (v) => compact(v || 0), legend: "매출(만원)" },
  zero: { bg: "transparent", color: "var(--muted-foreground)", text: () => "0", legend: "행 있음 · 매출 0 (사실)" },
  brand_missing: { bg: "var(--sig-warn-surface)", color: "var(--sig-warn)", text: () => "?", legend: "그 브랜드만 행 없음 (0인지 미입력인지 모름)" },
  not_uploaded: { bg: "var(--sig-danger-surface)", color: "var(--sig-danger)", text: () => "-", legend: "판매 파일 미업로드" },
};

function compact(v: number): string {
  if (v >= 10000) return `${Math.round(v / 10000)}`;
  return String(Math.round(v));
}

export function SalesCoverage() {
  const [data, setData] = useState<Coverage | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/sales-coverage")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (alive && d) setData(d); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  if (failed) {
    return (
      <Card><CardContent className="p-4 text-sm" style={{ color: "var(--sig-danger)" }}>
        판매 업로드 현황을 불러오지 못했습니다. 공백 여부를 확인할 수 없습니다.
      </CardContent></Card>
    );
  }
  if (!data || data.rows.length === 0) return null;

  const gapCount = data.brandGaps.reduce((s, g) => s + g.dates.length, 0);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
          <h3 className="font-semibold text-sm">
            판매 업로드 커버리지 <span className="text-xs font-normal text-muted-foreground">최근 14일 · 브랜드별</span>
          </h3>
          <div className="flex items-center gap-3 stamp">
            {data.notUploaded.length > 0 ? (
              <span style={{ color: "var(--sig-danger)" }}>
                파일 미업로드 {data.notUploaded.length}일: {data.notUploaded.map((d) => d.slice(5)).join(", ")}
              </span>
            ) : (
              <span style={{ color: "var(--sig-ok)" }}>14일 전부 업로드됨</span>
            )}
            {gapCount > 0 && (
              <span style={{ color: "var(--sig-warn)" }}>브랜드 결번 {gapCount}칸</span>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="num text-[10px] border-collapse">
            <thead>
              <tr>
                <th className="sticky left-0 bg-card text-left pr-2 font-medium text-muted-foreground">브랜드</th>
                {data.days.map((d) => {
                  const notUp = data.notUploaded.includes(d);
                  return (
                    <th key={d} className="px-1 py-0.5 text-center font-normal"
                      style={{ color: notUp ? "var(--sig-danger)" : "var(--muted-foreground)", fontWeight: notUp ? 600 : 400 }}
                      title={d}>
                      {d.slice(8)}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.brand}>
                  <td className="sticky left-0 bg-card pr-2 font-medium whitespace-nowrap font-sans">{BRAND_LABEL[row.brand] || row.brand}</td>
                  {row.cells.map((c) => {
                    const v = CELL[c.state];
                    return (
                      <td key={c.date}
                        className="px-1 py-0.5 text-center border border-border/30"
                        style={{ backgroundColor: v.bg, color: v.color }}
                        title={`${c.date} ${BRAND_LABEL[row.brand]}: ${
                          c.state === "not_uploaded" ? "그 날 판매 파일 미업로드"
                          : c.state === "brand_missing" ? "이 브랜드 행만 없음 — 0매출인지 미입력인지 확인 필요"
                          : `${(c.revenue ?? 0).toLocaleString()}원`}`}>
                        {v.text(c.revenue)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 stamp text-muted-foreground">
          {(Object.keys(CELL) as CoverageState[]).map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm border border-border/50"
                style={{ backgroundColor: CELL[k].bg, color: CELL[k].color }} />
              {CELL[k].legend}
            </span>
          ))}
          <span>공구 제외 기준</span>
        </div>
        {gapCount > 0 && (
          <p className="stamp mt-1.5" style={{ color: "var(--sig-warn)" }}>
            {data.brandGaps.map((g) => `${BRAND_LABEL[g.brand] || g.brand} ${g.dates.length}일(${g.dates.map((d) => d.slice(5)).join(", ")})`).join(" · ")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
