import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import snapshot from "@/data/content-board/snapshot.json";

// 콘텐츠 탭 보드. 2026-09-18 신설. SQL: docs/sql/content-board.sql
//
// section = naver    : 네이버 블로그 글 한 편 = 한 행. 초안 → 임시저장 → 발행 확인 단계
//           research : 축 하나 = 한 행. 최근 7일 수집·후보·판정 수와 최근 채택 항목
//           magazine : 펫 축 자사몰 매거진(2026-09-21 추가). 요약 1행 + 조회수 상위 10행 + 최근 60일 글
// 로컬 content-board-push.mjs 가 계산해 섹션 단위로 통째 교체한다. 대시보드는 판정하지 않는다.
//
// 인증: /api/ops-status 와 같다(요청 단 인증 없음, 배포 자체가 보호 경계).

const SECTIONS = ["naver", "research", "magazine"] as const;
type Section = (typeof SECTIONS)[number];
const MAX_ITEMS = 200;

export async function GET(req: NextRequest) {
  const section = req.nextUrl.searchParams.get("section");
  if (!section || !SECTIONS.includes(section as Section)) {
    return NextResponse.json({ error: `section 은 ${SECTIONS.join("/")}` }, { status: 400 });
  }
  const { data, error } = await supabase
    .from("content_board").select("*").eq("section", section).order("sort_order");
  if (!error) return NextResponse.json({ items: data || [], source: "db" });

  // 표가 없으면 빈손으로 돌려보내지 않고 배포에 같이 실린 스냅샷을 준다.
  // anon 키로는 표를 만들 수 없어서(DDL 불가) 표가 생기기 전까지 세 칸이 통째로 비어 있었다.
  // 표가 생기면 위에서 끝나므로 이 길은 저절로 닫힌다. source 로 어느 쪽인지 화면에 밝힌다.
  const sections = snapshot.sections as Record<string, unknown[]>;
  return NextResponse.json({
    items: sections[section] || [],
    source: "snapshot",
    generatedAt: snapshot.generatedAt,
    dbError: error.message,
  });
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
