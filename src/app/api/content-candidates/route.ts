import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// 콘텐츠 후보(쓰레드 주간 후보 등). 2026-09-18 신설. SQL: docs/sql/content-candidates.sql
//
// POST  로컬이 검증 게이트를 통과한 후보를 올린다. 이미 고르거나 탈락·보관된 후보는 덮지 않는다
//       (김호의 선택을 로컬 재실행이 되돌리면 안 된다).
// PATCH action=choose  대시보드 선택. 같은 channel·week·axis 의 나머지 proposed 는 rejected 로.
//       action=undo    선택 취소. 그 묶음의 chosen·rejected 를 proposed 로 되돌린다(노션 보관 전까지만).
//       action=archived 로컬이 노션에 보관한 뒤 notion_url 을 채운다.
//
// 인증: /api/ops-status·/api/raw-ingest 와 같다(요청 단 인증 없음, 배포 자체가 보호 경계).

const AXES = new Set(["balancelab", "pet"]);
// research = 자료조사 판정 결과. 쓰레드 후보와 성격이 다르다(글이 아니라 자료).
// 그래서 아래 validate 에서 글쓰기 게이트를 묻지 않고, choose 대신 keep/drop 으로 한 건씩 뒤집는다.
const CHANNELS = new Set(["threads", "instagram", "naver_blog", "research"]);
// 자료조사는 한 주에 여러 건을 채택할 수 있다. 쓰레드처럼 하나만 고르는 게 아니다.
const MULTI_PICK = new Set(["research"]);
const WEEK_RE = /^\d{4}-W\d{2}$/;
const MAX_ITEMS = 20;
const GROUP_MAX = 3; // 한 주·축·채널에 후보 3개까지(김호: 2~3개)

interface Candidate {
  id: string;
  axis: string;
  channel: string;
  week: string;
  title: string;
  body: string;
  sources: { label: string; url: string }[];
  research: Record<string, unknown>;
  gates: Record<string, unknown>;
}

const clip = (s: unknown, n: number) => String(s ?? "").slice(0, n);

function validate(items: unknown[]): { rows?: Candidate[]; error?: string } {
  if (items.length > MAX_ITEMS) return { error: `items 는 ${MAX_ITEMS}개까지` };
  const rows: Candidate[] = [];
  for (const [i, raw] of items.entries()) {
    const it = raw as Partial<Candidate>;
    if (!it || typeof it.id !== "string" || !it.id) return { error: `items[${i}].id 없음` };
    if (!AXES.has(String(it.axis))) return { error: `items[${i}].axis 는 balancelab/pet` };
    if (!CHANNELS.has(String(it.channel))) return { error: `items[${i}].channel 은 threads/instagram/naver_blog/research` };
    const isResearch = String(it.channel) === "research";
    if (!WEEK_RE.test(String(it.week))) return { error: `items[${i}].week 는 YYYY-Www` };
    if (typeof it.title !== "string" || !it.title) return { error: `items[${i}].title 없음` };
    // 자료조사는 한 줄 요약이 본문이라 길이를 길게 요구하지 않는다.
    const minBody = isResearch ? 10 : 50;
    if (typeof it.body !== "string" || it.body.length < minBody) return { error: `items[${i}].body 가 비었거나 너무 짧음` };
    const gates = it.gates && typeof it.gates === "object" ? it.gates : {};
    // 게이트를 통과하지 않은 후보는 받지 않는다. 대시보드에 올라온 것은 곧 올려도 되는 글이어야 한다.
    // 자료조사는 예외다. 그건 아직 글이 아니라 **글감**이라 출처·규제·기계검사를 물을 대상이 아니다.
    // 그 검사는 이 자료로 글을 쓸 때 받는다. 여기서 요구하면 자료가 영영 못 올라온다.
    if (!isResearch) {
      const failed = ["evidence", "regulation", "evals"].filter((g) => (gates as Record<string, unknown>)[g] !== "pass");
      if (failed.length) return { error: `items[${i}] 게이트 미통과: ${failed.join(", ")}` };
    }
    const sources = Array.isArray(it.sources)
      ? it.sources
          .filter((s) => s && typeof s.url === "string" && /^https?:\/\//.test(s.url))
          .map((s) => ({ label: clip(s.label, 200), url: clip(s.url, 500) }))
      : [];
    if (!sources.length) return { error: `items[${i}] 출처가 없음(출처 없는 글은 올리지 않는다)` };
    rows.push({
      id: clip(it.id, 80),
      axis: String(it.axis),
      channel: String(it.channel),
      week: String(it.week),
      title: clip(it.title, 200),
      body: clip(it.body, 5000),
      sources,
      research: it.research && typeof it.research === "object" ? it.research : {},
      gates,
    });
  }
  return { rows };
}

export async function GET(req: NextRequest) {
  const channel = req.nextUrl.searchParams.get("channel") || "threads";
  const week = req.nextUrl.searchParams.get("week");
  if (!CHANNELS.has(channel)) return NextResponse.json({ error: `모르는 channel: ${channel}` }, { status: 400 });

  // 주 목록(최근 12주)을 같이 준다. 화면은 기본으로 가장 최근 주를 보인다.
  const { data: weeksData, error: wErr } = await supabase
    .from("content_candidates")
    .select("week")
    .eq("channel", channel)
    .order("week", { ascending: false })
    .limit(500);
  if (wErr) return NextResponse.json({ error: wErr.message }, { status: 500 });
  const weeks = [...new Set((weeksData || []).map((r) => r.week as string))].slice(0, 12);
  // week=recent 는 최근 두 주를 합쳐 준다. 자료조사는 '최근 7일' 로 보는데 그 7일이 주 경계를
  // 넘는 일이 흔하다. 한 주만 주면 화면의 목록과 버튼이 어긋난다.
  const recent = week === "recent";
  const target = !recent && week && WEEK_RE.test(week) ? week : weeks[0];
  if (!target) return NextResponse.json({ weeks: [], week: null, items: [] });

  let q = supabase.from("content_candidates").select("*").eq("channel", channel);
  q = recent ? q.in("week", weeks.slice(0, 2)) : q.eq("week", target);
  const { data, error } = await q.order("axis").order("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ weeks, week: recent ? "recent" : target, items: data || [] });
}

export async function POST(req: NextRequest) {
  let body: { items?: unknown[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON 파싱 실패" }, { status: 400 });
  }
  if (!Array.isArray(body.items)) return NextResponse.json({ error: "items 배열 없음" }, { status: 400 });
  const { rows, error: invalid } = validate(body.items);
  if (invalid || !rows) return NextResponse.json({ error: invalid }, { status: 400 });
  if (!rows.length) return NextResponse.json({ ok: true, written: 0, kept: [] });

  // 이미 결정이 난 후보는 건드리지 않는다.
  const { data: existing, error: exErr } = await supabase
    .from("content_candidates")
    .select("id, status, channel, week, axis")
    .in("id", rows.map((r) => r.id));
  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });
  const decided = new Set((existing || []).filter((r) => r.status !== "proposed").map((r) => r.id as string));
  const toWrite = rows.filter((r) => !decided.has(r.id));

  // 한 묶음(주·축·채널)에 후보가 3개를 넘지 않게 한다. 이미 있는 것 + 새로 올 것.
  const groupKey = (r: { channel: string; week: string; axis: string }) => `${r.channel}|${r.week}|${r.axis}`;
  const groups = new Map<string, Candidate>();
  for (const r of toWrite) groups.set(groupKey(r), r);
  for (const [key, r] of groups) {
    const { data: inDb, error: cErr } = await supabase
      .from("content_candidates").select("id")
      .eq("channel", r.channel).eq("week", r.week).eq("axis", r.axis);
    if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
    const ids = new Set((inDb || []).map((x) => x.id as string));
    toWrite.filter((x) => groupKey(x) === key).forEach((x) => ids.add(x.id));
    if (!MULTI_PICK.has(r.channel) && ids.size > GROUP_MAX) {
      return NextResponse.json({ error: `${r.week} ${r.axis} ${r.channel} 후보가 ${GROUP_MAX}개를 넘습니다(${ids.size})` }, { status: 400 });
    }
  }

  const now = new Date().toISOString();
  if (toWrite.length) {
    const { error } = await supabase
      .from("content_candidates")
      .upsert(toWrite.map((r) => ({ ...r, status: "proposed", updated_at: now })), { onConflict: "id" });
    if (error) return NextResponse.json({ error: `기록 실패: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true, written: toWrite.length, kept: [...decided] });
}

export async function PATCH(req: NextRequest) {
  let body: { id?: string; action?: string; notion_url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON 파싱 실패" }, { status: 400 });
  }
  const id = String(body.id || "");
  const { data: row, error: gErr } = await supabase.from("content_candidates").select("*").eq("id", id).maybeSingle();
  if (gErr) return NextResponse.json({ error: gErr.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: `없는 후보: ${id}` }, { status: 404 });

  const now = new Date().toISOString();

  if (body.action === "choose") {
    if (row.status === "archived") return NextResponse.json({ error: "이미 노션에 보관된 후보입니다" }, { status: 409 });
    const { data: archived } = await supabase.from("content_candidates").select("id")
      .eq("channel", row.channel).eq("week", row.week).eq("axis", row.axis).eq("status", "archived");
    if (archived?.length) return NextResponse.json({ error: "이 주에는 이미 고른 글이 노션에 보관됐습니다" }, { status: 409 });
    // 나머지를 먼저 탈락시키고 고른 것을 chosen 으로. 순서가 바뀌어도 결과는 같다.
    const { error: e1 } = await supabase.from("content_candidates")
      .update({ status: "rejected", chosen_at: null, updated_at: now })
      .eq("channel", row.channel).eq("week", row.week).eq("axis", row.axis).neq("id", id);
    if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
    const { error: e2 } = await supabase.from("content_candidates")
      .update({ status: "chosen", chosen_at: now, updated_at: now }).eq("id", id);
    if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });
    return NextResponse.json({ ok: true, id, status: "chosen" });
  }

  // 자료조사 전용. 한 건만 뒤집는다. 옆 후보를 건드리지 않는다.
  // 김호 2026-09-22: "버튼 넣어서 버리거나 채택을 할 수 있게. 사람이 선택하거나, 의견이 없으면 니가 알아서 진행"
  // → 버튼은 **게이트가 아니라 덮어쓰기**다. 아무도 안 누르면 올라온 그대로(chosen) 간다.
  if (body.action === "keep" || body.action === "drop") {
    if (!MULTI_PICK.has(row.channel)) {
      return NextResponse.json({ error: `${row.channel} 에는 keep/drop 을 쓰지 않습니다(choose 를 쓰세요)` }, { status: 400 });
    }
    if (row.status === "archived") return NextResponse.json({ error: "이미 보관된 항목입니다" }, { status: 409 });
    const next = body.action === "keep" ? "chosen" : "rejected";
    const { error } = await supabase.from("content_candidates")
      .update({ status: next, chosen_at: next === "chosen" ? now : null, updated_at: now })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, id, status: next });
  }

  if (body.action === "undo") {
    if (row.status === "archived") return NextResponse.json({ error: "노션에 보관된 뒤에는 되돌릴 수 없습니다" }, { status: 409 });
    const { error } = await supabase.from("content_candidates")
      .update({ status: "proposed", chosen_at: null, updated_at: now })
      .eq("channel", row.channel).eq("week", row.week).eq("axis", row.axis)
      .in("status", ["chosen", "rejected"]);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, id, status: "proposed" });
  }

  if (body.action === "archived") {
    if (row.status !== "chosen") return NextResponse.json({ error: `chosen 이 아닌 후보: ${row.status}` }, { status: 409 });
    const url = String(body.notion_url || "");
    if (!/^https:\/\/(www\.|app\.)?notion\.(so|com)\//.test(url)) return NextResponse.json({ error: "notion_url 형식이 아님" }, { status: 400 });
    const { error } = await supabase.from("content_candidates")
      .update({ status: "archived", notion_url: url, updated_at: now }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, id, status: "archived" });
  }

  return NextResponse.json({ error: `모르는 action: ${String(body.action)}` }, { status: 400 });
}
