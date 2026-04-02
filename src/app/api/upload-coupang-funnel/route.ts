import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import * as XLSX from "xlsx";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const date = formData.get("date") as string;
    const type = formData.get("type") as string; // "daily" or "item"

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

    let funnelDays = 0;
    const salesDays = 0;

    if (type === "daily") {
      // 쿠팡 Daily Summary → daily_funnel (brand=coupang)
      // 날짜별 집계
      const byDate = new Map<string, { impressions: number; sessions: number; cart_adds: number; purchases: number }>();

      for (const r of rows) {
        // 날짜 파싱
        let rowDate = date;
        const dateVal = r["날짜"] || r["date"] || r["Date"];
        if (dateVal) {
          if (dateVal instanceof Date) {
            rowDate = dateVal.toISOString().slice(0, 10);
          } else {
            const parsed = new Date(String(dateVal));
            if (!isNaN(parsed.getTime())) rowDate = parsed.toISOString().slice(0, 10);
          }
        }

        const existing = byDate.get(rowDate) || { impressions: 0, sessions: 0, cart_adds: 0, purchases: 0 };
        existing.impressions += Number(r["노출수"] || r["조회수"] || r["pageViews"] || 0);
        existing.sessions += Number(r["방문수"] || r["방문자수"] || r["visitors"] || 0);
        existing.cart_adds += Number(r["장바구니"] || r["cartAdds"] || 0);
        existing.purchases += Number(r["구매건수"] || r["구매수"] || r["purchases"] || 0);
        byDate.set(rowDate, existing);
      }

      for (const entry of Array.from(byDate.entries())) {
        const [d, vals] = entry;
        const { error } = await supabase.from("daily_funnel").upsert(
          { date: d, brand: "coupang", ...vals },
          { onConflict: "date,brand" }
        );
        if (error) console.error(`Funnel upsert error for ${d}:`, error);
        else funnelDays++;
      }
    }

    return NextResponse.json({
      ok: true,
      funnel: funnelDays,
      sales: salesDays,
      message: `쿠팡 퍼널 ${funnelDays}일 반영`,
    });
  } catch (error) {
    console.error("Upload coupang funnel error:", error);
    return NextResponse.json({ error: "업로드 실패" }, { status: 500 });
  }
}
