"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section";
import { formatNumber, cn } from "@/lib/utils";
import { DmEditor, DmSettingsPanel, type Setting } from "@/components/influencer-dm";

// 공구 셀러 발굴 (2026-10-14). 밸런스랩 공구 재개, 주력 큐모발검사. 병목은 '같이 할 셀러 찾기'.
// 해시태그를 큐에 넣으면 PC 의 aside 수집기가 해시태그 → 올린 사람 → 프로필을 읽어 점수를 매겨
// 협찬 리스트 시트에 넣는다. 이 화면은 그 시트를 보여 주고 상태(후보·컨택함·제외)를 바꾼다. 정본은 시트다.
// 후보로 고르면 PC 의 DM 워커가 그 계정을 읽고 맞춤 제안 DM 초안을 쓴다. 사람이 고치고 「발송 승인」 하면 워커가 aside 로 보낸다.

type Row = Record<string, string>;
interface Board { candidates: Row[]; tags: Row[]; collector: Record<string, string>; settings: Setting[]; sheetUrl: string }

const STATUSES = ["검토 전", "후보", "컨택함", "제외"] as const;
const FIT = /영양제|건강식품|유산균|비타민|미네랄|중금속|모발검사|영양|롱제비티|대사|혈당|다이어트/;
const STATUS_STYLE: Record<string, string> = {
  "검토 전": "bg-muted text-muted-foreground",
  후보: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  컨택함: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  제외: "bg-red-500/10 text-red-500",
};

async function call<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { window.location.href = "/login?next=/influencers"; throw new Error("로그인이 필요합니다"); }
  if (!r.ok) throw new Error(j.error || `요청 실패 (${r.status})`);
  return j as T;
}

const btn = "rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40";
const num = (s: string) => Number(String(s || "").replace(/,/g, "")) || 0;
const words = (s: string) => String(s || "").split(/\s+/).filter(Boolean);

export default function InfluencersPage() {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [tagText, setTagText] = useState("");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<string>("검토 전");
  const [minFollowers, setMinFollowers] = useState(1000);
  const [fitOnly, setFitOnly] = useState(false);
  const [signalOnly, setSignalOnly] = useState(true);
  const [tagFilter, setTagFilter] = useState("");

  const load = useCallback(async () => {
    try { setBoard(await call<Board>("/api/influencers/board")); setError(""); }
    catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function addTags() {
    setBusy("tags"); setNote("");
    try {
      const j = await call<{ added: string[]; skipped: number }>("/api/influencers/tags", { tags: tagText });
      setNote(`${j.added.length}개 추가${j.skipped ? `, ${j.skipped}개는 이미 있음` : ""}. 다음 수집 때 돕니다.`);
      setTagText("");
      await load();
    } catch (e) { setNote((e as Error).message); }
    finally { setBusy(""); }
  }

  async function review(handle: string, next: string) {
    if (!board) return;
    const prev = board;
    setBoard({ ...board, candidates: board.candidates.map((c) => (c["핸들"] === handle ? { ...c, 상태: next, "DM 상태": next === "후보" && !c["DM 상태"] ? "초안 대기" : c["DM 상태"] } : c)) });
    try { await call("/api/influencers/review", { handle, status: next }); }
    catch (e) { setBoard(prev); setNote((e as Error).message); }
  }

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of board?.candidates || []) m[c["상태"] || "검토 전"] = (m[c["상태"] || "검토 전"] || 0) + 1;
    return m;
  }, [board]);

  const allTags = useMemo(() => Array.from(new Set((board?.candidates || []).flatMap((c) => words(c["발견 태그"])))), [board]);

  const view = useMemo(() => (board?.candidates || [])
    .filter((c) => status === "전체" || (c["상태"] || "검토 전") === status)
    .filter((c) => num(c["팔로워"]) >= minFollowers)
    .filter((c) => !fitOnly || FIT.test(`${c["관련 키워드"]} ${c["소개글"]} ${c["하이라이트"]} ${c["게시물 캡션"]}`))
    .filter((c) => !signalOnly || c["공구 신호"])
    .filter((c) => !tagFilter || words(c["발견 태그"]).includes(tagFilter))
    .sort((a, b) => num(b["점수"]) - num(a["점수"])), [board, status, minFollowers, fitOnly, signalOnly, tagFilter]);

  const col = board?.collector || {};

  return (
    <PageShell title="공구 셀러 발굴" description="인스타 해시태그로 공구 진행자를 찾아 협찬 리스트 시트에 쌓습니다 (밸런스랩 큐모발검사)" hideFilters>
      <Card>
        <CardContent className="py-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          <span><span className="text-muted-foreground">수집기 마지막 실행</span> <b>{col["마지막 실행"] || "아직 없음"}</b></span>
          {col["결과"] && <span className="text-muted-foreground">{col["결과"]}</span>}
          {col["오늘 열람"] && <span><span className="text-muted-foreground">오늘 열람</span> {col["오늘 열람"]}</span>}
          {col["오늘 새 후보"] && <span><span className="text-muted-foreground">오늘 새 후보</span> {col["오늘 새 후보"]}</span>}
          {col["DM 워커 마지막 실행"] && <span><span className="text-muted-foreground">DM 워커</span> {col["DM 워커 마지막 실행"]} · 오늘 발송 {col["오늘 발송"]} · {col["DM 발송 계정"]}</span>}
          <span className="text-xs text-muted-foreground">수집은 평일 10시·15시(하루 새 후보 30명까지), 초안·발송·회신은 평일 9~18시 매시 PC 에서 돕니다. PC 가 꺼져 있으면 &lsquo;대기&rsquo;·&lsquo;승인&rsquo;으로 남습니다.</span>
          {board?.sheetUrl && <a className="ml-auto underline text-xs" href={board.sheetUrl} target="_blank" rel="noreferrer">시트 열기</a>}
        </CardContent>
      </Card>
      {error && <div className="rounded-md border border-red-500/50 text-red-500 px-3 py-2 text-sm">{error}</div>}

      <SectionHeading eyebrow="1단계" title="수집할 해시태그" note="공구 셀러가 쓰는 태그 · 경쟁 브랜드 공구 태그가 효과가 좋습니다 (예: #영양제공구 #바이오컴공구 #모발검사)" />
      <Card>
        <CardContent className="py-4 space-y-3">
          <div className="flex gap-2">
            <input className="flex-1 rounded-md border bg-background px-3 py-2 text-sm" placeholder="#영양제공구 #건강식품공구 #모발검사 (여러 개는 띄어쓰기로)" value={tagText}
              onChange={(e) => setTagText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && tagText.trim()) addTags(); }} />
            <button className={btn} style={{ background: "var(--primary)" }} disabled={!!busy || !tagText.trim()} onClick={addTags}>{busy === "tags" ? "추가 중…" : "큐에 추가"}</button>
          </div>
          {note && <p className="text-xs text-muted-foreground">{note}</p>}
          {(board?.tags.length || 0) > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {board!.tags.map((t) => (
                <span key={t["태그"]} className="text-xs px-2 py-1 rounded border" title={t["오류"] || `추가: ${t["추가한 사람"]} ${t["추가일"]}`}>
                  {t["태그"]} · <span className={t["상태"] === "오류" ? "text-red-500" : t["상태"] === "완료" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>{t["상태"] || "대기"}</span>
                  {t["상태"] === "완료" && <span className="text-muted-foreground"> · 게시물 {t["본 게시물"]} → 새 {t["새 후보"]}</span>}
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {board && <DmSettingsPanel key={board.settings.map((x) => x.값).join("|").length} settings={board.settings} onSaved={load} />}

      <SectionHeading eyebrow="2단계" title="후보 검토" note="점수 = 팔로워(25) + 공구 신호(35) + 건강·영양 관련(20) + 여러 태그 발견(10) + 연락처(10)" />
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {[...STATUSES, "전체"].map((s) => (
          <button key={s} onClick={() => setStatus(s)} className={cn("px-2.5 py-1 rounded-full border", status === s ? "bg-foreground text-background" : "")}>
            {s} {s === "전체" ? board?.candidates.length ?? 0 : counts[s] || 0}
          </button>
        ))}
        <span className="mx-2 h-4 border-l" />
        <select className="rounded border bg-background px-2 py-1" value={minFollowers} onChange={(e) => setMinFollowers(Number(e.target.value))}>
          {[0, 1000, 3000, 10000, 50000].map((n) => <option key={n} value={n}>팔로워 {n ? `${formatNumber(n)} 이상` : "전체"}</option>)}
        </select>
        <select className="rounded border bg-background px-2 py-1" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
          <option value="">발견 태그 전체</option>
          {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <label><input type="checkbox" className="mr-1 align-middle" checked={signalOnly} onChange={(e) => setSignalOnly(e.target.checked)} />공구 신호 있는 것만</label>
        <label><input type="checkbox" className="mr-1 align-middle" checked={fitOnly} onChange={(e) => setFitOnly(e.target.checked)} />건강·영양 관련만</label>
        <button className="ml-auto underline" onClick={load}>새로고침</button>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {!board ? <p className="text-sm text-muted-foreground px-6 py-8 text-center">불러오는 중…</p>
            : view.length === 0 ? <p className="text-sm text-muted-foreground px-6 py-8 text-center">조건에 맞는 후보가 없습니다.</p>
            : (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr className="text-left">
                  <th className="px-3 py-2 text-right">점수</th>
                  <th className="px-3 py-2">계정</th>
                  <th className="px-3 py-2 text-right">팔로워</th>
                  <th className="px-3 py-2">공구 신호 · 진행 공구</th>
                  <th className="px-3 py-2">발견 게시물</th>
                  <th className="px-3 py-2">연락처 · 링크</th>
                  <th className="px-3 py-2">상태</th>
                </tr>
              </thead>
              <tbody>
                {view.map((c) => {
                  const h = c["핸들"];
                  const cur = c["상태"] || "검토 전";
                  const showDm = cur === "후보" || !!c["DM 상태"];
                  return (
                    <Fragment key={h}>
                    <tr className={cn("align-top", !showDm && "border-b last:border-0")}>
                      <td className="px-3 py-2 text-right num font-semibold">{c["점수"]}</td>
                      <td className="px-3 py-2 min-w-[200px] max-w-[280px]">
                        <a className="font-mono font-medium hover:underline" href={c["프로필"] || `https://www.instagram.com/${h}/`} target="_blank" rel="noreferrer">@{h}</a>
                        <span className="ml-1 text-xs text-muted-foreground">{c["이름"]}</span>
                        {c["카테고리"] && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-muted">{c["카테고리"]}</span>}
                        {c["소개글"] && <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-line" title={c["소개글"]}>{c["소개글"]}</p>}
                        {c["관련 키워드"] && <p className="text-[10px] text-muted-foreground mt-0.5">키워드: {c["관련 키워드"]}</p>}
                      </td>
                      <td className="px-3 py-2 text-right num">{c["팔로워"] ? formatNumber(num(c["팔로워"])) : "-"}</td>
                      <td className="px-3 py-2 text-xs max-w-[240px]">
                        <div className="flex flex-wrap gap-1">{(c["공구 신호"] || "").split(", ").filter(Boolean).map((s) => <span key={s} className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-400">{s}</span>)}</div>
                        {c["진행·예정 공구"] && <p className="mt-1">{c["진행·예정 공구"]}</p>}
                        {c["하이라이트"] && <p className="mt-1 text-muted-foreground line-clamp-2" title={c["하이라이트"]}>하이라이트: {c["하이라이트"]}</p>}
                      </td>
                      <td className="px-3 py-2 text-xs max-w-[240px]">
                        <p className="text-muted-foreground">{c["발견 태그"]}</p>
                        {c["게시물 캡션"] && <p className="line-clamp-3" title={c["게시물 캡션"]}>{c["게시물 캡션"]}</p>}
                        {words(c["발견 게시물"]).slice(0, 2).map((u, i) => <a key={u} className="underline mr-2" href={u} target="_blank" rel="noreferrer">게시물{i + 1}</a>)}
                      </td>
                      <td className="px-3 py-2 text-xs max-w-[200px] break-all">
                        {words(c["이메일"]).map((e) => <div key={e}>✉ {e}</div>)}
                        {c["카카오"] && <div>💬 {c["카카오"]}</div>}
                        {words(c["판매 링크"]).map((l) => <div key={l} className="text-muted-foreground">🔗 {l}</div>)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-col gap-1 min-w-[72px]">
                          {STATUSES.map((s) => (
                            <button key={s} onClick={() => s !== cur && review(h, s)}
                              className={cn("text-xs px-2 py-0.5 rounded", s === cur ? STATUS_STYLE[s] + " font-semibold" : "text-muted-foreground hover:bg-muted")}>
                              {s}
                            </button>
                          ))}
                          {c["검토자"] && <span className="text-[10px] text-muted-foreground">{c["검토자"]} {c["검토일"]?.slice(5)}</span>}
                        </div>
                      </td>
                    </tr>
                    {showDm && (
                      <tr className="border-b last:border-0">
                        <td />
                        <td colSpan={6} className="px-3 pb-4">
                          <DmEditor key={`${c["DM 상태"]}|${c["DM 초안"]}`} row={c} onChanged={load} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
