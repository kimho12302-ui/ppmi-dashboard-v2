"use client";

// 공구 셀러 발굴 화면의 DM 부분 (2026-10-14).
// - DmSettingsPanel: 제안 조건(공구/협찬, 공구가·수수료 언급 여부와 값, 참고 메시지). PC 의 DM 워커가 초안을 쓸 때 읽는다
// - DmEditor: 후보 한 명의 맞춤 초안을 고치고 「발송 승인」 한다. 대시보드는 직접 보내지 않는다.
//   승인된 행만 PC 워커가 aside 로 보낸다(승인 후 24시간 안, 하루 상한, 같은 사람 재발송 차단).
// - 「바로 고치기」(2026-10-21): Claude API 로 그 자리에서 고친다(src/lib/dm-fix.ts). 키가 없으면 PC 워커가 다음 정시에 다시 쓴다.

import { useState } from "react";
import { cn } from "@/lib/utils";

type Row = Record<string, string>;
export interface Setting { 항목: string; 값: string; 설명: string }

async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { window.location.href = "/login?next=/influencers"; throw new Error("로그인이 필요합니다"); }
  if (!r.ok) throw new Error(j.error || `요청 실패 (${r.status})`);
  return j;
}

// 인스타 DM 입력칸은 공백 포함 1,000자에서 자른다(scripts/lib/dm-rules.mjs 의 IG_DM_MAX 와 같은 값)
const IG_DM_MAX = 1000;

const btn = "rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-40";
const YESNO = ["체험 키트 제공", "공구가 언급", "수수료 언급"];
const CHOICES: Record<string, string[]> = { "제안 종류": ["공구", "제품 협찬", "체험 후 공구"] };

export function DmSettingsPanel({ settings, onSaved }: { settings: Setting[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(settings.map((s) => [s.항목, s.값])));
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setVals((p) => ({ ...p, [k]: v }));

  async function save() {
    setBusy(true); setMsg("");
    try {
      await post("/api/influencers/settings", { items: settings.map((s) => ({ 항목: s.항목, 값: vals[s.항목] ?? "" })) });
      setMsg("저장했습니다. 다음 초안부터 적용됩니다.");
      onSaved();
    } catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  }

  const summary = `${vals["제안 종류"]} · ${vals["상품"]} · 체험 키트 ${vals["체험 키트 제공"]} · 공구가 ${vals["공구가 언급"] === "예" ? vals["공구가"] : "언급 안 함"} · 수수료 ${vals["수수료 언급"] === "예" ? vals["수수료"] : "언급 안 함"}`;

  return (
    <div className="rounded-xl border">
      <button className="w-full flex items-center justify-between px-4 py-3 text-sm" onClick={() => setOpen(!open)}>
        <span><b>DM 제안 조건</b> <span className="text-muted-foreground ml-2">{summary}</span></span>
        <span className="text-xs text-muted-foreground">{open ? "접기" : "펼쳐서 수정"}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3 border-t pt-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {settings.filter((s) => s.항목 !== "참고 메시지").map((s) => (
              <label key={s.항목} className="text-xs space-y-1 block">
                <span className="font-medium">{s.항목}</span>
                {YESNO.includes(s.항목) || CHOICES[s.항목] ? (
                  <select className="w-full rounded border bg-background px-2 py-1.5 text-sm" value={vals[s.항목] || ""} onChange={(e) => set(s.항목, e.target.value)}>
                    {(CHOICES[s.항목] || ["예", "아니오"]).map((o) => <option key={o}>{o}</option>)}
                  </select>
                ) : (
                  <input className="w-full rounded border bg-background px-2 py-1.5 text-sm" value={vals[s.항목] || ""} onChange={(e) => set(s.항목, e.target.value)}
                    disabled={(s.항목 === "공구가" && vals["공구가 언급"] !== "예") || (s.항목 === "수수료" && vals["수수료 언급"] !== "예")} />
                )}
                <span className="text-muted-foreground block">{s.설명}</span>
              </label>
            ))}
          </div>
          <label className="text-xs space-y-1 block">
            <span className="font-medium">참고 메시지</span>
            <textarea className="w-full h-40 rounded border bg-background px-2 py-1.5 text-sm" value={vals["참고 메시지"] || ""} onChange={(e) => set("참고 메시지", e.target.value)} />
            <span className="text-muted-foreground block">말투·구성만 참고합니다. 원장에 없는 사실(오차 0%, 20년, 소개처, 특정인 체험담 등)은 초안에 넣지 않습니다. 쓰고 싶으면 &lsquo;추가로 써도 되는 사실&rsquo;에 적어 주세요.</span>
          </label>
          <div className="flex items-center gap-3">
            <button className={cn(btn, "text-white")} style={{ background: "var(--primary)" }} disabled={busy} onClick={save}>{busy ? "저장 중…" : "조건 저장"}</button>
            {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

const DM_STYLE: Record<string, string> = {
  "초안 대기": "bg-muted text-muted-foreground",
  초안: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  승인: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  발송됨: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  실패: "bg-red-500/10 text-red-500",
  회신: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
};

export function DmEditor({ row, onChanged }: { row: Row; onChanged: () => void }) {
  const h = row["핸들"];
  const [stLocal, setStLocal] = useState("");
  const st = stLocal || row["DM 상태"] || (row["상태"] === "후보" ? "초안 대기" : "");
  const [text, setText] = useState(row["DM 초안"] || "");
  const [instr, setInstr] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [note, setNote] = useState("");
  // 보낸 지 3달(90일)이 안 됐으면 잠근다. 지나면 다시 초안을 쓰고 보낼 수 있다
  const m = String(row["DM 발송"] || "").match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/);
  const sinceSent = m ? (Date.now() - Date.parse(m[1].replace(" ", "T") + ":00+09:00")) / 86400000 : null;
  const sent = sinceSent !== null && sinceSent < 90;
  const dirty = text !== (row["DM 초안"] || "");
  const tooLong = text.length > IG_DM_MAX;

  // Claude API 로 그 자리에서 고친다. 키가 없으면 서버가 지시만 남기고 PC 워커가 다음 정시에 다시 쓴다
  async function fixNow() {
    setBusy("fix"); setMsg(""); setNote("");
    try {
      const j = await post("/api/influencers/dm", { handle: h, action: "fix", instruction: instr, ...(text ? { text } : {}) });
      // 대체 경로에서는 목록을 다시 읽지 않는다(다시 읽으면 이 칸이 새로 그려져 안내 문구가 사라진다). 상태만 여기서 바꿔 보여 준다
      if (j.fallback) { setNote(j.message || "API 키가 없어 다음 정시에 다시 씁니다"); setStLocal("초안 대기"); return; }
      setText(j.text || "");
      if (j.errors) setMsg(j.errors);
      onChanged();
    } catch (e) { setMsg((e as Error).message); }
    finally { setBusy(""); }
  }

  async function act(action: string, extra: Record<string, string> = {}) {
    if (action === "approve" && !window.confirm(`@${h} 에게 이 메시지를 보내도록 승인할까요?\n\nPC 의 DM 워커가 다음 회차에 aside 로 보냅니다. 보낸 뒤에는 되돌릴 수 없습니다.`)) return;
    setBusy(action); setMsg("");
    try { await post("/api/influencers/dm", { handle: h, action, ...extra }); onChanged(); }
    catch (e) { setMsg((e as Error).message); }
    finally { setBusy(""); }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium">DM</span>
        <span className={cn("px-2 py-0.5 rounded", DM_STYLE[st] || "bg-muted")}>{st || "-"}</span>
        {row["DM 승인"] && <span className="text-muted-foreground">승인: {row["DM 승인"]}</span>}
        {row["DM 발송"] && <span className="text-muted-foreground">발송: {row["DM 발송"].split(" · ").slice(0, 2).join(" · ")}</span>}
        {row["DM 오류"] && <span className="text-red-500">{row["DM 오류"]}</span>}
        {sent && <span className="text-muted-foreground">다시 보내기는 {Math.ceil(90 - (sinceSent || 0))}일 뒤</span>}
        {row["DM 이력"] && <span className="text-muted-foreground">이전 발송: {row["DM 이력"].split(" · ")[0]}</span>}
      </div>
      {row["회신"] && <p className="text-xs rounded bg-emerald-500/10 px-2 py-1">💬 회신: {row["회신"]}</p>}
      {st === "초안 대기" && !row["DM 초안"] ? (
        <p className="text-xs text-muted-foreground">PC 의 DM 워커가 다음 회차에 이 계정의 소개글·최근 게시물을 읽고 맞춤 초안을 씁니다.</p>
      ) : (
        <div className="space-y-1">
          <textarea className="w-full min-h-[160px] rounded border bg-background px-2 py-1.5 text-sm leading-relaxed" value={text}
            onChange={(e) => setText(e.target.value)} disabled={sent || st === "승인" || busy === "fix"} />
          <p className={cn("text-xs text-right tabular-nums", tooLong ? "text-red-500 font-medium" : "text-muted-foreground")}>
            {text.length.toLocaleString()}/{IG_DM_MAX.toLocaleString()}자{tooLong && " · 인스타 DM 은 1,000자에서 잘려 보낼 수 없습니다. 줄여 주세요"}
          </p>
        </div>
      )}
      {st === "초안 대기" && row["DM 초안"] && !note && (
        <p className="text-xs text-muted-foreground">PC 의 DM 워커가 다음 정시에 프로필을 다시 읽고 초안을 새로 씁니다.</p>
      )}
      {!sent && (
        <div className="flex flex-wrap items-center gap-2">
          {st !== "승인" && text && (
            <button className={cn(btn, "border")} disabled={!!busy || !dirty} onClick={() => act("save", { text })}>{busy === "save" ? "저장 중…" : "초안 저장"}</button>
          )}
          {st !== "승인" && text && row["상태"] === "후보" && (
            <button className={cn(btn, "text-white")} style={{ background: "var(--primary)" }} disabled={!!busy || tooLong}
              title={tooLong ? "1,000자를 넘으면 보낼 수 없습니다" : undefined} onClick={() => act("approve", { text })}>
              {busy === "approve" ? "승인 중…" : "발송 승인"}
            </button>
          )}
          {st === "승인" && <button className={cn(btn, "border")} disabled={!!busy} onClick={() => act("cancel")}>승인 취소</button>}
          {st !== "승인" && (
            <>
              <input className="flex-1 min-w-[180px] rounded border bg-background px-2 py-1 text-xs" placeholder="고칠 지시 (예: 육아 얘기로 시작, 더 짧게)" value={instr} onChange={(e) => setInstr(e.target.value)} />
              {text && (
                <button className={cn(btn, "border border-violet-500/50 text-violet-700 dark:text-violet-400")} disabled={!!busy} onClick={fixNow}
                  title="지금 초안과 시트에 있는 계정 정보로 Claude 가 바로 고칩니다. 프로필은 다시 읽지 않습니다">
                  {busy === "fix" ? "고치는 중…" : "바로 고치기"}
                </button>
              )}
              <button className={cn(btn, "border")} disabled={!!busy} onClick={() => act("redraft", { instruction: instr })}
                title="PC 의 DM 워커가 다음 정시에 인스타 프로필을 다시 읽고 새로 씁니다">
                {text ? "프로필 다시 읽고 새로 쓰기 (다음 정시)" : "초안 다시 쓰기"}
              </button>
            </>
          )}
        </div>
      )}
      {note && <p className="text-xs text-amber-700 dark:text-amber-400">{note}</p>}
      {msg && <p className="text-xs text-red-500">{msg}</p>}
    </div>
  );
}
