import { NextRequest, NextResponse } from "next/server";
import { mentionsFromSeed, mapLimit, normalizeHandle } from "@/lib/ig-discovery";

export const maxDuration = 60;
const MAX_SEEDS = 10;

// 시드 계정(비슷한 브랜드·공구 계정)의 캡션에서 @언급된 계정 = 후보.
// 브랜드가 공구 진행자를 태그하는 관행을 쓴다. 분석은 따로(/analyze) 한다.
export async function POST(req: NextRequest) {
  const token = process.env.META_ADS_TOKEN;
  if (!token) return NextResponse.json({ error: "서버에 META_ADS_TOKEN 이 없습니다" }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const seeds = Array.from(new Set((body.seeds || []).map((h: string) => normalizeHandle(String(h))).filter(Boolean))) as string[];
  if (!seeds.length) return NextResponse.json({ error: "시드 계정을 넣어 주세요" }, { status: 400 });
  if (seeds.length > MAX_SEEDS) return NextResponse.json({ error: `시드는 한 번에 ${MAX_SEEDS}개까지` }, { status: 400 });

  const perSeed = await mapLimit(seeds, 3, (s) => mentionsFromSeed(token, s));
  const tokenErr = perSeed.find((r) => r.error?.startsWith("메타 토큰 오류"));
  if (tokenErr && perSeed.every((r) => !r.ok)) return NextResponse.json({ error: tokenErr.error }, { status: 502 });

  // 여러 시드에 같이 언급될수록 위로
  const merged = new Map<string, { handle: string; count: number; seeds: string[]; example?: string }>();
  for (const r of perSeed) {
    for (const m of r.mentions) {
      if (seeds.includes(m.handle)) continue;
      const cur = merged.get(m.handle) || { handle: m.handle, count: 0, seeds: [], example: m.example };
      cur.count += m.count;
      cur.seeds.push(r.seed);
      merged.set(m.handle, cur);
    }
  }
  const candidates = Array.from(merged.values()).sort((a, b) => b.seeds.length - a.seeds.length || b.count - a.count);
  return NextResponse.json({ seeds: perSeed.map(({ seed, ok, error, mentions }) => ({ seed, ok, error, found: mentions.length })), candidates });
}
