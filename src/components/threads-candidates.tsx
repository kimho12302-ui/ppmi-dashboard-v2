"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// 이번 주 쓰레드 후보. 규칙은 /api/content-candidates 주석과 볼트 콘텐츠-자동화-대시보드-요구사항.md.
// 로컬이 게이트를 통과한 후보만 올린다. 여기서는 고르고, 버리고, 복사만 한다.
// 쓰레드에 올리는 것은 사람이다(자동 게시 금지).
//
// ★ 2026-09-28 김호 "쓰레드 후보 여러개 선택은 안됨?" → 한 축에서 여러 건을 고를 수 있다.
//   옛 판은 하나를 고르면 같은 축의 나머지가 자동 탈락했다.
//
//   대신 주 1편 규칙(축마다 주 1편)은 그대로다. 고른 것이 여럿이면 **대기열**이고 한 주에 나가는 것은
//   1건이다. 순서는 고른 순서(chosen_at 이 이른 것부터). 팬아웃하는 쪽은 로컬 크론
//   balancelab-daily-content-trigger 의 [2-E] 절이고, 대기열 판정은 threads-candidates.mjs pending 이 한다.
//   이 화면은 그 순서를 **똑같은 규칙으로 계산해 보여 주기만** 한다. 정본은 pending 이다.

type Status = "proposed" | "chosen" | "rejected" | "archived";
interface Item {
  id: string;
  axis: "balancelab" | "pet";
  week: string;
  title: string;
  body: string;
  sources: { label: string; url: string }[];
  research: { url?: string; claim?: string; evidence?: string; krCoverage?: string; publishedAt?: string };
  gates: Record<string, string>;
  status: Status;
  chosen_at: string | null;
  notion_url: string | null;
}
interface Resp { weeks: string[]; week: string | null; items: Item[]; error?: string }

// 로컬 threads-candidates.mjs 의 POST_SEP 와 같아야 한다. 쓰레드는 포스트 여러 개를 이어 올린다.
const POST_SEP = "\n\n---\n\n";

const AXIS: Record<Item["axis"], string> = { balancelab: "밸런스랩", pet: "너티·아이언펫" };
const GATE: Record<string, string> = { evidence: "출처 검수", regulation: "규제 검수", evals: "기계 검사" };
const STATUS: Record<Status, { text: string; color: string }> = {
  proposed: { text: "후보", color: "var(--muted-foreground)" },
  chosen: { text: "선택됨", color: "var(--sig-ok)" },
  rejected: { text: "버림", color: "var(--muted-foreground)" },
  archived: { text: "보관 완료", color: "var(--sig-ok)" },
};

export function ThreadsCandidates({ only }: { only?: "balancelab" | "pet" } = {}) {
  const [week, setWeek] = useState<string | null>(null);
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async (w: string | null) => {
    try {
      const r = await fetch(`/api/content-candidates?channel=threads${w ? `&week=${w}` : ""}`, { cache: "no-store" });
      const d: Resp = await r.json();
      if (!r.ok) throw new Error(d.error || String(r.status));
      setData(d);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { load(week); }, [load, week]);

  async function act(id: string, action: "choose" | "drop" | "undo") {
    if (busy) return; // 두 번 눌러 엇갈리지 않게
    setBusy(id);
    try {
      const r = await fetch("/api/content-candidates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || String(r.status));
      await load(data?.week ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function copy(item: Item) {
    try {
      await navigator.clipboard.writeText(item.body);
      setCopied(item.id);
      setTimeout(() => setCopied((c) => (c === item.id ? null : c)), 2000);
    } catch {
      setError("복사하지 못했습니다. 본문을 직접 선택해 복사하세요.");
    }
  }

  if (!data && !error) return null;
  const items = data?.items || [];
  // only 가 오면 그 축만. 콘텐츠 탭이 브랜드별로 갈리면서 한 축씩 부른다.
  const axes = (["balancelab", "pet"] as const).filter((a) => (!only || a === only) && items.some((i) => i.axis === a));

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-sm">🧵 이번 주 쓰레드 후보</h3>
          {data?.weeks.length ? (
            <select
              className="text-xs border rounded px-1 py-0.5 bg-transparent"
              value={data.week ?? ""}
              onChange={(e) => setWeek(e.target.value)}
            >
              {data.weeks.map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          한 축에서 여러 개 고를 수 있습니다. 안 고른 것은 그대로 남고, 「버리기」를 누른 것만 버려집니다.
          다만 <b>축마다 주 1편</b>이라 고른 것이 여럿이면 대기열이 됩니다. 먼저 고른 것이 먼저 나갑니다.
          쓰레드에는 복사해서 직접 올려 주세요.
        </p>
        {error && <p className="text-xs" style={{ color: "var(--sig-danger)" }}>{error}</p>}
        {!items.length && !error && <p className="text-xs text-muted-foreground">아직 올라온 후보가 없습니다.</p>}

        {axes.map((axis) => {
          const group = items.filter((i) => i.axis === axis);
          // 대기열 = 아직 보관 전인 chosen. 고른 순서(chosen_at 오름차순)다. 값이 없으면 맨 뒤로 보낸다.
          // pending(threads-candidates.mjs)과 같은 규칙이어야 한다. 한쪽만 고치면 화면과 실제가 어긋난다.
          const queue = group
            .filter((i) => i.status === "chosen")
            .sort((a, b) => (a.chosen_at || "9").localeCompare(b.chosen_at || "9") || a.id.localeCompare(b.id));
          const pos = new Map(queue.map((i, n) => [i.id, n + 1]));
          const doneCount = group.filter((i) => i.status === "archived").length;
          return (
            <section key={axis} className="space-y-2">
              <h4 className="text-xs font-semibold">
                {AXIS[axis]} <span className="font-normal text-muted-foreground">후보 {group.length}개</span>
              </h4>
              <QueueLine picked={queue.length} done={doneCount} />
              <div className="grid gap-3 lg:grid-cols-3">
                {group.map((item) => (
                  <CandidateCard
                    key={item.id}
                    item={item}
                    queuePos={pos.get(item.id) ?? null}
                    busy={busy === item.id}
                    copied={copied === item.id}
                    onChoose={() => act(item.id, "choose")}
                    onDrop={() => act(item.id, "drop")}
                    onUndo={() => act(item.id, "undo")}
                    onCopy={() => copy(item)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </CardContent>
    </Card>
  );
}

/**
 * 축마다 지금 몇 개 골랐는지. 김호가 여러 개 고를 수 있게 된 뒤로 이 줄이 없으면
 * "다 나가는 건가?" 를 화면에서 못 읽는다. 주 1편 규칙을 여기에 적어 둔다.
 */
function QueueLine({ picked, done }: { picked: number; done: number }) {
  const sent = done ? ` · 이 주에서 이미 ${done}건 나갔습니다` : "";
  if (!picked) {
    return (
      <p className="text-xs text-muted-foreground">
        {done ? `고른 것 없음${sent}` : "아직 고른 것 없음"}
      </p>
    );
  }
  return (
    <p className="text-xs" style={{ color: "var(--sig-ok)" }}>
      <b>{picked}건 선택됨</b>
      <span className="text-muted-foreground">
        {picked === 1
          ? ` · 다음 자동 회차에 나갑니다${sent}`
          : ` · 한 주에 1건씩 나갑니다. 다음 차례는 대기열 1번, 나머지 ${picked - 1}건은 다음 주로${sent}`}
      </span>
    </p>
  );
}

function CandidateCard({ item, queuePos, busy, copied, onChoose, onDrop, onUndo, onCopy }: {
  item: Item; queuePos: number | null; busy: boolean; copied: boolean;
  onChoose: () => void; onDrop: () => void; onUndo: () => void; onCopy: () => void;
}) {
  const st = STATUS[item.status];
  const chosen = item.status === "chosen" || item.status === "archived";
  const dim = item.status === "rejected";
  const posts = item.body.split(POST_SEP);
  const [copiedPost, setCopiedPost] = useState<number | null>(null);
  async function onCopyPost(i: number, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedPost(i);
      setTimeout(() => setCopiedPost((c) => (c === i ? null : c)), 2000);
    } catch { /* 복사 권한이 없으면 사용자가 본문을 직접 선택한다 */ }
  }
  return (
    <div className={cn("rounded-lg border p-3 flex flex-col gap-2 text-xs", chosen && "ring-2", dim && "opacity-50")}
      style={chosen ? { borderColor: "var(--sig-ok)", ["--tw-ring-color" as string]: "var(--sig-ok)" } : undefined}>
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-sm leading-snug">{item.title}</p>
        <span className="whitespace-nowrap text-right" style={{ color: st.color }}>
          {st.text}
          {item.status === "chosen" && queuePos ? (
            <><br /><span className="font-normal">{queuePos === 1 ? "다음 차례" : `대기열 ${queuePos}번`}</span></>
          ) : null}
        </span>
      </div>

      <div className="flex flex-wrap gap-1">
        {Object.keys(GATE).map((g) => (
          <span key={g} className="rounded px-1.5 py-0.5 border"
            style={{ color: item.gates[g] === "pass" ? "var(--sig-ok)" : "var(--sig-danger)" }}>
            {GATE[g]} {item.gates[g] === "pass" ? "통과" : "미통과"}
          </span>
        ))}
        {item.research.krCoverage && <span className="rounded px-1.5 py-0.5 border">{item.research.krCoverage}</span>}
      </div>

      <div className="space-y-2 max-h-96 overflow-y-auto">
        {posts.map((p, i) => (
          <div key={i} className="rounded bg-muted/40 p-2">
            <div className="flex items-center justify-between mb-1 text-muted-foreground">
              <span>포스트 {i + 1}/{posts.length} · {p.length}자</span>
              <button onClick={() => onCopyPost(i, p)} className="underline">{copiedPost === i ? "복사됨" : "이 포스트 복사"}</button>
            </div>
            <div className="whitespace-pre-wrap leading-relaxed">{p}</div>
          </div>
        ))}
      </div>

      <div className="space-y-0.5">
        <p className="text-muted-foreground">출처</p>
        {item.sources.map((s) => (
          <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="block underline break-all">{s.label}</a>
        ))}
        {item.research.evidence && <p className="text-muted-foreground">근거: {item.research.evidence}</p>}
      </div>

      <div className="flex flex-wrap gap-2 mt-auto pt-1">
        {item.status === "proposed" && (
          <>
            <button onClick={onChoose} disabled={busy}
              className="rounded px-3 py-1 font-semibold text-white disabled:opacity-50" style={{ background: "var(--sig-ok)" }}>
              {busy ? "처리 중" : "이걸로"}
            </button>
            <button onClick={onDrop} disabled={busy}
              className="rounded px-3 py-1 border text-muted-foreground disabled:opacity-50"
              title="이 후보는 안 쓰겠다고 표시합니다. 누르지 않으면 후보로 그대로 남습니다">
              {busy ? "처리 중" : "버리기"}
            </button>
          </>
        )}
        {item.status === "chosen" && (
          <button onClick={onUndo} disabled={busy} className="rounded px-3 py-1 border disabled:opacity-50">
            {busy ? "처리 중" : "선택 취소"}
          </button>
        )}
        {item.status === "rejected" && (
          <button onClick={onUndo} disabled={busy} className="rounded px-3 py-1 border disabled:opacity-50">
            {busy ? "처리 중" : "되살리기"}
          </button>
        )}
        <button onClick={onCopy} className="rounded px-3 py-1 border">{copied ? "복사됨" : "전체 복사"}</button>
        {item.notion_url && (
          <a href={item.notion_url} target="_blank" rel="noreferrer" className="rounded px-3 py-1 border">노션</a>
        )}
      </div>
    </div>
  );
}
