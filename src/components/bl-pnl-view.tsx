"use client";

import { useCallback, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useFetch } from "@/hooks/use-dashboard-data";
import { cn } from "@/lib/utils";
import { kstDate } from "@/lib/date";
import { PnlBlockTable, PNL_EXPORT_COLS, type PnlTableRow } from "@/components/bl-pnl-table";
import {
  PNL_PRODUCTS, PNL_SELECTABLE, GONGGU_COMMISSION_RATE, SHIP_FEE, GONGGU_SHIP_TIMES,
  MANUAL_COST_DEFAULT_KIND, MANUAL_COST_KIND_MAX,
  computeGonggu, computeSelf, sumRows, adSum, manualSum, productConfig,
  type PnlProductKey, type PnlResponse, type PnlMonthInput, type PnlRow, type ManualCost,
} from "@/lib/bl-pnl";

// 밸런스랩 제품별 손익 (2026-10-28). 월별 요약 안의 보기: /monthly?view=pnl&product=nutrition
// 옛 주소 /brand/balancelab/pnl 은 next.config.mjs 에서 이리로 보낸다.
// 김호가 매달 손으로 채우던 시트 「★브랜드별 매출」 밸런스랩 제품 블록을 자동 계산한다.
// 계산식·단가는 src/lib/bl-pnl.ts 한 곳에 있다.

export type PnlPick = PnlProductKey | "all";
type Pick = PnlPick;
export const PNL_DEFAULT_PICK: PnlPick = "nutrition";
const PICKS: { key: Pick; label: string }[] = [
  ...PNL_SELECTABLE.map((k) => ({ key: k as Pick, label: productConfig(k).label })),
  { key: "all", label: "합계" },
];
export function isPnlPick(v: string | null): v is PnlPick {
  return v !== null && PICKS.some((p) => p.key === v);
}
const won = (n: number) => Math.round(n).toLocaleString("ko-KR");

/** 한 달 × 선택 제품의 공구·자체 행. 합계면 제품별로 계산한 뒤 더한다(단가가 제품마다 달라서) */
function rowsFor(m: PnlMonthInput, pick: Pick): { gonggu: PnlRow; self: PnlRow; adNote: string; hasExtra: boolean } {
  const keys = pick === "all" ? PNL_PRODUCTS.map((p) => p.key) : [pick];
  const g: PnlRow[] = [], s: PnlRow[] = [];
  const ad = { naverSearch: 0, naverShopping: 0, meta: 0 };
  const extraByKind = new Map<string, number>();
  for (const k of keys) {
    const p = m.products[k];
    const cfg = productConfig(k);
    const extra = p.extra ?? [];
    g.push(computeGonggu(p.gonggu, cfg));
    s.push(computeSelf(p.self, adSum(p.ad) + manualSum(extra), cfg));
    ad.naverSearch += p.ad.naverSearch; ad.naverShopping += p.ad.naverShopping; ad.meta += p.ad.meta;
    for (const x of extra) extraByKind.set(x.kind, (extraByKind.get(x.kind) || 0) + x.amount);
  }
  const parts = [`네이버 검색 ${won(ad.naverSearch)}`, `네이버 쇼핑 ${won(ad.naverShopping)}`, `메타 ${won(ad.meta)}`];
  extraByKind.forEach((amount, kind) => parts.push(`${kind} ${won(amount)}`));
  return { gonggu: sumRows(g), self: sumRows(s), adNote: parts.join(" · "), hasExtra: extraByKind.size > 0 };
}

function monthNotes(m: PnlMonthInput, pick: Pick, block: "gonggu" | "self"): string[] {
  const out: string[] = [];
  if (m.lagWarning) out.push("최근 5일 미반영 가능");
  if (block === "self" && m.gongguUntagged) out.push("공구 포함(원장에 공구 표식 없음)");
  if (block === "self" && pick !== "all" && (m.products[pick]?.extra ?? []).length > 0) {
    out.push(`광고 외 ${m.products[pick].extra.map((x) => x.kind).join("·")} 포함`);
  }
  if (block === "self" && (pick === "heavy" || pick === "nutrition" || pick === "all") && m.keywordCoverage !== "full") {
    out.push(m.keywordCoverage === "none" ? "중금속 파워링크 몫 측정 불가(키워드 원장 없음)" : "중금속 파워링크 몫 일부만 측정");
  }
  if (block === "self" && m.gfa > 0) out.push(`GFA ${won(m.gfa)} 별도`);
  return out;
}

/** 월별 요약 페이지가 연도·제품을 URL 로 쥐고 넘겨 준다 */
export function BlPnlView({ year, pick, onPickChange }: { year: string; pick: Pick; onPickChange: (p: Pick) => void }) {
  const { data, loading, error, refetch } = useFetch<PnlResponse>(`/api/bl-product-pnl?year=${year}`);
  const thisMonth = kstDate().slice(0, 7);
  const [editMonth, setEditMonth] = useState<string | null>(null);
  const setPick = onPickChange;
  const canEdit = pick !== "all";
  const editing = canEdit && editMonth ? data?.months.find((m) => m.month === editMonth) ?? null : null;

  const view = useMemo(() => {
    if (!data?.months) return null;
    const gRows: PnlTableRow[] = [], sRows: PnlTableRow[] = [];
    const gTot: PnlRow[] = [], sTot: PnlRow[] = [];
    for (const m of data.months) {
      const future = m.month > thisMonth;
      const r = future ? null : rowsFor(m, pick);
      const gBlocked = !future && m.gongguUntagged ? "공구 구분 불가 (판매 원장에 공구 표식이 없어 아래 자체에 섞여 있음)" : undefined;
      gRows.push({ month: m.month, row: r?.gonggu ?? null, blockedText: gBlocked, notes: future ? [] : monthNotes(m, pick, "gonggu") });
      sRows.push({ month: m.month, row: r?.self ?? null, notes: future ? [] : monthNotes(m, pick, "self"), marketingTitle: r?.adNote, marketingHasExtra: r?.hasExtra });
      if (r && !gBlocked) gTot.push(r.gonggu);
      if (r) sTot.push(r.self);
    }
    return { gRows, sRows, gTotal: sumRows(gTot), sTotal: sumRows(sTot) };
  }, [data, pick, thisMonth]);

  const download = useCallback(async () => {
    if (!data?.months) return;
    const XLSX = await import("xlsx");
    const header = ["제품", "구분", "월", ...PNL_EXPORT_COLS.map((c) => c.label), "비고"];
    const lines: (string | number | null)[][] = [header];
    for (const p of PICKS) {
      for (const m of data.months) {
        if (m.month > thisMonth) continue;
        const r = rowsFor(m, p.key);
        const put = (block: "gonggu" | "self", row: PnlRow) =>
          lines.push([p.label, block === "gonggu" ? "공구" : "자체", m.month,
            ...PNL_EXPORT_COLS.map((c) => (row[c.key] as number | null)),
            (block === "gonggu" && m.gongguUntagged ? ["공구 구분 불가"] : monthNotes(m, p.key, block)).join(" · ")]);
        put("gonggu", r.gonggu);
        put("self", r.self);
      }
    }
    const ws = XLSX.utils.aoa_to_sheet(lines);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "제품별 손익");
    XLSX.writeFile(wb, `밸런스랩_제품별손익_${year}.xlsx`);
  }, [data, thisMonth, year]);

  const label = PICKS.find((p) => p.key === pick)?.label ?? "";
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {PICKS.map((p) => (
          <button key={p.key} onClick={() => setPick(p.key)}
            className={cn("px-3 py-1.5 text-sm rounded-md border transition-colors",
              pick === p.key ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted")}>
            {p.label}
          </button>
        ))}
        <button onClick={download} disabled={!data} className="ml-auto px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50">
          엑셀로 내려받기
        </button>
      </div>

      {error && <p className="text-sm text-red-600">불러오지 못했습니다: {error}</p>}
      {loading && !data && <div className="h-64 rounded-xl bg-muted animate-pulse" />}
      {view && (
        <>
          <PnlBlockTable title={`${label} · 공구`} marketingLabel="마케팅비(수수료)"
            subtitle={`마케팅비 = 매출 × ${(GONGGU_COMMISSION_RATE * 100).toFixed(1)}% · 배송비 = ${won(SHIP_FEE)}원 × 주문 ${GONGGU_SHIP_TIMES}회`}
            rows={view.gRows} total={view.gTotal} totalNote="공구 구분 불가 달은 뺀 합계" />
          {editing && canEdit && (
            <ManualCostEditor key={`${pick}-${editing.month}`} month={editing.month} product={pick}
              items={editing.products[pick].extra ?? []} ready={data?.manualCostReady ?? false}
              onClose={() => setEditMonth(null)} onSaved={refetch} />
          )}
          <PnlBlockTable title={`${label} · 자체`} marketingLabel="마케팅비(광고비 + 광고 외)"
            subtitle={canEdit
              ? "마케팅비 = 네이버 검색·쇼핑 + 메타 광고비(GFA 제외) + 광고 외 마케팅비(체험 키트 원가 등). 칸에 마우스를 올리면 내역, 누르면 광고 외 마케팅비 입력"
              : "마케팅비 = 네이버 검색·쇼핑 + 메타 광고비(GFA 제외) + 광고 외 마케팅비. 입력은 제품 하나를 고른 화면에서"}
            rows={view.sRows} total={view.sTotal}
            onMarketingClick={canEdit ? (m) => setEditMonth((cur) => (cur === m ? null : m)) : undefined}
            editingMonth={editMonth} />
        </>
      )}
      <RulesCard />
    </>
  );
}

function RulesCard() {
  return (
    <Card>
      <CardContent className="p-4 space-y-3 text-sm">
        <h3 className="font-semibold">계산 규칙과 설정값</h3>
        <table className="text-xs border-collapse">
          <thead><tr className="text-muted-foreground">
            <th className="text-left pr-4 pb-1">제품</th><th className="text-right pr-4 pb-1">재료비 단가</th>
            <th className="text-right pr-4 pb-1">자체 배송 횟수</th><th className="text-left pb-1">근거</th>
          </tr></thead>
          <tbody>
            {PNL_PRODUCTS.map((p) => (
              <tr key={p.key}>
                <td className="pr-4 py-0.5">{p.label}</td><td className="text-right pr-4 tabular-nums">{won(p.unitCost)}원</td>
                <td className="text-right pr-4">{p.selfShipTimes}회</td><td className="text-muted-foreground">{p.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="list-disc pl-5 space-y-1 text-xs text-muted-foreground">
          <li>마진 = 매출 − 재료비 원가. 공헌 이익 = 마진 − 마케팅비 − 배송비. 재료비는 공구·자체 모두 한 번만 뺀다(시트 공구 블록은 두 번 빼는 칸이 있음).</li>
          <li>매출·판매수량·주문건수는 판매 원장(DB). 주문건수는 원장의 구매자 수 합. 공구는 셀러 표식(lineup)이나 공구 판매처가 붙은 행.</li>
          <li>자체 광고비는 캠페인 이름으로 중금속·타액·음식물을 가르고, 나머지(큐모발 공통 파워링크의 구분 안 되는 몫, 제품 미구분 메타)는 뉴트리션으로 둔다. 시트와 같은 규칙.</li>
          <li>큐모발 공통 파워링크 중 중금속 검색어(중금속·납중독·수은) 광고비는 중금속으로 옮긴다. 키워드 원장이 없는 달은 옮길 수 없어 뉴트리션에 남는다.</li>
          <li>남의 캠페인(와이에스환경·한국반려동물안전인증센터·99.브랜드·경진대회 등)과 GFA 는 뺀다.</li>
          <li>광고 외 마케팅비(체험 키트 원가 등)는 원장이 없어 손으로 넣는다. 자체표 마케팅비 칸을 누르면 제품·달별로 넣고, 자체 마케팅비에 더한다. 넣은 칸은 보라색 숫자와 + 표시.</li>
          <li>공구/자체 구분은 판매 원장의 셀러 표식. 2025-12 ~ 2026-05 는 Sales 시트 「브랜드명」(공동구매/자체판매) 기준으로 원장을 보정한다(docs/sql/2026-10-28-bl-gonggu.sql). 그 SQL 전에는 1·2월 공구가 자체에 섞여 「공구 구분 불가」로 보인다.</li>
          <li>&quot;큐모발검사 뉴트리션 + 맞춤 영양제&quot; 묶음은 뉴트리션으로 센다. 영양제는 단품(맞춤영양제·메디넥스)만.</li>
          <li>단가를 바꾸려면 src/lib/bl-pnl.ts 의 PNL_PRODUCTS 한 곳만 고친다.</li>
        </ul>
      </CardContent>
    </Card>
  );
}

/** 광고 외 마케팅비 입력 (제품 하나 × 한 달). 금액 0 으로 저장하면 그 줄을 지운다 */
function ManualCostEditor({ month, product, items, ready, onClose, onSaved }: {
  month: string; product: PnlProductKey; items: ManualCost[]; ready: boolean;
  onClose: () => void; onSaved: () => void;
}) {
  const first = items[0];
  const [kind, setKind] = useState(first?.kind ?? MANUAL_COST_DEFAULT_KIND);
  const [amount, setAmount] = useState(first ? String(first.amount) : "");
  const [memo, setMemo] = useState(first?.memo ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const current = items.find((x) => x.kind === kind.trim());

  const pickItem = (x: ManualCost) => { setKind(x.kind); setAmount(String(x.amount)); setMemo(x.memo ?? ""); setMsg(null); };

  const save = async (value: number) => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "bl_pnl_manual_cost", data: { product, month, kind: kind.trim(), amount: value, memo } }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setMsg(value === 0 ? "지웠습니다" : "저장했습니다");
      onSaved();
    } catch (e) {
      setMsg(`저장 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const parsed = Number(amount.replace(/,/g, ""));
  const trimmed = kind.trim();
  const valid = trimmed.length > 0 && trimmed.length <= MANUAL_COST_KIND_MAX && amount.trim() !== "" && Number.isInteger(parsed) && parsed >= 0;
  const inputCls = "px-2 py-1.5 rounded-md border bg-background text-sm text-foreground disabled:opacity-60";
  return (
    <Card className="border-primary/40">
      <CardContent className="p-4 space-y-3 text-sm">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="font-semibold">광고 외 마케팅비 · {productConfig(product).label} · {Number(month.slice(5))}월</h3>
          <span className="text-xs text-muted-foreground">자체표 마케팅비에 더해진다. 금액 0 으로 저장하면 그 줄을 지운다.</span>
          <button onClick={onClose} className="ml-auto text-xs text-muted-foreground hover:underline">닫기</button>
        </div>
        {!ready && (
          <p className="text-xs text-amber-700 dark:text-amber-400">SQL 실행 후 사용: 저장할 표가 아직 없습니다 (docs/sql/2026-10-28-bl-pnl-manual-cost.sql).</p>
        )}
        {items.length > 0 && (
          <ul className="text-xs space-y-1">
            {items.map((x) => (
              <li key={x.kind}>
                <button onClick={() => pickItem(x)} className="hover:underline text-left">
                  {x.kind} <span className="tabular-nums font-medium">{won(x.amount)}원</span>
                  {x.memo && <span className="text-muted-foreground"> · {x.memo}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">종류
            <input value={kind} onChange={(e) => setKind(e.target.value)} maxLength={MANUAL_COST_KIND_MAX} disabled={!ready} className={cn(inputCls, "w-40")} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">금액(원)
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder="0" disabled={!ready}
              className={cn(inputCls, "w-36 text-right tabular-nums")} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground flex-1 min-w-[12rem]">메모
            <input value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={200} disabled={!ready} className={inputCls} />
          </label>
          <button onClick={() => save(parsed)} disabled={!ready || !valid || busy}
            className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50">
            {busy ? "저장 중" : "저장"}
          </button>
          {current && (
            <button onClick={() => save(0)} disabled={!ready || busy}
              className="px-3 py-1.5 text-sm rounded-md border hover:bg-muted disabled:opacity-50">지우기</button>
          )}
        </div>
        {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
      </CardContent>
    </Card>
  );
}
