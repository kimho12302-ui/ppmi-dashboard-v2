import { NextRequest, NextResponse } from "next/server";
import { saveSettings } from "@/lib/influencer-sheet";
import schema from "@/lib/influencer-schema.json";

const KEYS = schema.dmSettings.defaults.map(([k]) => k);

// DM 조건(제안 종류·공구가·수수료 언급 여부 등). 워커가 초안을 쓸 때 읽는다.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const items = (Array.isArray(body.items) ? body.items : [])
    .filter((i: { 항목?: string }) => KEYS.includes(String(i?.항목)))
    .map((i: { 항목: string; 값?: string }) => ({ 항목: i.항목, 값: String(i.값 ?? "").slice(0, 3000) }));
  if (!items.length) return NextResponse.json({ error: "저장할 설정이 없습니다" }, { status: 400 });
  try {
    await saveSettings(items);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: `시트 쓰기 실패: ${(e as Error).message}` }, { status: 500 });
  }
}
