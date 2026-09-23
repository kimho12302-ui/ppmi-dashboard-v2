"use client";

import { useCallback, useEffect, useState } from "react";

import {
  useBoard,
  BoardCard, BoardEmpty, BoardError, Masthead, Figure, FigureRow, FigureRule,
  AlertRow, AlertStrip, Flag, SectionHead, Columns, Footnote, MiniBar, ScrollList,
  Stale, Snap,
} from "@/components/board-kit";

// ---------- 자료조사 신선도 ----------
//
// 2026-09-22 재작성. 김호: "자료조사 신선도는 아이언펫은 내용이 없고, 밸런스랩은 디자인이 별로야."
//
// 옛 판의 두 가지 문제
//   (1) 브랜드 칩으로 축 하나만 볼 때도 2열 격자를 그대로 써서 카드 오른쪽 절반이 통째로 비었다
//   (2) 막대에 날짜 축이 없어 어느 날이 어느 막대인지 못 읽었다. 판정이 0건인 축은
//       "판정 아직 없음" 여섯 글자로 끝나서, 왜 비었는지도 언제 채워지는지도 알 수 없었다
//
// 다른 두 칸(매거진·네이버)과 같은 뼈대(board-kit)를 쓴다.
//   머리단 = 7일 수집 하나를 크게 + 요일별 수집 막대(날짜 축 있음)
//   본문 왼쪽 = 공정 3단(수집 → 1차 후보 → 판정), 오른쪽 = 채택한 것
//
// 비는 칸을 그냥 두지 않는다. 무엇이 있고 무엇이 없는지, 없는 것은 언제 채워지는지 적는다.

interface Axis {
  axis: string; label: string; lastCrawl: string | null; collected7: number;
  days: { date: string; collected: number | null }[];
  candidates: { date: string; scored: number; picked: number } | null;
  review: { adopted: number; held: number; excluded: number; files: number };
  adopted: { date: string; title: string; claim: string; url: string; krCoverage: string; channels: string[]; used?: { threads?: boolean; carousel?: boolean } }[];
}

const todayKst = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);

// 판정을 누가 언제 만드는지. 출처는 볼트 RUNBOOK-research-candidates.md 의 표다.
// 공정이 바뀌면 여기도 같이 고쳐야 한다. 모르는 축은 말을 지어내지 않고 비워 둔다.
const REVIEW_OWNER: Record<string, string> = {
  balancelab: "밸런스랩 판정은 평일 일일 작성 공정 맨 앞에서 만듭니다.",
  pet: "너티·아이언펫 판정은 주 1회 주간 자료 다이제스트 안에서 만듭니다.",
};

// 국내 확산 대조 문구는 원천이 문장으로 준다. 아는 값만 짧게 줄이고 모르는 값은 원문 그대로.
function CoverageFlag({ text }: { text: string }) {
  if (!text) return null;
  if (text.startsWith("선점 가능")) return <Flag tone="ok" title={text}>선점 가능</Flag>;
  if (text.startsWith("국내 이미 보도")) return <Flag tone="idle" title={text}>국내 이미 보도</Flag>;
  return <Flag tone="idle" title={text}>{text}</Flag>;
}

/** 요일별 수집 막대. 옛 판에는 날짜 축이 없어 어느 막대가 어느 날인지 못 읽었다. */
function DayBars({ days }: { days: { date: string; collected: number | null }[] }) {
  const max = Math.max(1, ...days.map((d) => d.collected || 0));
  return (
    <div className="ml-auto w-[14rem]">
      <div className="flex gap-[3px]">
        {days.map((d) => (
          <span key={d.date} className="stamp num min-w-0 flex-1 text-center text-muted-foreground">{d.collected ?? "·"}</span>
        ))}
      </div>
      <div className="flex h-8 items-end gap-[3px]">
        {days.map((d) => {
          const v = d.collected;
          return (
            <span key={d.date} className="min-w-0 flex-1 rounded-sm"
              title={`${d.date}: ${v == null ? "기록 없음" : `${v}건`}`}
              style={{
                height: `${v == null ? 4 : Math.max(8, (v / max) * 100)}%`,
                background: v == null ? "var(--border)" : "var(--primary)",
                opacity: v == null ? 1 : 0.4 + 0.6 * (v / max),
              }} />
          );
        })}
      </div>
      <div className="mt-1 flex gap-[3px]">
        {days.map((d) => (
          <span key={d.date} className="stamp num min-w-0 flex-1 text-center text-muted-foreground">
            {Number(d.date.slice(8, 10))}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * 공정 한 단.
 *
 * ★ 단마다 세는 기간이 다르다. 모으기·판정은 최근 7일 합이고 1차 후보는 하루치다.
 *   셋을 같은 기준선에 나란히 그리면 깔때기로 읽혀 틀린 말을 한다.
 *   그래서 막대는 그 단 안에서만 뜻이 있는 것으로 쓰고, 기간을 줄마다 밝힌다.
 */
function Stage({ label, window, value, unit, children, tone, note }: {
  label: string; window: string; value: number; unit: string;
  children?: React.ReactNode; tone?: "warn" | "idle"; note?: string;
}) {
  const dim = value === 0;
  return (
    <div className="px-2 py-3">
      <div className="flex items-baseline gap-2">
        <span className="text-[12px] font-medium">{label}</span>
        <span className="stamp text-muted-foreground">{window}</span>
        <span aria-hidden className="h-px flex-1" style={{ background: "var(--border)" }} />
        <span className="num text-[15px] font-semibold"
          style={dim ? { color: `var(--sig-${tone || "idle"})` } : undefined}>
          {value.toLocaleString()}<span className="ml-0.5 text-[10px] font-medium text-muted-foreground">{unit}</span>
        </span>
      </div>
      <div className="mt-2">
        {dim
          ? <p className="stamp" style={{ color: `var(--sig-${tone || "idle"})` }}>{note || "없음"}</p>
          : children}
      </div>
    </div>
  );
}

/** 판정 구성(채택·보류·제외)을 한 줄 막대로. 이건 같은 창 안의 값이라 나란히 둬도 된다. */
function JudgeBar({ adopted, held, excluded }: { adopted: number; held: number; excluded: number }) {
  const total = adopted + held + excluded;
  if (total === 0) return null;
  const parts: [string, number, string][] = [
    ["채택", adopted, "var(--sig-ok)"],
    ["보류", held, "var(--sig-warn)"],
    ["제외", excluded, "var(--sig-idle)"],
  ];
  return (
    <>
      <span aria-hidden className="flex h-[3px] w-full overflow-hidden rounded-full" style={{ background: "var(--border)" }}>
        {parts.filter(([, v]) => v > 0).map(([k, v, c]) => (
          <span key={k} style={{ width: `${(v / total) * 100}%`, background: c }} />
        ))}
      </span>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
        {parts.map(([k, v, c]) => (
          <span key={k} className="stamp inline-flex items-center gap-1 text-muted-foreground">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
            {k} <b className="num text-foreground">{v}</b>
          </span>
        ))}
      </div>
    </>
  );
}

/**
 * 채택한 자료를 사람이 뒤집는 버튼.
 *
 * 김호 2026-09-22: "채택한 것에 버튼 넣어서 버리거나 채택을 할 수 있게 했으면 좋겠어.
 *                   사람이 선택하거나, 의견이 없으면 니가 알아서 진행"
 *
 * 그래서 이 버튼은 **게이트가 아니라 덮어쓰기**다. 올라온 자료는 이미 `chosen` 이고,
 * 아무도 안 누르면 그대로 쓰인다. 누르는 건 버릴 때뿐이다.
 * 값은 content_candidates(channel=research)에 남고 볼트가 다음 회차에 읽는다.
 */
type Verdict = { id: string; status: string };

function useResearchVerdicts() {
  const [map, setMap] = useState<Map<string, Verdict>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/content-candidates?channel=research&week=recent", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const m = new Map<string, Verdict>();
        for (const it of d.items || []) {
          const url = (it.sources || [])[0]?.url;
          if (url) m.set(url, { id: it.id, status: it.status });
        }
        setMap(m);
      })
      .catch(() => setMap(new Map()));
  }, []);

  useEffect(load, [load]);

  const act = useCallback(async (url: string, action: "keep" | "drop") => {
    const v = map.get(url);
    if (!v) return;
    setBusy(url);
    // 먼저 화면을 바꾼다. 누르고 아무 반응이 없으면 눌렸는지 알 수 없다.
    setMap((prev) => new Map(prev).set(url, { ...v, status: action === "keep" ? "chosen" : "rejected" }));
    try {
      const r = await fetch("/api/content-candidates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: v.id, action }),
      });
      if (!r.ok) throw new Error(String(r.status));
    } catch {
      load(); // 실패하면 서버 값으로 되돌린다. 화면만 바뀐 채 두지 않는다
    } finally {
      setBusy(null);
    }
  }, [map, load]);

  return { map, busy, act };
}

/**
 * 채택한 자료가 채널로 나갔는지 두 칸으로 보인다. 김호 2026-09-23.
 * 쓰 = 쓰레드 후보에 그 원문 주소가 있음 · 인 = 인스타 캐러셀 post.json 에 있음.
 * 블로그는 넣지 않는다. 밸런스랩 블로그 초안은 원문 주소를 남기지 않아 자료와 이어지지 않는다.
 */
function UseMarks({ used }: { used?: { threads?: boolean; carousel?: boolean } }) {
  if (!used) return null;
  const marks: [string, boolean, string][] = [
    ["쓰", Boolean(used.threads), "쓰레드 후보로 씀"],
    ["인", Boolean(used.carousel), "인스타 캐러셀로 씀"],
  ];
  return (
    <span className="inline-flex shrink-0 items-center gap-[3px]" aria-label="채널 사용">
      {marks.map(([ch, on, title]) => (
        <span
          key={ch}
          title={`${title}: ${on ? "예" : "아직"}`}
          className="grid h-[15px] w-[15px] place-items-center rounded-[3px] text-[9px] font-semibold leading-none"
          style={on
            ? { background: "var(--sig-ok)", color: "var(--background)" }
            : { background: "var(--muted)", color: "var(--muted-foreground)", opacity: 0.55 }}
        >
          {ch}
        </span>
      ))}
    </span>
  );
}

function VerdictButtons({ v, busy, onAct }: { v?: Verdict; busy: boolean; onAct: (a: "keep" | "drop") => void }) {
  if (!v) return <span className="stamp text-muted-foreground">올리기 전</span>;
  const dropped = v.status === "rejected";
  return (
    <button
      type="button"
      disabled={busy}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onAct(dropped ? "keep" : "drop"); }}
      className="stamp rounded border px-1.5 py-px transition-colors hover:bg-[var(--accent)] disabled:opacity-50"
      style={dropped ? { color: "var(--sig-ok)" } : { color: "var(--muted-foreground)" }}
      title={dropped ? "다시 쓰겠다고 표시합니다" : "이 자료는 안 쓰겠다고 표시합니다"}
    >
      {busy ? "..." : dropped ? "되살리기" : "버리기"}
    </button>
  );
}

export function ResearchFreshness({ only }: { only?: "balancelab" | "pet" } = {}) {
  const { rows: all, error, snap } = useBoard<Axis>("research");
  if (error) return <BoardError what="자료조사 신선도" error={error} />;
  if (!all) return null;
  // 행 하나 = 축 하나(item_key). 브랜드 칩이 고른 축만 남긴다.
  const rows = only ? all.filter((r) => r.item_key === only) : all;
  if (all.length === 0) return <BoardEmpty what="자료조사 신선도" how="content-board-push.mjs --only=research" />;
  if (rows.length === 0) {
    return <BoardEmpty what={`자료조사 신선도(${only})`} how="content-board-push.mjs --only=research" />;
  }
  // 브랜드 칩이 축을 하나로 좁히므로 카드도 축 하나를 그린다.
  // 옛 판은 축이 하나여도 2열 격자를 써서 오른쪽 절반이 비어 있었다.
  return <>{rows.map((r) => <AxisBoard key={r.item_key} axis={r.data} reportedAt={r.reported_at} snap={snap} />)}</>;
}

function AxisBoard({ axis: a, reportedAt, snap }: { axis: Axis; reportedAt?: string; snap: string | null }) {
  // 채택한 자료를 사람이 뒤집을 수 있게 한다. 안 누르면 내 판정대로 간다.
  const verdicts = useResearchVerdicts();
  const today = todayKst();
  const late = !a.lastCrawl || a.lastCrawl < today;
  const todayCount = a.days.length ? a.days[a.days.length - 1].collected : null;
  const picked = a.candidates?.picked ?? 0;
  const judged = a.review.adopted + a.review.held + a.review.excluded;
  const noReview = a.review.files === 0;
  const owner = REVIEW_OWNER[a.axis] || "";

  return (
    <BoardCard>
      <Masthead
        eyebrow="RESEARCH / 매일 06:00 수집"
        title="자료조사 신선도"
        subtitle={`${a.label} · 최근 7일 수집과 판정`}
        right={<><Stale at={reportedAt} /><Snap at={snap} /></>}
      >
        <FigureRow>
          <Figure hero
            value={a.collected7.toLocaleString()}
            unit="건"
            label="7일 수집"
            sub={a.lastCrawl ? `마지막 수집 ${a.lastCrawl}` : "수집 기록 없음"} />
          <FigureRule />
          <Figure
            value={todayCount == null ? "없음" : todayCount.toLocaleString()}
            unit={todayCount == null ? undefined : "건"}
            label="오늘 수집"
            tone={late ? "danger" : undefined} />
          <Figure value={picked.toLocaleString()} unit="건" label={a.candidates ? `1차 후보 (${a.candidates.scored}건 중)` : "1차 후보"} />
          <Figure
            value={a.review.adopted.toLocaleString()}
            unit="건"
            label="채택"
            tone={noReview ? "warn" : undefined} />
          <DayBars days={a.days} />
        </FigureRow>

        {(late || noReview) && (
          <AlertRow>
            {late && (
              <AlertStrip tone="danger"
                title="오늘 수집이 없습니다"
                body={`매일 06시에 도는 수집기가 오늘 것을 안 남겼습니다. 마지막 수집은 ${a.lastCrawl || "기록 없음"}입니다.`} />
            )}
            {noReview && (
              <AlertStrip tone="warn"
                title="판정이 아직 없습니다"
                body={`최근 7일 안에 판정 파일(_candidates/날짜-review.json)이 없습니다. 모으는 것과 1차 후보까지는 돌고 있습니다. ${owner}`} />
            )}
          </AlertRow>
        )}
      </Masthead>

      <Columns
        left={<>
          <SectionHead title="공정" note="모으기 → 1차 후보 → 판정" />
          <div className="divide-y">
            <Stage label="모으기" window="최근 7일" value={a.collected7} unit="건" note="수집 기록 없음" tone="warn">
              <p className="stamp text-muted-foreground">
                하루 평균 <b className="num text-foreground">{Math.round(a.collected7 / Math.max(1, a.days.length))}</b>건 ·
                마지막 <b className="num text-foreground">{a.lastCrawl || "기록 없음"}</b>
              </p>
            </Stage>
            <Stage label="1차 후보" window={a.candidates ? `${a.candidates.date} 하루` : "하루"} value={picked} unit="건"
              note="후보 파일 없음" tone="warn">
              {a.candidates && (
                <>
                  <MiniBar ratio={a.candidates.scored > 0 ? picked / a.candidates.scored : 0} accent />
                  <p className="stamp text-muted-foreground mt-1.5">
                    줄 세운 <b className="num text-foreground">{a.candidates.scored}</b>건 가운데 위에서 <b className="num text-foreground">{picked}</b>건
                  </p>
                </>
              )}
            </Stage>
            <Stage label="판정" window="최근 7일" value={judged} unit="건" note="아직 안 돌았음" tone="warn">
              <JudgeBar adopted={a.review.adopted} held={a.review.held} excluded={a.review.excluded} />
              <p className="stamp text-muted-foreground mt-1.5">판정 파일 <b className="num text-foreground">{a.review.files}</b>개</p>
            </Stage>
          </div>
        </>}
        right={<>
          <SectionHead title="채택한 것" note={noReview ? "판정이 돌면 여기에 쌓입니다" : `최근 7일 ${a.adopted.length}건`} />
          {a.adopted.length === 0 ? (
            <div className="rounded-lg border border-dashed px-4 py-5">
              <p className="text-xs font-medium">채택한 자료가 아직 없습니다.</p>
              <ul className="mt-2 space-y-1">
                <li className="stamp text-muted-foreground">
                  모으는 것은 돌고 있습니다. 최근 7일 <b className="num text-foreground">{a.collected7}</b>건,
                  마지막 수집 <b className="num text-foreground">{a.lastCrawl || "기록 없음"}</b>
                </li>
                <li className="stamp text-muted-foreground">
                  1차 후보도 나왔습니다. <b className="num text-foreground">{picked}</b>건
                  {a.candidates ? ` (${a.candidates.date} 기준, ${a.candidates.scored}건 중)` : ""}
                </li>
                <li className="stamp" style={{ color: "var(--sig-warn)" }}>
                  막힌 곳은 판정입니다. Claude 가 원문을 읽고 채택·보류·제외를 정하는 단계가 최근 7일 안에 안 돌았습니다
                </li>
                {owner && <li className="stamp text-muted-foreground">{owner}</li>}
              </ul>
            </div>
          ) : (
            <ScrollList>
              <ul className="space-y-px">
                {a.adopted.map((x) => {
                  const v = verdicts.map.get(x.url);
                  const dropped = v?.status === "rejected";
                  return (
                  <li key={x.url} className="group -mx-2">
                    <div
                      className="grid grid-cols-[minmax(0,1fr)] sm:grid-cols-[3.4rem_minmax(0,1fr)] gap-x-3 rounded-md px-2 py-2.5 transition-colors group-hover:bg-[var(--accent)]"
                      style={dropped ? { opacity: 0.45 } : undefined}>
                      <span className="num stamp hidden pt-0.5 text-muted-foreground sm:block">{x.date.slice(5).replace("-", ".")}</span>
                      <span className="min-w-0">
                        <a href={x.url} target="_blank" rel="noreferrer"
                          className="line-clamp-2 text-[12.5px] leading-snug hover:underline" title={x.title}
                          style={dropped ? { textDecoration: "line-through" } : undefined}>
                          {x.claim || x.title}
                        </a>
                        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <CoverageFlag text={x.krCoverage} />
                          {x.channels.map((c) => (
                            <span key={c} className="stamp rounded border px-1.5 py-px text-muted-foreground">{c}</span>
                          ))}
                          {x.channels.length === 0 && <span className="stamp text-muted-foreground">채널 미정</span>}
                          <UseMarks used={x.used} />
                          <VerdictButtons v={v} busy={verdicts.busy === x.url} onAct={(action) => verdicts.act(x.url, action)} />
                        </span>
                      </span>
                    </div>
                  </li>
                  );
                })}
              </ul>
            </ScrollList>
          )}
        </>}
      />

      <Footnote>
        매일 06시에 논문과 건강 매체를 모으고, 규칙으로 1차 후보를 줄 세운 뒤 Claude 가 원문을 읽고 채택 · 보류 · 제외를 정합니다.
        채택한 것이 블로그와 쓰레드의 재료가 됩니다. 대시보드는 따로 판정하지 않습니다.
      </Footnote>
    </BoardCard>
  );
}
