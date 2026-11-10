"use client";

// 재고 화면 (/inventory) 2026-11-10. 기획: 볼트 Work/PPMI/projects/마케팅-대시보드/재고-화면-기획-2026-11-10.md 「시각화 확정안 v2」.
//   표 한 장 + 행마다 같은 축(0~120일)의 남은 날 막대 + 행을 누르면 그 상품 하나의 상세 그래프.
//   묶음: ① 지금 손댈 것(펼침, 안에 보류 접힘) ② 정상(접힘) ③ 과재고(재고 가치 순) ④ 출고 0(재고 가치 순) ⑤ 판정 제외(접힘)
//   2026-11-10 김호: 사입을 브랜드별 탭으로, 판매 규모 등급(ABC)으로 급한 순서를 가르고 안 팔리는 품절·발주 필요는 보류로.
// 계산은 전부 src/lib/inventory.ts. 이 파일은 고르고 그리기만 한다. 문구를 바꾸면 src/lib/guides/screens/inventory.ts 도 고친다.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { freshFetch } from "@/lib/fresh-fetch";
import { kstDate } from "@/lib/date";
import {
  BRAND_LABEL, SPEED_WINDOWS, STATUS_LABEL, buildCards, addDays, buildBrandTabs, inBrandTab, ownSaipTabs,
  ABC_A_SHARE, ABC_B_SHARE, SCALE_LABEL, SCALE_POOL_LABEL, HOLD_QUIET_DAYS,
  type InvBrand, type InvGroup, type InventoryRow, type InvStatus, type SpeedWindow,
} from "@/lib/inventory";
import { RunwayAxis, RunwayBar } from "./runway-bar";
import { InventoryDetail } from "./inventory-detail";
import {
  GROUPS, SCALE_TONE, STATUS_TONE, coupangSourceLabel, coupangText, fmtInt, fmtManWon, fmtSpeed, fmtWon, md, scaleTitle, type InventoryResponse,
} from "./inventory-ui";

/** 데스크톱 표 칸 너비 (머리줄과 행이 같은 값을 쓴다) */
const COLS = "md:grid-cols-[minmax(0,1.5fr)_56px_72px_60px_80px_68px_minmax(200px,2.1fr)_44px_74px_92px_84px]";

export function InventoryScreen() {
  const [windowDays, setWindowDays] = useState<SpeedWindow>(28);
  const [data, setData] = useState<InventoryResponse | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<string>("all");
  const [open, setOpen] = useState<Record<InvGroup, boolean>>(() => Object.fromEntries(GROUPS.map((g) => [g.key, g.open])) as Record<InvGroup, boolean>);
  const [selected, setSelected] = useState<string | null>(null);
  // 보류(사입 품절·발주 필요 중 C·판매 없음·미상이고 최근 30일 출고 0)는 ① 안에서 접어 둔다. 판정은 그대로
  const [showHold, setShowHold] = useState(false);

  // 7·14·28 을 빨리 바꾸면 늦게 온 앞 요청이 뒤 결과를 덮지 않게 앞 요청을 취소한다
  const inflight = useRef<AbortController | null>(null);
  const load = useCallback(async (fresh: boolean) => {
    inflight.current?.abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;
    setLoading(true);
    setFailed(null);
    try {
      const url = `/api/inventory?window=${windowDays}`;
      let res = await (fresh ? freshFetch(url, { signal: ctrl.signal }) : fetch(url, { signal: ctrl.signal }));
      let json = await res.json();
      // 배포 직후 5분 캐시에 판매 규모(scale)가 없는 옛 응답이 남아 있으면 캐시를 건너뛰고 다시 읽는다
      if (res.ok && !json.setupNeeded && !("scale" in json)) {
        res = await freshFetch(url, { signal: ctrl.signal });
        json = await res.json();
      }
      if (!res.ok) throw new Error(json.message || json.error || String(res.status));
      if (!ctrl.signal.aborted) setData(json as InventoryResponse);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setFailed(e instanceof Error ? e.message : String(e));
    } finally {
      if (inflight.current === ctrl) setLoading(false);
    }
  }, [windowDays]);
  useEffect(() => { load(false); return () => inflight.current?.abort(); }, [load]);

  const ready = data && !data.setupNeeded ? data : null;
  const tabs = useMemo(() => buildBrandTabs(ready?.rows ?? []), [ready]);
  const own = useMemo(() => ownSaipTabs(tabs), [tabs]);
  // 다시 읽어 탭이 사라졌으면(그 브랜드 SKU 가 0 이 됨) 전체로
  const activeTab = tabs.some((t) => t.key === tab) ? tab : "all";
  const rows = useMemo(() => (ready ? ready.rows.filter((r) => inBrandTab(r, activeTab, own)) : []), [ready, activeTab, own]);
  const cards = useMemo(() => buildCards(rows), [rows]);

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
          <CoupangRgNotice data={ready} />

          <section data-tour="inventory-cards" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
            <CountCard status="soldout" n={cards.card.soldout}
              sub={`재고 합 0${cards.counts.late ? " · 입고 지연 포함" : ""}`} held={ready.scale ? cards.card.held_soldout : undefined} />
            <CountCard status="order" n={cards.card.order}
              sub={`남은 날 ≤ 주의 일수${cards.card.late ? ` · 입고 지연 ${cards.card.late} 포함` : ""}`} held={ready.scale ? cards.card.held_order : undefined} />
            <CountCard status="soon" n={cards.card.soon} sub={`≤ 30일 · 입고 대기 ${cards.card.incoming}`} />
            <CountCard status="restock" n={cards.card.restock} sub="쿠팡만 부족, 위킵엔 있음 · 발주 아님" />
            <CountCard status="over" n={cards.card.over} sub="남은 날 > 60일" />
            <ValueCard cards={cards} />
          </section>

          <div className="flex flex-wrap items-center gap-2 justify-between">
            <div data-tour="inventory-tabs" className="flex flex-wrap items-center gap-1 rounded-lg bg-muted p-1">
              {tabs.map((b) => (
                <button key={b.key} type="button" onClick={() => setTab(b.key)} aria-pressed={activeTab === b.key}
                  className={`px-2.5 sm:px-3 py-1 rounded-md text-xs sm:text-sm ${activeTab === b.key ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                  {b.label} <span className="num text-muted-foreground">{b.count}</span>
                </button>
              ))}
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
          <p data-tour="inventory-rule" className="text-[11px] sm:text-xs text-muted-foreground leading-relaxed">
            하루 출고 = 최근 {ready.window}일({md(ready.window_from)} ~ {md(ready.daily_through)}) 위킵 출고 합 ÷ {ready.window} · 남은 날 = (위킵 가용 + 이동 + 내부) ÷ 하루 출고.
            너티는 쿠팡 재고 ÷ 쿠팡 하루 판매도 따로 계산해 짧은 쪽으로 판정
            <CoupangRule data={ready} />.
            발주 필요 ≤ 주의 일수(사입 15 · 너티 20) · 곧 발주 ≤ 30 · 과재고 &gt; 60일. 발주를 넣으면 입고 대기.
            <ScaleRule data={ready} />
            <Link href="/settings?tab=inventory" data-tour="inventory-settings-link" className="ml-1 underline underline-offset-2 text-foreground">쿠팡 재고·발주·기준 일수 입력 →</Link>
          </p>

          <div className="space-y-3">
            {GROUPS.map((g) => {
              const list = rows.filter((r) => r.group === g.key);
              // 보류(inventory.ts isHeld)는 ① 안 맨 아래에 접어 둔다
              const hold = g.key === "act" ? rows.filter((r) => r.group === "hold") : [];
              return (
                <section key={g.key} data-tour={`inventory-group-${g.key}`} className="rounded-xl border bg-card overflow-hidden">
                  <button type="button" onClick={() => setOpen((o) => ({ ...o, [g.key]: !o[g.key] }))} aria-expanded={open[g.key]}
                    className="w-full flex items-center gap-2 px-3 sm:px-4 py-2.5 text-left hover:bg-muted/40">
                    <span className="text-sm font-semibold">{g.no} {g.title}</span>
                    <span className="num text-sm text-muted-foreground">{list.length}</span>
                    {hold.length > 0 && <span className="num text-xs text-muted-foreground">+ 보류 {hold.length}</span>}
                    <span className="hidden sm:inline text-xs text-muted-foreground truncate">{g.hint}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{open[g.key] ? "접기" : "펼치기"}</span>
                  </button>
                  {open[g.key] && (list.length > 0 || hold.length > 0) && (
                    <div className="border-t">
                      <HeaderRow />
                      {list.map((r, i) => (
                        <Fragment key={r.sku_no}>
                          <Row row={r} asOf={ready.as_of} first={g.key === "act" && i === 0} active={selected === r.sku_no}
                            onClick={() => setSelected((s) => (s === r.sku_no ? null : r.sku_no))} />
                          {selected === r.sku_no && <InventoryDetail row={r} asOf={ready.as_of} windowDays={ready.window} />}
                        </Fragment>
                      ))}
                      {list.length === 0 && <p className="px-4 py-3 text-xs text-muted-foreground">보류 말고 손댈 것 없음</p>}
                      {hold.length > 0 && (
                        <div data-tour="inventory-hold" className="border-t bg-muted/20">
                          <button type="button" onClick={() => setShowHold((v) => !v)} aria-expanded={showHold}
                            className="w-full px-4 py-2 text-left text-xs hover:bg-muted/40">
                            <span className="font-medium text-foreground">안 팔려서 보류 중일 수 있음 {hold.length}개</span>
                            <span className="text-muted-foreground"> · {showHold ? "접기" : "펼치기"} · 사입 품절·발주 필요 중 90일 판매 규모가 C·판매 없음·미상이고 최근 {HOLD_QUIET_DAYS}일 위킵 출고도 0. 일부러 발주를 끊었을 수 있어 위에서 뺐습니다(판정은 그대로)</span>
                          </button>
                          {showHold && hold.map((r) => (
                            <Fragment key={r.sku_no}>
                              <Row row={r} asOf={ready.as_of} first={false} active={selected === r.sku_no}
                                onClick={() => setSelected((s) => (s === r.sku_no ? null : r.sku_no))} />
                              {selected === r.sku_no && <InventoryDetail row={r} asOf={ready.as_of} windowDays={ready.window} />}
                            </Fragment>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {open[g.key] && list.length === 0 && hold.length === 0 && <p className="border-t px-4 py-3 text-xs text-muted-foreground">해당 상품 없음</p>}
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
  // 날짜별 입고·출고는 보통 어제까지. 2일 넘게 밀리면 하루 출고가 옛 기간으로 계산된다
  const dailyStale = !data.daily_through || data.daily_through < addDays(today, -2);
  const readAt = data.read_at ? new Date(Date.parse(data.read_at) + 9 * 3600_000).toISOString().replace("T", " ").slice(0, 16) : "-";
  return (
    <div data-tour="inventory-freshness" className="space-y-2">
      {!stale && dailyStale && (
        <div className="rounded-lg border px-3 py-2 text-sm" style={{ background: "var(--sig-warn-surface)", borderColor: "var(--sig-warn-border)", color: "var(--sig-warn)" }}>
          날짜별 입고·출고가 {data.daily_through ?? "없음"}까지만 들어와 있습니다. 하루 출고가 그 날까지의 기간으로 계산되어 최근 변화가 빠졌을 수 있습니다.
        </div>
      )}
      {stale && (
        <div className="rounded-lg border px-3 py-2 text-sm" style={{ background: "var(--sig-danger-surface)", borderColor: "var(--sig-danger-border)", color: "var(--sig-danger)" }}>
          위킵 재고 수집이 멈췄습니다. 마지막 재고 {data.as_of ?? "없음"} 기준이라 아래 판정이 오늘과 다를 수 있습니다. 위킵 로그인이 풀렸는지 확인하세요.
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>위킵 재고 <b className="num text-foreground">{data.as_of ?? "-"}</b> (읽은 시각 {readAt} KST)</span>
        <span>날짜별 입고·출고 <b className="num text-foreground">{data.daily_through ?? "-"}</b>까지</span>
        <span>쿠팡 로켓그로스 <b className="num text-foreground">{data.coupang_rg?.date ?? "없음"}</b>{data.coupang_rg && !data.coupang_rg.fresh ? " (오래됨)" : ""}</span>
        <span>상품 {data.rows.length}개(위킵 SKU)</span>
        <button type="button" onClick={onRefresh} disabled={loading} className="ml-auto px-2 py-0.5 rounded border bg-card hover:bg-muted disabled:opacity-50">
          {loading ? "읽는 중" : "새로 읽기"}
        </button>
      </div>
    </div>
  );
}

function CountCard({ status, n, sub, held }: { status: InvStatus; n: number; sub: string; held?: number }) {
  const t = STATUS_TONE[status];
  return (
    <div className="rounded-xl border bg-card p-3" style={n > 0 ? { borderColor: t.border, background: t.surface } : undefined}>
      <p className="text-xs font-medium" style={{ color: n > 0 ? t.color : "var(--muted-foreground)" }}>
        {STATUS_LABEL[status]}
      </p>
      <p className="num text-2xl font-bold leading-tight mt-0.5">
        {n}<span className="text-sm font-normal text-muted-foreground ml-0.5">개</span>
      </p>
      {held ? <p className="text-[11px] text-muted-foreground" title="사입 C·판매 없음·미상이고 최근 30일 출고 0 인 것은 ① 아래 보류로 보내 이 개수에서 뺐습니다">보류 {held}개 제외</p> : null}
      <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>
    </div>
  );
}

/** 계산 규칙 한 줄 끝의 판매 규모 설명 */
function ScaleRule({ data }: { data: Exclude<InventoryResponse, { setupNeeded: true }> }) {
  if (!data.scale) {
    return <span className="block mt-0.5" style={{ color: "var(--sig-warn)" }}>판매 규모 등급을 계산하지 못해 등급 없이 보입니다(보류 묶음 없음){data.scale_error ? `: ${data.scale_error}` : ""}.</span>;
  }
  const s = data.scale;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return (
    <span className="block mt-0.5">
      판매 규모 = {md(s.window.from)} ~ {md(s.window.to)}({s.window.days}일, 판매 동기화 지연 5일 앞) 판매 매출을 기본 품목으로 풀어 SKU 에 붙인 값(공구 채널 제외
      {s.gonggu_excluded.rows ? ` ${fmtInt(s.gonggu_excluded.rows)}행` : " 0행"}). 매출이 안 붙는 SKU 는 같은 기간 위킵 출고 × 원가(「출고 기준」).
      {" "}{SCALE_POOL_LABEL.saip}·{SCALE_POOL_LABEL.nutty} 각각 큰 순 누적 {pct(ABC_A_SHARE)}까지 A · {pct(ABC_B_SHARE)}까지 B · 나머지 C.
      {" "}사입 품절·발주 필요 중 C·판매 없음·미상이고 최근 {HOLD_QUIET_DAYS}일 위킵 출고도 0 인 것은 ① 아래 보류로 접음(너티는 보류 없음, C 라도 최근 출고가 있으면 ① 아래쪽).
      {s.unattached.components > 0 && (
        <span title={s.unattached.top.map((t) => `${t.name} ${fmtManWon(t.revenue)}`).join(" / ")}>
          {" "}위킵 SKU 가 없는 판매 {s.unattached.components}개 품목 {fmtManWon(s.unattached.revenue)}(닥터레이 영양제 등)은 등급 계산 밖.
        </span>
      )}
    </span>
  );
}

export function ScaleBadge({ row }: { row: InventoryRow }) {
  const g = row.scale.grade;
  if (!row.scale.pool && g === null) return <span className="text-muted-foreground">-</span>;
  const key = g ?? "unknown";
  const t = SCALE_TONE[key];
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-semibold whitespace-nowrap border"
      style={{ color: t.color, background: t.surface, borderColor: t.border, borderStyle: key === "none" || key === "unknown" ? "dashed" : "solid" }}>
      {g ? SCALE_LABEL[g] : "미상"}
    </span>
  );
}

/** 판매 규모 칸: 등급 배지 + 90일 판매 금액(또는 출고 기준 값) */
function ScaleCell({ row }: { row: InventoryRow }) {
  const s = row.scale;
  return (
    <span className="text-right" title={scaleTitle(row)}>
      <ScaleBadge row={row} />
      <span className="block text-[10px] text-muted-foreground">
        {s.basis === "sales" ? fmtManWon(s.value ?? 0) : s.basis === "shipout" ? `출고 기준 ${fmtManWon(s.value ?? 0)}` : s.basis === "unknown" && s.pool ? "원가 없음" : ""}
      </span>
    </span>
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
      <span>상태</span><span className="text-right" title="최근 90일 판매 매출 기준 ABC 등급">판매 규모</span><span className="text-right">재고 가치</span>
    </div>
  );
}

function Badge({ status, coupangMissing }: { status: InvStatus; coupangMissing?: boolean }) {
  const t = STATUS_TONE[status];
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium whitespace-nowrap border"
      style={{ color: t.color, background: t.surface, borderColor: t.border === "transparent" ? "var(--border)" : t.border }}>
      {status === "soldout" && coupangMissing ? "위킵 품절" : STATUS_LABEL[status]}
      {status === "soldout" && coupangMissing && <span className="ml-1 font-normal opacity-80">(쿠팡 미입력)</span>}
    </span>
  );
}

/** 쿠팡 칸 마우스 설명: 출처·입고 중·판매 속도 근거 */
function coupangTitle(row: InventoryRow): string {
  const src = row.coupang_source === "wing" ? `WING 로켓그로스 재고현황 ${row.coupang_as_of} 판매 가능(옵션 묶음을 낱개로 환산)`
    : row.coupang_source === "manual" ? `설정 손 입력 ${row.coupang_as_of}` : row.coupang_missing ? "쿠팡 재고 미입력" : "쿠팡 로켓그로스에 이 SKU 옵션 없음";
  const inbound = (row.coupang_inbound ? ` · 입고 중 ${fmtInt(row.coupang_inbound)}` : "")
    + (row.coupang_rg?.inbound_requested ? ` · 입고 요청만(위킵 미출고) ${fmtInt(row.coupang_rg.inbound_requested)}` : "");
  const speed = row.coupang_per_day === null ? "" : ` · 하루 판매 ${fmtSpeed(row.coupang_per_day)}(${row.coupang_speed_basis === "wing30" ? "RG 30일 ÷ 30" : "판매 원장 쿠팡"})`;
  return `${src}${inbound}${speed}${row.coupang_note ? ` · ${row.coupang_note}` : ""}`;
}
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
          row.confidence !== "확실" && !row.confirmed ? `매칭 ${row.confidence}` : null,
          row.held ? (row.last_shipout ? `마지막 출고 ${md(row.last_shipout)}` : "읽은 기간 출고 없음") : null].filter(Boolean).join(" · ") || BRAND_LABEL[row.brand]}
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
        <span className="text-right text-muted-foreground" title={coupangTitle(row)}>
          {row.brand === "nutty" || row.coupang !== null ? coupangText(row) : ""}
          {both && <span className="block text-[10px]">{fmtDays(row.runway_coupang)}</span>}
          {coupangSourceLabel(row) && <span className="block text-[10px] whitespace-nowrap" style={row.coupang_source === "manual" ? { color: "var(--sig-warn)" } : undefined}>{coupangSourceLabel(row)}</span>}
        </span>
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
        <span><Badge status={row.status} coupangMissing={row.coupang_missing} /></span>
        <ScaleCell row={row} />
        <span className="text-right">{row.total_stock <= 0 ? <span className="text-muted-foreground">-</span> : row.value === null ? <span className="text-muted-foreground">원가 없음</span> : fmtWon(row.value)}</span>
      </div>
      {/* 휴대폰: 세 줄 */}
      <div className="md:hidden space-y-1.5">
        <div className="flex items-start gap-2">{name}<span className="ml-auto shrink-0 flex items-center gap-1"><ScaleBadge row={row} /><Badge status={row.status} coupangMissing={row.coupang_missing} /></span></div>
        <RunwayBar row={row} asOf={asOf} />
        <p className="num text-[11px] text-muted-foreground">
          위킵 {fmtInt(row.available)}{both ? `(${fmtDays(row.runway_wekeep)})` : ""}{row.brand === "nutty" || row.coupang !== null ? ` · 쿠팡 ${coupangText(row)}${both ? `(${fmtDays(row.runway_coupang)})` : ""}${coupangSourceLabel(row) ? ` ${coupangSourceLabel(row)}` : ""}` : ""} · 하루 {fmtSpeed(row.speed.perDay)}(시트 {fmtSpeed(row.sheet_per_day)})
          · 소진 {md(row.stockout_date)} · {row.total_stock <= 0 ? "재고 0" : row.value === null ? "원가 없음" : fmtManWon(row.value)}
          {row.incoming ? ` · 입고 ${fmtInt(row.incoming.qty)}(${md(row.incoming.expected_at)})` : ""}
          {row.scale.basis === "sales" ? ` · 90일 판매 ${fmtManWon(row.scale.value ?? 0)}` : row.scale.basis === "shipout" ? ` · 출고 기준 ${fmtManWon(row.scale.value ?? 0)}` : ""}
        </p>
      </div>
    </button>
  );
}

/** 규칙 한 줄 안 쿠팡 근거. WING 값이 새로우면 그쪽, 아니면 손 입력 + 판매 원장(옛 방식) */
function CoupangRule({ data }: { data: Exclude<InventoryResponse, { setupNeeded: true }> }) {
  const rg = data.coupang_rg;
  if (rg?.fresh) {
    return (
      <span>
        (쿠팡 재고 = WING 로켓그로스 {md(rg.date)} 판매 가능 · 하루 판매 = 로켓그로스 최근 30일 판매(취소 뺌) ÷ 30, 옵션 묶음은 낱개로 풀어 셈.
        입고 중은 남은 날에 안 넣고 상세에 「입고 중 포함」으로 따로)
      </span>
    );
  }
  return (
    <span>
      (쿠팡 재고 = 설정 손 입력{rg ? ` · WING 값이 ${md(rg.date)} 기준이라 오래돼 안 씀` : ""} · 하루 판매 = 판매 원장 쿠팡
      {data.coupang_window ? ` ${md(data.coupang_window.from)} ~ ${md(data.coupang_window.to)}` : ""}, 묶음은 낱개로 풀어 셈. 판매자배송이 섞일 수 있음
      {data.coupang_unmapped ? <span title={data.coupang_unmapped.products.join(" / ")}> · 판매 구성표에 없는 쿠팡 판매 상품 {data.coupang_unmapped.products.length}개 · {fmtInt(data.coupang_unmapped.qty)}개는 낱개로 못 풀어 빠짐</span> : null})
    </span>
  );
}

/** 쿠팡 로켓그로스 경고: 짝 없는 옵션에 재고가 있음 · 값이 오래됨 */
function CoupangRgNotice({ data }: { data: Exclude<InventoryResponse, { setupNeeded: true }> }) {
  const rg = data.coupang_rg;
  if (!rg) {
    return data.coupang_rg_error ? (
      <div className="rounded-lg border px-3 py-2 text-sm" style={{ background: "var(--sig-warn-surface)", borderColor: "var(--sig-warn-border)", color: "var(--sig-warn)" }}>
        쿠팡 로켓그로스 재고 표를 읽지 못해 손 입력 쿠팡 재고로 판정했습니다: {data.coupang_rg_error}
      </div>
    ) : null;
  }
  const stray = rg.unmapped_with_stock;
  return (
    <>
      {stray.length > 0 && (
        <div data-tour="inventory-coupang-unmapped" className="rounded-lg border px-3 py-2 text-sm" style={{ background: "var(--sig-danger-surface)", borderColor: "var(--sig-danger-border)", color: "var(--sig-danger)" }}>
          쿠팡 로켓그로스 옵션 {stray.length}개가 위킵 SKU 와 짝이 없어 쿠팡 재고에서 빠졌습니다(판매 가능 {fmtInt(stray.reduce((a, u) => a + u.orderable, 0))}묶음 · 입고 중 {fmtInt(stray.reduce((a, u) => a + u.inbound, 0))}묶음).
          <span className="block text-xs mt-0.5 text-foreground">{stray.map((u) => `${u.name} (옵션 ${u.vendor_item_id})`).join(" · ")}</span>
          <span className="block text-xs mt-0.5 text-muted-foreground">볼트 짝짓기 초안(settings/collectors/raw/coupang-rg/coupang-rg-sku-map.draft.json)에 줄을 더하고 수집기를 --push-only 로 다시 보내면 사라집니다.</span>
        </div>
      )}
      {!rg.fresh && (
        <div className="rounded-lg border px-3 py-2 text-sm" style={{ background: "var(--sig-warn-surface)", borderColor: "var(--sig-warn-border)", color: "var(--sig-warn)" }}>
          쿠팡 로켓그로스 재고가 {rg.date} 기준({rg.age_days}일 전)이라 쓰지 않고 손 입력 쿠팡 재고로 판정했습니다. WING 로그인이 풀렸는지 확인하세요.
        </div>
      )}
    </>
  );
}
