"use client";

import { useMemo, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section";
import { formatNumber, cn } from "@/lib/utils";

// 공구 인플루언서 발굴 (2026-10-14). 밸런스랩 공구 재개, 주력 큐모발검사. 병목은 '같이 할 사람 찾기'.
// 후보 모으기 → 계정 분석(공식 API) → 고른 행을 팀 협찬 리스트 시트에 추가. 정본은 시트다.
// DM 발송은 다음 단계(첫 DM 은 공식 API 로 불가, aside 워커가 필요).

const DEFAULT_KEYWORDS = "탈모, 두피, 모발, 헤어, 머리숱, 영양, 건강, 다이어트, 육아, 뷰티, 피부";

interface Contacts { emails: string[]; kakao: string[]; links: string[] }
interface Row {
  handle: string; ok: boolean; error?: string; name?: string; biography?: string;
  followers?: number; lastPostAt?: string | null; daysSinceLastPost?: number | null;
  avgLikes?: number | null; avgComments?: number; engagementPct?: number | null;
  gongguPosts?: number; gongguExamples?: string[]; keywordHits?: Record<string, number>;
  contacts?: Contacts; score?: number; scoreParts?: Record<string, number>;
  inSheet?: string | null; source?: string;
}
interface Candidate { handle: string; count: number; seeds: string[]; example?: string }

const PART_LABEL: Record<string, string> = {
  followers: "팔로워(20)", engagement: "참여율(25)", gonggu: "공구 이력(25)",
  relevance: "주제 관련(20)", recency: "최근 활동(5)", contact: "연락처(5)",
};

const splitList = (s: string) => s.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { window.location.href = `/login?next=/influencers`; throw new Error("로그인이 필요합니다"); }
  if (!r.ok) throw new Error(j.error || `요청 실패 (${r.status})`);
  return j as T;
}

const btn = "rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40";
const input = "w-full rounded-md border bg-background px-3 py-2 text-sm";

export default function InfluencersPage() {
  const [handlesText, setHandlesText] = useState("");
  const [seedsText, setSeedsText] = useState("");
  const [keywords, setKeywords] = useState(DEFAULT_KEYWORDS);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [pickedCand, setPickedCand] = useState<Set<string>>(new Set());
  const [seedReport, setSeedReport] = useState<{ seed: string; ok: boolean; error?: string; found: number }[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string>("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string; link?: string } | null>(null);
  const [onlyContact, setOnlyContact] = useState(false);
  const [hideInSheet, setHideInSheet] = useState(true);

  async function analyze(handles: string[], source: string) {
    if (!handles.length) return;
    setBusy("analyze"); setMsg(null);
    try {
      const all: Row[] = [];
      // 서버는 한 번에 30개까지. 넘으면 나눠 보낸다
      for (let i = 0; i < handles.length; i += 30) {
        const j = await post<{ results: Row[] }>("/api/influencers/analyze", { handles: handles.slice(i, i + 30), keywords: splitList(keywords.replace(/,/g, " ")) });
        all.push(...j.results.map((r) => ({ ...r, source })));
      }
      setRows((prev) => {
        const map = new Map(prev.map((r) => [r.handle, r]));
        for (const r of all) map.set(r.handle, { ...r, source: map.get(r.handle)?.source || r.source });
        return Array.from(map.values());
      });
      const ok = all.filter((r) => r.ok).length;
      setMsg({ kind: "ok", text: `${all.length}개 분석: 성공 ${ok}, 분석 불가 ${all.length - ok}` });
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally { setBusy(""); }
  }

  async function findMentions() {
    setBusy("mentions"); setMsg(null);
    try {
      const j = await post<{ seeds: typeof seedReport; candidates: Candidate[] }>("/api/influencers/mentions", { seeds: splitList(seedsText) });
      setSeedReport(j.seeds);
      setCandidates(j.candidates);
      setPickedCand(new Set(j.candidates.slice(0, 30).map((c) => c.handle)));
      setMsg({ kind: "ok", text: `언급된 계정 ${j.candidates.length}개. 위에서부터 30개를 골라 두었습니다.` });
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally { setBusy(""); }
  }

  async function addToSheet() {
    const chosen = rows.filter((r) => picked.has(r.handle) && r.ok);
    if (!chosen.length) return;
    setBusy("sheet"); setMsg(null);
    try {
      const j = await post<{ added: string[]; skipped: { handle: string; reason: string }[]; tab: string; sheetUrl: string }>("/api/influencers/sheet", { rows: chosen });
      setRows((prev) => prev.map((r) => (j.added.includes(r.handle) ? { ...r, inSheet: j.tab } : r)));
      setPicked(new Set());
      const sk = j.skipped.length ? ` / 건너뜀 ${j.skipped.length} (${j.skipped.map((s) => `${s.handle}: ${s.reason}`).join(", ")})` : "";
      setMsg({ kind: "ok", text: `시트 「${j.tab}」 탭에 ${j.added.length}개 추가${sk}`, link: j.sheetUrl });
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally { setBusy(""); }
  }

  const view = useMemo(() => rows
    .filter((r) => !onlyContact || (r.contacts && (r.contacts.emails.length || r.contacts.kakao.length)))
    .filter((r) => !hideInSheet || !r.inSheet)
    .sort((a, b) => Number(b.ok) - Number(a.ok) || (b.score ?? -1) - (a.score ?? -1)), [rows, onlyContact, hideInSheet]);
  const hiddenInSheet = rows.filter((r) => r.inSheet).length;

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, h: string) => {
    const n = new Set(set); if (n.has(h)) n.delete(h); else n.add(h); setter(n);
  };

  return (
    <PageShell title="공구 인플루언서 발굴" description="밸런스랩 큐모발검사 공구 진행자 찾기 → 계정 분석 → 팀 협찬 리스트 시트에 추가" hideFilters>
      <Card>
        <CardContent className="py-3 text-xs text-muted-foreground space-y-1">
          <p>· 분석은 인스타 공식 API 로 합니다. <b>비즈니스·크리에이터 계정만</b> 읽히고 개인 계정은 &lsquo;분석 불가&rsquo;로 나옵니다.</p>
          <p>· 인스타 해시태그 검색 API 는 올린 사람을 알려 주지 않아서, 후보는 ① 직접 붙여넣기 ② 비슷한 브랜드 계정이 캡션에 @태그한 계정으로 모읍니다.</p>
          <p>· 고른 행은 협찬 리스트 시트의 「인스타_공구후보」 탭에 들어갑니다. 시트에 이미 있는 핸들(제안 리스트·컨택타깃 포함)은 다시 넣지 않습니다. DM 발송은 다음 단계입니다.</p>
        </CardContent>
      </Card>

      <SectionHeading eyebrow="1단계" title="후보 모으기" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="py-4 space-y-2">
            <p className="text-sm font-medium">핸들 직접 넣기</p>
            <textarea className={cn(input, "h-28 font-mono")} placeholder={"@handle 또는 instagram.com/handle\n줄바꿈·쉼표로 여러 개"} value={handlesText} onChange={(e) => setHandlesText(e.target.value)} />
            <button className={btn} style={{ background: "var(--primary)" }} disabled={!!busy || !handlesText.trim()}
              onClick={() => analyze(splitList(handlesText), "직접 입력")}>
              {busy === "analyze" ? "분석 중…" : "분석"}
            </button>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 space-y-2">
            <p className="text-sm font-medium">비슷한 브랜드가 태그한 계정 찾기</p>
            <input className={cn(input, "font-mono")} placeholder="시드 계정 (예: 탈모샴푸·모발검사·영양제 브랜드), 쉼표로 최대 10개" value={seedsText} onChange={(e) => setSeedsText(e.target.value)} />
            <button className={btn} style={{ background: "var(--primary)" }} disabled={!!busy || !seedsText.trim()} onClick={findMentions}>
              {busy === "mentions" ? "찾는 중…" : "언급된 계정 찾기"}
            </button>
            {seedReport.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {seedReport.map((s) => `${s.seed}: ${s.ok ? `${s.found}개` : s.error}`).join(" · ")}
              </p>
            )}
            {candidates.length > 0 && (
              <div className="space-y-2">
                <div className="max-h-48 overflow-auto rounded-md border p-2 flex flex-wrap gap-1.5">
                  {candidates.map((c) => (
                    <label key={c.handle} className={cn("text-xs px-2 py-1 rounded border cursor-pointer font-mono", pickedCand.has(c.handle) ? "bg-muted" : "opacity-60")}>
                      <input type="checkbox" className="mr-1 align-middle" checked={pickedCand.has(c.handle)} onChange={() => toggle(pickedCand, setPickedCand, c.handle)} />
                      @{c.handle} <span className="text-muted-foreground">×{c.count}{c.seeds.length > 1 ? ` · 시드 ${c.seeds.length}곳` : ""}</span>
                    </label>
                  ))}
                </div>
                <button className={btn} style={{ background: "var(--primary)" }} disabled={!!busy || pickedCand.size === 0}
                  onClick={() => analyze(Array.from(pickedCand), `시드 언급: ${splitList(seedsText).join(",")}`)}>
                  {busy === "analyze" ? "분석 중…" : `고른 ${pickedCand.size}개 분석`}
                </button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground whitespace-nowrap">관련 키워드</span>
        <input className={cn(input, "py-1 text-xs")} value={keywords} onChange={(e) => setKeywords(e.target.value)} />
      </div>

      {msg && (
        <div className={cn("rounded-md border px-3 py-2 text-sm", msg.kind === "err" ? "border-red-500/50 text-red-500" : "")}>
          {msg.text} {msg.link && <a className="underline ml-1" href={msg.link} target="_blank" rel="noreferrer">시트 열기</a>}
        </div>
      )}

      <SectionHeading eyebrow="2단계" title="분석 결과" note="점수 = 팔로워·참여율·공구 이력·주제 관련·최근 활동·연락처 (마우스를 올리면 항목별)"
        action={
          <div className="flex items-center gap-3 text-xs">
            <label><input type="checkbox" className="mr-1 align-middle" checked={onlyContact} onChange={(e) => setOnlyContact(e.target.checked)} />연락처 있는 것만</label>
            <label><input type="checkbox" className="mr-1 align-middle" checked={hideInSheet} onChange={(e) => setHideInSheet(e.target.checked)} />시트에 있는 것 숨김{hiddenInSheet ? ` (${hiddenInSheet})` : ""}</label>
            <button className={btn} style={{ background: "var(--primary)" }} disabled={!!busy || picked.size === 0} onClick={addToSheet}>
              {busy === "sheet" ? "추가 중…" : `선택 ${picked.size}개 시트에 추가`}
            </button>
          </div>
        } />
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {view.length === 0 ? (
            <p className="text-sm text-muted-foreground px-6 py-8 text-center">아직 분석한 계정이 없습니다.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr className="text-left">
                  <th className="px-3 py-2 w-8">
                    <input type="checkbox" checked={view.filter((r) => r.ok && !r.inSheet).every((r) => picked.has(r.handle)) && picked.size > 0}
                      onChange={(e) => setPicked(e.target.checked ? new Set(view.filter((r) => r.ok && !r.inSheet).map((r) => r.handle)) : new Set())} />
                  </th>
                  <th className="px-3 py-2">계정</th>
                  <th className="px-3 py-2 text-right">점수</th>
                  <th className="px-3 py-2 text-right">팔로워</th>
                  <th className="px-3 py-2 text-right">참여율</th>
                  <th className="px-3 py-2 text-right">공구 글</th>
                  <th className="px-3 py-2">관련 키워드</th>
                  <th className="px-3 py-2">최근 글</th>
                  <th className="px-3 py-2">연락처</th>
                </tr>
              </thead>
              <tbody>
                {view.map((r) => (
                  <tr key={r.handle} className={cn("border-b last:border-0 align-top", !r.ok && "opacity-50")}>
                    <td className="px-3 py-2">
                      <input type="checkbox" disabled={!r.ok || !!r.inSheet} checked={picked.has(r.handle)} onChange={() => toggle(picked, setPicked, r.handle)} />
                    </td>
                    <td className="px-3 py-2 min-w-[180px]">
                      <a className="font-mono font-medium hover:underline" href={`https://www.instagram.com/${r.handle}/`} target="_blank" rel="noreferrer">@{r.handle}</a>
                      {r.name && <span className="ml-1 text-xs text-muted-foreground">{r.name}</span>}
                      {r.inSheet && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-muted">시트: {r.inSheet}</span>}
                      {!r.ok && <p className="text-xs text-red-500">{r.error}</p>}
                      {r.biography && <p className="text-xs text-muted-foreground line-clamp-2 max-w-xs" title={r.biography}>{r.biography}</p>}
                      {r.source && <p className="text-[10px] text-muted-foreground">경로: {r.source}</p>}
                    </td>
                    <td className="px-3 py-2 text-right num font-semibold" title={r.scoreParts ? Object.entries(r.scoreParts).map(([k, v]) => `${PART_LABEL[k] || k}: ${v}`).join("\n") : ""}>{r.score ?? "-"}</td>
                    <td className="px-3 py-2 text-right num">{r.followers != null ? formatNumber(r.followers) : "-"}</td>
                    <td className="px-3 py-2 text-right num" title={r.avgLikes == null && r.ok ? "좋아요를 숨긴 계정: 댓글만으로 계산" : `평균 좋아요 ${r.avgLikes ?? "-"} · 댓글 ${r.avgComments ?? "-"}`}>
                      {r.engagementPct != null ? `${r.engagementPct}%` : "-"}{r.ok && r.avgLikes == null ? "*" : ""}
                    </td>
                    <td className="px-3 py-2 text-right num">
                      {r.gongguPosts ? (
                        <a className="underline" href={r.gongguExamples?.[0]} target="_blank" rel="noreferrer" title="최근 25개 중 공구 표현이 있는 게시물 수. 누르면 예시">{r.gongguPosts}</a>
                      ) : r.ok ? 0 : "-"}
                    </td>
                    <td className="px-3 py-2 text-xs">{Object.entries(r.keywordHits || {}).map(([k, n]) => `${k}${n}`).join(" ")}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{r.daysSinceLastPost != null ? `${r.daysSinceLastPost}일 전` : "-"}</td>
                    <td className="px-3 py-2 text-xs max-w-[220px] break-all">
                      {r.contacts?.emails.map((e) => <div key={e}>✉ {e}</div>)}
                      {r.contacts?.kakao.map((k) => <div key={k}>💬 {k}</div>)}
                      {r.contacts?.links.map((l) => <div key={l} className="text-muted-foreground">🔗 {l}</div>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
