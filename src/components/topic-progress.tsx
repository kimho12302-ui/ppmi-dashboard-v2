"use client";

import {
  useBoard, BoardCard, BoardEmpty, BoardError, Masthead, SectionHead, Footnote, Stale, Snap,
} from "@/components/board-kit";

// ---------- 주제별 진행 ----------
//
// 김호 2026-09-23: "매번 이렇게 물어봐야하는거야? 버튼이나 대시보드에 진행은 안 되는거야?"
//
// 쓰레드 후보를 고르는 버튼은 이미 있었다(threads-candidates.tsx). 없던 것은 **고른 다음**이다.
// 한 주제가 쓰레드 · 인스타 · 블로그 · 노션 네 칸 중 어디까지 갔는지 볼 자리가 없어서
// 김호가 매번 대화로 물어야 했다.
//
// 값은 전부 볼트 파일의 실재다. 계산은 로컬 topic-board.mjs 가 하고 여기서는 그리기만 한다.
// 대시보드는 판정하지 않는다.
//
// 가로로 넓히지 않는다. 김호 2026-09-22 "가로가 너무 길어서" 안 읽힌다고 했다.
// 한 주제를 한 줄에 다 밀어 넣지 말고 채널을 세로로 쌓는다.

type State = "done" | "todo" | "unknown" | "dropped";

interface Channel {
  key: string;
  label: string;
  state: State;
  note: string;
  href: string | null;
}

interface Topic {
  week: string;
  axis: "balancelab" | "pet";
  axisLabel: string;
  n: string;
  title: string;
  status: "ready" | "selected" | "dropped";
  researchUrl: string | null;
  slug: string | null;
  channels: Channel[];
  axisHint?: string;
}

const STATUS: Record<Topic["status"], { text: string; tone: string }> = {
  selected: { text: "선택됨", tone: "var(--sig-ok)" },
  ready: { text: "후보", tone: "var(--muted-foreground)" },
  dropped: { text: "반려", tone: "var(--muted-foreground)" },
};

// 링크 글자는 칸마다 다르다. "여기로 가면 무엇을 할 수 있는가"를 적는다.
// 주소가 없으면 아무것도 그리지 않는다. 모르는 주소를 지어내면 404 로 보낸다.
const GO: Record<string, string> = {
  threads: "올리러 가기",
  instagram: "드라이브",
  blog: "열기",
  notion: "열기",
};

/**
 * 칸 하나의 표시. 네 가지 상태를 눈으로 구분할 수 있어야 한다.
 *   done    채워진 점   그 채널에 실물이 있다
 *   todo    빈 점       아직 안 했다
 *   unknown 가운뎃점    연결이 없어 알 수 없다. **안 한 것과 다르다**
 *   dropped 빈 점(흐림) 이 주제는 버려졌다
 */
function Dot({ state }: { state: State }) {
  if (state === "unknown") {
    return <span aria-hidden className="stamp leading-none text-muted-foreground" style={{ opacity: 0.6 }}>·</span>;
  }
  const on = state === "done";
  return (
    <span
      aria-hidden
      className="h-[7px] w-[7px] rounded-full"
      style={on
        ? { background: "var(--sig-ok)" }
        : { border: "1px solid var(--border)", opacity: state === "dropped" ? 0.4 : 1 }}
    />
  );
}

function ChannelRow({ c }: { c: Channel }) {
  const dim = c.state === "unknown" || c.state === "dropped";
  return (
    <li className="grid grid-cols-[0.9rem_2.9rem_minmax(0,1fr)_auto] items-center gap-x-2 py-[3px]">
      <span className="grid h-3 place-items-center"><Dot state={c.state} /></span>
      <span className="stamp text-muted-foreground">{c.label}</span>
      <span className="stamp truncate" style={dim ? { color: "var(--muted-foreground)" } : undefined} title={c.note}>
        {c.note}
      </span>
      {c.href
        ? <a href={c.href} target="_blank" rel="noreferrer" className="stamp shrink-0 underline decoration-dotted underline-offset-2 hover:decoration-solid">{GO[c.key] || "열기"}</a>
        : <span aria-hidden />}
    </li>
  );
}

function TopicRow({ t }: { t: Topic }) {
  const st = STATUS[t.status];
  const dropped = t.status === "dropped";
  return (
    <li className="-mx-2 rounded-md px-2 py-2.5 transition-colors hover:bg-[var(--accent)]" style={dropped ? { opacity: 0.5 } : undefined}>
      <div className="flex items-start justify-between gap-2">
        {t.researchUrl ? (
          <a href={t.researchUrl} target="_blank" rel="noreferrer"
            className="line-clamp-2 text-[12.5px] font-medium leading-snug hover:underline"
            title={`원문 보기: ${t.researchUrl}`}
            style={dropped ? { textDecoration: "line-through" } : undefined}>
            {t.title}
          </a>
        ) : (
          <span className="line-clamp-2 text-[12.5px] font-medium leading-snug">{t.title}</span>
        )}
        <span className="stamp shrink-0 whitespace-nowrap" style={{ color: st.tone }}>{st.text}</span>
      </div>
      <ul className="mt-1.5">
        {t.channels.map((c) => <ChannelRow key={c.key} c={c} />)}
      </ul>
    </li>
  );
}

export function TopicProgress({ only }: { only?: "balancelab" | "pet" } = {}) {
  const { rows, error, snap } = useBoard<Topic>("topics");
  if (error) return <BoardError what="주제별 진행" error={error} />;
  if (!rows) return null;
  if (rows.length === 0) return <BoardEmpty what="주제별 진행" how="content-board-push.mjs --only=topics" />;

  const topics = rows.map((r) => r.data).filter((t) => !only || t.axis === only);
  if (topics.length === 0) return null;
  const reportedAt = rows[0]?.reported_at;

  // 주 단위로 묶는다. 들어온 순서를 지킨다(로컬이 이미 줄을 세웠다. 여기서 다시 세우지 않는다).
  const weeks: { week: string; topics: Topic[] }[] = [];
  for (const t of topics) {
    const last = weeks[weeks.length - 1];
    if (last && last.week === t.week) last.topics.push(t);
    else weeks.push({ week: t.week, topics: [t] });
  }

  const chosen = topics.filter((t) => t.status === "selected").length;
  const waiting = topics.filter((t) => t.status === "ready").length;

  return (
    <BoardCard>
      <Masthead
        eyebrow="TOPICS / 고른 다음 어디까지 갔나"
        title="주제별 진행"
        subtitle={`고른 주제 ${chosen}건 · 고르기 전 ${waiting}건`}
        right={<><Stale at={reportedAt} /><Snap at={snap} /></>}
      />
      <div className="px-5 pb-4">
        {weeks.map(({ week, topics: list }) => (
          <section key={week} className="mb-4 last:mb-0">
            <SectionHead title={week} note={list[0]?.axisLabel} />
            {list.find((t) => t.axisHint) && (
              <p className="stamp text-muted-foreground mb-2">{list.find((t) => t.axisHint)?.axisHint}</p>
            )}
            <ul className="divide-y">
              {list.map((t) => <TopicRow key={`${t.week}:${t.axis}:${t.n}`} t={t} />)}
            </ul>
          </section>
        ))}
      </div>
      <Footnote>
        주제를 묶는 열쇠는 원문 주소입니다. 쓰레드 후보의 research_url 과 인스타 캐러셀 post.json 의 sourceUrl 이
        같으면 같은 주제로 봅니다. 제목은 채널마다 다르게 쓰므로 제목으로는 묶지 않습니다.
        원문 주소가 없는 옛 회차는 <b>미연결</b>로 둡니다. 안 했다는 뜻이 아니라 이어 볼 근거가 없다는 뜻입니다.
      </Footnote>
    </BoardCard>
  );
}
