"use client";

// 상품별 매출 추이 (2026-10-13 신설, 김호 "상품별로 매출을 선그래프로 볼 수 있으면").
// 판매 원장(product_sales) 상품×일 행을 그대로 받아 고른 상품만 선으로 그린다.
//
// - 선은 기본 상위 5개, 최대 10개. 수백 개를 한꺼번에 그리면 읽을 수 없다.
//   대신 고르는 목록은 기간 내 판매된 상품 **전체**를 매출순으로 보여 준다(자르지 않음).
// - 판매가 없는 날은 0 으로 채운다. 빈칸으로 두면 선이 끊겨 "그날 데이터가 없다"로 읽힌다.
// - 판매 원장은 며칠 늦게 들어온다. 마지막으로 들어온 날 뒤는 0 이 아니라 아직 모르는 값이라
//   그 뒤는 그리지 않고 문구로 알린다.
// - "공구 합계" 집계 행은 상품이 아니라서 뺀다(상품 행과 겹쳐 두 번 세게 된다).

import { useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { useFetch } from "@/hooks/use-dashboard-data";
import { productSalesUrl } from "@/lib/api-urls";
import { isGongguAggregate } from "@/lib/gonggu";
import { bucketKey, bucketLabel, GRAN_LABELS, type Gran } from "@/lib/bucket";
import { BRAND_LABELS } from "@/lib/types";
import { formatCurrency, formatNumber, cn } from "@/lib/utils";

interface Row { date: string; brand: string; product: string; revenue: number; quantity: number }

const MAX_LINES = 10;
const DEFAULT_LINES = 5;
const COLORS = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#65a30d", "#ea580c", "#475569"];

const keyOf = (r: { brand: string; product: string }) => `${r.brand}|${r.product}`;

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(from + "T00:00:00Z");
  const end = new Date(to + "T00:00:00Z");
  if (isNaN(d.getTime()) || isNaN(end.getTime())) return out;
  while (d <= end && out.length < 1200) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function ProductTrendChart({ brand, from, to }: { brand: string; from: string; to: string }) {
  const { data, loading, error } = useFetch<{ products: Row[] }>(productSalesUrl(brand, from, to));
  const [metric, setMetric] = useState<"revenue" | "quantity">("revenue");
  const span = daysBetween(from, to).length;
  const [gran, setGran] = useState<Gran | null>(null);
  const g: Gran = gran ?? (span <= 45 ? "day" : span <= 200 ? "week" : "month");
  const [picked, setPicked] = useState<string[] | null>(null);
  const [q, setQ] = useState("");

  const rows = useMemo(
    () => (data?.products || []).filter((r) => r.date && !isGongguAggregate(r)),
    [data],
  );

  // 기간 내 상품 전체, 매출순
  const totals = useMemo(() => {
    const m = new Map<string, { key: string; brand: string; product: string; revenue: number; quantity: number }>();
    for (const r of rows) {
      const k = keyOf(r);
      const e = m.get(k) || { key: k, brand: r.brand, product: r.product, revenue: 0, quantity: 0 };
      e.revenue += Number(r.revenue || 0);
      e.quantity += Number(r.quantity || 0);
      m.set(k, e);
    }
    return Array.from(m.values()).sort((a, b) => b[metric] - a[metric]);
  }, [rows, metric]);

  // 고른 게 없으면 상위 5. 필터를 바꿔 고른 상품이 사라지면 남은 것만 쓴다.
  const selected = useMemo(() => {
    const valid = new Set(totals.map((t) => t.key));
    const p = (picked || []).filter((k) => valid.has(k));
    return p.length > 0 ? p : totals.slice(0, DEFAULT_LINES).map((t) => t.key);
  }, [picked, totals]);

  const lastDate = useMemo(() => rows.reduce((mx, r) => (r.date > mx ? r.date : mx), ""), [rows]);

  const series = useMemo(() => {
    if (!lastDate) return [];
    const end = lastDate < to ? lastDate : to;
    const keys = Array.from(new Set(daysBetween(from, end).map((d) => bucketKey(d, g)))).sort();
    const sel = new Set(selected);
    const acc = new Map<string, Record<string, number>>();
    for (const k of keys) acc.set(k, Object.fromEntries(selected.map((s) => [s, 0])));
    for (const r of rows) {
      const k = keyOf(r);
      if (!sel.has(k) || r.date > end) continue;
      const b = acc.get(bucketKey(r.date, g));
      if (b) b[k] += Number(r[metric] || 0);
    }
    return keys.map((k) => ({ label: bucketLabel(k, g), ...acc.get(k)! }));
  }, [rows, selected, from, to, g, metric, lastDate]);

  const nameOf = useMemo(() => {
    const multiBrand = new Set(totals.map((t) => t.brand)).size > 1;
    const m = new Map<string, string>();
    for (const t of totals) m.set(t.key, multiBrand ? `${t.product} (${BRAND_LABELS[t.brand] || t.brand})` : t.product);
    return m;
  }, [totals]);

  const toggle = (k: string) => {
    const cur = selected;
    if (cur.includes(k)) setPicked(cur.filter((x) => x !== k));
    else if (cur.length < MAX_LINES) setPicked([...cur, k]);
  };
  const shown = q ? totals.filter((t) => t.product.toLowerCase().includes(q.toLowerCase())) : totals;
  const fmt = (v: number) => (metric === "revenue" ? formatCurrency(v) : `${formatNumber(v)}개`);

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">상품별 매출 추이</h3>
          <div className="flex flex-wrap gap-2">
            <div className="flex gap-0.5 rounded-lg bg-muted p-1">
              {([["revenue", "매출"], ["quantity", "수량"]] as const).map(([k, l]) => (
                <button key={k} onClick={() => setMetric(k)}
                  className={cn("px-3 py-1 text-xs rounded-md", metric === k ? "bg-card shadow-sm font-medium" : "text-muted-foreground")}>{l}</button>
              ))}
            </div>
            <div className="flex gap-0.5 rounded-lg bg-muted p-1">
              {GRAN_LABELS.map(({ key, label }) => (
                <button key={key} onClick={() => setGran(key)}
                  className={cn("px-3 py-1 text-xs rounded-md", g === key ? "bg-card shadow-sm font-medium" : "text-muted-foreground")}>{label}</button>
              ))}
            </div>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground py-10 text-center">불러오는 중...</p>
        ) : error ? (
          <p className="text-sm py-10 text-center" style={{ color: "var(--sig-danger)" }}>불러오지 못했습니다 ({error}). 새로고침해 주세요</p>
        ) : totals.length === 0 ? (
          <p className="text-sm text-muted-foreground py-10 text-center">이 기간에 판매된 상품이 없습니다</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              판매 원장 기준. 기본은 {metric === "revenue" ? "매출" : "수량"} 상위 {DEFAULT_LINES}개이고, 아래 목록에서 최대 {MAX_LINES}개까지 골라 겹쳐 볼 수 있습니다.
              {lastDate && lastDate < to && <> 판매 원장은 <b>{lastDate}</b>까지 들어와 있어 그 뒤는 그리지 않았습니다.</>}
            </p>
            <ResponsiveContainer width="100%" height={340}>
              <LineChart data={series} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={16} />
                <YAxis tick={{ fontSize: 11 }} width={64}
                  tickFormatter={(v) => (metric === "revenue" ? (v >= 10000 ? `${Math.round(v / 10000)}만` : String(v)) : String(v))} />
                <Tooltip formatter={(v, k) => [fmt(Number(v ?? 0)), nameOf.get(String(k)) || String(k)]} />
                <Legend formatter={(k: string) => nameOf.get(k) || k} wrapperStyle={{ fontSize: 12 }} />
                {selected.map((k, i) => (
                  <Line key={k} type="monotone" dataKey={k} stroke={COLORS[i % COLORS.length]}
                    strokeWidth={2} dot={series.length <= 31 ? { r: 2 } : false} isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>

            <div className="flex items-center justify-between gap-2 pt-1">
              <span className="text-xs text-muted-foreground">
                상품 {formatNumber(totals.length)}개 전체 · 선택 {selected.length}/{MAX_LINES}
                {picked && picked.length > 0 && (
                  <button onClick={() => setPicked(null)} className="ml-2 underline">상위 {DEFAULT_LINES}개로 되돌리기</button>
                )}
              </span>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="상품 검색"
                className="h-7 rounded-md border bg-background px-2 text-xs w-44" />
            </div>
            <div className="max-h-56 overflow-y-auto rounded-md border divide-y">
              {shown.map((t) => {
                const i = selected.indexOf(t.key);
                const on = i >= 0;
                const full = !on && selected.length >= MAX_LINES;
                return (
                  <button key={t.key} onClick={() => toggle(t.key)} disabled={full}
                    className={cn("w-full flex items-center justify-between gap-3 px-3 py-1.5 text-left text-xs",
                      on ? "bg-muted/60" : "hover:bg-muted/40", full && "opacity-40 cursor-not-allowed")}>
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 border"
                        style={on ? { backgroundColor: COLORS[i % COLORS.length], borderColor: COLORS[i % COLORS.length] } : undefined} />
                      <span className="truncate">{nameOf.get(t.key)}</span>
                    </span>
                    <span className="flex-shrink-0 text-muted-foreground">{formatCurrency(t.revenue)} · {formatNumber(t.quantity)}개</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
