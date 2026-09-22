"use client";

import {
  useBoard, kst, dayLabel, monthLabel, groupByMonth,
  BoardCard, BoardEmpty, BoardError, Masthead, Figure, FigureRow, FigureRule, SplitBar,
  AlertRow, AlertStrip, Flag, SectionHead, Columns, Footnote, EmptyNote, ScrollList, MonthRule,
  Stale, Snap,
} from "@/components/board-kit";

// ---------- 네이버 블로그 진행판 (밸런스랩) ----------
//
// 2026-09-22 재작성. 김호: "밸런스랩이랑 통일을 해줘. 두 탭의 레이아웃을."
// 옛 판은 6칸짜리 넓은 표였다. 칸 셋이 거의 "-" 로 비어 있었고, 사람이 손대야 하는
// "검토 대기"가 회색 칩 하나로 다른 숫자들과 같은 크기로 앉아 있었다.
//
// 자사몰 매거진 칸과 같은 뼈대(board-kit)를 쓴다. 브랜드 칩을 오갈 때 눈이 다시 읽지 않도록.
//   머리단 = 검토 대기 하나를 크게 + 단계 구성비
//   본문 왼쪽 = 초안 진행(골라 볼 것), 오른쪽 = 블로그에 올라간 글(흘러가는 기록)

type Stage = "draft" | "temp_saved" | "published" | "unconfirmed";

interface NaverPost {
  slug: string; title: string; draftDate: string; notion: string | null; stage: Stage;
  tempSave: { ok: boolean; at: string; note: string | null } | null;
  published: { title: string; url: string; date: string | null; match: "exact" | "similar"; score: number | null } | null;
}
interface NaverRecent { blog: string; rssOk: boolean; recent: { title: string; url: string; date: string | null }[] }

// 단계 색: 파랑(공정 안에서 살아 있음) → 앰버(사람 차례) → 초록(끝). 회색은 추적이 끊긴 것.
// 의미색을 그대로 쓰되 '발행 미확인'에는 붉은색을 쓰지 않는다. 실패가 아니라 확인이 안 된 것이다.
const STAGE: Record<Stage, { text: string; short: string; color: string; step: number }> = {
  draft: { text: "초안", short: "초안", color: "var(--primary)", step: 1 },
  temp_saved: { text: "임시저장 · 검토 대기", short: "검토 대기", color: "var(--sig-warn)", step: 2 },
  published: { text: "발행됨", short: "발행됨", color: "var(--sig-ok)", step: 3 },
  unconfirmed: { text: "발행 미확인", short: "발행 미확인", color: "var(--sig-idle)", step: 1 },
};
const STAGE_ORDER: Stage[] = ["temp_saved", "draft", "published", "unconfirmed"];

/** 초안 → 임시저장 → 발행 3칸. 매거진 칸의 조회수 막대와 같은 자리에 들어가는 '진행 정도'. */
function StepBar({ stage }: { stage: Stage }) {
  const done = STAGE[stage].step;
  return (
    <span aria-hidden className="flex items-center gap-1">
      {[1, 2, 3].map((i) => (
        <span key={i} className="h-[3px] w-full rounded-full"
          style={{ background: done >= i ? STAGE[stage].color : "var(--border)", opacity: done >= i ? 1 : 1 }} />
      ))}
    </span>
  );
}

export function NaverProgressBoard() {
  const { rows, error, snap } = useBoard<NaverPost | NaverRecent>("naver");
  if (error) return <BoardError what="네이버 블로그 진행판" error={error} />;
  if (!rows) return null;
  if (rows.length === 0) return <BoardEmpty what="네이버 블로그 진행판" how="content-board-push.mjs --only=naver" />;

  const recentBlog = rows.find((r) => r.item_key === "_recent")?.data as NaverRecent | undefined;
  const posts = rows.filter((r) => r.item_key !== "_recent").map((r) => r.data as NaverPost);
  const reportedAt = rows[0]?.reported_at;

  const count = (s: Stage) => posts.filter((p) => p.stage === s).length;
  const waiting = count("temp_saved");
  const failed = posts.filter((p) => p.tempSave && !p.tempSave.ok).length;
  const unconfirmed = count("unconfirmed");

  const stageParts = STAGE_ORDER
    .map((s) => ({ key: s, label: STAGE[s].short, value: count(s), color: STAGE[s].color }))
    .filter((p) => p.value > 0);

  // 왼쪽은 공정 안에 살아 있는 것(검토 대기 · 초안)을 먼저 세운다. 손댈 것이 위로 온다.
  const live = posts
    .filter((p) => p.stage === "temp_saved" || p.stage === "draft")
    .sort((a, b) => STAGE[b.stage].step - STAGE[a.stage].step || b.draftDate.localeCompare(a.draftDate));
  const rest = posts.filter((p) => p.stage !== "temp_saved" && p.stage !== "draft");

  const blogPosts = recentBlog?.recent || [];
  const matchedCount = blogPosts.filter((r) => posts.some((p) => p.published?.url === r.url)).length;
  const months = groupByMonth(blogPosts, (r) => r.date);

  return (
    <BoardCard>
      <Masthead
        eyebrow={`BLOG.NAVER.COM / ${(recentBlog?.blog || "밸런스랩").toUpperCase()}`}
        title="네이버 블로그 진행판"
        subtitle="밸런스랩 · 최근 45일 초안이 어디까지 갔는지"
        right={<><Stale at={reportedAt} /><Snap at={snap} /></>}
      >
        <FigureRow>
          <Figure hero
            value={waiting.toLocaleString()}
            unit="편"
            label="검토 대기"
            sub="임시저장까지 끝났고 사람 차례" />
          <FigureRule />
          <Figure value={count("draft").toLocaleString()} unit="편" label="초안" />
          <Figure value={count("published").toLocaleString()} unit="편" label="발행 확인됨" />
          <Figure value={posts.length.toLocaleString()} unit="편" label="최근 45일 초안" />
          <SplitBar parts={stageParts} />
        </FigureRow>

        {(failed > 0 || unconfirmed > 0 || recentBlog?.rssOk === false) && (
          <AlertRow>
            {failed > 0 && (
              <AlertStrip tone="danger"
                title={`임시저장이 실패한 글 ${failed}편`}
                body="네이버 에디터에 넣다가 끊겼습니다. 목록에서 붉은 표가 붙은 줄을 다시 돌려야 합니다." />
            )}
            {recentBlog?.rssOk === false && (
              <AlertStrip tone="danger"
                title="블로그 새 글 목록을 못 읽었습니다"
                body="발행 여부를 제목으로 대조할 수 없어 아래 발행 상태가 모두 미확인으로 남습니다." />
            )}
            {unconfirmed > 0 && (
              <AlertStrip tone="warn"
                title={`발행 미확인 ${unconfirmed}편`}
                body="초안은 있는데 블로그 새 글 목록에서 같은 제목을 못 찾았습니다. 발행할 때 제목을 바꾸면 여기에 남습니다." />
            )}
          </AlertRow>
        )}
      </Masthead>

      <Columns
        left={<>
          <SectionHead title="초안 진행" note={`공정 안 ${live.length}편 · 끝났거나 끊긴 것 ${rest.length}편`} />
          {posts.length === 0 ? <EmptyNote>최근 45일 초안이 없습니다.</EmptyNote> : (
            <ol className="space-y-px">
              {[...live, ...rest].map((p) => {
                // 매거진 칸과 같게, 갈 곳이 있는 줄만 링크로 만든다. 갈 곳 없는 줄에
                // 링크처럼 보이는 효과만 주면 눌러도 아무 일이 안 일어난다.
                const row = (
                  <div className="flex items-start gap-2.5 rounded-md px-2 py-3 transition-colors group-hover:bg-[var(--accent)]">
                    <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: STAGE[p.stage].color }} />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-[12.5px] leading-snug group-hover:underline" title={p.title}>{p.title}</span>
                        {p.tempSave && !p.tempSave.ok && <Flag tone="danger" title={p.tempSave.note || ""}>임시저장 실패</Flag>}
                      </span>
                      <span className="mt-1.5 grid grid-cols-[4.2rem_minmax(0,1fr)] items-center gap-2">
                        <span className="stamp num text-muted-foreground">{p.draftDate}</span>
                        <StepBar stage={p.stage} />
                      </span>
                    </span>
                    <span className="flex w-[6.6rem] shrink-0 flex-col items-end gap-0.5 pt-px">
                      <span className="stamp whitespace-nowrap" style={{ color: STAGE[p.stage].color }}>{STAGE[p.stage].short}</span>
                      {p.tempSave?.ok && <span className="stamp num whitespace-nowrap text-muted-foreground">{kst(p.tempSave.at)}</span>}
                      {p.notion && <span className="stamp text-muted-foreground">노션 열기</span>}
                    </span>
                  </div>
                );
                return (
                  <li key={p.slug} className={p.notion ? "group -mx-2" : "-mx-2"}>
                    {p.notion
                      ? <a href={p.notion} target="_blank" rel="noreferrer" className="block">{row}</a>
                      : row}
                  </li>
                );
              })}
            </ol>
          )}
        </>}
        right={<>
          <SectionHead
            title="블로그에 올라간 글"
            note={recentBlog?.rssOk === false
              ? "새 글 목록 읽기 실패"
              : `새 글 목록 ${blogPosts.length}편 · 우리 초안과 대조된 것 ${matchedCount}편`} />
          {blogPosts.length === 0 ? (
            <EmptyNote>
              {recentBlog?.rssOk === false
                ? "블로그 새 글 목록을 못 읽어 비어 있습니다. 진행판의 발행 상태도 믿을 수 없습니다."
                : "블로그 새 글 목록에 글이 없습니다."}
            </EmptyNote>
          ) : (
            <ScrollList>
              {months.map((m) => (
                <div key={m.key} className="mb-1.5 last:mb-0">
                  <MonthRule label={monthLabel(m.key)} count={m.rows.length} />
                  <ul className="space-y-px">
                    {m.rows.map((r) => {
                      // 이 글이 우리 초안 중 어느 것인지 대조해서 붙여 준다(원천이 이미 맞춰 놓은 값).
                      const matched = posts.find((p) => p.published?.url === r.url);
                      return (
                        <li key={r.url} className="group -mx-2">
                          <a href={r.url} target="_blank" rel="noreferrer"
                            className="grid grid-cols-[2.6rem_minmax(0,1fr)] sm:grid-cols-[2.6rem_minmax(0,1fr)_5.5rem] items-center gap-x-3 rounded-md px-2 py-[5px] transition-colors group-hover:bg-[var(--accent)]">
                            <span className="num stamp text-muted-foreground">{dayLabel(r.date)}</span>
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span className="truncate text-[12.5px] leading-snug group-hover:underline" title={r.title}>{r.title}</span>
                              {matched?.published?.match === "similar" && <Flag tone="warn" title="제목이 초안과 조금 다릅니다">제목 유사</Flag>}
                            </span>
                            <span className="hidden justify-end sm:flex">
                              {matched && <Flag tone="ok" title={`초안 ${matched.slug}`}>초안 대조됨</Flag>}
                            </span>
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </ScrollList>
          )}
        </>}
      />

      <Footnote>
        자동 작업이 네이버 에디터에 넣고 임시저장까지 합니다. 검토와 발행은 사람이 합니다.
        발행 여부는 블로그 새 글 목록의 제목으로 대조합니다. 대시보드는 따로 판정하지 않습니다.
      </Footnote>
    </BoardCard>
  );
}
