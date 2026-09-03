"use client";

import { useState } from "react";
import Link from "next/link";
import { useDataStatus, type StatusSource, type CollectorHealth } from "@/hooks/use-data-status";
import { STATUS, MODE_LABEL, REASON_LABEL, COLLECTOR_HEALTH_LABEL, staleText } from "@/lib/status-ui";

/**
 * 상단 데이터 상태 레일.
 *
 * 이전 화면(FreshnessStrip)은 14개 소스를 한 줄에 11px 로 뿌리고 "정상 5 / 연결끊김 1 / 수기미입력 8"
 * 처럼 세기만 했다. 그래서
 *  - 회사가 안 돌리는 구글 애즈가 빨간 '연결끊김'으로 떴고,
 *  - API 가 없어 사람이 넣는 게 정상인 GFA·퍼널이 같은 무게의 경고로 깔렸고,
 *  - 정작 진짜 고장(메타 토큰 만료)이 그 사이에 묻혔다.
 *
 * 그래서 여기서는 세 가지를 서로 다른 사건으로 다룬다.
 *   고장      자동 수집이 멈춤 → 숫자를 믿을 수 없다. 항목·원인·조치를 항상 펼쳐서 보여준다.
 *   입력 필요  사람이 넣을 항목 → 할 일이다. 어디에 넣는지 링크를 같이 준다.
 *   미운영     안 돌리는 채널 → 조용히. 접힌 상태에서는 개수만.
 */

const SHORT: Record<string, string> = {
  sales: "판매실적",
  meta_ads: "메타",
  google_ads: "구글",
  naver_sa: "네이버 검색",
  naver_shopping: "네이버 쇼핑",
  ga4: "GA4",
  coupang_ads: "쿠팡 광고",
  coupang_funnel: "쿠팡 퍼널",
  gfa_saip: "GFA 사입",
  gfa_nutty: "GFA 너티",
  gfa_balancelab: "GFA 밸런스랩",
  smartstore_ironpet: "SS 아이언펫",
  smartstore_balancelab: "SS 밸런스랩",
  cafe24_funnel: "카페24 퍼널",
};

const short = (s: StatusSource) => SHORT[s.id] || s.label;
const mmdd = (d: string | null) => (d ? d.slice(5) : "없음");

function Dot({ color }: { color: string }) {
  return <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />;
}

/** 접힌 상태의 카운터. 색은 의미색, 숫자는 등폭. */
function Tally({ k, n, onClick }: { k: keyof typeof STATUS; n: number; onClick?: () => void }) {
  const v = STATUS[k];
  const dim = n === 0;
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border transition-colors"
      style={{
        color: dim ? "var(--muted-foreground)" : v.color,
        backgroundColor: dim ? "transparent" : v.surface,
        borderColor: dim ? "transparent" : v.border,
      }}
    >
      <Dot color={dim ? "var(--muted-foreground)" : v.color} />
      <span className="text-xs">{v.label}</span>
      <span className="num text-xs font-semibold">{n}</span>
    </button>
  );
}

/** 고장 1건 = 카드 1장. 무엇이·언제부터·왜·무엇을 해야 하는지 한 줄에. */
function BrokenRow({ s }: { s: StatusSource }) {
  return (
    <div
      className="flex items-start gap-2.5 px-3 py-2 rounded-lg border"
      style={{ backgroundColor: STATUS.broken.surface, borderColor: STATUS.broken.border }}
    >
      <span className="mt-1.5"><Dot color={STATUS.broken.color} /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-sm font-semibold" style={{ color: STATUS.broken.color }}>{short(s)}</span>
          <span className="stamp px-1.5 py-0.5 rounded" style={{ color: STATUS.broken.color, backgroundColor: STATUS.broken.surface }}>
            {REASON_LABEL[s.reason || "unknown"]}
          </span>
          <span className="num text-xs text-muted-foreground">
            마지막 데이터 {s.latestDate || "없음"} · {staleText(s.staleDays)}
          </span>
        </div>
        {s.action && <p className="text-xs text-muted-foreground mt-0.5">{s.action}</p>}
      </div>
    </div>
  );
}

/** 입력 필요 1건. '어디에 넣는지'까지가 한 항목이다. */
function InputRow({ s }: { s: StatusSource }) {
  return (
    <div
      className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg border"
      style={{ backgroundColor: STATUS.input_needed.surface, borderColor: STATUS.input_needed.border }}
    >
      <Dot color={STATUS.input_needed.color} />
      <span className="text-sm font-medium" style={{ color: STATUS.input_needed.color }}>{short(s)}</span>
      <span className="num text-xs text-muted-foreground">
        {mmdd(s.latestDate)}까지 입력됨 · {staleText(s.staleDays)}
      </span>
      <Link
        href={s.entry || "/settings"}
        className="ml-auto text-xs px-2 py-1 rounded-md border hover:bg-muted transition-colors whitespace-nowrap"
        style={{ borderColor: STATUS.input_needed.border, color: STATUS.input_needed.color }}
      >
        입력하기 →
      </Link>
    </div>
  );
}

function CollectorRow({ c }: { c: CollectorHealth }) {
  const color = c.health === "running" ? STATUS.ok.color : STATUS.broken.color;
  return (
    <div className="flex items-center gap-2 text-xs">
      <Dot color={color} />
      <span className="font-medium">{c.source}</span>
      <span className="stamp px-1 rounded" style={{ color }}>{COLLECTOR_HEALTH_LABEL[c.health]}</span>
      <span className="num text-muted-foreground ml-auto">
        마지막 실행 {c.lastRun || "없음"} · 최신 데이터 {c.latestDataDate || "없음"}
        {c.dataLagDays !== null && c.dataLagDays > 0 ? ` (${c.dataLagDays}일 밀림)` : ""}
      </span>
    </div>
  );
}

export function DataStatusRail() {
  const { data, failed } = useDataStatus();
  const [expanded, setExpanded] = useState(false);

  // 조회 자체가 실패하면 조용히 사라지면 안 된다 — 사라진 레일은 "이상 없음"으로 오독된다.
  if (failed) {
    return (
      <div
        className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border"
        style={{ backgroundColor: STATUS.broken.surface, borderColor: STATUS.broken.border, color: STATUS.broken.color }}
      >
        <Dot color={STATUS.broken.color} />
        <span>데이터 상태를 읽지 못했습니다. 아래 숫자의 신선도를 보증할 수 없습니다</span>
      </div>
    );
  }

  if (!data) {
    return <div className="h-9 rounded-lg border border-border/60 bg-muted/20 animate-pulse" />;
  }

  const broken = data.sources.filter((s) => s.status === "broken");
  const inputNeeded = data.sources
    .filter((s) => s.status === "input_needed")
    .sort((a, b) => (b.staleDays ?? 999) - (a.staleDays ?? 999));
  const inactive = data.sources.filter((s) => s.status === "inactive");
  const okList = data.sources.filter((s) => s.status === "ok");
  const frozenCollectors = data.collectors.filter((c) => c.health !== "running");

  const quiet = broken.length === 0 && inputNeeded.length === 0;

  return (
    <section className="rounded-xl border border-border/70 bg-card overflow-hidden" aria-label="데이터 상태">
      {/* 헤더: 접혀 있어도 세 분류가 각각 몇 건인지 읽힌다 */}
      <div className="flex items-center gap-2 flex-wrap px-3 py-2 border-b border-border/60 bg-muted/20">
        <span className="text-xs font-semibold">데이터 상태</span>
        <span className="num text-[11px] text-muted-foreground">{data.referenceDate} 기준</span>
        <div className="flex items-center gap-1.5 flex-wrap ml-1">
          <Tally k="broken" n={broken.length} onClick={() => setExpanded(true)} />
          <Tally k="input_needed" n={inputNeeded.length} onClick={() => setExpanded(true)} />
          <Tally k="inactive" n={inactive.length} onClick={() => setExpanded(true)} />
          <span className="num text-[11px] text-muted-foreground px-1">정상 {okList.length}</span>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {expanded ? "접기" : "전체 보기"}
          </button>
          <Link href="/settings" className="text-xs text-primary/80 hover:text-primary hover:underline">설정 →</Link>
        </div>
      </div>

      <div className="p-3 space-y-2">
        {quiet && !expanded && (
          <p className="text-xs text-muted-foreground">
            고장·미입력 없음. 자동 수집 {data.sources.filter((s) => s.mode === "auto").length}건, 수기 입력{" "}
            {data.sources.filter((s) => s.mode === "manual").length}건 모두 어제까지 채워져 있습니다.
          </p>
        )}

        {/* ★ 고장은 접혀 있어도 항상 전부 보인다. 이게 이 레일의 존재 이유다. */}
        {broken.length > 0 && (
          <div className="space-y-1.5">
            <p className="stamp" style={{ color: STATUS.broken.color }}>고장 · 아래 숫자에 반영되지 않음</p>
            {broken.map((s) => <BrokenRow key={s.id} s={s} />)}
          </div>
        )}

        {/* 입력 필요는 접힌 상태에서 오래된 순 3건까지. 나머지는 개수로. */}
        {inputNeeded.length > 0 && (
          <div className="space-y-1.5">
            <p className="stamp" style={{ color: STATUS.input_needed.color }}>
              입력 필요 · API가 없어 사람이 넣는 항목
            </p>
            {(expanded ? inputNeeded : inputNeeded.slice(0, 3)).map((s) => <InputRow key={s.id} s={s} />)}
            {!expanded && inputNeeded.length > 3 && (
              <button onClick={() => setExpanded(true)} className="text-xs text-muted-foreground hover:text-foreground pl-1">
                +{inputNeeded.length - 3}건 더 보기
              </button>
            )}
          </div>
        )}

        {expanded && (
          <div className="pt-1 grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-border/60 mt-1 pt-3">
            {(["auto", "manual", "inactive"] as const).map((mode) => {
              const list = data.sources.filter((s) => s.mode === mode);
              if (list.length === 0) return null;
              return (
                <div key={mode}>
                  <p className="stamp text-muted-foreground mb-1.5">
                    {MODE_LABEL[mode]} {list.length}
                  </p>
                  <div className="space-y-1">
                    {list.map((s) => {
                      const v = STATUS[s.status];
                      return (
                        <div key={s.id} className="flex items-center gap-1.5 text-xs">
                          <Dot color={v.color} />
                          <span className={s.status === "inactive" ? "text-muted-foreground" : ""}>{short(s)}</span>
                          <span className="num text-muted-foreground ml-auto">{mmdd(s.latestDate)}</span>
                        </div>
                      );
                    })}
                  </div>
                  {mode === "inactive" && list.some((s) => s.inactiveNote) && (
                    <p className="text-[11px] text-muted-foreground/80 mt-1.5 leading-snug">
                      {list.filter((s) => s.inactiveNote).map((s) => s.inactiveNote).join(" · ")}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* 죽은 수집기: ok:true 로 보고하면서 데이터는 안 늘어나는 경우.
            소스 목록에는 안 잡히므로(cafe24_sales) 따로 드러낸다. */}
        {expanded && frozenCollectors.length > 0 && (
          <div className="pt-2 border-t border-border/60 space-y-1">
            <p className="stamp" style={{ color: STATUS.broken.color }}>
              수집기 점검 {frozenCollectors.length}건 · 성공 보고와 실제 데이터가 어긋남
            </p>
            {frozenCollectors.map((c) => <CollectorRow key={c.source} c={c} />)}
          </div>
        )}
      </div>
    </section>
  );
}
