export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import * as XLSX from "xlsx";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const date = formData.get("date") as string;

    if (!file || !date) {
      return NextResponse.json({ error: "파일과 날짜가 필요합니다" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];

    if (rawData.length < 2) {
      return NextResponse.json({ error: "데이터가 비어있습니다" }, { status: 400 });
    }

    // 날짜별 집계
    const byDate = new Map<string, { impressions: number; sessions: number; cart_adds: number; purchases: number }>();
    const headers = (rawData[0] as string[]).map(h => String(h || "").trim());
    const colIdx = (names: string[]) => {
      for (const n of names) { const i = headers.indexOf(n); if (i >= 0) return i; }
      return -1;
    };
    const dateCol    = colIdx(["날짜", "date", "Date"]);
    const sessionCol = colIdx(["방문자", "방문수", "방문자수", "visitors", "sessions"]);
    const impCol     = colIdx(["조회", "노출", "조회수", "노출수", "pageViews"]);
    const cartCol    = colIdx(["장바구니", "cartAdds", "cart_adds"]);
    const orderCol   = colIdx(["주문", "구매건수", "구매수", "purchases", "orders"]);

    // 날짜 컬럼 없으면 전체 합산 → selectedDate(date)로 저장
    if (dateCol < 0) {
      const agg = { impressions: 0, sessions: 0, cart_adds: 0, purchases: 0 };
      for (let i = 1; i < rawData.length; i++) {
        const row = rawData[i] as unknown[];
        if (!row) continue;
        agg.sessions    += sessionCol >= 0 ? Number(row[sessionCol] || 0) : 0;
        agg.impressions += impCol     >= 0 ? Number(row[impCol]     || 0) : 0;
        agg.cart_adds   += cartCol    >= 0 ? Number(row[cartCol]    || 0) : 0;
        agg.purchases   += orderCol   >= 0 ? Number(row[orderCol]   || 0) : 0;
      }
      byDate.set(date, agg);
    } else {
      for (let i = 1; i < rawData.length; i++) {
        const row = rawData[i] as unknown[];
        if (!row || !row[dateCol]) continue;
        const dv = row[dateCol];
        let rowDate = date;
        if (dv instanceof Date) {
          rowDate = dv.toISOString().slice(0, 10);
        } else {
          const s = String(dv).slice(0, 10);
          if (/^\d{4}-\d{2}-\d{2}$/.test(s)) rowDate = s;
        }
        const ex = byDate.get(rowDate) || { impressions: 0, sessions: 0, cart_adds: 0, purchases: 0 };
        ex.sessions    += sessionCol >= 0 ? Number(row[sessionCol] || 0) : 0;
        ex.impressions += impCol     >= 0 ? Number(row[impCol]     || 0) : 0;
        ex.cart_adds   += cartCol    >= 0 ? Number(row[cartCol]    || 0) : 0;
        ex.purchases   += orderCol   >= 0 ? Number(row[orderCol]   || 0) : 0;
        byDate.set(rowDate, ex);
      }
    }

    let funnelDays = 0;
    const errors: string[] = [];

    for (const [d, vals] of byDate.entries()) {
      const { error } = await supabase.from("daily_funnel").upsert(
        { date: d, brand: "all", channel: "coupang", ...vals },
        { onConflict: "date,brand,channel" }
      );
      if (error) errors.push(`${d}: ${error.message}`);
      else funnelDays++;
    }

    return NextResponse.json({
      ok: true,
      funnel: funnelDays,
      message: `쿠팡 퍼널 ${funnelDays}일 반영`,
      ...(errors.length > 0 && { warnings: errors }),
    });
  } catch (error) {
    console.error("Upload coupang funnel error:", error);
    return NextResponse.json({ error: "업로드 실패" }, { status: 500 });
  }
}
