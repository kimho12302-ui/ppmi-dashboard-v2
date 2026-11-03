import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { buildSearchDemand, validateFile, type SearchDemandFile, type SearchDemandResult } from "@/lib/search-demand";

// 키워드 탭 「검색 수요」. 네이버 데이터랩 주별 검색 지수. 2026-11-03 신설.
// 원천 = 저장소 안 파일 src/data/search-demand-weekly.json (사람이 브라우저로 긁어 넣는다. 자동 수집 아님, DB 안 씀).
// 계산: src/lib/search-demand.ts
//
// ★ 빌드 때 한 번 읽어 고정한다(force-static). 파일을 바꾸면 커밋 → 배포해야 화면이 바뀐다.
//   다시 수집하는 순서: JSON 교체 → npm run build 로 확인 → 커밋 → 배포.
// 파일이 없거나 비었거나 모양이 틀리면 200 + notice. 500 으로 내면 화면이 빈 칸이 되고 스모크 시험도 깨진다.
// 상단 기간·브랜드 필터는 받지 않는다(전년 비교와 기준선이 기간에 묶여 있어서 늘 전 기간).

export const dynamic = "force-static";

const FILE = path.join(process.cwd(), "src", "data", "search-demand-weekly.json");

async function load(): Promise<SearchDemandResult> {
  let text: string;
  try {
    text = await readFile(FILE, "utf-8");
  } catch {
    return { ready: false, reason: "missing", collectedAt: null, notice: "데이터 없음. 주별 검색 수요 파일이 아직 올라오지 않았습니다." };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    return { ready: false, reason: "invalid", collectedAt: null, notice: "데이터 파일을 읽지 못했습니다(JSON 형식 오류)." };
  }
  const problem = validateFile(parsed);
  const collectedAt = (parsed as { collectedAt?: unknown })?.collectedAt;
  const last = typeof collectedAt === "string" ? collectedAt : null;
  if (problem) return { ready: false, reason: "invalid", collectedAt: last, notice: `데이터 파일 형식 오류: ${problem}` };
  const built = buildSearchDemand(parsed as SearchDemandFile);
  if (!built) return { ready: false, reason: "empty", collectedAt: last, notice: "데이터 없음. 파일에 쓸 수 있는 주별 값이 없습니다." };
  return built;
}

export async function GET() {
  return NextResponse.json(await load());
}
