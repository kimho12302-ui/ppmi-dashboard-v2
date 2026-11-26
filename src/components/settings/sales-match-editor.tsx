"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { freshFetch } from "@/lib/fresh-fetch";
import { SOURCE_DASHBOARD, normKey, suggestCodes } from "@/lib/sales-match-core";

// 「자동 판매입력」 카드 안의 판매입력 매칭표 편집 (2026-11-26).
//   미매칭 상품 줄마다 「코드 넣기」 → 통계 시트 「상품 목록」 코드 중에서 고르기 → 저장하면 보관된 #N/A 줄도 바로 고친다.
//   「매칭표 보기」 → 검색·코드 바꾸기·지우기(대시보드에서 넣은 줄만).
// API: GET/POST/DELETE /api/sales-match, GET /api/sales-match/products. 규칙 src/lib/sales-match-core.ts.

export interface MatchItem { key: string; code: string; source: string; note: string | null; updatedAt: string | null }
export type MatchState =
  | { kind: "loading" }
  | { kind: "setup" }
  | { kind: "error"; message: string }
  | { kind: "ok"; seeded: boolean; match: MatchItem[] };

interface Product { code: string; name: string; brand: string; category?: string; lineup?: string }
type ProductState = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "ok"; items: Product[] };

export interface SaveOutcome { key: string; code: string; dates: string[]; lines: number; warnings: string[] }

const WARN = { background: "var(--sig-warn-surface)", color: "var(--sig-warn)" };
const DANGER = { background: "var(--sig-danger-surface)", color: "var(--sig-danger)" };
const OK = { background: "var(--sig-ok-surface)", color: "var(--sig-ok)" };
const SHOW_MAX = 40;
const TABLE_PAGE = 50;

export function useSalesMatch() {
  const [state, setState] = useState<MatchState>({ kind: "loading" });
  const load = useCallback((fresh = false) => {
    (fresh ? freshFetch("/api/sales-match") : fetch("/api/sales-match", { cache: "no-store" }))
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (d.setupNeeded) return setState({ kind: "setup" });
        if (!r.ok || !d.ok) return setState({ kind: "error", message: d.message || d.error || `HTTP ${r.status}` });
        setState({ kind: "ok", seeded: !!d.seeded, match: d.match ?? [] });
      })
      .catch((e) => setState({ kind: "error", message: e instanceof Error ? e.message : String(e) }));
  }, []);
  useEffect(() => { load(); }, [load]);
  return { state, reload: () => load(true) };
}

/** 「상품 목록」은 처음 고를 때 한 번 읽는다(시트 읽기라 느리다). 「목록 다시 읽기」로 새로 읽는다 */
let productCache: Product[] | null = null;
function useProducts(active: boolean) {
  const [state, setState] = useState<ProductState>(productCache ? { kind: "ok", items: productCache } : { kind: "idle" });
  const load = useCallback(() => {
    setState({ kind: "loading" });
    fetch("/api/sales-match/products", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.ok) return setState({ kind: "error", message: d.message || d.error || `HTTP ${r.status}` });
        productCache = d.items ?? [];
        setState({ kind: "ok", items: productCache ?? [] });
      })
      .catch((e) => setState({ kind: "error", message: e instanceof Error ? e.message : String(e) }));
  }, []);
  useEffect(() => { if (active && state.kind === "idle") load(); }, [active, state.kind, load]);
  return { state, reload: load };
}

async function postMatch(key: string, code: string): Promise<{ ok: true; outcome: SaveOutcome } | { ok: false; message: string }> {
  try {
    const r = await fetch("/api/sales-match", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, code }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok && !d.saved) return { ok: false, message: d.error || `HTTP ${r.status}` };
    const warnings: string[] = [...(d.warnings ?? []), ...(d.error ? [d.error] : [])];
    return { ok: true, outcome: { key, code, dates: d.patched?.dates ?? [], lines: d.patched?.lines ?? 0, warnings } };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

const matchesQuery = (p: Product, q: string) => {
  if (!q) return true;
  const s = q.toLowerCase();
  return [p.code, p.name, p.brand, p.category ?? ""].some((v) => v.toLowerCase().includes(s));
};

/** 「상품 목록」 코드 검색 선택 + 저장. 추천 코드(머리표만 다른 기존 매칭)를 맨 위에 둔다 */
function CodePicker({ matchKey, current, matches, onSaved, onCancel }: {
  matchKey: string;
  current?: string;
  matches: MatchItem[];
  onSaved: (o: SaveOutcome) => void;
  onCancel: () => void;
}) {
  const products = useProducts(true);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const suggested = useMemo(() => suggestCodes(matchKey, matches), [matchKey, matches]);

  const list = useMemo(() => {
    if (products.state.kind !== "ok") return [];
    const all = products.state.items;
    const byCode = new Map(all.map((p) => [p.code, p]));
    const top = suggested.flatMap((c) => (byCode.has(c) ? [byCode.get(c)!] : []));
    const topSet = new Set(top.map((p) => p.code));
    const restFiltered = all.filter((p) => !topSet.has(p.code) && matchesQuery(p, q.trim()));
    return [...top.filter((p) => matchesQuery(p, q.trim())), ...restFiltered];
  }, [products.state, suggested, q]);
  const loadedCodes = products.state.kind === "ok" ? new Set(products.state.items.map((p) => p.code)) : null;
  const missingSuggest = loadedCodes ? suggested.filter((c) => !loadedCodes.has(c)) : [];

  const save = async () => {
    if (!picked || saving) return;
    setSaving(true);
    setError(null);
    const r = await postMatch(matchKey, picked);
    setSaving(false);
    if (r.ok) onSaved(r.outcome);
    else setError(r.message);
  };

  return (
    <div className="mt-1.5 rounded border border-border bg-background p-2 space-y-2 text-foreground">
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="search" value={q} onChange={(e) => setQ(e.target.value)} autoFocus
          placeholder="코드·상품명·브랜드 검색"
          aria-label="상품 목록 코드 검색"
          className="flex-1 min-w-[160px] text-xs px-2 py-1 rounded border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <button type="button" onClick={products.reload} disabled={products.state.kind === "loading"}
          className="text-[11px] text-primary hover:underline disabled:opacity-50">목록 다시 읽기</button>
      </div>
      {products.state.kind === "loading" && <p className="text-[11px] text-muted-foreground">통계 시트 「상품 목록」 읽는 중...</p>}
      {products.state.kind === "error" && (
        <p className="text-[11px] rounded px-2 py-1" style={DANGER}>상품 목록을 못 읽었습니다: {products.state.message}</p>
      )}
      {products.state.kind === "ok" && (
        <>
          <ul role="listbox" aria-label="품목코드" className="max-h-56 overflow-y-auto divide-y divide-border/40 rounded border border-border/60">
            {list.slice(0, SHOW_MAX).map((p) => {
              const isSuggest = suggested.includes(p.code);
              const sel = picked === p.code;
              return (
                <li key={p.code} role="option" aria-selected={sel}>
                  <button type="button" onClick={() => setPicked(p.code)}
                    className={cn("w-full text-left px-2 py-1 text-[11px] flex items-baseline gap-2 hover:bg-muted/60 focus:outline-none focus-visible:bg-muted",
                      sel && "bg-primary/10")}>
                    <span className="num font-medium shrink-0">{p.code}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{p.name || "(이름 없음)"}</span>
                      {/* 좁은 화면은 카테고리·브랜드를 이름 아래 줄로(옆에 두면 이름이 잘린다) */}
                      <span className="block truncate text-muted-foreground sm:hidden">{[p.category, p.brand].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className="hidden sm:inline text-muted-foreground shrink-0 max-w-[40%] truncate">{[p.category, p.brand].filter(Boolean).join(" · ")}</span>
                    {isSuggest && <span className="shrink-0 rounded px-1 text-[10px] font-medium" style={OK}>추천</span>}
                    {current === p.code && <span className="shrink-0 text-[10px] text-muted-foreground">지금 코드</span>}
                  </button>
                </li>
              );
            })}
            {list.length === 0 && <li className="px-2 py-1.5 text-[11px] text-muted-foreground">검색 결과 없음</li>}
          </ul>
          {list.length > SHOW_MAX && <p className="text-[11px] text-muted-foreground">{list.length}개 중 {SHOW_MAX}개만 보입니다. 검색어를 더 넣으세요.</p>}
          {missingSuggest.length > 0 && (
            <p className="text-[11px]" style={{ color: "var(--sig-warn)" }}>
              비슷한 상품이 쓰는 코드 {missingSuggest.join(", ")} 는 「상품 목록」에 없어 고를 수 없습니다.
            </p>
          )}
          <p className="text-[11px] text-muted-foreground">
            목록에 없는 새 코드는 통계 시트 「상품 목록」 탭에 먼저 등록한 뒤 「목록 다시 읽기」를 누르세요. 여기 없는 코드는 매출 업로드에서 「미등록 품목코드」로 막힙니다.
          </p>
        </>
      )}
      {error && <p className="text-[11px] rounded px-2 py-1" style={DANGER}>저장 못 함: {error}</p>}
      <div className="flex items-center gap-2 justify-end">
        <button type="button" onClick={onCancel} className="text-[11px] text-muted-foreground hover:underline">닫기</button>
        <button type="button" onClick={save} disabled={!picked || saving}
          className="px-2.5 py-1 rounded text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed">
          {saving ? "저장 중..." : picked ? `${picked} 로 저장` : "코드를 고르세요"}
        </button>
      </div>
    </div>
  );
}

/** 저장 결과 띠: 「n일치 m줄 고침」 + 경고 */
export function SaveOutcomeNote({ outcome, onClose }: { outcome: SaveOutcome; onClose: () => void }) {
  return (
    <div className="text-xs rounded px-3 py-2 leading-relaxed" style={outcome.warnings.length ? WARN : OK} role="status">
      <div className="flex items-start justify-between gap-2">
        <p>
          <span className="font-medium">{outcome.code}</span> 저장.{" "}
          {outcome.lines > 0 ? `보관된 판매입력 ${outcome.dates.length}일치 ${outcome.lines}줄 고침 (${outcome.dates.join(", ")})` : "고칠 보관 줄 없음"}
        </p>
        <button type="button" onClick={onClose} className="shrink-0 hover:underline">닫기</button>
      </div>
      {outcome.warnings.map((w) => <p key={w}>· {w}</p>)}
    </div>
  );
}

/** 하루치 미매칭 상품 목록 + 줄마다 「코드 넣기」 */
export function UnmatchedFixList({ entries, match, onSaved }: {
  entries: { 판매몰?: string; 매칭열쇠?: string; 줄수?: number }[];
  match: MatchState;
  onSaved: (o: SaveOutcome) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const editable = match.kind === "ok" && match.seeded;
  return (
    <ul className="space-y-1">
      {entries.map((u, i) => {
        const key = u.매칭열쇠 ?? "";
        const id = `${i}:${key}`;
        return (
          <li key={id}>
            <div className="flex items-start gap-2">
              <span className="min-w-0 flex-1 break-all">
                {key || "(열쇠 없음)"}{u.줄수 && u.줄수 > 1 ? ` ×${u.줄수}` : ""}
                {u.판매몰 && <span className="text-muted-foreground"> · {u.판매몰}</span>}
              </span>
              {key && editable && (
                <button type="button" onClick={() => setOpen(open === id ? null : id)} aria-expanded={open === id}
                  className="shrink-0 px-2 py-0.5 rounded border text-[11px] font-medium hover:bg-background"
                  style={{ borderColor: "var(--sig-warn)" }}>
                  {open === id ? "닫기" : "코드 넣기"}
                </button>
              )}
            </div>
            {open === id && match.kind === "ok" && (
              <CodePicker matchKey={key} matches={match.match}
                onSaved={(o) => { setOpen(null); onSaved(o); }} onCancel={() => setOpen(null)} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

const stamp = (iso: string | null) => {
  const t = Date.parse(iso ?? "");
  return Number.isNaN(t) ? "" : new Date(t + 9 * 3600 * 1000).toISOString().slice(5, 16).replace("T", " ");
};

/** 「매칭표 보기」 접기 영역 */
export function MatchTablePanel({ match, onChanged }: { match: MatchState; onChanged: (o: SaveOutcome | null) => void }) {
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(TABLE_PAGE);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => {
    if (match.kind !== "ok") return [];
    const s = q.trim().toLowerCase();
    return s ? match.match.filter((m) => m.key.toLowerCase().includes(s) || m.code.toLowerCase().includes(s)) : match.match;
  }, [match, q]);

  const remove = async (m: MatchItem) => {
    if (busy) return;
    if (!window.confirm(`매칭표에서 지울까요?\n${m.key} → ${m.code}\n이미 고친 보관 줄은 그대로입니다.`)) return;
    setBusy(m.key);
    setError(null);
    try {
      const r = await fetch(`/api/sales-match?key=${encodeURIComponent(m.key)}`, { method: "DELETE" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setError(d.error || `HTTP ${r.status}`);
      else onChanged(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const dashCount = match.kind === "ok" ? match.match.filter((m) => m.source === SOURCE_DASHBOARD).length : 0;

  return (
    <details className="group rounded border border-border/60">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium hover:bg-muted/40">
        매칭표 보기
        {match.kind === "ok" && <span className="text-muted-foreground font-normal"> · {match.match.length}줄 (대시보드에서 넣은 줄 {dashCount})</span>}
      </summary>
      <div className="px-3 pb-3 pt-1 space-y-2">
        {match.kind === "loading" && <p className="text-xs text-muted-foreground">불러오는 중...</p>}
        {match.kind === "setup" && (
          <div className="text-xs rounded px-3 py-2 leading-relaxed" style={WARN}>
            <p className="font-medium">표 없음, SQL 실행 필요</p>
            <p>매칭표 표가 아직 없습니다. Supabase SQL 편집기에서 <code>docs/sql/2026-11-26-sales-match.sql</code> 를 실행하세요. 그전까지 회사 PC 는 볼트 sales_match.json 으로 계산합니다.</p>
          </div>
        )}
        {match.kind === "error" && <p className="text-xs rounded px-3 py-2" style={DANGER}>매칭표를 불러오지 못했습니다: {match.message}</p>}
        {match.kind === "ok" && (
          <>
            {!match.seeded && (
              <p className="text-xs rounded px-3 py-2 leading-relaxed" style={WARN}>
                매칭표 옮기기 전입니다. 회사 PC 에서 볼트 sales_match.json 을 한 번 옮겨야(seed) 코드를 넣고 바꿀 수 있습니다.
              </p>
            )}
            <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setLimit(TABLE_PAGE); }}
              placeholder="상품명+옵션 또는 코드 검색" aria-label="매칭표 검색"
              className="w-full text-xs px-2 py-1 rounded border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/40" />
            {error && <p className="text-xs rounded px-3 py-2" style={DANGER}>{error}</p>}
            <ul className="divide-y divide-border/40 text-[11px]">
              {rows.slice(0, limit).map((m) => {
                const dash = m.source === SOURCE_DASHBOARD;
                const id = normKey(m.key);
                return (
                  <li key={id} className="py-1.5">
                    <div className="flex items-start gap-x-2 gap-y-0.5 flex-wrap sm:flex-nowrap">
                      {/* 좁은 화면은 열쇠가 한 줄을 다 쓰고 코드·버튼은 다음 줄로 */}
                      <span className="min-w-0 basis-full sm:basis-auto sm:flex-1 break-all">{m.key}</span>
                      <span className="num font-medium shrink-0">{m.code}</span>
                      <span className={cn("shrink-0 rounded px-1 text-[10px]", dash ? "font-medium" : "text-muted-foreground")}
                        style={dash ? OK : undefined}>{m.source}</span>
                      {match.seeded && (
                        <span className="shrink-0 flex gap-2">
                          <button type="button" onClick={() => setEditing(editing === id ? null : id)} className="text-primary hover:underline">
                            {editing === id ? "닫기" : "코드 바꾸기"}
                          </button>
                          {dash && (
                            <button type="button" onClick={() => remove(m)} disabled={busy !== null}
                              className="hover:underline disabled:opacity-50" style={{ color: "var(--sig-danger)" }}>
                              {busy === m.key ? "지우는 중..." : "지우기"}
                            </button>
                          )}
                        </span>
                      )}
                    </div>
                    {(m.note || m.updatedAt) && (
                      <p className="text-muted-foreground">{[m.note, dash || m.note ? stamp(m.updatedAt) : ""].filter(Boolean).join(" · ")}</p>
                    )}
                    {editing === id && (
                      <CodePicker matchKey={m.key} current={m.code} matches={match.match}
                        onSaved={(o) => { setEditing(null); onChanged(o); }} onCancel={() => setEditing(null)} />
                    )}
                  </li>
                );
              })}
              {rows.length === 0 && <li className="py-1.5 text-muted-foreground">{q ? "검색 결과 없음" : "매칭표가 비어 있습니다"}</li>}
            </ul>
            {rows.length > limit && (
              <button type="button" onClick={() => setLimit(limit + TABLE_PAGE)} className="text-xs text-primary hover:underline">
                더 보기 ({rows.length - limit}줄 남음)
              </button>
            )}
            <p className="stamp text-muted-foreground">
              대소문자는 안 가리고 상품명+옵션이 글자 그대로 같아야 맞습니다. 회사 PC 는 매일 이 표를 받아 계산합니다. 엑셀에서 옮긴 줄은 코드만 바꿀 수 있고(옛 코드는 메모에 남음), 지우기는 대시보드에서 넣은 줄만 됩니다.
            </p>
          </>
        )}
      </div>
    </details>
  );
}
