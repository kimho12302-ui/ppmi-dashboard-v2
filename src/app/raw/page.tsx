"use client";

import { Suspense, useMemo, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { useFetch } from "@/hooks/use-dashboard-data";
import { cn } from "@/lib/utils";

type TableName = "daily_sales" | "daily_ad_spend" | "daily_funnel" | "product_sales" | "keyword_performance";

const TABLES: { key: TableName; label: string }[] = [
  { key: "daily_sales", label: "매출 (daily_sales)" },
  { key: "daily_ad_spend", label: "광고비 (daily_ad_spend)" },
  { key: "daily_funnel", label: "퍼널 (daily_funnel)" },
  { key: "product_sales", label: "제품 매출 (product_sales)" },
  { key: "keyword_performance", label: "키워드 (keyword_performance)" },
];

export default function RawPage() {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">로딩 중...</div>}>
      <RawInner />
    </Suspense>
  );
}

function RawInner() {
  const [table, setTable] = useState<TableName>("daily_sales");
  const [page, setPage] = useState(0);
  const limit = 50;

  // API route for raw data
  const apiUrl = `/api/raw?table=${table}&offset=${page * limit}&limit=${limit}`;
  const { data, loading, error } = useFetch<{ rows: Record<string, unknown>[]; total: number; hasMore?: boolean; totalIsEstimate?: boolean }>(apiUrl);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rows = useMemo(() => data?.rows || [], [data]);
  const total = data?.total || 0;
  // 큰 표는 전체 행 수를 정확히 세지 않고 추정값을 받는다(2026-11-09 속도 수정). 다음 쪽 여부는 hasMore 가 정확하다.
  const totalIsEstimate = !!data?.totalIsEstimate;
  const hasMore = !!data?.hasMore;
  const pageCount = Math.max(1, Math.ceil(total / limit));
  const columns = useMemo(() => {
    if (rows.length === 0) return [];
    return Object.keys(rows[0]);
  }, [rows]);

  // 원본 대조용 화면이라 숫자를 줄이지 않는다(예전엔 "11만" 처럼 축약돼 id·금액을 시트와 맞춰 볼 수 없었다, 2026-11-04).
  // 객체·배열 칸은 JSON 그대로.
  const formatValue = (val: unknown): string => {
    if (val === null || val === undefined) return "-";
    if (typeof val === "object") return JSON.stringify(val);
    return String(val);
  };

  /* CSV 다운로드 */
  const downloadCSV = () => {
    if (rows.length === 0) return;
    const header = columns.join(",");
    // 값 안의 큰따옴표는 두 번 써서 CSV 칸이 깨지지 않게 한다
    const body = rows.map((r) => columns.map((c) => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const csv = `\uFEFF${header}\n${body}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${table}_page${page + 1}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <PageShell title="Raw Data" description="DB 테이블 직접 조회" hideFilters>
      {/* 테이블 선택 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-0.5 rounded-lg bg-muted p-1 flex-wrap">
          {TABLES.map((t) => (
            <button
              key={t.key}
              onClick={() => { setTable(t.key); setPage(0); }}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap",
                table === t.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          onClick={downloadCSV}
          className="px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          CSV 다운로드
        </button>
      </div>

      {/* 데이터 */}
      <Card>
        <CardContent className="p-4 overflow-x-auto">
          {loading ? (
            <div className="h-32 flex items-center justify-center text-muted-foreground">로딩 중...</div>
          ) : error ? (
            <div className="h-32 flex items-center justify-center text-red-500">에러: {error}</div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-muted-foreground">총 {totalIsEstimate ? "약 " : ""}{total.toLocaleString("ko-KR")}행 · {columns.length}열</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage(Math.max(0, page - 1))}
                    disabled={page === 0}
                    className="px-2 py-1 text-xs rounded bg-muted disabled:opacity-30"
                  >
                    이전
                  </button>
                  <span className="text-xs text-muted-foreground">{page + 1} / {totalIsEstimate ? `약 ${pageCount}` : pageCount}</span>
                  <button
                    onClick={() => setPage(page + 1)}
                    disabled={!hasMore}
                    className="px-2 py-1 text-xs rounded bg-muted disabled:opacity-30"
                  >
                    다음
                  </button>
                </div>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left border-b text-muted-foreground">
                    {columns.map((col) => (
                      <th key={col} className="pb-2 pr-3 whitespace-nowrap">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i} className="border-b border-border/30 hover:bg-muted/50">
                      {columns.map((col) => (
                        <td key={col} className="py-1.5 pr-3 whitespace-nowrap">{formatValue(row[col])}</td>
                      ))}
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={columns.length || 1} className="py-8 text-center text-muted-foreground">데이터 없음</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
