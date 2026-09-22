"use client";

import { BRAND_COLORS } from "@/lib/types";
import {
  useBoard, kst, dayLabel, monthLabel, groupByMonth,
  BoardCard, BoardEmpty, BoardError, Masthead, Figure, FigureRow, FigureRule, SplitBar,
  AlertRow, AlertStrip, Flag, SectionHead, Columns, Footnote, EmptyNote, MiniBar, ScrollList, MonthRule,
  Stale, Snap,
} from "@/components/board-kit";

// ---------- 자사몰 매거진 (아이언펫·너티) ----------
//
// 2026-09-21 신설, 2026-09-22 화면 재작성(김호 반려: "최소한의 UI 도 고려 안 됐다").
// 첫 판은 숫자와 제목을 한 덩어리로 흘려 놓은 콘솔 출력이었다.
//
// 뼈대는 board-kit 의 것을 그대로 쓴다. 다른 두 칸(네이버·자료조사)과 자리가 같아야 한다.
//   머리단 = 누적 조회수 하나를 크게 + 브랜드 구성비
//   본문 왼쪽 = 많이 읽힌 글(골라 볼 것), 오른쪽 = 최근 발행(흘러가는 기록)
//
// 세 장부(mapping.json 원장 · published.json 실재 · 공개 게시판 조회수)를 로컬에서 맞춰 올린 것을
// 그린다. 어긋난 행은 감추지 않는다. 2026-09 에 그 어긋남 하나가 매거진 장부를 50건 묵히고
// 블로그를 13일 세웠다.

interface MagSummary {
  summary: true; recent: number; windowDays: number; totalArticles: number;
  totalViews: number; avgViews: number; mismatches: number; naverMissing: number; viewsReadAt: string | null;
}
interface MagTop { top: true; rank: number; articleNo: number; title: string; views: number; publish: string | null }
interface MagRow {
  articleNo: number; slug: string; keyword: string | null; brand: string | null; publish: string | null;
  ledgerStatus: string | null; liveOnSite: boolean; mismatch: string | null;
  views: number | null; viewsReadAt: string | null; naverDraft: boolean; url: string;
}
type MagItem = MagSummary | MagTop | MagRow;

const isSummary = (d: MagItem): d is MagSummary => "summary" in d;
const isTop = (d: MagItem): d is MagTop => "top" in d;

// 어긋남 문구는 원천이 문장으로 준다. 줄 안에 문장을 넣으면 잘려서 "..."로 끝난다.
// 아는 값만 짧은 표로 줄이고, 모르는 값은 원문 그대로 보여 준다(뜻을 지어내지 않는다).
// 어느 쪽이든 전체 문장은 마우스를 올리면 나온다.
const MISMATCH_SHORT: Record<string, string> = {
  "사이트에는 있는데 원장은 미발행": "원장 미발행",
  "원장은 발행인데 사이트에 없음": "사이트 없음",
};

// 원천은 브랜드를 한글 이름으로 준다. 다른 화면(매출·광고 차트)과 같은 색을 쓰려고 키로 옮긴다.
const BRAND_KEY: Record<string, string> = { "너티": "nutty", "아이언펫": "ironpet" };
const brandColor = (b: string | null) => (b && BRAND_COLORS[BRAND_KEY[b]]) || "var(--sig-idle)";

export function MagazineBoard() {
  const { rows, error, snap } = useBoard<MagItem>("magazine");
  if (error) return <BoardError what="자사몰 매거진" error={error} />;
  if (!rows) return null;
  if (rows.length === 0) return <BoardEmpty what="자사몰 매거진" how="content-board-push.mjs --only=magazine" />;

  const items = rows.map((r) => r.data);
  const summary = items.find(isSummary);
  const top = items.filter(isTop).sort((a, b) => a.rank - b.rank);
  const recent = items.filter((d): d is MagRow => !isSummary(d) && !isTop(d));
  const reportedAt = rows[0]?.reported_at;

  // 상위 글에는 주소가 없다. 최근 발행 줄의 주소 틀에서 글번호만 갈아 끼운다.
  // 틀을 못 찾으면 링크를 안 건다. 주소를 지어내면 404 로 보낸다.
  const sample = recent.find((r) => r.url && r.url.includes(`/${r.articleNo}/`));
  const topUrl = sample
    ? (no: number) => {
      const marker = `/${sample.articleNo}/`;
      const cut = sample.url.indexOf(marker);
      return `${sample.url.slice(0, cut)}/${no}/${sample.url.slice(cut + marker.length)}`;
    }
    : null;

  const months = groupByMonth(recent, (r) => r.publish);

  const brandCounts = recent.reduce<Record<string, number>>((acc, r) => {
    const k = r.brand || "미지정";
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const brandParts = Object.entries(brandCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => ({ key: name, label: name, value: n, color: brandColor(name) }));

  const topMax = Math.max(1, ...top.map((t) => t.views));
  const recentMax = Math.max(1, ...recent.map((r) => r.views ?? 0));
  const viewsReadAt = summary?.viewsReadAt || recent.find((r) => r.viewsReadAt)?.viewsReadAt || null;

  return (
    <BoardCard>
      <Masthead
        eyebrow="IRONPET.STORE / MAGAZINE"
        title="자사몰 매거진"
        subtitle="아이언펫 · 너티 게시판에 실제로 올라간 글과 공개 조회수"
        right={<><Stale at={reportedAt} /><Snap at={snap} /></>}
      >
        {summary && (
          <FigureRow>
            <Figure hero
              value={summary.totalViews.toLocaleString()}
              label="누적 조회수"
              sub={viewsReadAt ? `${kst(viewsReadAt)} 읽음` : undefined} />
            <FigureRule />
            <Figure value={summary.totalArticles.toLocaleString()} unit="편" label="전체 글" />
            <Figure value={summary.avgViews.toLocaleString()} label="편당 평균 조회" />
            <Figure value={summary.recent.toLocaleString()} unit="편" label={`최근 ${summary.windowDays}일 발행`} />
            <SplitBar parts={brandParts} />
          </FigureRow>
        )}

        {summary && (summary.mismatches > 0 || summary.naverMissing > 0) && (
          <AlertRow>
            {summary.mismatches > 0 && (
              <AlertStrip tone="danger"
                title={`장부와 사이트가 어긋난 글 ${summary.mismatches}편`}
                body="아래 최근 발행에서 붉은 표가 붙은 줄입니다. 사이트에는 올라가 있는데 원장에는 발행으로 안 적혀 있습니다." />
            )}
            {summary.naverMissing > 0 && (
              <AlertStrip tone="warn"
                title={`네이버 재구성이 없는 글 ${summary.naverMissing}편`}
                body="자사몰에는 올렸지만 같은 글의 네이버 초안이 없습니다." />
            )}
          </AlertRow>
        )}
      </Masthead>

      <Columns
        left={<>
          <SectionHead title="많이 읽힌 글" note="전 기간" />
          {top.length === 0 ? <EmptyNote>아직 조회수를 읽은 글이 없습니다.</EmptyNote> : (
            <ol className="space-y-px">
              {top.map((t) => {
                const row = (
                  <div className="flex items-start gap-2.5 rounded-md px-2 py-3 transition-colors group-hover:bg-[var(--accent)]">
                    <span className="num w-4 shrink-0 pt-px text-right text-[11px] font-semibold"
                      style={{ color: t.rank <= 3 ? "var(--primary)" : "var(--sig-idle)" }}>{t.rank}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] leading-snug group-hover:underline" title={t.title}>{t.title}</span>
                      <span className="mt-1.5 grid grid-cols-[4.2rem_minmax(0,1fr)] items-center gap-2">
                        <span className="stamp num text-muted-foreground">{t.publish || "날짜 없음"}</span>
                        <MiniBar ratio={t.views / topMax} accent />
                      </span>
                    </span>
                    <span className="num w-12 shrink-0 pt-px text-right text-[12px] font-semibold">{t.views.toLocaleString()}</span>
                  </div>
                );
                return (
                  <li key={t.articleNo} className="group -mx-2">
                    {topUrl
                      ? <a href={topUrl(t.articleNo)} target="_blank" rel="noreferrer" className="block">{row}</a>
                      : row}
                  </li>
                );
              })}
            </ol>
          )}
        </>}
        right={<>
          <SectionHead
            title="최근 발행"
            note={summary ? `최근 ${summary.windowDays}일 ${recent.length}편 · 막대는 이 목록 안에서의 상대 조회수` : `${recent.length}편`} />
          {recent.length === 0 ? <EmptyNote>최근 발행한 글이 없습니다.</EmptyNote> : (
            <ScrollList>
              {months.map((m) => (
                <div key={m.key} className="mb-1.5 last:mb-0">
                  <MonthRule label={monthLabel(m.key)} count={m.rows.length} />
                  <ul className="space-y-px">
                    {m.rows.map((r) => (
                      <li key={r.articleNo} className="group -mx-2">
                        <a href={r.url} target="_blank" rel="noreferrer"
                          className="grid grid-cols-[2.6rem_3.7rem_minmax(0,1fr)_2.4rem] sm:grid-cols-[2.6rem_3.7rem_14rem_minmax(3rem,1fr)_2.4rem] items-center gap-x-3 rounded-md px-2 py-[5px] transition-colors group-hover:bg-[var(--accent)]">
                          <span className="num stamp text-muted-foreground">{dayLabel(r.publish)}</span>
                          <span className="flex min-w-0 items-center gap-1">
                            <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: brandColor(r.brand) }} />
                            <span className="stamp truncate text-muted-foreground">{r.brand || "미지정"}</span>
                          </span>
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate text-[12.5px] leading-snug group-hover:underline" title={r.keyword || r.slug}>
                              {r.keyword || r.slug}
                            </span>
                            {r.mismatch && <Flag tone="danger" title={r.mismatch}>{MISMATCH_SHORT[r.mismatch] || r.mismatch}</Flag>}
                            {!r.naverDraft && <Flag tone="warn">네이버 없음</Flag>}
                          </span>
                          <span className="hidden sm:block"><MiniBar ratio={(r.views ?? 0) / recentMax} /></span>
                          <span className="num text-right text-[11px] font-medium">
                            {r.views === null ? "-" : r.views.toLocaleString()}
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </ScrollList>
          )}
        </>}
      />

      <Footnote>
        원장(mapping.json) · 실제 게시(published.json) · 게시판 공개 조회수 세 곳을 로컬에서 맞춰 올린 값입니다.
        대시보드는 따로 판정하지 않습니다.
      </Footnote>
    </BoardCard>
  );
}
