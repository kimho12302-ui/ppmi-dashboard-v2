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
    const rows = XLSX.utils.sheet_to_json(sheet) as Record<string, unknown>[];

    if (!rows.length) {
      return NextResponse.json({ error: "데이터가 비어있습니다" }, { status: 400 });
    }

    // 날짜별 집계
    const byDate = new Map<string, { impressions: number; sessions: number; cart_adds: number; purchases: number }>();

    for (const r of rows) {
      let rowDate = date;
      const dateVal = r["날짜"] || r["date"] || r["Date"];
      if (dateVal) {
        if (dateVal instanceof Date) {
          rowDate = dateVal.toISOString().slice(0, 10);
        } else {
          const s = String(dateVal);
          // YYYY-MM-DD 포맷이면 그대로 사용
          if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
            rowDate = s;
          } else {
            const parsed = new Date(s);
            if (!isNaN(parsed.getTime()) && parsed.getFullYear() > 2000) {
              rowDate = parsed.toISOString().slice(0, 10);
            }
          }
        }
      }

      const existing = byDate.get(rowDate) || { impressions: 0, sessions: 0, cart_adds: 0, purchases: 0 };
      existing.impressions += Number(r["노출수"] || r["조회수"] || r["pageViews"] || 0);
      existing.sessions    += Number(r["방문수"] || r["방문자수"] || r["visitors"] || 0);
      existing.cart_adds   += Number(r["장바구니"] || r["cartAdds"] || 0);
      existing.purchases   += Number(r["구매건수"] || r["구매수"] || r["purchases"] || 0);
      byDate.set(rowDate, existing);
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
