"use client";

import { Card } from "@/components/ui/card";
import { BRAND_COLORS } from "@/lib/types";
import { useBoard, kst, Stale, Snap, BoardError } from "@/components/content-board";

// ---------- 자사몰 매거진 (아이언펫·너티) ----------
//
// 2026-09-21 신설, 2026-09-22 화면 재작성.
// 김호 반려: "최소한의 UI 도 고려 안 됐다". 첫 판은 숫자와 제목을 한 덩어리로 흘려 놓은
// 콘솔 출력이었다. 글이 108편인데 읽는 사람이 "많이 읽힌 글이 뭔지"도 "오늘 뭐가 어긋났는지"도
// 한눈에 못 잡았다.
//
// 방향: 편집국 게시판.
//   (1) 머리단 = 누적 조회수 하나를 크게 세우고 나머지 수치는 작게 붙인다(크기 대비로 위계).
//   (2) 어긋남은 줄 안에 섞지 않고 머리단 아래 띠로 떼어낸다(조치할 것은 조치할 곳에).
//   (3) 본문 = 5:7 비대칭 두 칸. 왼쪽은 "많이 읽힌 글" 순위 막대, 오른쪽은 "최근 발행" 달별 척추.
//   (4) 브랜드(너티·아이언펫)는 원천에 있는데 첫 판이 안 썼다. 점+이름으로 살린다.
//
// 색 규칙(globals.css 주석과 같다): 브랜드색은 '무엇'을, 의미색(ok/warn/danger)은 '괜찮은가'를
// 말한다. 두 축이 섞이지 않게 브랜드는 작은 점, 상태는 테두리 알약으로 모양을 갈라 놓았다.
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

// 어긋남 문구는 원천이 문장으로 준다. 줄 안에 문장을 넣으면 잘려서 "..."로 끝난다.
// 아는 값만 짧은 표로 줄이고, 모르는 값은 원문 그대로 보여 준다(뜻을 지어내지 않는다).
// 어느 쪽이든 전체 문장은 마우스를 올리면 나온다.
const MISMATCH_SHORT: Record<string, string> = {
  "사이트에는 있는데 원장은 미발행": "원장 미발행",
  "원장은 발행인데 사이트에 없음": "사이트 없음",
};
const isTop = (d: MagItem): d is MagTop => "top" in d;

// 원천은 브랜드를 한글 이름으로 준다. 다른 화면(매출·광고 차트)과 같은 색을 쓰려고 키로 옮긴다.
const BRAND_KEY: Record<string, string> = { "너티": "nutty", "아이언펫": "ironpet" };
const brandColor = (b: string | null) => (b && BRAND_COLORS[BRAND_KEY[b]]) || "var(--sig-idle)";

// 날짜는 항상 파싱한다. 연도를 박아 넣으면 해가 바뀌는 순간 조용히 틀린다.
const monthLabel = (key: string) => {
  const [y, m] = key.split("-");
  return m ? `${y}. ${Number(m)}월` : key;
};
const dayLabel = (iso: string | null) => (iso && iso.length >= 10 ? iso.slice(5).replace("-", ".") : "??.??");

/** 머리단 수치 한 칸. hero 는 그 카드에서 제일 먼저 읽혀야 하는 값 하나뿐이다. */
function Figure({ value, unit, label, sub, hero }: {
  value: string; unit?: string; label: string; sub?: string; hero?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className={hero
        ? "num text-[28px] font-bold leading-none tracking-tight"
        : "num text-[18px] font-semibold leading-none"}>
        {value}
        {unit && <span className="ml-0.5 text-[11px] font-medium text-muted-foreground">{unit}</span>}
      </p>
      <p className="stamp text-muted-foreground mt-1.5 whitespace-nowrap">{label}</p>
      {sub && <p className="stamp mt-0.5 whitespace-nowrap" style={{ color: "var(--sig-idle)" }}>{sub}</p>}
    </div>
  );
}

/** 조치가 필요한 것만 띠로 뽑는다. 줄 안에 섞어 두면 안 읽힌다. */
function AlertStrip({ tone, title, body }: { tone: "danger" | "warn"; title: string; body: string }) {
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

/** 상태 알약. 브랜드 점과 모양을 달리해 '무엇'과 '괜찮은가'가 안 섞이게 한다. */
function Flag({ tone, children, title }: { tone: "danger" | "warn"; children: string; title?: string }) {
  return (
    <span className="stamp shrink-0 rounded-full border px-1.5 py-px max-w-[9.5rem] truncate"
      title={title}
      style={{ color: `var(--sig-${tone})`, borderColor: `var(--sig-${tone}-border)`, backgroundColor: `var(--sig-${tone}-surface)` }}>
      {children}
    </span>
  );
}

function SectionHead({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex items-baseline gap-2 mb-3">
      <h4 className="shrink-0 whitespace-nowrap text-[11px] font-semibold tracking-[0.08em]">{title}</h4>
      {note && <span className="stamp text-muted-foreground truncate">{note}</span>}
      <span aria-hidden className="h-px flex-1" style={{ background: "var(--rule)" }} />
    </div>
  );
}

export function MagazineBoard() {
  const { rows, error, snap } = useBoard<MagItem>("magazine");
  if (error) return <BoardError what="자사몰 매거진" error={error} />;
  if (!rows) return null;
  if (rows.length === 0) {
    return (
      <Card>
        <div className="px-5 py-4 text-xs text-muted-foreground">
          자사몰 매거진: 아직 올라온 값이 없습니다. 로컬에서 <code>content-board-push.mjs --only=magazine</code> 을 한 번 돌리면 채워집니다.
        </div>
      </Card>
    );
  }

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

  // 달 묶음. 들어온 순서(발행 내림차순)를 그대로 쓴다. 대시보드가 다시 줄 세우지 않는다.
  const months: { key: string; rows: MagRow[] }[] = [];
  for (const r of recent) {
    const key = r.publish && r.publish.length >= 7 ? r.publish.slice(0, 7) : "날짜 없음";
    const last = months[months.length - 1];
    if (last && last.key === key) last.rows.push(r);
    else months.push({ key, rows: [r] });
  }

  const brandCounts = recent.reduce<Record<string, number>>((acc, r) => {
    const k = r.brand || "미지정";
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const brandList = Object.entries(brandCounts).sort((a, b) => b[1] - a[1]);
  const brandTotal = brandList.reduce((s, [, n]) => s + n, 0);

  const topMax = Math.max(1, ...top.map((t) => t.views));
  const recentMax = Math.max(1, ...recent.map((r) => r.views ?? 0));
  const viewsReadAt = summary?.viewsReadAt || recent.find((r) => r.viewsReadAt)?.viewsReadAt || null;

  return (
    <Card className="overflow-hidden">
      {/* ── 머리단 ── */}
      <div className="px-5 pt-5 pb-4" style={{ backgroundImage: "var(--surface-sheen)" }}>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <p className="stamp text-muted-foreground tracking-[0.16em]">IRONPET.STORE / MAGAZINE</p>
            <h3 className="text-base font-semibold tracking-tight mt-1">자사몰 매거진</h3>
            <p className="stamp text-muted-foreground mt-1">아이언펫 · 너티 게시판에 실제로 올라간 글과 공개 조회수</p>
          </div>
          <div className="flex items-center gap-2 pt-0.5">
            <Stale at={reportedAt} />
            <Snap at={snap} />
          </div>
        </div>

        {summary && (
          <div className="mt-5 flex flex-wrap items-end gap-x-7 gap-y-4">
            <Figure hero
              value={summary.totalViews.toLocaleString()}
              label="누적 조회수"
              sub={viewsReadAt ? `${kst(viewsReadAt)} 읽음` : undefined} />
            <span aria-hidden className="hidden sm:block h-9 w-px self-center" style={{ background: "var(--rule)" }} />
            <Figure value={summary.totalArticles.toLocaleString()} unit="편" label="전체 글" />
            <Figure value={summary.avgViews.toLocaleString()} label="편당 평균 조회" />
            <Figure value={summary.recent.toLocaleString()} unit="편" label={`최근 ${summary.windowDays}일 발행`} />

            {brandTotal > 0 && (
              <div className="ml-auto min-w-[9rem]">
                <div aria-hidden className="flex h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--muted)" }}>
                  {brandList.map(([name, n]) => (
                    <span key={name} style={{ width: `${(n / brandTotal) * 100}%`, background: brandColor(name) }} />
                  ))}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                  {brandList.map(([name, n]) => (
                    <span key={name} className="stamp text-muted-foreground inline-flex items-center gap-1">
                      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: brandColor(name) }} />
                      {name} {n}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {summary && (summary.mismatches > 0 || summary.naverMissing > 0) && (
          <div className="mt-4 grid gap-2 md:grid-cols-2">
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
          </div>
        )}
      </div>

      {/* ── 본문: 5:7 비대칭 두 칸 ── */}
      {/* 좁은 화면에서 한 칸이 될 때도 minmax(0,...) 를 줘야 한다. 그냥 grid 면 칸 너비가
          내용의 min-content 로 잡혀서, 줄임표(truncate) 걸린 긴 제목이 칸을 통째로 늘린다.
          2026-09-22 실측: 390px 에서 카드 안쪽이 517px 로 불어나 조회수 숫자가 잘려 나갔다. */}
      <div className="grid grid-cols-[minmax(0,1fr)] border-t lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* 왼쪽: 많이 읽힌 글 */}
        <section className="px-5 py-4 lg:border-r">
          <SectionHead title="많이 읽힌 글" note="전 기간" />
          {top.length === 0 ? (
            <p className="stamp text-muted-foreground">아직 조회수를 읽은 글이 없습니다.</p>
          ) : (
            <ol className="space-y-px">
              {top.map((t) => {
                const ratio = t.views / topMax;
                const row = (
                  <div className="flex items-start gap-2.5 rounded-md px-2 py-3 transition-colors group-hover:bg-[var(--accent)]">
                    <span className="num w-4 shrink-0 pt-px text-right text-[11px] font-semibold"
                      style={{ color: t.rank <= 3 ? "var(--primary)" : "var(--sig-idle)" }}>{t.rank}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] leading-snug group-hover:underline" title={t.title}>{t.title}</span>
                      <span className="mt-1.5 flex items-center gap-2">
                        <span className="stamp num w-[4.2rem] shrink-0 text-muted-foreground">{t.publish || "날짜 없음"}</span>
                        <span aria-hidden className="h-[3px] flex-1 overflow-hidden rounded-full" style={{ background: "var(--border)" }}>
                          <span className="block h-full rounded-full"
                            style={{ width: `${Math.max(3, ratio * 100)}%`, background: "var(--primary)", opacity: 0.35 + 0.65 * ratio }} />
                        </span>
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
        </section>

        {/* 오른쪽: 최근 발행 */}
        <section className="border-t px-5 py-4 lg:border-t-0">
          <SectionHead
            title="최근 발행"
            note={summary ? `최근 ${summary.windowDays}일 ${recent.length}편 · 막대는 이 목록 안에서의 상대 조회수` : `${recent.length}편`} />
          {recent.length === 0 ? (
            <p className="stamp text-muted-foreground">최근 발행한 글이 없습니다.</p>
          ) : (
            <div className="relative">
              <div className="lg:max-h-[38rem] lg:overflow-y-auto lg:pr-1">
              {months.map((m) => (
                <div key={m.key} className="mb-1.5 last:mb-0">
                  <div className="flex items-center gap-2 py-1.5">
                    <span className="num stamp font-semibold">{monthLabel(m.key)}</span>
                    <span aria-hidden className="h-px flex-1" style={{ background: "var(--rule)" }} />
                    <span className="stamp text-muted-foreground">{m.rows.length}편</span>
                  </div>
                  <ul className="space-y-px">
                    {m.rows.map((r) => {
                      const ratio = (r.views ?? 0) / recentMax;
                      return (
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
                            <span aria-hidden className="hidden h-[3px] overflow-hidden rounded-full sm:block" style={{ background: "var(--border)" }}>
                              <span className="block h-full rounded-full"
                                style={{ width: `${Math.max(4, ratio * 100)}%`, background: "var(--foreground)", opacity: 0.28 + 0.45 * ratio }} />
                            </span>
                            <span className="num text-right text-[11px] font-medium">
                              {r.views === null ? "-" : r.views.toLocaleString()}
                            </span>
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
              </div>
              {/* 아래가 더 있다는 표시. 잘린 줄을 흐리게 덮어 스크롤 칸인 걸 알린다. */}
              <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-8 lg:block"
                style={{ background: "linear-gradient(to top, var(--card), transparent)" }} />
            </div>
          )}
        </section>
      </div>

      {/* ── 꼬리말: 이 숫자가 어디서 왔는지 ── */}
      <div className="px-5 pb-5">
        <p className="surface-sunken stamp text-muted-foreground px-3 py-2">
          원장(mapping.json) · 실제 게시(published.json) · 게시판 공개 조회수 세 곳을 로컬에서 맞춰 올린 값입니다.
          대시보드는 따로 판정하지 않습니다.
        </p>
      </div>
    </Card>
  );
}
