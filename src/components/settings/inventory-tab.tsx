"use client";

// 설정 > 재고 탭 (2026-11-10). 재고 화면(/inventory)이 쓰는 손 입력 값.
//   손 입력 재고(쿠팡 로켓그로스·이동 중·내부) · 발주 · 판매 중지 메모 · 판정 기준 일수 · 매칭표 확인
// 읽기·쓰기: /api/inventory-settings. 표가 없으면(SQL 실행 전) 저장이 「SQL 실행 전」으로 막힌다.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { freshFetch } from "@/lib/fresh-fetch";
import { kstDate } from "@/lib/date";
import { StatusBadge } from "@/components/settings/shared";
import { LOCATION_LABEL, BRAND_LABEL, parseWekeepName, type InvBrand } from "@/lib/inventory";
import { InventoryMapReview, type MapRow } from "./inventory-map-tab";

const API = "/api/inventory-settings";
const inp = "w-full mt-1 px-2 py-1.5 rounded-md border bg-background text-sm";
const btn = "px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50";

interface Sku { sku_no: string; name: string; available: number; date: string }
interface StockRow { sku_no: string; location: string; as_of: string; qty: number; note: string | null }
interface OrderRow { id: number; sku_no: string; qty: number; ordered_at: string; expected_at: string | null; status: string; note: string | null }
interface NoteRow { sku_no: string; kind: string; note: string | null; exclude: boolean }
interface RuleRow { scope_kind: string; scope_key: string; warn_days: number; soon_days: number; over_days: number }
interface CostRow { cost_key: string; sku_no: string | null; product_name: string; cost: number; source: string | null; note: string | null }
export interface InventorySettingsData {
  mode: "db" | "dev-files";
  missing: string[];
  skus: Sku[];
  map: MapRow[];
  stocks: StockRow[];
  orders: OrderRow[];
  notes: NoteRow[];
  rules: RuleRow[];
  costs: CostRow[];
  defaults: Record<string, { warn: number; soon: number; over: number }>;
  components: string[];
}

const SUBTABS = [
  { key: "stock", label: "쿠팡·이동·내부 재고" },
  { key: "order", label: "발주" },
  { key: "note", label: "판매 중지 메모" },
  { key: "rule", label: "판정 기준 일수" },
  { key: "cost", label: "원가" },
  { key: "map", label: "매칭표 확인" },
] as const;
type Sub = (typeof SUBTABS)[number]["key"];
const ORDER_STATUS: Record<string, string> = { ordered: "입고 대기", received: "입고 완료", cancelled: "취소" };
const NOTE_KIND: Record<string, string> = { stopped: "판매 중지", discontinued: "단종", memo: "메모" };

export async function postInventory(type: string, data: Record<string, unknown>): Promise<string> {
  const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, data }) });
  const json = await res.json().catch(() => ({}));
  return res.ok ? "✅ 저장 완료" : `❌ ${json.error || "저장 실패"}`;
}

export function InventoryTab() {
  const [sub, setSub] = useState<Sub>("stock");
  const [data, setData] = useState<InventorySettingsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const res = await freshFetch(API);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || String(res.status));
      setData(json);
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const nameOf = useMemo(() => new Map((data?.skus ?? []).map((s) => [s.sku_no, s.name])), [data]);

  return (
    <div className="space-y-4" data-tour="settings-inventory">
      <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1 w-fit">
        {SUBTABS.map((s) => (
          <button key={s.key} type="button" onClick={() => setSub(s.key)} aria-pressed={sub === s.key}
            className={`px-3 py-1 rounded-md text-sm ${sub === s.key ? "bg-card shadow-sm" : "text-muted-foreground"}`}>{s.label}</button>
        ))}
      </div>
      {error && <p className="text-sm text-red-500">재고 설정을 읽지 못했습니다: {error}</p>}
      {data && data.missing.length > 0 && (
        <p className="text-xs rounded-md p-2 bg-amber-500/10 text-amber-700 dark:text-amber-400">
          아직 없는 표: {data.missing.join(", ")}. docs/sql/2026-11-10-inventory.sql 실행 전이라 저장이 막힙니다.
          {data.mode === "dev-files" ? " (개발용: SKU 목록·매칭표는 볼트 원천 파일에서 읽음)" : ""}
        </p>
      )}
      {!data && !error && <div className="h-32 rounded-xl border bg-muted/30 animate-pulse" />}
      {data && sub === "stock" && <StockPanel data={data} nameOf={nameOf} onSaved={load} />}
      {data && sub === "order" && <OrderPanel data={data} nameOf={nameOf} onSaved={load} />}
      {data && sub === "note" && <NotePanel data={data} nameOf={nameOf} onSaved={load} />}
      {data && sub === "rule" && <RulePanel data={data} onSaved={load} />}
      {data && sub === "cost" && <CostPanel data={data} onSaved={load} />}
      {data && sub === "map" && <InventoryMapReview data={data} onSaved={load} />}
    </div>
  );
}

function SkuSelect({ skus, value, onChange, filter }: { skus: Sku[]; value: string; onChange: (v: string) => void; filter?: (s: Sku) => boolean }) {
  const list = [...skus].filter((s) => !filter || filter(s)).sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inp}>
      <option value="">SKU 고르기 ({list.length}개)</option>
      {list.map((s) => <option key={s.sku_no} value={s.sku_no}>{s.name} · 위킵 {s.available}</option>)}
    </select>
  );
}

async function del(params: Record<string, string>, onSaved: () => void) {
  if (!confirm("지울까요?")) return;
  const res = await fetch(`${API}?${new URLSearchParams(params)}`, { method: "DELETE" });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    alert(`지우지 못했습니다: ${json.error || res.status}`);
  }
  onSaved();
}

/** 원가 (재고 가치 = 원가 × 재고). 시트 「2026 재고·출고 통합관리」 원가가 정본이었고, 시트 은퇴 뒤에는 여기서 고친다 */
function CostPanel({ data, onSaved }: { data: InventorySettingsData; onSaved: () => void }) {
  const [f, setF] = useState({ sku_no: "", cost: "", note: "" });
  const [status, setStatus] = useState<string | null>(null);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const costBySku = useMemo(() => new Map(data.costs.filter((c) => c.sku_no).map((c) => [c.sku_no as string, c])), [data]);
  const nameOf = (sku: string) => data.skus.find((s) => s.sku_no === sku)?.name || sku;
  const save = async () => {
    setStatus(await postInventory("cost", { sku_no: f.sku_no, cost: Number(f.cost), note: f.note, product_name: nameOf(f.sku_no) }));
    setF({ sku_no: "", cost: "", note: "" });
    onSaved();
  };
  const missingSkus = data.skus.filter((s) => !costBySku.has(s.sku_no));
  const rows = onlyMissing
    ? missingSkus.map((s) => [s.name, "-", "원가 없음", "", String(s.available),
      <button key="e" type="button" className="text-xs text-primary hover:underline" onClick={() => setF({ sku_no: s.sku_no, cost: "", note: "" })}>넣기</button>])
    : data.costs.map((c) => [c.product_name, c.cost.toLocaleString("ko-KR") + "원", c.source || "", c.note || "", c.sku_no ? "위킵 SKU" : "위킵에 없음",
      <span key="a" className="space-x-2 whitespace-nowrap">
        {c.sku_no && <button type="button" className="text-xs text-primary hover:underline" onClick={() => setF({ sku_no: c.sku_no as string, cost: String(c.cost), note: c.note || "" })}>고치기</button>}
        <button type="button" className="text-xs text-red-500 hover:underline" onClick={() => del({ type: "cost", cost_key: c.cost_key }, onSaved)}>삭제</button>
      </span>]);
  return (
    <Card><CardContent className="p-4 space-y-4">
      <div>
        <h3 className="font-semibold">원가</h3>
        <p className="text-xs text-muted-foreground mt-1">재고 화면의 <b>재고 가치 = 원가 × 재고</b> 에 쓰는 값입니다. 처음 값은 시트 「2026 재고·출고 통합관리」 각 탭 원가 칸(사입 R열 · 너티 P열 · 닥터레이 C열 공급가)에서 가져왔고, 출처 칸에 읽은 칸이 적혀 있습니다. 여기 없는 상품은 재고 화면에서 「원가 없음」이고 합계에서 빠집니다. 설정 &gt; 제품 원가 탭의 값은 쓰지 않습니다.</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="col-span-2"><label className="text-xs text-muted-foreground">위킵 SKU</label><SkuSelect skus={data.skus} value={f.sku_no} onChange={(v) => setF({ ...f, sku_no: v, cost: costBySku.get(v) ? String(costBySku.get(v)?.cost) : f.cost })} /></div>
        <div><label className="text-xs text-muted-foreground">원가(원, 낱개 1개)</label><input type="number" min={1} value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} className={inp} /></div>
        <div className="col-span-2"><label className="text-xs text-muted-foreground">메모</label><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} className={inp} placeholder="예: 11월 매입가 인상" /></div>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={!f.sku_no || !(Number(f.cost) > 0)} className={btn}>저장</button><StatusBadge status={status} />
        <label className="ml-auto text-xs flex items-center gap-1.5"><input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} /> 원가 없는 위킵 SKU 만 보기 ({missingSkus.length})</label>
      </div>
      <SimpleTable head={onlyMissing ? ["위킵 상품", "원가", "", "", "위킵 재고", ""] : ["상품", "원가", "출처", "메모", "구분", ""]} rows={rows} />
    </CardContent></Card>
  );
}

function StockPanel({ data, nameOf, onSaved }: { data: InventorySettingsData; nameOf: Map<string, string>; onSaved: () => void }) {
  const [f, setF] = useState({ sku_no: "", location: "coupang", as_of: kstDate(), qty: "", note: "" });
  const [status, setStatus] = useState<string | null>(null);
  const save = async () => { setStatus(await postInventory("stock", { ...f, qty: Number(f.qty) })); onSaved(); };
  return (
    <Card><CardContent className="p-4 space-y-4">
      <div>
        <h3 className="font-semibold">위킵 밖 재고</h3>
        <p className="text-xs text-muted-foreground mt-1">쿠팡 로켓그로스 창고·이동 중·사무실(내부) 재고를 기준일과 함께 적습니다. 화면은 SKU·위치마다 <b>가장 최근 기준일</b> 값을 씁니다. 적지 않은 칸은 0 이 아니라 「미입력」으로 보입니다. 쿠팡 재고는 너티만 판정에 따로 쓰고(쿠팡 판매 속도로 나눔), 이동·내부는 위킵 재고에 더해 계산합니다.</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="col-span-2"><label className="text-xs text-muted-foreground">SKU</label><SkuSelect skus={data.skus} value={f.sku_no} onChange={(v) => setF({ ...f, sku_no: v })} /></div>
        <div><label className="text-xs text-muted-foreground">위치</label>
          <select value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} className={inp}>
            {Object.entries(LOCATION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
        <div><label className="text-xs text-muted-foreground">기준일</label><input type="date" value={f.as_of} onChange={(e) => setF({ ...f, as_of: e.target.value })} className={inp} /></div>
        <div><label className="text-xs text-muted-foreground">수량(낱개)</label><input type="number" min={0} value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} className={inp} /></div>
      </div>
      <div className="flex items-center gap-3"><input placeholder="메모(선택)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} className={`${inp} mt-0 max-w-md`} />
        <button type="button" onClick={save} disabled={!f.sku_no || f.qty === ""} className={btn}>저장</button><StatusBadge status={status} /></div>
      <SimpleTable head={["SKU", "위치", "기준일", "수량", "메모", ""]} rows={data.stocks.map((s) => [
        nameOf.get(s.sku_no) || s.sku_no, LOCATION_LABEL[s.location as keyof typeof LOCATION_LABEL] || s.location, s.as_of, String(s.qty), s.note || "",
        <button key="d" type="button" className="text-xs text-red-500 hover:underline" onClick={() => del({ type: "stock", sku_no: s.sku_no, location: s.location, as_of: s.as_of }, onSaved)}>삭제</button>,
      ])} />
    </CardContent></Card>
  );
}

function OrderPanel({ data, nameOf, onSaved }: { data: InventorySettingsData; nameOf: Map<string, string>; onSaved: () => void }) {
  const [f, setF] = useState({ sku_no: "", qty: "", ordered_at: kstDate(), expected_at: "", note: "" });
  const [status, setStatus] = useState<string | null>(null);
  const save = async () => { setStatus(await postInventory("order", { ...f, qty: Number(f.qty), status: "ordered" })); onSaved(); };
  const setOrderStatus = async (o: OrderRow, st: string) => { setStatus(await postInventory("order", { ...o, status: st })); onSaved(); };
  return (
    <Card><CardContent className="p-4 space-y-4">
      <div>
        <h3 className="font-semibold">발주</h3>
        <p className="text-xs text-muted-foreground mt-1">발주를 넣으면 그 상품은 재고 화면에서 「발주 필요」·「곧 발주」·「품절」 대신 파란 <b>「입고 대기」</b>로 바뀌고, 남은 날 막대에 입고 예정일이 마름모로 찍힙니다. 물건이 들어오면 「입고 완료」를 눌러 주세요(위킵 재고에 잡히면 다시 원래 판정으로 돌아갑니다).</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="col-span-2"><label className="text-xs text-muted-foreground">SKU</label><SkuSelect skus={data.skus} value={f.sku_no} onChange={(v) => setF({ ...f, sku_no: v })} /></div>
        <div><label className="text-xs text-muted-foreground">수량</label><input type="number" min={1} value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} className={inp} /></div>
        <div><label className="text-xs text-muted-foreground">발주일</label><input type="date" value={f.ordered_at} onChange={(e) => setF({ ...f, ordered_at: e.target.value })} className={inp} /></div>
        <div><label className="text-xs text-muted-foreground">입고 예정일</label><input type="date" value={f.expected_at} onChange={(e) => setF({ ...f, expected_at: e.target.value })} className={inp} /></div>
      </div>
      <div className="flex items-center gap-3"><input placeholder="메모(선택)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} className={`${inp} mt-0 max-w-md`} />
        <button type="button" onClick={save} disabled={!f.sku_no || !f.qty} className={btn}>발주 넣기</button><StatusBadge status={status} /></div>
      <SimpleTable head={["SKU", "수량", "발주일", "입고 예정", "상태", ""]} rows={data.orders.map((o) => [
        nameOf.get(o.sku_no) || o.sku_no, String(o.qty), o.ordered_at, o.expected_at || "-", ORDER_STATUS[o.status] || o.status,
        <span key="a" className="space-x-2 whitespace-nowrap">
          {o.status === "ordered" && <button type="button" className="text-xs text-primary hover:underline" onClick={() => setOrderStatus(o, "received")}>입고 완료</button>}
          {o.status === "ordered" && <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setOrderStatus(o, "cancelled")}>취소</button>}
          <button type="button" className="text-xs text-red-500 hover:underline" onClick={() => del({ type: "order", id: String(o.id) }, onSaved)}>삭제</button>
        </span>,
      ])} />
    </CardContent></Card>
  );
}

function NotePanel({ data, nameOf, onSaved }: { data: InventorySettingsData; nameOf: Map<string, string>; onSaved: () => void }) {
  const [f, setF] = useState({ sku_no: "", kind: "stopped", note: "", exclude: true });
  const [status, setStatus] = useState<string | null>(null);
  const save = async () => { setStatus(await postInventory("note", f)); onSaved(); };
  return (
    <Card><CardContent className="p-4 space-y-4">
      <div>
        <h3 className="font-semibold">판매 중지·단종 메모</h3>
        <p className="text-xs text-muted-foreground mt-1">시트에서 손으로 덮어쓰던 것입니다. 「판정에서 빼기」를 켜면 재고 화면 ⑤ 판정 제외 묶음으로 가서 품절·발주 필요 개수에 안 들어갑니다. 끄면 메모만 상품 이름 아래에 붙습니다.</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 items-end">
        <div className="col-span-2"><label className="text-xs text-muted-foreground">SKU</label><SkuSelect skus={data.skus} value={f.sku_no} onChange={(v) => setF({ ...f, sku_no: v })} /></div>
        <div><label className="text-xs text-muted-foreground">종류</label>
          <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} className={inp}>
            {Object.entries(NOTE_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
        <div className="col-span-2"><label className="text-xs text-muted-foreground">메모</label><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} className={inp} placeholder="예: 12월 단종 예정" /></div>
      </div>
      <div className="flex items-center gap-3">
        <label className="text-sm flex items-center gap-1.5"><input type="checkbox" checked={f.exclude} onChange={(e) => setF({ ...f, exclude: e.target.checked })} /> 판정에서 빼기</label>
        <button type="button" onClick={save} disabled={!f.sku_no} className={btn}>저장</button><StatusBadge status={status} /></div>
      <SimpleTable head={["SKU", "종류", "메모", "판정", ""]} rows={data.notes.map((n) => [
        nameOf.get(n.sku_no) || n.sku_no, NOTE_KIND[n.kind] || n.kind, n.note || "", n.exclude ? "제외" : "판정함",
        <button key="d" type="button" className="text-xs text-red-500 hover:underline" onClick={() => del({ type: "note", sku_no: n.sku_no }, onSaved)}>삭제</button>,
      ])} />
    </CardContent></Card>
  );
}

function RulePanel({ data, onSaved }: { data: InventorySettingsData; onSaved: () => void }) {
  const [f, setF] = useState({ scope_kind: "brand", scope_key: "saip", warn_days: "15", soon_days: "30", over_days: "60" });
  const [status, setStatus] = useState<string | null>(null);
  const suppliers = useMemo(() => [...new Set(data.skus.map((s) => parseWekeepName(s.name).supplier).filter((x): x is string => !!x))].sort(), [data]);
  const save = async () => {
    setStatus(await postInventory("rule", { ...f, warn_days: Number(f.warn_days), soon_days: Number(f.soon_days), over_days: Number(f.over_days) }));
    onSaved();
  };
  const scopeName = (r: RuleRow) => (r.scope_kind === "brand" ? `브랜드 ${BRAND_LABEL[r.scope_key as InvBrand] || r.scope_key}` : `공급처 ${r.scope_key}`);
  return (
    <Card><CardContent className="p-4 space-y-4">
      <div>
        <h3 className="font-semibold">판정 기준 일수</h3>
        <p className="text-xs text-muted-foreground mt-1">남은 날이 <b>발주 필요</b> 일수 이하면 주황, <b>곧 발주</b> 이하면 노랑, <b>과재고</b> 일수를 넘으면 회색입니다. 공급처 줄이 있으면 그것을, 없으면 브랜드 줄을, 둘 다 없으면 기본값(사입 {data.defaults.saip?.warn} · 너티 {data.defaults.nutty?.warn} · 곧 발주 {data.defaults.saip?.soon} · 과재고 {data.defaults.saip?.over})을 씁니다. 발주 후 입고까지 오래 걸리는 공급처는 발주 필요 일수를 길게 잡으세요.</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div><label className="text-xs text-muted-foreground">범위</label>
          <select value={f.scope_kind} onChange={(e) => setF({ ...f, scope_kind: e.target.value, scope_key: e.target.value === "brand" ? "saip" : suppliers[0] || "" })} className={inp}>
            <option value="brand">브랜드</option><option value="supplier">공급처</option>
          </select></div>
        <div><label className="text-xs text-muted-foreground">대상</label>
          <select value={f.scope_key} onChange={(e) => setF({ ...f, scope_key: e.target.value })} className={inp}>
            {f.scope_kind === "brand"
              ? (["saip", "nutty", "ironpet", "other"] as InvBrand[]).map((b) => <option key={b} value={b}>{BRAND_LABEL[b]}</option>)
              : suppliers.map((s) => <option key={s} value={s}>{s}</option>)}
          </select></div>
        <div><label className="text-xs text-muted-foreground">발주 필요 ≤ (일)</label><input type="number" min={0} value={f.warn_days} onChange={(e) => setF({ ...f, warn_days: e.target.value })} className={inp} /></div>
        <div><label className="text-xs text-muted-foreground">곧 발주 ≤ (일)</label><input type="number" min={0} value={f.soon_days} onChange={(e) => setF({ ...f, soon_days: e.target.value })} className={inp} /></div>
        <div><label className="text-xs text-muted-foreground">과재고 &gt; (일)</label><input type="number" min={1} value={f.over_days} onChange={(e) => setF({ ...f, over_days: e.target.value })} className={inp} /></div>
      </div>
      <div className="flex items-center gap-3"><button type="button" onClick={save} className={btn}>저장</button><StatusBadge status={status} /></div>
      <SimpleTable head={["범위", "발주 필요 ≤", "곧 발주 ≤", "과재고 >", ""]} rows={data.rules.map((r) => [
        scopeName(r), `${r.warn_days}일`, `${r.soon_days}일`, `${r.over_days}일`,
        <button key="d" type="button" className="text-xs text-red-500 hover:underline" onClick={() => del({ type: "rule", scope_kind: r.scope_kind, scope_key: r.scope_key }, onSaved)}>삭제</button>,
      ])} />
    </CardContent></Card>
  );
}

export function SimpleTable({ head, rows }: { head: string[]; rows: (string | React.ReactNode)[][] }) {
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">아직 입력한 줄이 없습니다.</p>;
  return (
    <div className="overflow-x-auto max-h-80 border rounded-md">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-muted"><tr>{head.map((h, i) => <th key={i} className="py-1.5 px-2 text-left font-medium text-muted-foreground">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t">{r.map((c, j) => <td key={j} className="py-1.5 px-2">{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
