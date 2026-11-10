"use client";

// 재고 화면 (/inventory) 2026-11-10. 기획: 볼트 Work/PPMI/projects/마케팅-대시보드/재고-화면-기획-2026-11-10.md 「시각화 확정안 v2」.
//   표 한 장 + 행마다 같은 축(0~120일)의 남은 날 막대 + 행을 누르면 그 상품 하나의 상세 그래프.
//   묶음: ① 지금 손댈 것(펼침) ② 정상(접힘) ③ 과재고(재고 가치 순) ④ 출고 0(재고 가치 순) ⑤ 판정 제외(접힘)
// 계산은 전부 src/lib/inventory.ts. 이 파일은 고르고 그리기만 한다. 문구를 바꾸면 src/lib/guides/screens/inventory.ts 도 고친다.
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { freshFetch } from "@/lib/fresh-fetch";
import { kstDate } from "@/lib/date";
import {
  BRAND_LABEL, SPEED_WINDOWS, STATUS_LABEL, buildCards, addDays,
  type InvBrand, type InvGroup, type InventoryRow, type InvStatus, type SpeedWindow,
} from "@/lib/inventory";
import { RunwayAxis, RunwayBar } from "./runway-bar";
import { InventoryDetail } from "./inventory-detail";
import { GROUPS, STATUS_TONE, fmtInt, fmtManWon, fmtSpeed, fmtWon, md, type InventoryResponse } from "./inventory-ui";

type BrandTab = "all" | "nutty" | "saip" | "other";
const BRAND_TABS: { key: BrandTab; label: string }[] = [
  { key: "all", label: "전체" }, { key: "nutty", label: "너티" }, { key: "saip", label: "사입" }, { key: "other", label: "아이언펫·기타" },
];
/** 오래 품절: 재고 0 이고 기간 안 출고도 0. 단종·장기 결품일 가능성이 커 ① 안에서 접어 둔다 */
const isDormant = (r: InventoryRow) => r.status === "soldout" && r.speed.total === 0 && (r.coupang_per_day ?? 0) === 0;
const inTab = (r: InventoryRow, tab: BrandTab) => tab === "all" || (tab === "other" ? r.brand === "ironpet" || r.brand === "other" : r.brand === tab);

/** 데스크톱 표 칸 너비 (머리줄과 행이 같은 값을 쓴다) */
const COLS = "md:grid-cols-[minmax(0,1.5fr)_56px_56px_64px_84px_72px_minmax(220px,2.3fr)_46px_74px_88px]";

export function InventoryScreen() {
  const [windowDays, setWindowDays] = useState<SpeedWindow>(28);
  const [data, setData] = useState<InventoryResponse | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<BrandTab>("all");
  const [supplier, setSupplier] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<InvGroup, boolean>>(() => Object.fromEntries(GROUPS.map((g) => [g.key, g.open])) as Record<InvGroup, boolean>);
  const [selected, setSelected] = useState<string | null>(null);
  // 품절 중 최근 기간 출고도 0 인 것(오래 품절)은 ① 안에서 접어 둔다. 판정은 그대로 품절
  const [showDormant, setShowDormant] = useState(false);

  const load = useCallback(async (fresh: boolean) => {
    setLoading(true);
    setFailed(null);
    try {
      const url = `/api/inventory?window=${windowDays}`;
      const res = await (fresh ? freshFetch(url) : fetch(url));
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || json.error || String(res.status));
      setData(json as InventoryResponse);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [windowDays]);
  useEffect(() => { load(false); }, [load]);

  const ready = data && !data.setupNeeded ? data : null;
  const rows = useMemo(() => (ready ? ready.rows.filter((r) => inTab(r, tab) && (!supplier || r.supplier === supplier)) : []), [ready, tab, supplier]);
  const cards = useMemo(() => buildCards(rows), [rows]);
  const suppliers = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of ready?.rows ?? []) if (r.brand === "saip" && r.supplier) m.set(r.supplier, (m.get(r.supplier) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [ready]);

  return (
    <div className="space-y-4">
      {data?.mode === "dev-files" && (
        <div className="rounded-lg border px-3 py-2 text-xs" style={{ background: "var(--sig-warn-surface)", borderColor: "var(--sig-warn-border)", color: "var(--sig-warn)" }}>
          개발용 원천 파일로 그린 화면입니다(볼트 위킵 원천 json). 운영 화면에서는 이 띠가 안 보이고 DB 표를 읽습니다.
        </div>
      )}
      {failed && (
        <div className="rounded-lg border p-3 text-sm" style={{ background: "var(--sig-danger-surface)", borderColor: "var(--sig-danger-border)", color: "var(--sig-danger)" }}>
          재고를 읽지 못했습니다. 못 읽은 것은 재고 0 이 아닙니다. ({failed})
          <button type="button" onClick={() => load(true)} className="ml-2 underline underline-offset-2">다시 읽기</button>
        </div>
      )}
      {data?.setupNeeded && <SetupNotice missing={data.missing} />}
      {!data && !failed && <div className="h-40 rounded-xl border bg-muted/30 animate-pulse" />}

      {ready && (
        <>
          <Freshness data={ready} loading={loading} onRefresh={() => load(true)} />

          <section data-tour="inventory-cards" className="grid grid-cols-2 lg:grid-cols-5 gap-2 sm:gap-3">
            <CountCard status="soldout" n={cards.counts.soldout} sub="위킵·쿠팡·이동·내부 합 0" />
            <CountCard status="order" n={cards.counts.order} sub="남은 날 ≤ 주의 일수" />
            <CountCard status="soon" n={cards.counts.soon} sub={`≤ 30일 · 입고 대기 ${cards.counts.incoming}`} />
            <CountCard status="over" n={cards.counts.over} sub="남은 날 > 60일" />
            <ValueCard cards={cards} />
          </section>

          <div className="flex flex-wrap items-center gap-2 justify-between">
            <div data-tour="inventory-tabs" className="flex flex-wrap items-center gap-1 rounded-lg bg-muted p-1">
              {BRAND_TABS.map((b) => {
                const n = ready.rows.filter((r) => inTab(r, b.key)).length;
                return (
                  <button key={b.key} type="button" onClick={() => { setTab(b.key); setSupplier(null); }} aria-pressed={tab === b.key}
                    className={`px-3 py-1 rounded-md text-xs sm:text-sm ${tab === b.key ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                    {b.label} <span className="num text-muted-foreground">{n}</span>
                  </button>
                );
              })}
            </div>
            <div data-tour="inventory-window" className="flex items-center gap-1 text-xs">
              <span className="text-muted-foreground">하루 출고 기간</span>
              <div className="flex gap-0.5 rounded-md bg-muted p-0.5">
                {SPEED_WINDOWS.map((w) => (
                  <button key={w} type="button" onClick={() => setWindowDays(w)} aria-pressed={windowDays === w}
                    className={`px-2 py-0.5 rounded ${windowDays === w ? "bg-card shadow-sm text-foreground" : "text-muted-foreground"}`}>{w}일</button>
                ))}
              </div>
            </div>
          </div>
          {tab === "saip" && suppliers.length > 0 && (
            <div data-tour="inventory-suppliers" className="flex flex-wrap gap-1.5">
              {[["", 0] as [string, number], ...suppliers].map(([s, n]) => (
                <button key={s || "all"} type="button" onClick={() => setSupplier(s || null)} aria-pressed={(supplier ?? "") === s}
                  className={`px-2.5 py-0.5 rounded-full border text-xs ${(supplier ?? "") === s ? "bg-foreground text-background" : "bg-card text-muted-foreground hover:text-foreground"}`}>
                  {s || "공급처 전체"}{s && <span className="num ml-1 opacity-70">{n}</span>}
                </button>
              ))}
            </div>
          )}

          <p data-tour="inventory-rule" className="text-[11px] sm:text-xs text-muted-foreground leading-relaxed">
            하루 출고 = 최근 {ready.window}일({md(ready.window_from)} ~ {md(ready.daily_through)}) 위킵 출고 합 ÷ {ready.window} · 남은 날 = (위킵 가용 + 이동 + 내부) ÷ 하루 출고.
            너티는 쿠팡 재고 ÷ 쿠팡 하루 판매{ready.coupang_window ? `(${md(ready.coupang_window.from)} ~ ${md(ready.coupang_window.to)} 판매, 묶음은 낱개로 풀어 셈)` : ""}도 따로 계산해 짧은 쪽으로 판정.
            발주 필요 ≤ 주의 일수(사입 15 · 너티 20) · 곧 발주 ≤ 30 · 과재고 &gt; 60일. 발주를 넣으면 입고 대기.
            <Link href="/settings?tab=inventory" data-tour="inventory-settings-link" className="ml-1 underline underline-offset-2 text-foreground">쿠팡 재고·발주·기준 일수 입력 →</Link>
          </p>

          <div className="space-y-3">
            {GROUPS.map((g) => {
              const all = rows.filter((r) => r.group === g.key);
              const dormant = g.key === "act" ? all.filter(isDormant) : [];
              const list = g.key === "act" && !showDormant ? all.filter((r) => !isDormant(r)) : all;
              return (
                <section key={g.key} data-tour={`inventory-group-${g.key}`} className="rounded-xl border bg-card overflow-hidden">
                  <button type="button" onClick={() => setOpen((o) => ({ ...o, [g.key]: !o[g.key] }))} aria-expanded={open[g.key]}
                    className="w-full flex items-center gap-2 px-3 sm:px-4 py-2.5 text-left hover:bg-muted/40">
                    <span className="text-sm font-semibold">{g.no} {g.title}</span>
                    <span className="num text-sm text-muted-foreground">{all.length}</span>
                    <span className="hidden sm:inline text-xs text-muted-foreground truncate">{g.hint}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{open[g.key] ? "접기" : "펼치기"}</span>
                  </button>
                  {open[g.key] && list.length > 0 && (
                    <div className="border-t">
                      <HeaderRow />
                      {list.map((r, i) => (
                        <Fragment key={r.sku_no}>
                          <Row row={r} asOf={ready.as_of} first={g.key === "act" && i === 0} active={selected === r.sku_no}
                            onClick={() => setSelected((s) => (s === r.sku_no ? null : r.sku_no))} />
                          {selected === r.sku_no && <InventoryDetail row={r} asOf={ready.as_of} windowDays={ready.window} />}
                        </Fragment>
                      ))}
                      {dormant.length > 0 && (
                        <button type="button" data-tour="inventory-dormant" onClick={() => setShowDormant((v) => !v)}
                          className="w-full border-t px-4 py-2 text-left text-xs text-muted-foreground hover:bg-muted/40">
                          {showDormant ? "오래 품절 접기" : `오래 품절 ${dormant.length}개 더 보기`} · 재고 0 이고 최근 {ready.window}일 위킵 출고도 0 (판정은 품절 그대로, 개수에도 들어감)
                        </button>
                      )}
                    </div>
                  )}
                  {open[g.key] && list.length === 0 && <p className="border-t px-4 py-3 text-xs text-muted-foreground">해당 상품 없음</p>}
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function SetupNotice({ missing }: { missing: string[] }) {
  return (
    <div className="rounded-xl border p-4 space-y-2 text-sm" style={{ background: "var(--sig-warn-surface)", borderColor: "var(--sig-warn-border)" }}>
      <p className="font-semibold" style={{ color: "var(--sig-warn)" }}>재고 표가 아직 없습니다 (SQL 실행 필요)</p>
      <ol className="list-decimal pl-5 space-y-1 text-xs text-foreground">
        <li>Supabase SQL Editor 에서 대시보드 리포 docs/sql/2026-11-10-inventory.sql 을 실행합니다.</li>
        <li>회사 PC 에서 위킵 수집기로 1월부터의 날짜별 재고를 보냅니다(백필).</li>
        <li>다음 날부터 매일 수집이 돌면 이 화면이 채워집니다.</li>
      </ol>
      <p className="text-xs text-muted-foreground">없는 표: {missing.join(", ") || "-"}</p>
    </div>
  );
}

function Freshness({ data, loading, onRefresh }: { data: Exclude<InventoryResponse, { setupNeeded: true }>; loading: boolean; onRefresh: () => void }) {
  const today = data.today || kstDate();
  const stale = !data.as_of || data.as_of < addDays(today, -1);
  const readAt = data.read_at ? new Date(Date.parse(data.read_at) + 9 * 3600_000).toISOString().replace("T", " ").slice(0, 16) : "-";
  return (
    <div data-tour="inventory-freshness" className="space-y-2">
      {stale && (
        <div className="rounded-lg border px-3 py-2 text-sm" style={{ background: "var(--sig-danger-surface)", borderColor: "var(--sig-danger-border)", color: "var(--sig-danger)" }}>
          위킵 재고 수집이 멈췄습니다. 마지막 재고 {data.as_of ?? "없음"} 기준이라 아래 판정이 오늘과 다를 수 있습니다. 위킵 로그인이 풀렸는지 확인하세요.
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>위킵 재고 <b className="num text-foreground">{data.as_of ?? "-"}</b> (읽은 시각 {readAt} KST)</span>
        <span>날짜별 입고·출고 <b className="num text-foreground">{data.daily_through ?? "-"}</b>까지</span>
        <span>상품 {data.rows.length}개(위킵 SKU)</span>
        <button type="button" onClick={onRefresh} disabled={loading} className="ml-auto px-2 py-0.5 rounded border bg-card hover:bg-muted disabled:opacity-50">
          {loading ? "읽는 중" : "새로 읽기"}
        </button>
      </div>
    </div>
  );
}

function CountCard({ status, n, sub }: { status: InvStatus; n: number; sub: string }) {
  const t = STATUS_TONE[status];
  return (
    <div className="rounded-xl border bg-card p-3" style={n > 0 ? { borderColor: t.border, background: t.surface } : undefined}>
      <p className="text-xs font-medium" style={{ color: n > 0 ? t.color : "var(--muted-foreground)" }}>{STATUS_LABEL[status]}</p>
      <p className="num text-2xl font-bold leading-tight mt-0.5">{n}<span className="text-sm font-normal text-muted-foreground ml-0.5">개</span></p>
      <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>
    </div>
  );
}

function ValueCard({ cards }: { cards: ReturnType<typeof buildCards> }) {
  const [open, setOpen] = useState(false);
  const brands = (Object.keys(cards.value_by_brand) as InvBrand[]).filter((b) => cards.value_by_brand[b] > 0 || cards.missing_cost_by_brand[b] > 0);
  return (
    <div data-tour="inventory-value-card" className="col-span-2 lg:col-span-1 rounded-xl border bg-card p-3">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="w-full text-left">
        <p className="text-xs font-medium text-muted-foreground">재고 가치 (원가 × 재고) <span className="underline underline-offset-2">{open ? "접기" : "브랜드별"}</span></p>
        <p className="num text-2xl font-bold leading-tight mt-0.5">{fmtManWon(cards.value_total)}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">원가 없는 상품 {cards.missing_cost}개는 빠짐</p>
      </button>
      {open && (
        <ul className="mt-2 space-y-0.5 text-xs border-t pt-2">
          {brands.map((b) => (
            <li key={b} className="flex justify-between gap-2 num">
              <span>{BRAND_LABEL[b]}</span>
              <span>{fmtManWon(cards.value_by_brand[b])}{cards.missing_cost_by_brand[b] ? <span className="text-muted-foreground"> · 원가 없음 {cards.missing_cost_by_brand[b]}</span> : null}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function HeaderRow() {
  return (
    <div className={`hidden md:grid ${COLS} gap-2 items-end px-4 py-1.5 bg-muted/40 text-[11px] text-muted-foreground`}>
      <span>상품</span><span className="text-right">위킵</span><span className="text-right">쿠팡</span><span className="text-right">이동·내부</span>
      <span className="text-right">입고 예정</span><span className="text-right">하루 출고</span><RunwayAxis /><span className="text-right">소진일</span>
      <span>상태</span><span className="text-right">재고 가치</span>
    </div>
  );
}

function Badge({ status }: { status: InvStatus }) {
  const t = STATUS_TONE[status];
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium whitespace-nowrap border"
      style={{ color: t.color, background: t.surface, borderColor: t.border === "transparent" ? "var(--border)" : t.border }}>
      {STATUS_LABEL[status]}
    </span>
  );
}

const missingText = (n: number | null) => (n === null ? "미입력" : fmtInt(n));
const fmtDays = (n: number | null) => (n === null ? "계산 불가" : `${fmtSpeed(n)}일`);

function Row({ row, asOf, first, active, onClick }: { row: InventoryRow; asOf: string | null; first: boolean; active: boolean; onClick: () => void }) {
  const other = row.transit === null && row.internal === null ? null : (row.transit ?? 0) + (row.internal ?? 0);
  // 너티에 쿠팡 재고가 들어 있으면 위킵 쪽·쿠팡 쪽 남은 날을 둘 다 보인다(판정은 짧은 쪽)
  const both = row.coupang !== null && row.coupang_per_day !== null;
  const name = (
    <span className="min-w-0">
      <span className="block truncate text-sm">{row.bare_name}</span>
      <span className="block truncate text-[11px] text-muted-foreground">
        {[row.supplier, ...row.tags.filter((t) => t === "파손" || t === "마케팅용"), row.note ? `메모: ${row.note}` : null,
          row.confidence !== "확실" && !row.confirmed ? `매칭 ${row.confidence}` : null].filter(Boolean).join(" · ") || BRAND_LABEL[row.brand]}
      </span>
    </span>
  );
  return (
    <button type="button" onClick={onClick} aria-expanded={active} data-tour={first ? "inventory-row" : undefined}
      className={`w-full text-left border-t first:border-t-0 px-3 sm:px-4 py-2 hover:bg-muted/40 ${active ? "bg-muted/50" : ""}`}>
      {/* 데스크톱: 한 줄 */}
      <div className={`hidden md:grid ${COLS} gap-2 items-center num text-xs`}>
        {name}
        <span className="text-right">{fmtInt(row.available)}{both && <span className="block text-[10px] text-muted-foreground">{fmtDays(row.runway_wekeep)}</span>}</span>
        <span className="text-right text-muted-foreground">{row.brand === "nutty" ? missingText(row.coupang) : ""}{both && <span className="block text-[10px]">{fmtDays(row.runway_coupang)}</span>}</span>
        <span className="text-right text-muted-foreground">{other === null ? "" : fmtInt(other)}</span>
        <span className="text-right" style={row.incoming ? { color: "#2563eb" } : undefined}>
          {row.incoming ? `${fmtInt(row.incoming.qty)} · ${md(row.incoming.expected_at)}` : ""}
        </span>
        <span className="text-right" title={`최근 ${row.speed.days}일 위킵 출고 ${fmtInt(row.speed.total)}개 ÷ ${row.speed.days}일. 시트 방식: ${row.sheet_basis}`}>
          {fmtSpeed(row.speed.perDay)}
          <span className="block text-[10px] text-muted-foreground">시트 {fmtSpeed(row.sheet_per_day)}</span>
        </span>
        <span data-tour={first ? "inventory-bar" : undefined}><RunwayBar row={row} asOf={asOf} /></span>
        <span className="text-right">{md(row.stockout_date)}</span>
        <span><Badge status={row.status} /></span>
        <span className="text-right">{row.total_stock <= 0 ? <span className="text-muted-foreground">-</span> : row.value === null ? <span className="text-muted-foreground">원가 없음</span> : fmtWon(row.value)}</span>
      </div>
      {/* 휴대폰: 세 줄 */}
      <div className="md:hidden space-y-1.5">
        <div className="flex items-start gap-2">{name}<span className="ml-auto shrink-0"><Badge status={row.status} /></span></div>
        <RunwayBar row={row} asOf={asOf} />
        <p className="num text-[11px] text-muted-foreground">
          위킵 {fmtInt(row.available)}{both ? `(${fmtDays(row.runway_wekeep)})` : ""}{row.brand === "nutty" ? ` · 쿠팡 ${missingText(row.coupang)}${both ? `(${fmtDays(row.runway_coupang)})` : ""}` : ""} · 하루 {fmtSpeed(row.speed.perDay)}(시트 {fmtSpeed(row.sheet_per_day)})
          · 소진 {md(row.stockout_date)} · {row.total_stock <= 0 ? "재고 0" : row.value === null ? "원가 없음" : fmtManWon(row.value)}
          {row.incoming ? ` · 입고 ${fmtInt(row.incoming.qty)}(${md(row.incoming.expected_at)})` : ""}
        </p>
      </div>
    </button>
  );
}
