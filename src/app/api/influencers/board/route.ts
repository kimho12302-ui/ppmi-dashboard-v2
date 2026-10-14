import { NextResponse } from "next/server";
import { readBoard, SHEET_URL } from "@/lib/influencer-sheet";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ ...(await readBoard()), sheetUrl: SHEET_URL });
  } catch (e) {
    return NextResponse.json({ error: `시트 읽기 실패: ${(e as Error).message}` }, { status: 500 });
  }
}
