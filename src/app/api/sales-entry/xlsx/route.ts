import { NextRequest, NextResponse } from "next/server";
import { SETUP_MESSAGE, buildSalesEntryWorkbook, isRealDate, workbookBytes } from "@/lib/sales-entry-core";
import { loadSalesEntry } from "@/lib/sales-entry";
import { serveSalesEntryXlsx } from "@/lib/sales-entry-file-core";
import { downloadOriginal } from "@/lib/sales-entry-file";

// 자동 판매입력 엑셀 받기 (2026-11-26). GET /api/sales-entry/xlsx?date=YYYY-MM-DD → 판매입력_YYMMDD.xlsx
//   원본이 있으면(실행 행 original_file_path) 복호화한 원본 그대로: 회사 PC 가 만든 파일 15탭, 고객정보 포함.
//     응답 헤더 X-Sales-Entry-Source: original. 못 열면 500(생성본으로 몰래 바꾸지 않는다).
//   없으면 고객정보 없는 생성본(판매정리·요약·미매칭·누락 탭). X-Sales-Entry-Source: generated.
//     저장이 덜 끝난 날(완료 표식 없음·줄 수 불일치)은 내주지 않는다.
// 판정: src/lib/sales-entry-file-core.ts serveSalesEntryXlsx. 캐시하지 않는다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date") ?? "";
  if (!isRealDate(date)) return NextResponse.json({ error: `date 형식이 다릅니다(YYYY-MM-DD): ${date}` }, { status: 400 });
  try {
    const res = await loadSalesEntry(date);
    if (res.setupNeeded) return NextResponse.json({ setupNeeded: true, error: SETUP_MESSAGE }, { status: 503 });
    if (res.error) return NextResponse.json({ error: "판매입력을 불러오지 못했습니다", message: res.error.message }, { status: 500 });
    const { run, lines, status } = res.data;
    const out = await serveSalesEntryXlsx(date, {
      run,
      status,
      lineCount: lines.length,
      buildGenerated: () => workbookBytes(buildSalesEntryWorkbook(run!, lines)),
      download: downloadOriginal,
      keyRaw: process.env.SALES_FILE_KEY,
    });
    if (out.kind === "json") return NextResponse.json(out.body, { status: out.status, headers: { "Cache-Control": "no-store" } });
    // 복사해 ArrayBuffer 를 가진 Uint8Array 로(BodyInit 형). 1MB 남짓이라 비용 무시
    return new NextResponse(new Uint8Array(out.bytes), { headers: out.headers });
  } catch (error) {
    console.error("sales-entry xlsx error:", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: "엑셀을 만들지 못했습니다", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
