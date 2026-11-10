"use client";

// 설정 > 재고 > 매칭표 확인 (2026-11-10). 위킵 SKU ↔ 판매 구성표 기본 품목(component)·대시보드 상품 코드.
// 초안(볼트 wekeep-sku-map.draft.json)은 이름 대조로 자동 짝지은 것이다: 확실 77 · 추정 29 · 없음 15.
// 사람이 할 일: 추정·없음 줄을 열어 기본 품목을 고르고 「확인」, 부자재·판촉물은 「판정 제외」.
// 기본 품목이 정해져야 쿠팡 판매 속도(너티)와 원가가 그 SKU 에 붙는다.
import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/settings/shared";
import { BRAND_LABEL, type InvBrand } from "@/lib/inventory";
import { postInventory, type InventorySettingsData } from "./inventory-tab";

export interface MapRow {
  sku_no: string;
  product_name: string | null;
  barcode: string | null;
  product_code: string | null;
  component: string | null;
  brand: string | null;
  supplier: string | null;
  confidence: string;
  confirmed: boolean;
  exclude: boolean;
  note: string | null;
}

const FILTERS = [
  { key: "todo", label: "확인할 것(추정·없음, 미확인)" },
  { key: "all", label: "전체" },
  { key: "confirmed", label: "확인함" },
  { key: "excluded", label: "판정 제외" },
] as const;
type Filter = (typeof FILTERS)[number]["key"];
const inp = "w-full px-2 py-1 rounded border bg-background text-xs";

export function InventoryMapReview({ data, onSaved }: { data: InventorySettingsData; onSaved: () => void }) {
  const [filter, setFilter] = useState<Filter>("todo");
  const [edit, setEdit] = useState<MapRow | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const available = useMemo(() => new Map(data.skus.map((s) => [s.sku_no, s.available])), [data]);
  const rows = useMemo(() => data.map.filter((r) =>
    filter === "all" ? true
      : filter === "confirmed" ? r.confirmed
        : filter === "excluded" ? r.exclude
          : !r.confirmed && !r.exclude && r.confidence !== "확실",
  ).sort((a, b) => (a.confidence === b.confidence ? String(a.product_name).localeCompare(String(b.product_name), "ko") : a.confidence === "없음" ? -1 : 1)), [data, filter]);
  const counts = useMemo(() => ({
    확실: data.map.filter((r) => r.confidence === "확실").length,
    추정: data.map.filter((r) => r.confidence === "추정").length,
    없음: data.map.filter((r) => r.confidence === "없음").length,
    확인: data.map.filter((r) => r.confirmed).length,
  }), [data]);

  const save = async (row: MapRow, patch: Partial<MapRow>) => {
    setStatus(await postInventory("map", { ...row, ...patch }));
    setEdit(null);
    onSaved();
  };

  return (
    <Card><CardContent className="p-4 space-y-4" data-tour="settings-inventory-map">
      <div>
        <h3 className="font-semibold">매칭표 확인 (위킵 SKU → 기본 품목)</h3>
        <p className="text-xs text-muted-foreground mt-1">
          위킵은 낱개(기본 품목) 단위로 재고를 세고, 판매는 「냠 2개」 같은 묶음으로 팔립니다. 이 표가 위킵 SKU 를 판매 구성표의 기본 품목에 잇습니다.
          자동 짝짓기 결과 확실 {counts.확실} · 추정 {counts.추정} · 없음 {counts.없음}, 사람이 확인한 줄 {counts.확인}.
          기본 품목이 맞으면 「확인」, 틀리면 「고치기」로 바꾼 뒤 저장, 부자재·판촉물처럼 판정이 필요 없으면 「판정 제외」를 누르세요.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" onClick={() => setFilter(f.key)} aria-pressed={filter === f.key}
            className={`px-2.5 py-0.5 rounded-full border text-xs ${filter === f.key ? "bg-foreground text-background" : "bg-card text-muted-foreground"}`}>{f.label}</button>
        ))}
        <span className="text-xs text-muted-foreground ml-1">{rows.length}줄</span>
        <StatusBadge status={status} />
      </div>
      <datalist id="inventory-components">{data.components.map((c) => <option key={c} value={c} />)}</datalist>
      <div className="overflow-x-auto border rounded-md max-h-[520px]">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted text-muted-foreground"><tr>
            {["위킵 상품명", "가용", "기본 품목(component)", "상품 코드", "브랜드·공급처", "짝짓기", "메모", ""].map((h) => <th key={h} className="py-1.5 px-2 text-left font-medium">{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((r) => edit?.sku_no === r.sku_no ? (
              <tr key={r.sku_no} className="border-t bg-primary/5 align-top">
                <td className="py-1.5 px-2">{r.product_name}<span className="block text-[10px] text-muted-foreground">{r.sku_no} · {r.barcode || "바코드 없음"}</span></td>
                <td className="py-1.5 px-2 num">{available.get(r.sku_no) ?? "-"}</td>
                <td className="py-1.5 px-2 min-w-[220px]"><input list="inventory-components" value={edit.component ?? ""} onChange={(e) => setEdit({ ...edit, component: e.target.value })} className={inp} /></td>
                <td className="py-1.5 px-2"><input value={edit.product_code ?? ""} onChange={(e) => setEdit({ ...edit, product_code: e.target.value })} className={inp} /></td>
                <td className="py-1.5 px-2 space-y-1">
                  <select value={edit.brand ?? "other"} onChange={(e) => setEdit({ ...edit, brand: e.target.value })} className={inp}>
                    {(["nutty", "saip", "ironpet", "other"] as InvBrand[]).map((b) => <option key={b} value={b}>{BRAND_LABEL[b]}</option>)}
                  </select>
                  <input value={edit.supplier ?? ""} onChange={(e) => setEdit({ ...edit, supplier: e.target.value })} className={inp} placeholder="공급처" />
                </td>
                <td className="py-1.5 px-2">{r.confidence}</td>
                <td className="py-1.5 px-2 min-w-[160px]"><input value={edit.note ?? ""} onChange={(e) => setEdit({ ...edit, note: e.target.value })} className={inp} /></td>
                <td className="py-1.5 px-2 whitespace-nowrap space-x-2">
                  <button type="button" className="text-primary hover:underline" onClick={() => save(r, { ...edit, confirmed: true })}>저장·확인</button>
                  <button type="button" className="text-muted-foreground hover:underline" onClick={() => setEdit(null)}>취소</button>
                </td>
              </tr>
            ) : (
              <tr key={r.sku_no} className="border-t align-top">
                <td className="py-1.5 px-2">{r.product_name}<span className="block text-[10px] text-muted-foreground">{r.sku_no} · {r.barcode || "바코드 없음"}</span></td>
                <td className="py-1.5 px-2 num">{available.get(r.sku_no) ?? "-"}</td>
                <td className="py-1.5 px-2">{r.component || <span className="text-muted-foreground">없음</span>}</td>
                <td className="py-1.5 px-2">{r.product_code || "-"}</td>
                <td className="py-1.5 px-2">{BRAND_LABEL[(r.brand as InvBrand) ?? "other"] ?? r.brand}{r.supplier ? ` · ${r.supplier}` : ""}</td>
                <td className="py-1.5 px-2 whitespace-nowrap">{r.confidence}{r.confirmed ? " · 확인함" : ""}{r.exclude ? " · 제외" : ""}</td>
                <td className="py-1.5 px-2 text-muted-foreground max-w-[280px]">{r.note}</td>
                <td className="py-1.5 px-2 whitespace-nowrap space-x-2">
                  {!r.confirmed && r.component && <button type="button" className="text-primary hover:underline" onClick={() => save(r, { confirmed: true })}>확인</button>}
                  <button type="button" className="hover:underline" onClick={() => setEdit(r)}>고치기</button>
                  <button type="button" className="text-muted-foreground hover:underline" onClick={() => save(r, { exclude: !r.exclude })}>{r.exclude ? "제외 풀기" : "판정 제외"}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CardContent></Card>
  );
}
