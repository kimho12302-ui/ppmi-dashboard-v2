"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";

// 콘텐츠 탭 보드 두 칸(네이버 진행판·자료조사 신선도). 값은 로컬 content-board-push.mjs 가 계산해 올린다.
// 대시보드는 판정하지 않는다. 규칙은 볼트 Work/밸런스랩/projects/네이버블로그-자동화/_스크립트/content-board-push.mjs 주석.

interface Row<T> { item_key: string; data: T; reported_at: string }

export function useBoard<T>(section: "naver" | "research" | "magazine") {
  const [rows, setRows] = useState<Row<T>[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 표가 없을 때 API 가 배포에 실린 스냅샷을 준다. 어느 쪽인지 화면에 밝혀야 한다.
  const [snap, setSnap] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/content-board?section=${section}`, { cache: "no-store" })
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error || String(r.status)); return d; })
      .then((d) => { if (!alive) return; setRows(d.items || []); setSnap(d.source === "snapshot" ? d.generatedAt || "" : null); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [section]);
  return { rows, error, snap };
}

export const kst = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

// 보드는 하루 두 번(06시 크롤러 뒤, 09시 작성 뒤) 올라온다. 36시간 넘게 안 오면 올리는 쪽이 멈춘 것이다.
const STALE_HOURS = 36;
export function Stale({ at }: { at?: string }) {
  if (!at) return null;
  const h = (Date.now() - new Date(at).getTime()) / 3_600_000;
  return (
    <span className="text-xs font-normal" style={{ color: h > STALE_HOURS ? "var(--sig-danger)" : "var(--muted-foreground)" }}>
      {h > STALE_HOURS ? `갱신 멈춤 (${Math.floor(h)}시간 전)` : `갱신 ${kst(at)}`}
    </span>
  );
}


// 표가 없어 스냅샷으로 뜬 칸임을 밝힌다. 배포에 실린 값이라 크론이 다시 올려도 배포 전까지 안 바뀐다.
// 라이브인 척하면 낡은 수치를 최신으로 읽게 된다.
export function Snap({ at }: { at: string | null }) {
  if (at === null) return null;
  return (
    <span className="text-xs font-normal" style={{ color: "var(--sig-warn)" }}>
      스냅샷{at ? ` · ${kst(at)}` : " · 아직 안 채워짐"}
    </span>
  );
}

// 표가 아직 없을 때(SQL 미실행) 날 에러 문구 대신 무엇을 하면 되는지 말한다.
// 2026-09-21: content_board 가 없어 세 칸이 통째로 안 뜨는데 화면에는 Supabase 원문만 나왔다.
export function BoardError({ what, error }: { what: string; error: string }) {
  const missing = /Could not find the table/i.test(error);
  return (
    <Card>
      <CardContent className="p-4 text-xs space-y-1">
        <div style={{ color: "var(--sig-danger)" }}>{what}: {missing ? "표가 아직 없습니다" : error}</div>
        {missing && (
          <div className="text-muted-foreground">
            Supabase SQL Editor 에 <code>docs/sql/_PENDING.sql</code> 을 한 번 실행하면 이 칸이 살아납니다.
            그다음 볼트에서 <code>node content-board-push.mjs</code> 를 돌리면 값이 찹니다.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- 네이버 진행판 ----------

type Stage = "draft" | "temp_saved" | "published" | "unconfirmed";
interface NaverPost {
  slug: string; title: string; draftDate: string; notion: string | null; stage: Stage;
  tempSave: { ok: boolean; at: string; note: string | null } | null;
  published: { title: string; url: string; date: string | null; match: "exact" | "similar"; score: number | null } | null;
}
interface NaverRecent { blog: string; rssOk: boolean; recent: { title: string; url: string; date: string | null }[] }

const STAGE: Record<Stage, { text: string; color: string }> = {
  draft: { text: "초안", color: "var(--muted-foreground)" },
  temp_saved: { text: "임시저장 · 검토 대기", color: "var(--sig-warn)" },
  published: { text: "발행됨", color: "var(--sig-ok)" },
  unconfirmed: { text: "발행 미확인", color: "var(--muted-foreground)" },
};

export function NaverProgressBoard() {
  const { rows, error, snap } = useBoard<NaverPost | NaverRecent>("naver");
  if (error) return <BoardError what="네이버 진행판" error={error} />;
  if (!rows) return null;
  const recent = rows.find((r) => r.item_key === "_recent")?.data as NaverRecent | undefined;
  const posts = rows.filter((r) => r.item_key !== "_recent").map((r) => r.data as NaverPost);
  const count = (s: Stage) => posts.filter((p) => p.stage === s).length;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <h3 className="font-semibold text-sm">📝 네이버 블로그 진행판 <span className="font-normal text-muted-foreground text-xs">밸런스랩 · 최근 45일 초안</span> <Stale at={rows[0]?.reported_at} /> <Snap at={snap} /></h3>
        <p className="text-xs text-muted-foreground">
          자동 작업이 네이버 에디터에 넣고 <b>임시저장</b>까지 합니다. 검토·발행은 사람이 합니다.
          발행은 블로그 새 글 목록에서 제목으로 확인합니다. 발행할 때 제목을 바꾸면 여기서 &quot;발행 미확인&quot;으로 남습니다.
        </p>
        <div className="flex flex-wrap gap-2 text-xs">
          {(["temp_saved", "draft", "published", "unconfirmed"] as Stage[]).map((s) => (
            <span key={s} className="rounded border px-2 py-1"><span style={{ color: STAGE[s].color }}>●</span> {STAGE[s].text} {count(s)}</span>
          ))}
        </div>
        {posts.length === 0 ? <p className="text-xs text-muted-foreground">최근 45일 초안이 없습니다.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-muted-foreground border-b">
                <th className="text-left py-1 pr-2 whitespace-nowrap">초안일</th><th className="text-left px-2">제목</th>
                <th className="text-left px-2 whitespace-nowrap">단계</th><th className="text-left px-2 whitespace-nowrap">임시저장</th>
                <th className="text-left px-2">발행 글</th><th className="text-left px-2">노션</th>
              </tr></thead>
              <tbody>{posts.map((p) => (
                <tr key={p.slug} className="border-b last:border-0 align-top">
                  <td className="py-1 pr-2 whitespace-nowrap">{p.draftDate}</td>
                  <td className="px-2">{p.title}</td>
                  <td className="px-2 whitespace-nowrap" style={{ color: STAGE[p.stage].color }}>{STAGE[p.stage].text}</td>
                  <td className="px-2 whitespace-nowrap">
                    {p.tempSave ? (p.tempSave.ok ? kst(p.tempSave.at) : <span style={{ color: "var(--sig-danger)" }} title={p.tempSave.note || ""}>실패</span>) : "-"}
                  </td>
                  <td className="px-2">
                    {p.published ? (
                      <a href={p.published.url} target="_blank" rel="noreferrer" className="underline">
                        {p.published.date || "날짜 없음"}{p.published.match === "similar" ? " (제목 유사)" : ""}
                      </a>
                    ) : "-"}
                  </td>
                  <td className="px-2">{p.notion ? <a href={p.notion} target="_blank" rel="noreferrer" className="underline">열기</a> : "-"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {recent && (
          <div className="text-xs">
            <p className="text-muted-foreground mb-1">블로그에 실제로 올라간 최근 글 {recent.rssOk ? "" : "(RSS 읽기 실패)"}</p>
            <ul className="space-y-0.5">{recent.recent.map((r) => (
              <li key={r.url}><span className="text-muted-foreground">{r.date}</span> <a href={r.url} target="_blank" rel="noreferrer" className="underline">{r.title}</a></li>
            ))}</ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- 자료조사 신선도 ----------

interface Axis {
  axis: string; label: string; lastCrawl: string | null; collected7: number;
  days: { date: string; collected: number | null }[];
  candidates: { date: string; scored: number; picked: number } | null;
  review: { adopted: number; held: number; excluded: number; files: number };
  adopted: { date: string; title: string; claim: string; url: string; krCoverage: string; channels: string[] }[];
}

const todayKst = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);

export function ResearchFreshness({ only }: { only?: "balancelab" | "pet" } = {}) {
  const { rows: all, error, snap } = useBoard<Axis>("research");
  // 행 하나 = 축 하나(item_key). 브랜드 칩이 고른 축만 남긴다.
  const rows = only && all ? all.filter((r) => r.item_key === only) : all;
  if (error) return <BoardError what="자료조사 신선도" error={error} />;
  if (!rows) return null;
  const today = todayKst();

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <h3 className="font-semibold text-sm">🔎 자료조사 신선도 <span className="font-normal text-muted-foreground text-xs">최근 7일</span> <Stale at={rows[0]?.reported_at} /> <Snap at={snap} /></h3>
        <p className="text-xs text-muted-foreground">
          매일 06시에 논문·건강 매체를 모으고, 규칙으로 1차 후보를 줄 세운 뒤 Claude 가 원문을 읽고 채택·보류·제외를 정합니다.
          채택된 것이 블로그·쓰레드의 재료가 됩니다.
        </p>
        <div className="grid gap-3 lg:grid-cols-2">
          {rows.map(({ data: a }) => {
            const late = !a.lastCrawl || a.lastCrawl < today;
            const max = Math.max(1, ...a.days.map((d) => d.collected || 0));
            return (
              <div key={a.axis} className="rounded-lg border p-3 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm">{a.label}</span>
                  <span style={{ color: late ? "var(--sig-danger)" : "var(--sig-ok)" }}>
                    {late ? `오늘 수집 없음 (마지막 ${a.lastCrawl || "없음"})` : "오늘 수집됨"}
                  </span>
                </div>
                <div className="flex items-end gap-1 h-12" aria-label="날짜별 수집 건수">
                  {a.days.map((d) => (
                    <div key={d.date} className="flex-1 flex flex-col items-center justify-end h-full" title={`${d.date}: ${d.collected == null ? "기록 없음" : `${d.collected}건`}`}>
                      <span className="text-[10px] text-muted-foreground">{d.collected ?? "·"}</span>
                      <div className="w-full rounded-sm" style={{ height: `${d.collected ? Math.max(8, (d.collected / max) * 100) : 4}%`, background: d.collected == null ? "var(--muted)" : "var(--chart-1, #3b82f6)" }} />
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded border px-2 py-0.5">7일 수집 {a.collected7}건</span>
                  <span className="rounded border px-2 py-0.5">1차 후보 {a.candidates ? `${a.candidates.picked}건 (${a.candidates.date})` : "없음"}</span>
                  <span className="rounded border px-2 py-0.5">
                    판정 {a.review.files ? `채택 ${a.review.adopted} · 보류 ${a.review.held} · 제외 ${a.review.excluded}` : "아직 없음"}
                  </span>
                </div>
                {a.adopted.length > 0 && (
                  <ul className="space-y-1">{a.adopted.map((x) => (
                    <li key={x.url}>
                      <a href={x.url} target="_blank" rel="noreferrer" className="underline">{x.claim || x.title}</a>
                      <span className="text-muted-foreground"> · {x.date} · {x.krCoverage}{x.channels.length ? ` · ${x.channels.join("·")}` : ""}</span>
                    </li>
                  ))}</ul>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
