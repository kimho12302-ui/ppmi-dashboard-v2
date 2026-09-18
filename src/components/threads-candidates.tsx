"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// 이번 주 쓰레드 후보. 규칙은 /api/content-candidates 주석과 볼트 콘텐츠-자동화-대시보드-요구사항.md.
// 로컬이 게이트를 통과한 후보만 올린다. 여기서는 고르고(나머지 자동 탈락) 복사만 한다.
// 쓰레드에 올리는 것은 사람이다(자동 게시 금지).

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
  chosen: { text: "선택됨 · 노션 보관 대기", color: "var(--sig-ok)" },
  rejected: { text: "탈락", color: "var(--muted-foreground)" },
  archived: { text: "선택됨 · 노션 보관 완료", color: "var(--sig-ok)" },
};

export function ThreadsCandidates() {
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

  async function act(id: string, action: "choose" | "undo") {
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
  const axes = (["balancelab", "pet"] as const).filter((a) => items.some((i) => i.axis === a));

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
          축마다 주 1편입니다. 하나를 고르면 같은 주의 나머지는 탈락하고, 고른 글은 다음 자동 회차에 노션에 보관됩니다.
          쓰레드에는 복사해서 직접 올려 주세요.
        </p>
        {error && <p className="text-xs" style={{ color: "var(--sig-danger)" }}>{error}</p>}
        {!items.length && !error && <p className="text-xs text-muted-foreground">아직 올라온 후보가 없습니다.</p>}

        {axes.map((axis) => {
          const group = items.filter((i) => i.axis === axis);
          const decided = group.some((i) => i.status === "chosen" || i.status === "archived");
          return (
            <section key={axis} className="space-y-2">
              <h4 className="text-xs font-semibold">{AXIS[axis]} <span className="font-normal text-muted-foreground">후보 {group.length}개</span></h4>
              <div className="grid gap-3 lg:grid-cols-3">
                {group.map((item) => (
                  <CandidateCard
                    key={item.id}
                    item={item}
                    dim={decided && item.status === "rejected"}
                    busy={busy === item.id}
                    copied={copied === item.id}
                    onChoose={() => act(item.id, "choose")}
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

function CandidateCard({ item, dim, busy, copied, onChoose, onUndo, onCopy }: {
  item: Item; dim: boolean; busy: boolean; copied: boolean;
  onChoose: () => void; onUndo: () => void; onCopy: () => void;
}) {
  const st = STATUS[item.status];
  const chosen = item.status === "chosen" || item.status === "archived";
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
        <span className="whitespace-nowrap" style={{ color: st.color }}>{st.text}</span>
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

      <div className="flex gap-2 mt-auto pt-1">
        {item.status === "proposed" && (
          <button onClick={onChoose} disabled={busy}
            className="rounded px-3 py-1 font-semibold text-white disabled:opacity-50" style={{ background: "var(--sig-ok)" }}>
            {busy ? "처리 중" : "이걸로"}
          </button>
        )}
        {item.status === "chosen" && (
          <button onClick={onUndo} disabled={busy} className="rounded px-3 py-1 border disabled:opacity-50">
            {busy ? "처리 중" : "선택 취소"}
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
