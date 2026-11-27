"use client";

// 「쿠팡 옵션별」 보기 (2026-11-27 김호 "쿠팡 재고는 여러 개 세트별로 SKU 가 다르게 잡힌다. SKU 별 재고가 별도다").
//   쿠팡은 세트 옵션(vendorItemId)마다 따로 입고하고 품절도 옵션별로 난다. 제품별 표는 세트를 낱개로 합쳐 어느 세트가 먼저 떨어지는지 안 보여서,
//   같은 자리에서 보기만 바꿔 옵션 하나에 한 줄을 보인다(새 그래프·표 추가 없음, 김호 "표 한 장 + 막대 + 누르면 상세").
// 계산(남은 날·상태·입고 건 정리·정렬)은 전부 src/lib/inventory.ts. 여기는 그리기만 한다. 상세 패널 옵션 표도 아래 칸 부품을 같이 쓴다.
import { useMemo, useState } from "react";
import {
  RG_OPTION_SOON_DAYS, RG_OPTION_STATUS_LABEL, rgHealthLabel,
  type CoupangOptionRow, type RgOption, type RgOptionStatus, type RgPendingInbound,
} from "@/lib/inventory";
import { OptionRunwayBar, RunwayAxis } from "./runway-bar";
import { STATUS_TONE, fmtInt, md, type InventoryResponse, type Tone } from "./inventory-ui";

type Ready = Exclude<InventoryResponse, { setupNeeded: true }>;

/** 옵션 상태 색: 품절 빨강 · 품절임박 주황(발주 필요와 같은 경고색) · 정상 무채색 · 판매중지 흐리게 */
export const RG_OPTION_TONE: Record<RgOptionStatus, Tone> = {
  soldout: STATUS_TONE.soldout,
  soon: STATUS_TONE.order,
  ok: STATUS_TONE.ok,
  suspended: STATUS_TONE.excluded,
};

export function RgStatusBadge({ status }: { status: RgOptionStatus | undefined }) {
  if (!status) return <span className="text-muted-foreground">-</span>;
  const t = RG_OPTION_TONE[status];
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium whitespace-nowrap border"
      style={{ color: t.color, background: t.surface, borderColor: t.border === "transparent" ? "var(--border)" : t.border }}>
      {RG_OPTION_STATUS_LABEL[status]}
    </span>
  );
}

/** 쿠팡이 매긴 판정(재고 건강도) + 쿠팡 남은 날(daysOfCover) */
export function RgHealthCell({ o }: { o: Pick<RgOption, "health_group" | "days_of_cover"> }) {
  const label = rgHealthLabel(o.health_group);
  const warn = o.health_group === "ALMOST_OUT_OF_STOCK" || o.health_group === "OUT_OF_STOCK";
  return (
    <span className="whitespace-nowrap">
      <span style={warn ? { color: o.health_group === "OUT_OF_STOCK" ? "var(--sig-danger)" : STATUS_TONE.order.color } : undefined}>{label ?? "정상"}</span>
      {o.days_of_cover !== null && o.days_of_cover !== undefined && <span className="block text-[10px] text-muted-foreground">쿠팡 {o.days_of_cover}일</span>}
    </span>
  );
}

/** 입고 예정 건: 「20세트 12-05」, 요청만이면 「요청만(위킵 미출고)」, 예정일 지났으면 경고색 「예정일 지남」 */
export function RgInboundCell({ inbounds }: { inbounds: readonly RgPendingInbound[] | undefined }) {
  if (!inbounds?.length) return <span className="text-muted-foreground">-</span>;
  return (
    <span className="block space-y-0.5">
      {inbounds.map((x, i) => (
        <span key={`${x.shipment_id ?? "x"}-${i}`} className="block whitespace-nowrap"
          style={x.late ? { color: "var(--sig-warn)" } : undefined}
          title={`쿠팡 입고 건 ${x.shipment_id ?? "-"} · 상태 ${x.status}${x.shipped ? "" : " · 쿠팡에 요청만 하고 위킵에서 아직 안 나감(위킵 가용에 들어 있어 쿠팡 쪽에 안 셈)"}`}>
          {fmtInt(x.qty)}세트 {x.expected ? md(x.expected) : "예정일 없음"}
          {!x.shipped && <span className="text-muted-foreground"> · 요청만(위킵 미출고)</span>}
          {x.late && <span className="font-medium"> · 예정일 지남</span>}
        </span>
      ))}
    </span>
  );
}

/** 판매 가능: 세트 수, 괄호 안 낱개(묶음 수를 하나로 알 때만) */
export const setUnits = (n: number | null, qty: number | null) =>
  n === null ? "-" : qty && qty > 1 ? `${fmtInt(n)} (${fmtInt(n * qty)})` : fmtInt(n);

const HEAD = ["제품", "옵션", "묶음", "판매 가능", "남은 날", "상태", "쿠팡 판정", "7일 / 30일 판매", "입고 예정"];

export function CoupangOptionTable({ data, tabKey }: { data: Ready; tabKey: string }) {
  const [showSuspended, setShowSuspended] = useState(false);
  const all = useMemo(() => data.coupang_options ?? [], [data]);
  const list = useMemo(() => (showSuspended ? all : all.filter((o) => o.status !== "suspended")), [all, showSuspended]);
  const rg = data.coupang_rg;

  if (tabKey !== "all" && tabKey !== "nutty") {
    return <Notice>쿠팡 로켓그로스 옵션은 너티만 있습니다. 브랜드 탭을 「전체」나 「너티」로 바꾸면 보입니다.</Notice>;
  }
  if (!data.coupang_options) {
    return (
      <Notice>
        {rg ? "쿠팡 옵션 목록이 없는 옛 응답입니다. 위 「새로 읽기」를 누르세요." : "쿠팡 로켓그로스 재고 원천이 없어 옵션별로 볼 수 없습니다."}
        {data.coupang_rg_error ? ` (${data.coupang_rg_error})` : ""}
      </Notice>
    );
  }
  const suspended = all.filter((o) => o.status === "suspended").length;
  const soldout = all.filter((o) => o.status === "soldout" && !o.no_sales_30d).length;
  const soon = all.filter((o) => o.status === "soon").length;

  return (
    <section data-tour="inventory-coupang-option-table" className="rounded-xl border bg-card overflow-hidden">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 sm:px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            쿠팡 로켓그로스 옵션별 <span className="num font-normal text-muted-foreground">{list.length}</span>
            <span className="ml-2 text-xs font-normal">
              <span style={{ color: RG_OPTION_TONE.soldout.color }}>품절 {soldout}</span>
              <span className="text-muted-foreground"> · </span>
              <span style={{ color: RG_OPTION_TONE.soon.color }}>품절임박 {soon}</span>
            </span>
          </p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {rg ? `${rg.date} WING 재고현황 기준` : ""}{rg && !rg.fresh ? <span style={{ color: "var(--sig-warn)" }}> (오래됨: 제품별 판정에는 안 씀)</span> : null}.
            한 줄 = 쿠팡 옵션(세트) 하나. 수량은 세트, 괄호 안은 낱개. 남은 날 = 판매 가능 ÷ (최근 30일 판매 ÷ 30).
            품절임박 = 쿠팡이 품절임박으로 판정했거나 남은 날 ≤ {RG_OPTION_SOON_DAYS}일. 입고 예정은 남은 날에 안 넣습니다.
            품절 개수는 최근 30일 판매가 있던 옵션만 셉니다(오래 안 판 등록은 흐리게).
          </p>
        </div>
        {suspended > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
            <input type="checkbox" checked={showSuspended} onChange={(e) => setShowSuspended(e.target.checked)} />
            판매중지 포함 <span className="num">({suspended})</span>
          </label>
        )}
      </div>
      <div className="overflow-x-auto border-t">
        <table className="w-full min-w-[1080px] text-xs num">
          <thead className="bg-muted/40 text-[11px] text-muted-foreground">
            <tr>
              {HEAD.map((h) => (
                <th key={h} className={`px-2 py-1.5 font-medium whitespace-nowrap align-bottom ${h === "제품" || h === "옵션" || h === "상태" || h === "쿠팡 판정" || h === "입고 예정" ? "text-left" : "text-right"} ${h === "남은 날" ? "w-[220px]" : ""}`}>
                  {h === "남은 날" ? <><span className="block text-left">남은 날 (30일 속도)</span><RunwayAxis /></> : h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((o) => <OptionRow key={o.vendor_item_id} o={o} />)}
            {list.length === 0 && (
              <tr><td colSpan={HEAD.length} className="px-4 py-3 text-muted-foreground">판매 중인 쿠팡 옵션이 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function OptionRow({ o }: { o: CoupangOptionRow }) {
  const dim = o.status === "suspended" || (o.status === "soldout" && o.no_sales_30d);
  return (
    <tr className={`border-t align-top ${dim ? "text-muted-foreground" : ""}`}>
      <td className="px-2 py-1.5 text-left max-w-[180px]">
        {o.unmapped ? (
          <span style={{ color: "var(--sig-warn)" }} title="짝짓기 표에 없는 옵션이라 제품별 표의 쿠팡 재고에서 빠져 있습니다">짝 없음</span>
        ) : (
          o.products.map((p) => <span key={p.sku_no} className="block truncate" title={`위킵 SKU ${p.sku_no}`}>{p.name}{o.products.length > 1 ? ` ×${p.qty}` : ""}</span>)
        )}
        {o.needs_review && <span className="block text-[10px]" style={{ color: "var(--sig-warn)" }} title="이름으로 추정한 짝. 볼트 짝짓기 초안에서 확인">짝 확인 필요</span>}
      </td>
      <td className="px-2 py-1.5 text-left min-w-[220px]">
        <span className="block">{o.name}</span>
        <span className="block text-[10px] text-muted-foreground">옵션 {o.vendor_item_id}</span>
      </td>
      <td className="px-2 py-1.5 text-right whitespace-nowrap">{o.qty ? `×${o.qty}` : o.products.length > 1 ? "1+1" : "-"}</td>
      <td className="px-2 py-1.5 text-right whitespace-nowrap">{setUnits(o.orderable, o.qty)}</td>
      <td className="px-2 py-1.5"><OptionRunwayBar days={o.runway} status={o.status} /></td>
      <td className="px-2 py-1.5 text-left">
        <RgStatusBadge status={o.status} />
        {o.status === "soldout" && o.no_sales_30d && <span className="block text-[10px] whitespace-nowrap">30일 판매 없음</span>}
      </td>
      <td className="px-2 py-1.5 text-left"><RgHealthCell o={o} /></td>
      <td className="px-2 py-1.5 text-right whitespace-nowrap">{o.sales_7d === null ? "-" : fmtInt(o.sales_7d)} / {o.sales_30d === null ? "-" : fmtInt(o.sales_30d)}</td>
      <td className="px-2 py-1.5 text-left"><RgInboundCell inbounds={o.inbounds} /></td>
    </tr>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border bg-card px-4 py-6 text-sm text-muted-foreground">{children}</div>;
}
