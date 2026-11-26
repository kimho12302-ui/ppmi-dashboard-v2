import { NextRequest, NextResponse } from "next/server";
import { SETUP_MESSAGE, buildSalesEntryWorkbook, isRealDate, salesEntryFileName, workbookBytes } from "@/lib/sales-entry-core";
import { loadSalesEntry } from "@/lib/sales-entry";

// 자동 판매입력 엑셀 받기 (2026-11-26). GET /api/sales-entry/xlsx?date=YYYY-MM-DD → 판매입력_YYMMDD.xlsx
// 탭: 판매정리(사람 파일과 같은 배치, /api/upload-sales 에 그대로 올라감) · 요약 · 미매칭·누락
// 캐시하지 않는다(받을 때마다 DB 에서 읽는다). 저장이 덜 끝난 날(완료 표식 없음·줄 수 불일치)은 내주지 않는다.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date") ?? "";
  if (!isRealDate(date)) return NextResponse.json({ error: `date 형식이 다릅니다(YYYY-MM-DD): ${date}` }, { status: 400 });
  try {
    const res = await loadSalesEntry(date);
    if (res.setupNeeded) return NextResponse.json({ setupNeeded: true, error: SETUP_MESSAGE }, { status: 503 });
    if (res.error) return NextResponse.json({ error: "판매입력을 불러오지 못했습니다", message: res.error.message }, { status: 500 });
    const { run, lines, status } = res.data;
    if (status === "missing" || !run) return NextResponse.json({ error: `${date} 판매입력이 없습니다` }, { status: 404 });
    if (status === "incomplete") {
      return NextResponse.json({ error: `${date} 저장이 덜 끝났습니다(줄 ${lines.length}개, 기대 ${run.line_count}개). 회사 PC 에서 그날을 다시 보내세요` }, { status: 409 });
    }
    const bytes = workbookBytes(buildSalesEntryWorkbook(run, lines));
    const name = salesEntryFileName(date);
    const ascii = name.replace("판매입력", "sales_entry");
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("sales-entry xlsx error:", error);
    return NextResponse.json({ error: "엑셀을 만들지 못했습니다", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
