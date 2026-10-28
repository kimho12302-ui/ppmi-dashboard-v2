"use client";

import Link from "next/link";
import { Suspense, useCallback, useMemo, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { useFetch } from "@/hooks/use-dashboard-data";
import { cn } from "@/lib/utils";
import { kstDate } from "@/lib/date";
import { PnlBlockTable, PNL_EXPORT_COLS, type PnlTableRow } from "@/components/bl-pnl-table";
import {
  PNL_PRODUCTS, PNL_SELECTABLE, GONGGU_COMMISSION_RATE, SHIP_FEE, GONGGU_SHIP_TIMES,
  computeGonggu, computeSelf, sumRows, adSum, productConfig,
  type PnlProductKey, type PnlResponse, type PnlMonthInput, type PnlRow,
} from "@/lib/bl-pnl";

// 밸런스랩 제품별 손익 (2026-10-28). /brand/balancelab/pnl
// 김호가 매달 손으로 채우던 시트 「★브랜드별 매출」 밸런스랩 제품 블록을 자동 계산한다.
// 계산식·단가는 src/lib/bl-pnl.ts 한 곳에 있다.

type Pick = PnlProductKey | "all";
const PICKS: { key: Pick; label: string }[] = [
  ...PNL_SELECTABLE.map((k) => ({ key: k as Pick, label: productConfig(k).label })),
  { key: "all", label: "합계" },
];
const won = (n: number) => Math.round(n).toLocaleString("ko-KR");

export default function BlPnlPage({ params }: { params: { brand: string } }) {
  if (params.brand !== "balancelab") {
    return (
      <PageShell title="제품별 손익" hideFilters>
        <p className="text-sm text-muted-foreground">제품별 손익은 밸런스랩만 있습니다. <Link className="underline" href="/brand/balancelab/pnl">밸런스랩 제품별 손익으로</Link></p>
      </PageShell>
    );
  }
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">로딩 중...</div>}>
      <BlPnlInner />
    </Suspense>
  );
}

/** 한 달 × 선택 제품의 공구·자체 행. 합계면 제품별로 계산한 뒤 더한다(단가가 제품마다 달라서) */
function rowsFor(m: PnlMonthInput, pick: Pick): { gonggu: PnlRow; self: PnlRow; adNote: string } {
  const keys = pick === "all" ? PNL_PRODUCTS.map((p) => p.key) : [pick];
  const g: PnlRow[] = [], s: PnlRow[] = [];
  const ad = { naverSearch: 0, naverShopping: 0, meta: 0 };
  for (const k of keys) {
    const p = m.products[k];
    const cfg = productConfig(k);
    g.push(computeGonggu(p.gonggu, cfg));
    s.push(computeSelf(p.self, adSum(p.ad), cfg));
    ad.naverSearch += p.ad.naverSearch; ad.naverShopping += p.ad.naverShopping; ad.meta += p.ad.meta;
  }
  const adNote = `네이버 검색 ${won(ad.naverSearch)} · 네이버 쇼핑 ${won(ad.naverShopping)} · 메타 ${won(ad.meta)}`;
  return { gonggu: sumRows(g), self: sumRows(s), adNote };
}

function monthNotes(m: PnlMonthInput, pick: Pick, block: "gonggu" | "self"): string[] {
  const out: string[] = [];
  if (m.lagWarning) out.push("최근 5일 미반영 가능");
  if (block === "self" && m.gongguUntagged) out.push("공구 포함(원장에 공구 표식 없음)");
  if (block === "self" && (pick === "heavy" || pick === "nutrition" || pick === "all") && m.keywordCoverage !== "full") {
    out.push(m.keywordCoverage === "none" ? "중금속 파워링크 몫 측정 불가(키워드 원장 없음)" : "중금속 파워링크 몫 일부만 측정");
  }
  if (block === "self" && m.gfa > 0) out.push(`GFA ${won(m.gfa)} 별도`);
  return out;
}

function BlPnlInner() {
  const [year, setYear] = useState(kstDate().slice(0, 4));
  const [pick, setPick] = useState<Pick>("nutrition");
  const { data, loading, error } = useFetch<PnlResponse>(`/api/bl-product-pnl?year=${year}`);
  const thisMonth = kstDate().slice(0, 7);

  const view = useMemo(() => {
    if (!data?.months) return null;
    const gRows: PnlTableRow[] = [], sRows: PnlTableRow[] = [];
    const gTot: PnlRow[] = [], sTot: PnlRow[] = [];
    for (const m of data.months) {
      const future = m.month > thisMonth;
      const r = future ? null : rowsFor(m, pick);
      const gBlocked = !future && m.gongguUntagged ? "공구 구분 불가 (판매 원장에 공구 표식이 없어 아래 자체에 섞여 있음)" : undefined;
      gRows.push({ month: m.month, row: r?.gonggu ?? null, blockedText: gBlocked, notes: future ? [] : monthNotes(m, pick, "gonggu") });
      sRows.push({ month: m.month, row: r?.self ?? null, notes: future ? [] : monthNotes(m, pick, "self"), marketingTitle: r?.adNote });
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
    <PageShell title="밸런스랩 제품별 손익" description="시트 「★브랜드별 매출」 밸런스랩 제품 블록을 판매 원장·광고비 원장으로 자동 계산" hideFilters>
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/brand/balancelab" className="text-sm text-muted-foreground hover:underline mr-2">← 밸런스랩</Link>
        {PICKS.map((p) => (
          <button key={p.key} onClick={() => setPick(p.key)}
            className={cn("px-3 py-1.5 text-sm rounded-md border transition-colors",
              pick === p.key ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted")}>
            {p.label}
          </button>
        ))}
        <select value={year} onChange={(e) => setYear(e.target.value)} className="ml-auto px-2 py-1.5 text-sm rounded-md border bg-background">
          {[Number(kstDate().slice(0, 4)), Number(kstDate().slice(0, 4)) - 1].map((y) => <option key={y} value={y}>{y}년</option>)}
        </select>
        <button onClick={download} disabled={!data} className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50">
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
          <PnlBlockTable title={`${label} · 자체`} marketingLabel="마케팅비(광고비)"
            subtitle="마케팅비 = 네이버 검색·쇼핑 + 메타 광고비(GFA 제외). 칸에 마우스를 올리면 매체별 내역"
            rows={view.sRows} total={view.sTotal} />
        </>
      )}
      <RulesCard />
    </PageShell>
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
          <li>남의 캠페인(와이에스환경·한국반려동물안전인증센터·99.브랜드·경진대회 등)과 GFA 는 뺀다. 광고 외 비용(체험단·인플루언서)은 원장이 없어 빠진다.</li>
          <li>&quot;큐모발검사 뉴트리션 + 맞춤 영양제&quot; 묶음은 뉴트리션으로 센다. 영양제는 단품(맞춤영양제·메디넥스)만.</li>
          <li>단가를 바꾸려면 src/lib/bl-pnl.ts 의 PNL_PRODUCTS 한 곳만 고친다.</li>
        </ul>
      </CardContent>
    </Card>
  );
}
