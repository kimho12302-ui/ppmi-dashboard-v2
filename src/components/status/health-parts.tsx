"use client";

import Link from "next/link";
import type { DashboardHealth, Issue, Level, SourceRow, CollectorRow } from "@/lib/dashboard-health";

// 「대시보드 상태」 화면의 조각들. 색 어휘는 status-ui 의 의미색과 같다:
//   고장 = 빨강, 주의 = 노랑, 정상 = 초록, 의도 중단·미운영 = 회색(경고가 아니다).

export const LEVEL: Record<Level, { label: string; color: string; surface: string; border: string }> = {
  broken: { label: "고장", color: "var(--sig-danger)", surface: "var(--sig-danger-surface)", border: "var(--sig-danger-border)" },
  warn: { label: "주의", color: "var(--sig-warn)", surface: "var(--sig-warn-surface)", border: "var(--sig-warn-border)" },
  ok: { label: "정상", color: "var(--sig-ok)", surface: "var(--sig-ok-surface)", border: "var(--sig-ok-border)" },
  paused: { label: "쉬는 중", color: "var(--sig-idle)", surface: "var(--sig-idle-surface)", border: "var(--sig-idle-border)" },
};

function Dot({ level, size = 8 }: { level: Level; size?: number }) {
  return (
    <span
      aria-hidden
      className="rounded-full flex-shrink-0 inline-block"
      style={{ width: size, height: size, backgroundColor: LEVEL[level].color }}
    />
  );
}

function Pill({ level, text }: { level: Level; text: string }) {
  const v = LEVEL[level];
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-xs font-medium whitespace-nowrap"
      style={{ color: v.color, backgroundColor: v.surface, borderColor: v.border }}
    >
      <Dot level={level} size={6} />
      {text}
    </span>
  );
}

export function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-2 flex-wrap mb-2">
      <h2 className="text-base font-semibold">{title}</h2>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

/** 맨 위 한 줄 결론. 큰 글씨 하나로 "믿어도 되나"에 답한다. */
export function Verdict({ data, onRefresh, loading }: { data: DashboardHealth; onRefresh: () => void; loading: boolean }) {
  const { broken, warn } = data.counts;
  const level: Level = broken > 0 ? "broken" : warn > 0 ? "warn" : "ok";
  const v = LEVEL[level];
  const headline =
    level === "ok" ? "정상. 지금 숫자를 그대로 봐도 됩니다"
    : level === "broken" ? `고장 ${broken}건. 아래 항목이 채우는 숫자는 낮거나 비어 보일 수 있습니다`
    : "숫자는 대체로 맞습니다. 확인할 것이 있습니다";
  return (
    <section
      className="rounded-xl border p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6"
      style={{ backgroundColor: v.surface, borderColor: v.border }}
      aria-label="한 줄 결론"
    >
      <div className="flex items-center gap-3 min-w-0">
        <Dot level={level} size={14} />
        <p className="text-lg sm:text-xl font-bold leading-snug" style={{ color: v.color }}>{headline}</p>
      </div>
      <div className="flex items-center gap-2 flex-wrap sm:ml-auto">
        <Pill level="broken" text={`고장 ${broken}`} />
        <Pill level="warn" text={`주의 ${warn}`} />
        <Pill level="ok" text={`정상 ${data.counts.ok}`} />
        <Pill level="paused" text={`쉬는 중 ${data.counts.paused}`} />
        <button
          onClick={onRefresh}
          disabled={loading}
          className="text-xs px-2 py-1 rounded-md border hover:bg-muted transition-colors disabled:opacity-50"
        >
          {loading ? "확인 중" : "다시 확인"}
        </button>
      </div>
    </section>
  );
}

function IssueCard({ it }: { it: Issue }) {
  const v = LEVEL[it.level];
  return (
    <li className="rounded-lg border p-3 min-w-0" style={{ backgroundColor: v.surface, borderColor: v.border }}>
      <div className="flex items-start gap-2 flex-wrap">
        <Pill level={it.level} text={v.label} />
        <span className="text-sm font-semibold leading-snug min-w-0 break-words" style={{ color: v.color }}>{it.title}</span>
        {it.since && <span className="num text-xs text-muted-foreground ml-auto whitespace-nowrap">{it.since} 부터</span>}
      </div>
      <dl className="mt-2 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs">
        <dt className="text-muted-foreground">영향</dt>
        <dd className="break-words">{it.impact}</dd>
        {it.cause && (
          <>
            <dt className="text-muted-foreground">기록된 원인</dt>
            <dd className="break-words text-muted-foreground">{it.cause}</dd>
          </>
        )}
        <dt className="text-muted-foreground">할 일</dt>
        <dd className="break-words">
          {it.action}
          {it.link && (
            <Link href={it.link} className="ml-2 underline underline-offset-2" style={{ color: "var(--primary)" }}>
              바로 가기 →
            </Link>
          )}
        </dd>
      </dl>
    </li>
  );
}

export function IssueList({ issues }: { issues: Issue[] }) {
  if (issues.length === 0) {
    return <p className="text-sm text-muted-foreground">고장·주의 항목이 없습니다.</p>;
  }
  return <ul className="grid gap-2 md:grid-cols-2">{issues.map((it) => <IssueCard key={it.key} it={it} />)}</ul>;
}

/** 표 한 줄. 넓은 화면에서는 4칸, 좁은 화면에서는 이름·판정 한 줄 + 날짜·비고 한 줄로 접힌다. */
function Row({ name, sub, date, level, verdict, note }: { name: string; sub?: string; date: string | null; level: Level; verdict: string; note: string }) {
  const quiet = level === "paused";
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1.3fr)_6.5rem_8.5rem_minmax(0,2fr)] gap-x-3 gap-y-0.5 items-baseline px-3 py-2 border-t first:border-t-0">
      <div className="min-w-0">
        <span className={`text-sm font-medium ${quiet ? "text-muted-foreground" : ""}`}>{name}</span>
        {sub && <span className="ml-1.5 text-[11px] text-muted-foreground">{sub}</span>}
      </div>
      <span className="num text-xs text-muted-foreground order-3 sm:order-none">{date || ""}</span>
      <span className="justify-self-end sm:justify-self-start"><Pill level={level} text={verdict} /></span>
      <span className="text-xs text-muted-foreground break-words order-4 sm:order-none col-span-2 sm:col-span-1">{note}</span>
    </li>
  );
}

function TableHead({ cols }: { cols: [string, string, string, string] }) {
  return (
    <div className="hidden sm:grid grid-cols-[minmax(0,1.3fr)_6.5rem_8.5rem_minmax(0,2fr)] gap-x-3 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground bg-muted/40 border-b">
      {cols.map((c) => <span key={c}>{c}</span>)}
    </div>
  );
}

const LEVEL_ORDER: Record<Level, number> = { broken: 0, warn: 1, ok: 2, paused: 3 };

export function SourceTable({ rows }: { rows: SourceRow[] }) {
  const sorted = [...rows].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <TableHead cols={["소스", "마지막 데이터", "판정", "비고"]} />
      <ul>{sorted.map((r) => <Row key={r.id} name={r.label} sub={r.kind} date={r.latestDate} level={r.level} verdict={r.verdict} note={r.note} />)}</ul>
    </div>
  );
}

export function CollectorTable({ rows, dailySync }: { rows: CollectorRow[]; dailySync: DashboardHealth["dailySync"] }) {
  const sorted = [...rows].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <TableHead cols={["수집기", "마지막 실행", "판정", "비고"]} />
      <ul>
        <Row name="daily-sync (매일 자동 수집)" sub="GitHub Actions" date={dailySync.lastRun} level={dailySync.level} verdict={dailySync.verdict} note={dailySync.note} />
        {sorted.map((r) => (
          <Row
            key={r.source}
            name={r.label}
            date={r.lastRun}
            level={r.level}
            verdict={r.verdict}
            note={[r.latestDataDate ? `데이터 ${r.latestDataDate} 까지` : "", r.note].filter(Boolean).join(" · ")}
          />
        ))}
      </ul>
    </div>
  );
}

export function InputList({ inputs }: { inputs: DashboardHealth["inputs"] }) {
  if (inputs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        손으로 넣을 것이 남아 있지 않습니다. <Link href="/daily" className="underline underline-offset-2">일일 입력</Link>
      </p>
    );
  }
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {inputs.map((i) => (
        <li key={i.id} className="flex items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: LEVEL.warn.border, backgroundColor: LEVEL.warn.surface }}>
          <Dot level="warn" />
          <span className="text-sm font-medium" style={{ color: LEVEL.warn.color }}>{i.label}</span>
          <span className="num text-xs text-muted-foreground">{i.latestDate ? `${i.latestDate} 까지 입력됨` : "입력 없음"}</span>
          <Link href={i.link} className="ml-auto text-xs px-2 py-1 rounded-md border hover:bg-muted whitespace-nowrap">일일 입력 →</Link>
        </li>
      ))}
    </ul>
  );
}
