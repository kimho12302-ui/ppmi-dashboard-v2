"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { freshFetch } from "@/lib/fresh-fetch";
import { MatchTablePanel, SaveOutcomeNote, UnmatchedFixList, useSalesMatch, type SaveOutcome } from "@/components/settings/sales-match-editor";

// 「📤 엑셀 업로드」 탭의 「자동 판매입력」 칸 (2026-11-26).
// 회사 PC 스크립트(볼트 sales_entry_push.py)가 날마다 보낸 판매입력을 날짜별로 보여 주고, 그날 엑셀을 내려받는다.
// 보관·받기만 한다. 매출 원장 반영은 위 「판매 실적 (이카운트)」 칸에 이 엑셀을 올려야 된다.
// API: GET /api/sales-entry(목록), GET /api/sales-entry/xlsx?date=(엑셀)
// 2026-11-26 매칭표 편집: 미매칭 상품마다 「코드 넣기」, 아래 「매칭표 보기」(sales-match-editor.tsx, /api/sales-match)

interface Unmatched { 판매몰?: string; 매칭열쇠?: string; 줄수?: number }
interface Item {
  date: string;
  line_count: number;
  total: number;
  revenue: number | null;
  shipping: number;
  unmatched_count: number;
  gap_count: number;
  problem_count: number;
  unmatched: Unmatched[] | null;
  generated_at: string | null;
  updated_at?: string;
}
type ListState =
  | { kind: "loading" }
  | { kind: "setup"; message: string }
  | { kind: "error"; message: string }
  | { kind: "ok"; days: number; items: Item[] };

const DAYS = 30;
const won = (n: number | null | undefined) => (typeof n === "number" ? Math.round(n).toLocaleString("ko-KR") : "-");
const fileName = (date: string) => `판매입력_${date.slice(2, 4)}${date.slice(5, 7)}${date.slice(8, 10)}.xlsx`;
const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];
const dayLabel = (d: string) => `${d.slice(5)} (${WEEKDAY[new Date(`${d}T00:00:00Z`).getUTCDay()]})`;

/**
 * 보낸 시각 → KST "11-26 16:19". DB(timestamptz)는 UTC(+00:00)로 돌려주므로 문자열을 자르지 않고 시각으로 읽어 9시간 더한다.
 * (같은 규칙: src/lib/sales-entry-core.ts kstStamp. 그 모듈은 xlsx 를 끌고 와 화면에서 import 하지 않는다)
 */
function sentAt(it: Item): string {
  const t = Date.parse(it.generated_at ?? "");
  if (Number.isNaN(t)) return "-";
  return new Date(t + 9 * 3600 * 1000).toISOString().slice(5, 16).replace("T", " ");
}

const hasWarning = (it: Item) => it.unmatched_count > 0 || it.gap_count > 0 || it.problem_count > 0;

export function SalesEntryCard() {
  const [state, setState] = useState<ListState>({ kind: "loading" });
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const match = useSalesMatch();
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null);

  const load = useCallback((fresh = false) => {
    setState({ kind: "loading" });
    const url = `/api/sales-entry?days=${DAYS}`;
    (fresh ? freshFetch(url) : fetch(url))
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (d.setupNeeded) return setState({ kind: "setup", message: d.message || "표 없음, SQL 실행 필요" });
        if (!r.ok) return setState({ kind: "error", message: d.message || d.error || `HTTP ${r.status}` });
        setState({ kind: "ok", days: d.days ?? DAYS, items: d.items ?? [] });
      })
      .catch((e) => setState({ kind: "error", message: e instanceof Error ? e.message : String(e) }));
  }, []);

  useEffect(() => { load(); }, [load]);

  // <a download> 로 바로 받으면 오류(저장 덜 끝남 409 등)가 JSON 파일로 저장된다. 받아 보고 엑셀일 때만 저장한다.
  const download = async (date: string) => {
    if (downloading) return;
    setDownloading(date);
    setDownloadError(null);
    try {
      const r = await fetch(`/api/sales-entry/xlsx?date=${date}`, { cache: "no-store" });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setDownloadError(`${date}: ${d.error || `HTTP ${r.status}`}`);
        return;
      }
      const blob = await r.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = fileName(date);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch (e) {
      setDownloadError(`${date}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDownloading(null);
    }
  };

  const items = state.kind === "ok" ? state.items : [];
  const warnDays = items.filter(hasWarning).length;
  // 미매칭 상품은 표 밖(아래)에 둔다. 표는 좁은 화면에서 가로로 밀려 선택 상자가 잘린다(2026-11-26 390px 캡처)
  const unmatchedDays = items
    .map((it) => ({ date: it.date, entries: (it.unmatched ?? []).filter((u) => u && (u.매칭열쇠 ?? "") !== "") }))
    .filter((d) => d.entries.length > 0);
  const anyUnmatched = unmatchedDays.length > 0;
  const editable = match.state.kind === "ok" && match.state.seeded;

  // 코드를 저장하면 보관 줄이 고쳐지므로 목록·매칭표를 캐시 없이 다시 읽는다
  const afterSave = (o: SaveOutcome | null) => {
    if (o) setOutcome(o);
    load(true);
    match.reload();
  };

  return (
    <div data-tour="daily-upload-sales-entry" className="border rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h4 className="font-medium">자동 판매입력</h4>
          <p className="text-xs text-muted-foreground">
            회사 PC 가 매일 만든 이카운트 판매입력을 날짜별로 보관합니다. 「엑셀 받기」로 그날 판매입력 엑셀(판매정리·요약·미매칭·누락 탭)을 받습니다.
            여기 보관만으로는 매출에 반영되지 않습니다. 반영하려면 받은 파일을 위 「판매 실적 (이카운트)」에 올립니다.
          </p>
        </div>
        <button type="button" onClick={() => load(true)} disabled={state.kind === "loading"}
          className="text-xs text-primary hover:underline disabled:opacity-50 shrink-0">
          새로고침
        </button>
      </div>

      {state.kind === "loading" && <p className="text-xs text-muted-foreground">불러오는 중...</p>}

      {state.kind === "setup" && (
        <div className="text-xs rounded px-3 py-2 leading-relaxed" style={{ background: "var(--sig-warn-surface)", color: "var(--sig-warn)" }}>
          <p className="font-medium">표 없음, SQL 실행 필요</p>
          <p>보관 표가 아직 없습니다. Supabase SQL 편집기에서 <code>docs/sql/2026-11-26-sales-entry.sql</code> 를 실행하면 이 칸이 켜집니다.</p>
        </div>
      )}

      {state.kind === "error" && (
        <p className="text-xs rounded px-3 py-2" style={{ background: "var(--sig-danger-surface)", color: "var(--sig-danger)" }}>
          자동 판매입력 목록을 불러오지 못했습니다: {state.message}
        </p>
      )}

      {state.kind === "ok" && (
        <>
          <p className="stamp">
            최근 {state.days}일 중 {items.length}일 보관
            {warnDays > 0
              ? <span style={{ color: "var(--sig-warn)" }}> · 미매칭·누락 확인 필요 {warnDays}일</span>
              : items.length > 0 && <span style={{ color: "var(--sig-ok)" }}> · 경고 없음</span>}
          </p>
          {items.length === 0 ? (
            <p className="text-xs text-muted-foreground">최근 {state.days}일 동안 보관된 판매입력이 없습니다. 회사 PC 수집이 아직 보내지 않았거나 멈춘 상태입니다.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="num text-xs border-collapse w-full min-w-[560px] whitespace-nowrap">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="text-left font-medium py-1 pr-2">날짜</th>
                    <th className="text-right font-medium py-1 px-2">줄</th>
                    <th className="text-right font-medium py-1 px-2">총매출</th>
                    <th className="text-right font-medium py-1 px-2">배송비</th>
                    <th className="text-left font-medium py-1 px-2">경고</th>
                    <th className="text-left font-medium py-1 px-2">보낸 시각</th>
                    <th className="py-1 pl-2" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => {
                    const warn = hasWarning(it);
                    const bg = warn ? { background: "var(--sig-warn-surface)" } : undefined;
                    return (
                      <Fragment key={it.date}>
                      <tr className="border-t border-border/40 align-top" style={bg}>
                        <td className="py-1.5 pr-2 whitespace-nowrap font-medium">{dayLabel(it.date)}</td>
                        <td className="py-1.5 px-2 text-right">{it.line_count}</td>
                        <td className="py-1.5 px-2 text-right whitespace-nowrap">{won(it.total)}</td>
                        <td className="py-1.5 px-2 text-right whitespace-nowrap">{won(it.shipping)}</td>
                        <td className="py-1.5 px-2 font-sans">
                          {warn ? (
                            <div style={{ color: "var(--sig-warn)" }}>
                              <span className="font-medium">
                                {[
                                  it.unmatched_count > 0 && `미매칭 ${it.unmatched_count}줄`,
                                  it.gap_count > 0 && `누락 ${it.gap_count}건`,
                                  it.problem_count > 0 && `문제 ${it.problem_count}건`,
                                ].filter(Boolean).join(" · ")}
                              </span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">없음</span>
                          )}
                        </td>
                        <td className="py-1.5 px-2 whitespace-nowrap text-muted-foreground">{sentAt(it)}</td>
                        <td className="py-1.5 pl-2 text-right">
                          <button type="button" onClick={() => download(it.date)} disabled={downloading !== null}
                            className={cn("px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap font-sans",
                              "bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed")}>
                            {downloading === it.date ? "받는 중..." : "엑셀 받기"}
                          </button>
                        </td>
                      </tr>

                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {anyUnmatched && (
            <div className="rounded px-3 py-2 space-y-2" style={{ background: "var(--sig-warn-surface)" }}>
              <p className="text-xs font-medium" style={{ color: "var(--sig-warn)" }}>
                미매칭 상품 (품목코드 #N/A) · 「코드 넣기」로 코드를 넣으면 보관된 그 상품 줄도 바로 고쳐집니다
              </p>
              {unmatchedDays.map((d) => (
                <div key={d.date} className="text-[11px] leading-snug">
                  <p className="font-medium text-muted-foreground mb-0.5">{dayLabel(d.date)}</p>
                  <UnmatchedFixList entries={d.entries} match={match.state} onSaved={afterSave} />
                </div>
              ))}
            </div>
          )}
          {outcome && <SaveOutcomeNote outcome={outcome} onClose={() => setOutcome(null)} />}
          {anyUnmatched && !editable && match.state.kind !== "loading" && (
            <p className="text-[11px] text-muted-foreground">
              「코드 넣기」는 매칭표 표를 만들고(SQL) 회사 PC 에서 매칭표를 한 번 옮긴 뒤 켜집니다. 아래 「매칭표 보기」에 지금 상태가 있습니다.
            </p>
          )}
          {downloadError && (
            <p className="text-xs rounded px-3 py-2" style={{ background: "var(--sig-danger-surface)", color: "var(--sig-danger)" }}>
              엑셀을 받지 못했습니다. {downloadError}
            </p>
          )}
          <p className="stamp text-muted-foreground">
            미매칭 = 품목코드를 못 찾은 상품(엑셀에 #N/A). 「코드 넣기」로 「상품 목록」 코드를 고르면 매칭표에 저장되고 보관된 그 상품 줄도 바로 고쳐집니다. 누락 = 스마트스토어 발주확인 목록에는 있는데 판매정리에 빠진 주문. 받는 사람 이름·연락처·주소와 적요 칸은 보관하지 않습니다.
          </p>
        </>
      )}

      <MatchTablePanel match={match.state} onChanged={afterSave} />
    </div>
  );
}
