"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";

// 팀용 운영 상태 카드. 로컬 관제판이 매일 /api/ops-status 로 올린 판정을 그대로 그린다.
// 대시보드는 판정하지 않는다. 판정 규칙은 볼트 settings/pipelines/registry.json 이 정본이다.

type Signal = "ok" | "warn" | "fail" | "unknown";
interface Item {
  item_key: string;
  label: string;
  signal: Signal;
  summary: string;
  detail: string;
  last_at: string | null;
  reported_at: string;
  // brand 열이 따로 없어 metrics 안에 넣어 보낸다(ops_status 는 DDL 을 못 고친다).
  // null 이면 두 브랜드 공통 행이라 어느 쪽을 보든 나온다.
  // link = 그 칸에서 실제로 일하러 가는 곳(볼트 team-board.mjs 가 실측 주소만 넣는다)
  metrics?: { brand?: "pet" | "balancelab" | null; link?: string | null } | null;
}

const SIG: Record<Signal, { dot: string; color: string; text: string }> = {
  ok: { dot: "●", color: "var(--sig-ok)", text: "정상" },
  warn: { dot: "●", color: "var(--sig-warn)", text: "주의" },
  fail: { dot: "●", color: "var(--sig-danger)", text: "문제" },
  unknown: { dot: "○", color: "var(--muted-foreground)", text: "확인 못 함" },
};

// 관제판은 하루 두 번(아침 브리핑·야간 체인) 올린다. 36시간 넘게 안 오면 관제판 쪽이 멈춘 것이다.
const STALE_HOURS = 36;

function ago(iso: string): string {
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (h < 1) return "방금";
  if (h < 24) return `${Math.floor(h)}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

export function OpsStatusPanel({ section, title, hint, brand }: { section: "collector" | "content" | "report"; title: string; hint?: string; brand?: string }) {
  const [all, setAll] = useState<Item[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/ops-status?section=${section}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (alive) setAll(d.items || []); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [section]);

  if (failed) {
    return (
      <Card><CardContent className="p-4 text-sm" style={{ color: "var(--sig-danger)" }}>
        {title}: 상태를 불러오지 못했습니다.
      </CardContent></Card>
    );
  }
  if (!all) return null;
  // 브랜드를 고르면 그 브랜드 행 + 공통 행만. 전체면 다 보인다.
  const items = brand && brand !== "all"
    ? all.filter((i) => !i.metrics?.brand || i.metrics.brand === brand)
    : all;

  const reportedAt = items[0]?.reported_at;
  const stale = reportedAt ? (Date.now() - new Date(reportedAt).getTime()) / 3_600_000 > STALE_HOURS : true;
  const bad = items.filter((i) => i.signal === "fail" || i.signal === "warn").length;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <h3 className="text-base font-semibold">
            {title}
            {items.length > 0 && (
              <span className="ml-2 text-xs font-normal" style={{ color: bad ? "var(--sig-warn)" : "var(--sig-ok)" }}>
                {bad ? `확인 필요 ${bad}` : "모두 정상"}
              </span>
            )}
          </h3>
          <span className="text-xs" style={{ color: stale ? "var(--sig-danger)" : "var(--muted-foreground)" }}>
            {reportedAt ? `갱신 ${ago(reportedAt)}` : "아직 올라온 적 없음"}
            {stale && reportedAt ? " · 관제판이 멈췄을 수 있음" : ""}
          </span>
        </div>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">표시할 항목이 없습니다.</p>
        ) : (
          // 한 줄이 화면 폭을 가로지르면 이름과 값이 멀어져 눈이 따라가지 못한다.
          // 김호 2026-09-22: "가로가 너무 길어서 말이지". 그래서 좁은 칸으로 쪼갠다.
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((it) => {
              const s = SIG[it.signal] || SIG.unknown;
              const go = it.metrics?.link || null;
              return (
                <li
                  key={it.item_key}
                  className="rounded-lg border p-2.5 flex gap-2 items-start min-w-0"
                  style={{ borderColor: it.signal === "ok" ? undefined : s.color }}
                >
                  <span aria-label={s.text} title={s.text} style={{ color: s.color }} className="leading-5 shrink-0">{s.dot}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium leading-snug">{it.label}</div>
                    {it.summary && (
                      <p className="text-xs mt-0.5 leading-snug" style={{ color: it.signal === "ok" ? "var(--muted-foreground)" : s.color }}>
                        {it.summary}
                      </p>
                    )}
                    {it.detail && <p className="text-xs text-muted-foreground break-words mt-0.5 leading-snug">{it.detail}</p>}
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {it.last_at && <span className="text-[11px] text-muted-foreground">마지막 {it.last_at}</span>}
                      {/* 보기만 하고 끝나지 않게, 그 일을 하는 자리로 바로 보낸다. */}
                      {go && (
                        <a
                          href={go}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] underline underline-offset-2 hover:no-underline"
                          style={{ color: "var(--primary)" }}
                        >
                          하러 가기 →
                        </a>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
