import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// 콘텐츠 탭 보드. 2026-09-18 신설. SQL: docs/sql/content-board.sql
//
// section = naver    : 네이버 블로그 글 한 편 = 한 행. 초안 → 임시저장 → 발행 확인 단계
//           research : 축 하나 = 한 행. 최근 7일 수집·후보·판정 수와 최근 채택 항목
// 로컬 content-board-push.mjs 가 계산해 섹션 단위로 통째 교체한다. 대시보드는 판정하지 않는다.
//
// 인증: /api/ops-status 와 같다(요청 단 인증 없음, 배포 자체가 보호 경계).

const SECTIONS = ["naver", "research"] as const;
type Section = (typeof SECTIONS)[number];
const MAX_ITEMS = 200;

export async function GET(req: NextRequest) {
  const section = req.nextUrl.searchParams.get("section");
  if (!section || !SECTIONS.includes(section as Section)) {
    return NextResponse.json({ error: `section 은 ${SECTIONS.join("/")}` }, { status: 400 });
  }
  const { data, error } = await supabase
    .from("content_board").select("*").eq("section", section).order("sort_order");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data || [] });
}

export async function POST(req: NextRequest) {
  let body: { section?: string; items?: { item_key?: string; data?: unknown }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON 파싱 실패" }, { status: 400 });
  }
  const section = body.section as Section | undefined;
  if (!section || !SECTIONS.includes(section)) {
    return NextResponse.json({ error: `모르는 section: ${String(body.section)}` }, { status: 400 });
  }
  if (!Array.isArray(body.items) || body.items.length > MAX_ITEMS) {
    return NextResponse.json({ error: `items 배열(최대 ${MAX_ITEMS}) 필요` }, { status: 400 });
  }
  const rows = [];
  for (const [i, it] of body.items.entries()) {
    if (!it || typeof it.item_key !== "string" || !it.item_key) {
      return NextResponse.json({ error: `items[${i}].item_key 없음` }, { status: 400 });
    }
    if (!it.data || typeof it.data !== "object") {
      return NextResponse.json({ error: `items[${i}].data 없음` }, { status: 400 });
    }
    rows.push({ section, item_key: it.item_key.slice(0, 120), sort_order: i, data: it.data });
  }

  // 섹션 통째 교체. 로컬 원천에서 사라진 행이 화면에 영원히 남지 않게 한다.
  const reportedAt = new Date().toISOString();
  const { error: delErr } = await supabase.from("content_board").delete().eq("section", section);
  if (delErr) return NextResponse.json({ error: `삭제 실패: ${delErr.message}` }, { status: 500 });
  if (rows.length) {
    const { error } = await supabase.from("content_board").insert(rows.map((r) => ({ ...r, reported_at: reportedAt })));
    if (error) return NextResponse.json({ error: `기록 실패: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true, section, written: rows.length, reportedAt });
}
