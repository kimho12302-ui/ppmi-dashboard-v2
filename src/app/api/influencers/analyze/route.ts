import { NextRequest, NextResponse } from "next/server";
import { analyzeHandle, mapLimit, normalizeHandle, DEFAULT_KEYWORDS } from "@/lib/ig-discovery";
import { knownHandles } from "@/lib/influencer-sheet";

export const maxDuration = 60;
// 한 번에 너무 많이 돌리면 우리 인스타 계정의 시간당 호출 한도를 다 쓴다
const MAX = 30;

export async function POST(req: NextRequest) {
  const token = process.env.META_ADS_TOKEN;
  if (!token) return NextResponse.json({ error: "서버에 META_ADS_TOKEN 이 없습니다" }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const handles = Array.from(new Set((body.handles || []).map((h: string) => normalizeHandle(String(h))).filter(Boolean))) as string[];
  if (!handles.length) return NextResponse.json({ error: "분석할 핸들이 없습니다" }, { status: 400 });
  if (handles.length > MAX) return NextResponse.json({ error: `한 번에 ${MAX}개까지만 분석합니다 (지금 ${handles.length}개)` }, { status: 400 });
  const keywords: string[] = Array.isArray(body.keywords) && body.keywords.length ? body.keywords.map(String).slice(0, 30) : DEFAULT_KEYWORDS;

  const [results, known] = await Promise.all([
    mapLimit(handles, 4, (h) => analyzeHandle(token, h, keywords)),
    knownHandles().catch(() => ({} as Record<string, string>)),
  ]);
  // 토큰이 죽었으면 전부 같은 오류다. 행마다 보여 주지 말고 한 번에 알린다
  const tokenErr = results.find((r) => r.error?.startsWith("메타 토큰 오류"));
  if (tokenErr && results.every((r) => !r.ok)) return NextResponse.json({ error: tokenErr.error }, { status: 502 });
  return NextResponse.json({ results: results.map((r) => ({ ...r, inSheet: known[r.handle] || null })) });
}
