"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";

// ---------- 콘텐츠 보드 공용 뼈대 ----------
//
// 2026-09-22. 김호: "밸런스랩이랑 통일을 해줘. 두 탭의 레이아웃을. 탭마다 다르면 너무 헷갈리잖아."
//
// 펫 칩과 밸런스랩 칩을 오가면 같은 자리에 다른 모양이 나왔다. 펫은 편집국 판, 밸런스랩은
// 옛날 표였다. 브랜드를 바꿀 때마다 눈이 다시 화면을 읽어야 했다.
//
// 그래서 "비슷하게 생기게" 하지 않고 뼈대를 한 벌로 묶었다. 세 칸(매거진·네이버·자료조사)이
// 같은 부품을 쓴다. 한쪽만 모양이 어긋나는 일이 구조적으로 안 생긴다.
//
//   BoardCard
//     Masthead   머리단: 안내(eyebrow) · 제목 · 한 줄 설명 · 갱신 시각
//       FigureRow  읽을 값 하나를 크게(hero), 나머지는 작게
//       SplitBar   구성비 한 조각 (브랜드 / 단계 / 요일별 수집)
//       AlertStrip 조치할 것은 줄 안에 섞지 않고 띠로 떼어낸다
//     Columns    본문 5:7 비대칭 두 칸. 왼쪽=골라 볼 것, 오른쪽=흘러가는 기록
//     Footnote   이 숫자가 어디서 왔는지
//
// 값은 로컬 content-board-push.mjs 가 계산해 올린다. 대시보드는 판정하지 않는다.
// 규칙은 볼트 Work/밸런스랩/projects/네이버블로그-자동화/_스크립트/content-board-push.mjs 주석.

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

// 날짜는 항상 파싱한다. 연도를 박아 넣으면 해가 바뀌는 순간 조용히 틀린다.
export const monthLabel = (key: string) => {
  const [y, m] = key.split("-");
  return m ? `${y}. ${Number(m)}월` : key;
};
export const dayLabel = (iso: string | null) => (iso && iso.length >= 10 ? iso.slice(5).replace("-", ".") : "??.??");
export const monthKey = (iso: string | null) => (iso && iso.length >= 7 ? iso.slice(0, 7) : "날짜 없음");

/** 들어온 순서를 지키면서 달별로 묶는다. 대시보드가 다시 줄 세우지 않는다. */
export function groupByMonth<T>(rows: T[], pick: (r: T) => string | null) {
  const out: { key: string; rows: T[] }[] = [];
  for (const r of rows) {
    const key = monthKey(pick(r));
    const last = out[out.length - 1];
    if (last && last.key === key) last.rows.push(r);
    else out.push({ key, rows: [r] });
  }
  return out;
}

// 보드는 하루 두 번(06시 크롤러 뒤, 09시 작성 뒤) 올라온다. 36시간 넘게 안 오면 올리는 쪽이 멈춘 것이다.
const STALE_HOURS = 36;
export function Stale({ at }: { at?: string }) {
  if (!at) return null;
  const h = (Date.now() - new Date(at).getTime()) / 3_600_000;
  return (
    <span className="stamp whitespace-nowrap" style={{ color: h > STALE_HOURS ? "var(--sig-danger)" : "var(--muted-foreground)" }}>
      {h > STALE_HOURS ? `갱신 멈춤 (${Math.floor(h)}시간 전)` : `갱신 ${kst(at)}`}
    </span>
  );
}

// 표가 없어 스냅샷으로 뜬 칸임을 밝힌다. 배포에 실린 값이라 크론이 다시 올려도 배포 전까지 안 바뀐다.
// 라이브인 척하면 낡은 수치를 최신으로 읽게 된다.
export function Snap({ at }: { at: string | null }) {
  if (at === null) return null;
  return (
    <span className="stamp whitespace-nowrap" style={{ color: "var(--sig-warn)" }}>
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
      <div className="space-y-1 px-5 py-4 text-xs">
        <div style={{ color: "var(--sig-danger)" }}>{what}: {missing ? "표가 아직 없습니다" : error}</div>
        {missing && (
          <div className="text-muted-foreground">
            Supabase SQL Editor 에 <code>docs/sql/_PENDING.sql</code> 을 한 번 실행하면 이 칸이 살아납니다.
            그다음 볼트에서 <code>node content-board-push.mjs</code> 를 돌리면 값이 찹니다.
          </div>
        )}
      </div>
    </Card>
  );
}

/** 값이 아직 안 올라온 칸. 무엇을 돌리면 채워지는지 말한다. */
export function BoardEmpty({ what, how }: { what: string; how: string }) {
  return (
    <Card>
      <div className="px-5 py-4 text-xs text-muted-foreground">
        {what}: 아직 올라온 값이 없습니다. 로컬에서 <code>{how}</code> 을 한 번 돌리면 채워집니다.
      </div>
    </Card>
  );
}

export function BoardCard({ children }: { children: React.ReactNode }) {
  return <Card className="overflow-hidden">{children}</Card>;
}

export function Masthead({ eyebrow, title, subtitle, right, children }: {
  eyebrow: string; title: string; subtitle: string;
  right?: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <div className="px-5 pt-5 pb-4" style={{ backgroundImage: "var(--surface-sheen)" }}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="stamp text-muted-foreground tracking-[0.16em]">{eyebrow}</p>
          <h3 className="text-base font-semibold tracking-tight mt-1">{title}</h3>
          <p className="stamp text-muted-foreground mt-1">{subtitle}</p>
        </div>
        {right && <div className="flex items-center gap-2 pt-0.5">{right}</div>}
      </div>
      {children}
    </div>
  );
}

/** 머리단 수치 한 칸. hero 는 그 카드에서 제일 먼저 읽혀야 하는 값 하나뿐이다. */
export function Figure({ value, unit, label, sub, hero, tone }: {
  value: string; unit?: string; label: string; sub?: string; hero?: boolean; tone?: "ok" | "warn" | "danger";
}) {
  return (
    <div className="min-w-0">
      <p className={hero
        ? "num text-[28px] font-bold leading-none tracking-tight"
        : "num text-[18px] font-semibold leading-none"}
        style={tone ? { color: `var(--sig-${tone})` } : undefined}>
        {value}
        {unit && <span className="ml-0.5 text-[11px] font-medium text-muted-foreground">{unit}</span>}
      </p>
      <p className="stamp text-muted-foreground mt-1.5 whitespace-nowrap">{label}</p>
      {sub && <p className="stamp mt-0.5 whitespace-nowrap" style={{ color: "var(--sig-idle)" }}>{sub}</p>}
    </div>
  );
}

export function FigureRow({ children }: { children: React.ReactNode }) {
  return <div className="mt-5 flex flex-wrap items-end gap-x-7 gap-y-4">{children}</div>;
}

export function FigureRule() {
  return <span aria-hidden className="hidden sm:block h-9 w-px self-center" style={{ background: "var(--rule)" }} />;
}

/** 구성비 한 조각. 머리단 오른쪽 자리는 세 칸이 모두 이 크기로 쓴다. */
export function SplitBar({ parts }: { parts: { key: string; label: string; value: number; color: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (total <= 0) return null;
  return (
    <div className="ml-auto min-w-[9rem]">
      <div aria-hidden className="flex h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--muted)" }}>
        {parts.filter((p) => p.value > 0).map((p) => (
          <span key={p.key} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
        {parts.filter((p) => p.value > 0).map((p) => (
          <span key={p.key} className="stamp text-muted-foreground inline-flex items-center gap-1">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: p.color }} />
            {p.label} {p.value}
          </span>
        ))}
      </div>
    </div>
  );
}

/** 조치가 필요한 것만 띠로 뽑는다. 줄 안에 섞어 두면 안 읽힌다. */
export function AlertStrip({ tone, title, body }: { tone: "danger" | "warn" | "ok"; title: string; body: string }) {
  const color = `var(--sig-${tone})`;
  return (
    <div className="flex items-start gap-2.5 rounded-lg border px-3 py-2.5"
      style={{ borderColor: `var(--sig-${tone}-border)`, backgroundColor: `var(--sig-${tone}-surface)` }}>
      <span aria-hidden className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
        style={{ color, border: `1px solid ${color}` }}>!</span>
      <div className="min-w-0">
        <p className="text-xs font-semibold" style={{ color }}>{title}</p>
        <p className="stamp text-muted-foreground mt-0.5">{body}</p>
      </div>
    </div>
  );
}

export function AlertRow({ children }: { children: React.ReactNode }) {
  return <div className="mt-4 grid gap-2 md:grid-cols-2">{children}</div>;
}

/** 상태 알약. 브랜드·단계 점과 모양을 달리해 '무엇'과 '괜찮은가'가 안 섞이게 한다. */
export function Flag({ tone, children, title }: { tone: "danger" | "warn" | "ok" | "idle"; children: string; title?: string }) {
  return (
    <span className="stamp shrink-0 rounded-full border px-1.5 py-px max-w-[9.5rem] truncate"
      title={title}
      style={{ color: `var(--sig-${tone})`, borderColor: `var(--sig-${tone}-border)`, backgroundColor: `var(--sig-${tone}-surface)` }}>
      {children}
    </span>
  );
}

export function SectionHead({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex items-baseline gap-2 mb-3">
      <h4 className="shrink-0 whitespace-nowrap text-[11px] font-semibold tracking-[0.08em]">{title}</h4>
      {note && <span className="stamp text-muted-foreground truncate">{note}</span>}
      <span aria-hidden className="h-px flex-1" style={{ background: "var(--rule)" }} />
    </div>
  );
}

/**
 * 본문 두 칸.
 *
 * ★ 좁은 화면에서 한 칸이 될 때도 minmax(0,...) 를 줘야 한다. 그냥 grid 면 칸 너비가
 *   내용의 min-content 로 잡혀서, 줄임표(truncate) 걸린 긴 제목이 칸을 통째로 늘린다.
 *   2026-09-22 실측: 390px 에서 카드 안쪽이 517px 로 불어나 오른쪽 숫자가 잘려 나갔다.
 */
export function Columns({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] border-t lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <section className="px-5 py-4 lg:border-r">{left}</section>
      <section className="border-t px-5 py-4 lg:border-t-0">{right}</section>
    </div>
  );
}

export function Footnote({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-5 pb-5">
      <p className="surface-sunken stamp text-muted-foreground px-3 py-2">{children}</p>
    </div>
  );
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="stamp text-muted-foreground">{children}</p>;
}

/** 홈통 + 채움. 홈통을 --border 로 둬야 "어디까지가 전체인지"가 읽힌다. */
export function MiniBar({ ratio, accent }: { ratio: number; accent?: boolean }) {
  const r = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
  return (
    <span aria-hidden className="block h-[3px] w-full overflow-hidden rounded-full" style={{ background: "var(--border)" }}>
      <span className="block h-full rounded-full"
        style={{
          width: `${Math.max(4, r * 100)}%`,
          background: accent ? "var(--primary)" : "var(--foreground)",
          opacity: accent ? 0.35 + 0.65 * r : 0.28 + 0.45 * r,
        }} />
    </span>
  );
}

/** 목록이 길 때 잘린 줄을 흐리게 덮어 스크롤 칸인 걸 알린다. */
export function ScrollList({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      <div className="lg:max-h-[38rem] lg:overflow-y-auto lg:pr-1">{children}</div>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-8 lg:block"
        style={{ background: "linear-gradient(to top, var(--card), transparent)" }} />
    </div>
  );
}

/** 달 구분선. 흘러가는 기록의 척추 역할. */
export function MonthRule({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="num stamp font-semibold">{label}</span>
      <span aria-hidden className="h-px flex-1" style={{ background: "var(--rule)" }} />
      <span className="stamp text-muted-foreground">{count}편</span>
    </div>
  );
}
