"use client";

import { useCallback, useEffect, useState } from "react";
import { BoardCard, Masthead, Footnote, SectionHead, EmptyNote, Flag } from "@/components/board-kit";
import { cn } from "@/lib/utils";
import {
  isSupported as fsSupported,
  loadDirHandle,
  saveDirHandle,
  pickDir,
  ensureWritable,
  writeToDir,
  photoFileName,
  RECOMMENDED_DIR,
  type DirHandle,
} from "@/lib/photo-vault";

// 사진 찾기. 2026-09-30 신설.
//
// 김호 2026-09-30: "인스타 캐러셀 만들 때 이미지 API로 끌고 오잖아. 근데 이미지만 필요할 때가
// 있거든? 컨텐츠 탭에 검색 창 만들어서 이미지 검색하면 해당하는 이미지 보고 다운받을 수 있게."
//
// 지금까지는 캐러셀 스크립트(pexels.mjs)를 돌려야만 사진이 나왔다. 매거진 썸네일이나
// 블로그 이미지 한 장이 필요할 때 쓸 자리가 없었다.
//
// 디바운스는 눈이 편하려고 있다
// ────────────────────────────
// 한도를 아끼려고 넣은 것이 아니다. Pexels 시간당 200회는 사람이 손으로 두드리는 검색에는
// 넉넉하다. 이유는 화면이다. 글자마다 곧바로 부르면 격자가 타자 속도로 갈려서 읽을 수가 없다.
//   디바운스 300ms : 낱말을 치는 동안은 결과를 안 바꾸고, 손을 멈추면 바로 나온다.
//                    1초씩 잡으면 느리다고 느낀다. 300ms 면 깜빡임은 사라지고 기다리는
//                    느낌은 아직 안 든다.
//   최소 2글자     : 한 글자로는 결과가 사실상 무의미해서 보여 줄 값이 없다.
//   같은 질의 차단 : 질의·방향·페이지가 그대로면 요청 상태 객체가 바뀌지 않아 아예 안 부른다.
//
// 호출 카운터·시간당 상한·쿨다운 같은 것은 두지 않는다(김호 2026-09-30). 쓰는 사람을 막는
// 장치가 된다. 한도에 닿으면 429 문구로 알리는 것으로 끝낸다.
//
// 출처 표기는 선택이 아니다
// ───────────────────────
// Pexels 지침: "Whenever you are doing an API request make sure to show a prominent link to
// Pexels" · "Always credit our photographers". 그래서 (1) 결과 영역에 Pexels 링크를 띄우고
// (2) 사진마다 촬영자 이름을 보여 주고 그 이름이 사진 페이지로 이어지고 (3) 내려받기에
// 크레딧 문구가 따라간다. 사진만 주고 크레딧을 버리면 약관 위반이다.

const DEBOUNCE_MS = 300;
const MIN_QUERY_LEN = 2;
const PER_PAGE = 24;
/** 브라우저는 연달아 터지는 내려받기를 막는다. 한 장씩 틈을 두고 보낸다. */
const DOWNLOAD_GAP_MS = 350;

const PEXELS_HOME = "https://www.pexels.com";

type Orientation = "portrait" | "landscape" | "square";

const ORIENTATION_TABS: { key: Orientation; label: string; hint: string }[] = [
  // 기본은 세로다. 캐러셀이 1080x1350 이라 가로 사진은 위아래가 잘린다.
  { key: "portrait", label: "세로", hint: "캐러셀 1080x1350" },
  { key: "landscape", label: "가로", hint: "매거진 썸네일" },
  { key: "square", label: "정방형", hint: "피드 1:1" },
];

const ASPECT: Record<Orientation, string> = {
  portrait: "4 / 5",
  landscape: "3 / 2",
  square: "1 / 1",
};

interface Photo {
  id: number;
  alt: string;
  photographer: string;
  photographerUrl: string;
  pageUrl: string;
  src: string;
  thumb: string;
  width: number;
  height: number;
  credit: string;
  avgColor: string | null;
}

interface ApiBody {
  photos?: Photo[];
  total?: number;
  page?: number;
  hasMore?: boolean;
  cached?: boolean;
  note?: string;
  error?: string;
  rateLimited?: boolean;
}

interface Req {
  q: string;
  orientation: Orientation;
  page: number;
}

/** 캡션·크레딧에 그대로 붙일 한 줄. 사진 페이지 주소까지 같이 간다. */
const creditLine = (p: Photo) => `${p.credit}: ${p.pageUrl}`;

export function PhotoSearch() {
  const [input, setInput] = useState("");
  const [req, setReq] = useState<Req>({ q: "", orientation: "portrait", page: 1 });
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [meta, setMeta] = useState<{ total: number; hasMore: boolean; cached: boolean }>({
    total: 0, hasMore: false, cached: false,
  });
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<{ kind: "rate" | "error" | "note"; text: string } | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const [canUseFolder, setCanUseFolder] = useState(false);
  const [dir, setDir] = useState<DirHandle | null>(null);

  // 크로미움이 아니면 폴더 저장 단추를 아예 만들지 않는다.
  // 띄워 놓고 눌렀을 때 실패하게 두면 안 된다.
  useEffect(() => {
    if (!fsSupported()) return;
    setCanUseFolder(true);
    loadDirHandle().then((h) => { if (h) setDir(h); });
  }, []);

  // 입력 디바운스. 질의가 바뀌면 첫 페이지로 되돌린다.
  // 요청을 상태 객체 하나로 묶어 둔 이유: 질의와 페이지를 따로 두면 질의가 바뀐 그 렌더에서
  // 옛 페이지로 한 번, 새 페이지로 또 한 번 불려 한도가 두 배로 깎인다.
  useEffect(() => {
    const t = setTimeout(() => {
      const next = input.trim();
      setReq((r) => (r.q === next ? r : { ...r, q: next, page: 1 }));
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [input]);

  useEffect(() => {
    const { q, orientation, page } = req;
    if (q.length < MIN_QUERY_LEN) {
      setPhotos([]);
      setSelected(new Set());
      setMeta({ total: 0, hasMore: false, cached: false });
      setProblem(q.length === 0 ? null : { kind: "note", text: `검색어를 ${MIN_QUERY_LEN}글자 이상 적어 주세요` });
      return;
    }
    let alive = true;
    setLoading(true);
    setProblem(null);
    const url = `/api/photos?q=${encodeURIComponent(q)}&orientation=${orientation}&page=${page}&per_page=${PER_PAGE}`;
    fetch(url, { cache: "no-store" })
      .then(async (r) => ({ ok: r.ok, status: r.status, body: (await r.json()) as ApiBody }))
      .then(({ ok, status: httpStatus, body }) => {
        if (!alive) return;
        if (!ok) {
          // 한도 초과는 0건과 다른 일이다. 문구로 갈라 놓는다.
          setProblem({
            kind: body.rateLimited || httpStatus === 429 ? "rate" : "error",
            text: body.error || `사진 검색 실패 (${httpStatus})`,
          });
          if (page === 1) setPhotos([]);
          return;
        }
        const incoming = body.photos || [];
        setPhotos((prev) => {
          if (page === 1) return incoming;
          // 페이지를 넘기면 같은 사진이 다시 오는 일이 있다. id 로 한 번 걸러 준다.
          const seen = new Set(prev.map((p) => p.id));
          return [...prev, ...incoming.filter((p) => !seen.has(p.id))];
        });
        if (page === 1) setSelected(new Set());
        setMeta({
          total: body.total ?? incoming.length,
          hasMore: Boolean(body.hasMore),
          cached: Boolean(body.cached),
        });
        if (body.note) setProblem({ kind: "note", text: body.note });
      })
      .catch((e) => { if (alive) setProblem({ kind: "error", text: e instanceof Error ? e.message : String(e) }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [req]);

  const setOrientation = (o: Orientation) =>
    setReq((r) => (r.orientation === o ? r : { ...r, orientation: o, page: 1 }));

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const chooseDir = useCallback(async () => {
    try {
      const h = await pickDir();
      if (!h) return;
      if (!(await ensureWritable(h))) {
        setStatus("폴더 쓰기 권한을 받지 못했습니다");
        return;
      }
      await saveDirHandle(h);
      setDir(h);
      setStatus(`저장 폴더: ${h.name}`);
    } catch (e) {
      setStatus(`폴더 지정 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  /** 사진 바이트는 images.pexels.com 에서 직접 받는다(CORS 허용, API 한도와 무관). */
  const fetchBlob = async (p: Photo) => {
    const r = await fetch(p.src);
    if (!r.ok) throw new Error(`사진 받기 실패 ${r.status}`);
    return r.blob();
  };

  const saveViaBrowser = (blob: Blob, name: string) => {
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // 즉시 지우면 아직 시작 안 한 내려받기가 끊긴다.
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  };

  const copy = async (text: string, said: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus(said);
    } catch {
      setStatus("클립보드에 못 썼습니다. 주소창이 https 인지 확인하세요");
    }
  };

  /** 크레딧은 사진과 함께 간다. 사진만 받고 크레딧을 버리면 약관 위반이다. */
  const takeOne = async (p: Photo, toFolder: boolean) => {
    setStatus(`${p.id} 받는 중...`);
    try {
      const blob = await fetchBlob(p);
      if (toFolder && dir) {
        if (!(await ensureWritable(dir))) { setStatus("폴더 권한이 만료됐습니다. 폴더를 다시 지정하세요"); return; }
        await writeToDir(dir, photoFileName(p.id), blob);
        setStatus(`${dir.name}/${photoFileName(p.id)} 저장`);
      } else {
        saveViaBrowser(blob, photoFileName(p.id));
        setStatus(`${photoFileName(p.id)} 내려받음`);
      }
      await copy(creditLine(p), `${photoFileName(p.id)} 저장 · 크레딧 복사됨`);
    } catch (e) {
      setStatus(`실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const takeSelected = async (toFolder: boolean) => {
    const rows = photos.filter((p) => selected.has(p.id));
    if (rows.length === 0) return;
    if (toFolder && dir && !(await ensureWritable(dir))) {
      setStatus("폴더 권한이 만료됐습니다. 폴더를 다시 지정하세요");
      return;
    }
    let done = 0;
    for (const p of rows) {
      setStatus(`${done + 1}/${rows.length} 받는 중...`);
      try {
        const blob = await fetchBlob(p);
        if (toFolder && dir) await writeToDir(dir, photoFileName(p.id), blob);
        else {
          saveViaBrowser(blob, photoFileName(p.id));
          await new Promise((r) => setTimeout(r, DOWNLOAD_GAP_MS));
        }
        done += 1;
      } catch {
        // 한 장 실패가 나머지를 멈추게 하지 않는다. 몇 장 됐는지는 끝에 밝힌다.
      }
    }
    const where = toFolder && dir ? dir.name : "다운로드 폴더";
    await copy(rows.map(creditLine).join("\n"), `${done}/${rows.length}장 ${where} 저장 · 크레딧 ${rows.length}줄 복사됨`);
  };

  const showFolderButtons = canUseFolder && dir !== null;
  const tooShort = req.q.length > 0 && req.q.length < MIN_QUERY_LEN;
  const emptyResult = !loading && !problem && req.q.length >= MIN_QUERY_LEN && photos.length === 0;

  return (
    <BoardCard>
      <Masthead
        eyebrow="사진 찾기"
        title="Pexels 실사진 검색"
        subtitle="위 브랜드 칩은 이 검색에 영향을 주지 않습니다. 세 브랜드가 같이 쓰는 도구입니다."
        right={
          // Pexels 지침이 요구하는 눈에 띄는 링크.
          // 남은 호출 수 같은 계기판은 일부러 두지 않는다. 사람이 눈치를 보게 된다.
          <a href={PEXELS_HOME} target="_blank" rel="noreferrer"
            className="text-xs font-semibold underline decoration-dotted" style={{ color: "var(--primary)" }}>
            사진 제공: Pexels
          </a>
        }
      >
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="영어로 찾는 것이 결과가 넓습니다 (예: sleep bedroom, senior woman walking)"
              className="min-w-0 flex-1 rounded-lg border bg-card px-3 py-2 text-sm outline-none focus:ring-2"
              style={{ borderColor: "var(--border)" }}
              aria-label="사진 검색어"
            />
            {input && (
              <button onClick={() => setInput("")}
                className="rounded-lg border px-2.5 py-2 text-xs text-muted-foreground hover:text-foreground">
                지우기
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-0.5 rounded-lg bg-muted p-1">
              {ORIENTATION_TABS.map((t) => (
                <button key={t.key} onClick={() => setOrientation(t.key)} title={t.hint}
                  className={cn("rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    req.orientation === t.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                  {t.label}
                </button>
              ))}
            </div>
            <span className="stamp text-muted-foreground">
              {ORIENTATION_TABS.find((t) => t.key === req.orientation)?.hint}
            </span>

            {/* 크로미움이 아니면 이 단추 줄은 렌더되지 않는다 */}
            {canUseFolder && (
              <div className="ml-auto flex items-center gap-2">
                {dir && <Flag tone="ok" title={RECOMMENDED_DIR}>{`저장: ${dir.name}`}</Flag>}
                <button onClick={chooseDir} className="rounded-lg border px-2.5 py-1.5 text-xs hover:bg-muted">
                  {dir ? "폴더 변경" : "볼트 폴더 지정"}
                </button>
              </div>
            )}
          </div>

          {canUseFolder && !dir && (
            <p className="stamp text-muted-foreground">
              권장 폴더: <code>{RECOMMENDED_DIR}</code> (한 번 잡아 두면 다음부터 안 묻습니다)
            </p>
          )}
        </div>
      </Masthead>

      <div className="border-t px-5 py-4 space-y-3">
        {/* 고른 것이 있을 때만 뜨는 줄 */}
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2"
            style={{ borderColor: "var(--sig-ok-border)", backgroundColor: "var(--sig-ok-surface)" }}>
            <span className="text-xs font-semibold">{selected.size}장 선택</span>
            <button onClick={() => takeSelected(false)} className="rounded-md border bg-card px-2.5 py-1 text-xs hover:bg-muted">
              모아 받기
            </button>
            {showFolderButtons && (
              <button onClick={() => takeSelected(true)} className="rounded-md border bg-card px-2.5 py-1 text-xs hover:bg-muted">
                폴더에 저장
              </button>
            )}
            <button
              onClick={() => copy(photos.filter((p) => selected.has(p.id)).map(creditLine).join("\n"), `크레딧 ${selected.size}줄 복사됨`)}
              className="rounded-md border bg-card px-2.5 py-1 text-xs hover:bg-muted">
              크레딧만 복사
            </button>
            <button onClick={() => setSelected(new Set())} className="ml-auto text-xs text-muted-foreground hover:text-foreground">
              선택 해제
            </button>
          </div>
        )}

        {status && <p className="stamp text-muted-foreground">{status}</p>}

        {problem && (
          <div className="rounded-lg border px-3 py-2 text-xs"
            style={{
              borderColor: `var(--sig-${problem.kind === "rate" ? "warn" : problem.kind === "error" ? "danger" : "idle"}-border)`,
              backgroundColor: `var(--sig-${problem.kind === "rate" ? "warn" : problem.kind === "error" ? "danger" : "idle"}-surface)`,
              color: `var(--sig-${problem.kind === "rate" ? "warn" : problem.kind === "error" ? "danger" : "idle"})`,
            }}>
            {problem.text}
          </div>
        )}

        {req.q.length >= MIN_QUERY_LEN && (
          <SectionHead
            title={`"${req.q}"`}
            note={loading ? "찾는 중..." : `${meta.total.toLocaleString()}장 중 ${photos.length}장 표시${meta.cached ? " · 최근 결과 재사용" : ""}`}
          />
        )}

        {req.q.length === 0 && <EmptyNote>찾을 것을 적어 주세요. 사람·장소·상황을 영어로 적으면 결과가 넓습니다.</EmptyNote>}
        {tooShort && <EmptyNote>{MIN_QUERY_LEN}글자부터 찾습니다.</EmptyNote>}
        {emptyResult && <EmptyNote>이 검색어로는 사진이 없습니다. 다른 낱말이나 다른 방향으로 바꿔 보세요.</EmptyNote>}

        {photos.length > 0 && (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {photos.map((p) => (
              <PhotoTile key={p.id} photo={p} orientation={req.orientation}
                picked={selected.has(p.id)} onToggle={() => toggle(p.id)}
                onTake={() => takeOne(p, false)}
                onTakeToFolder={showFolderButtons ? () => takeOne(p, true) : null}
                onCopy={() => copy(creditLine(p), `크레딧 복사됨: ${p.photographer}`)} />
            ))}
          </ul>
        )}

        {meta.hasMore && !loading && (
          <button onClick={() => setReq((r) => ({ ...r, page: r.page + 1 }))}
            className="w-full rounded-lg border py-2 text-xs font-medium hover:bg-muted">
            더 보기 (다음 {PER_PAGE}장)
          </button>
        )}
      </div>

      <Footnote>
        사진과 문구는 <a href={PEXELS_HOME} target="_blank" rel="noreferrer" className="underline">Pexels</a> 것입니다.
        내려받으면 <code>Photo by 이름 on Pexels: 주소</code> 가 클립보드에 같이 담깁니다. 캡션 출처 칸에 붙여 주세요.
        파일명은 캐러셀 스크립트와 같은 <code>pexels-아이디.jpg</code> 입니다.
        치는 동안 격자가 갈리지 않게 손을 멈춘 뒤 {DEBOUNCE_MS}ms 에 찾고, {MIN_QUERY_LEN}글자부터 찾습니다.
      </Footnote>
    </BoardCard>
  );
}

function PhotoTile({ photo, orientation, picked, onToggle, onTake, onTakeToFolder, onCopy }: {
  photo: Photo;
  orientation: Orientation;
  picked: boolean;
  onToggle: () => void;
  onTake: () => void;
  onTakeToFolder: (() => void) | null;
  onCopy: () => void;
}) {
  return (
    <li className={cn("group overflow-hidden rounded-lg border transition-shadow", picked && "ring-2")}
      style={picked ? { borderColor: "var(--primary)", boxShadow: "0 0 0 2px var(--primary)" } : undefined}>
      <button onClick={onToggle} className="relative block w-full" aria-pressed={picked}
        title={picked ? "선택 해제" : "선택"}>
        {/* next/image 를 쓰지 않는다. 남의 CDN 사진을 검색 결과로 흘려보내는 자리라
            최적화 대상이 매번 달라지고, 그때마다 Vercel 이미지 변환이 돌아 값만 든다. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo.thumb} alt={photo.alt || `Pexels 사진 ${photo.id}`} loading="lazy"
          className="w-full object-cover"
          style={{ aspectRatio: ASPECT[orientation], background: photo.avgColor || "var(--muted)" }} />
        {picked && (
          <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold"
            style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}>
            v
          </span>
        )}
      </button>
      <div className="space-y-1.5 px-2 py-2">
        {/* 촬영자 이름은 반드시 보여야 하고, 그 이름이 Pexels 사진 페이지로 이어져야 한다 */}
        <a href={photo.pageUrl} target="_blank" rel="noreferrer"
          className="stamp block truncate underline decoration-dotted text-muted-foreground hover:text-foreground"
          title={`${photo.credit} · ${photo.width}x${photo.height}`}>
          {photo.photographer}
        </a>
        <div className="flex items-center gap-1">
          <button onClick={onTake} className="flex-1 rounded-md border py-1 text-[11px] hover:bg-muted">받기</button>
          {onTakeToFolder && (
            <button onClick={onTakeToFolder} className="rounded-md border px-1.5 py-1 text-[11px] hover:bg-muted" title="볼트 폴더에 저장">
              폴더
            </button>
          )}
          <button onClick={onCopy} className="rounded-md border px-1.5 py-1 text-[11px] hover:bg-muted" title="크레딧 문구 복사">
            크레딧
          </button>
        </div>
      </div>
    </li>
  );
}
