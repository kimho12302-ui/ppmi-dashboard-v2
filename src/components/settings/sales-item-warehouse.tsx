"use client";

import { useMemo, useState } from "react";
import { isBlankWarehouse, warehouseOptions } from "@/lib/sales-match-core";

// 「매칭표 보기」 안 「품목코드별 출하창고」 (2026-11-26).
//   출하창고 표(sales_item_codes)를 코드별로 보고 창고를 바꾼다. 고르기 목록은 표에 실제로 쓰인 창고만(많이 쓰인 순, 직접 입력 없음).
//   이미 창고가 있는 코드를 바꾸는 곳은 여기뿐이다(「코드 넣기」 상자에서는 빈 창고만 채운다: 실수 방지).
//   이미 보관된 판매입력 줄의 창고는 그대로다. 회사 PC 가 다음 계산부터 바뀐 창고를 쓴다.
// API: POST /api/sales-match/item {code, warehouse}. 규칙 src/lib/sales-match-core.ts saveItemWarehouse.

interface ItemRow { code: string; name: string | null; warehouse: string | null }

const WARN = { background: "var(--sig-warn-surface)", color: "var(--sig-warn)" };
const DANGER = { background: "var(--sig-danger-surface)", color: "var(--sig-danger)" };
const OK = { background: "var(--sig-ok-surface)", color: "var(--sig-ok)" };
const PAGE = 50;

async function postItem(code: string, warehouse: string): Promise<{ ok: true; note: string } | { ok: false; message: string }> {
  try {
    const r = await fetch("/api/sales-match/item", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, warehouse }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) return { ok: false, message: d.error || `HTTP ${r.status}` };
    return { ok: true, note: d.note ?? "" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

function ItemLine({ item, options, editable, busy, onSave }: {
  item: ItemRow;
  options: string[];
  editable: boolean;
  busy: boolean;
  onSave: (code: string, warehouse: string, previous: string | null) => void;
}) {
  const current = isBlankWarehouse(item.warehouse) ? null : item.warehouse;
  const [value, setValue] = useState(current ?? "");
  const changed = value !== "" && value !== current;
  return (
    <li className="py-1.5">
      <div className="flex items-center gap-x-2 gap-y-1 flex-wrap sm:flex-nowrap">
        <span className="num font-medium shrink-0">{item.code}</span>
        <span className="min-w-0 basis-full sm:basis-auto sm:flex-1 truncate text-muted-foreground order-last sm:order-none">{item.name || "(이름 없음)"}</span>
        {current
          ? <span className="shrink-0">{current}</span>
          : <span className="shrink-0 rounded px-1 text-[10px] font-medium" style={WARN}>창고 없음</span>}
        {editable && (
          <span className="shrink-0 flex items-center gap-1.5 ml-auto sm:ml-0">
            <select value={value} onChange={(e) => setValue(e.target.value)} aria-label={`${item.code} 출하창고`}
              className="text-[11px] px-1 py-0.5 rounded border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/40">
              {!current && <option value="">고르기</option>}
              {options.map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
            <button type="button" disabled={!changed || busy} onClick={() => onSave(item.code, value, current)}
              className="px-2 py-0.5 rounded text-[11px] font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed">
              {busy ? "저장 중..." : current ? "바꾸기" : "넣기"}
            </button>
          </span>
        )}
      </div>
    </li>
  );
}

/** 품목코드별 출하창고 보기·바꾸기 (「매칭표 보기」 안 접기 영역) */
export function ItemWarehousePanel({ items, seeded, onChanged }: { items: ItemRow[]; seeded: boolean; onChanged: () => void }) {
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const options = useMemo(() => warehouseOptions(items), [items]);
  const blankCount = useMemo(() => items.filter((i) => isBlankWarehouse(i.warehouse)).length, [items]);
  // 창고 없는 코드 먼저(채울 것), 그다음 코드 순
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const hit = s ? items.filter((i) => i.code.toLowerCase().includes(s) || (i.name ?? "").toLowerCase().includes(s) || (i.warehouse ?? "").toLowerCase().includes(s)) : items;
    return [...hit].sort((a, b) => {
      const ba = isBlankWarehouse(a.warehouse) ? 0 : 1;
      const bb = isBlankWarehouse(b.warehouse) ? 0 : 1;
      return ba - bb || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
    });
  }, [items, q]);

  const save = async (code: string, warehouse: string, previous: string | null) => {
    if (busy) return;
    if (previous && !window.confirm(`${code} 출하창고를 바꿀까요?\n${previous} → ${warehouse}\n이미 보관된 판매입력 줄은 그대로이고, 회사 PC 가 다음 계산부터 새 창고를 씁니다.`)) return;
    setBusy(code);
    setError(null);
    setDone(null);
    const r = await postItem(code, warehouse);
    setBusy(null);
    if (!r.ok) return setError(`${code}: ${r.message}`);
    setDone(`${code} 출하창고 ${previous ? `${previous} → ` : ""}${warehouse} 저장. ${r.note}`);
    onChanged();
  };

  return (
    <details className="rounded border border-border/60">
      <summary className="cursor-pointer select-none px-3 py-1.5 text-xs font-medium hover:bg-muted/40">
        품목코드별 출하창고
        <span className="text-muted-foreground font-normal"> · {items.length}개{blankCount > 0 ? ` (창고 없음 ${blankCount})` : ""}</span>
      </summary>
      <div className="px-3 pb-3 pt-1 space-y-2">
        <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }}
          placeholder="품목코드·이름·창고 검색" aria-label="출하창고 검색"
          className="w-full text-xs px-2 py-1 rounded border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/40" />
        {error && <p className="text-xs rounded px-3 py-2" style={DANGER}>저장 못 함: {error}</p>}
        {done && <p className="text-xs rounded px-3 py-2" style={OK} role="status">{done}</p>}
        <ul className="divide-y divide-border/40 text-[11px]">
          {rows.slice(0, limit).map((it) => (
            <ItemLine key={`${it.code}:${it.warehouse ?? ""}`} item={it} options={options} editable={seeded && options.length > 0}
              busy={busy === it.code} onSave={save} />
          ))}
          {rows.length === 0 && <li className="py-1.5 text-muted-foreground">{q ? "검색 결과 없음" : "출하창고 표가 비어 있습니다"}</li>}
        </ul>
        {rows.length > limit && (
          <button type="button" onClick={() => setLimit(limit + PAGE)} className="text-xs text-primary hover:underline">
            더 보기 ({rows.length - limit}개 남음)
          </button>
        )}
        <p className="stamp text-muted-foreground">
          고르기 목록은 이 표에 실제로 쓰인 창고만 많이 쓰인 순으로 보입니다({options.join(" · ") || "없음"}). 이미 보관된 판매입력 줄의 창고는 그대로이고, 회사 PC 가 다음 계산부터 새 창고를 씁니다.
        </p>
      </div>
    </details>
  );
}
