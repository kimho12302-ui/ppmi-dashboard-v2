export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import * as XLSX from "xlsx";

function parseDate(val: unknown): string {
  if (!val) return "";
  const s = String(val).replace(/\.0$/, "");
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return s.slice(0, 10);
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const brand = (formData.get("brand") as string) || "nutty";

    if (!file) {
      return NextResponse.json({ error: "파일이 필요합니다" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const allData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];

    if (allData.length < 2) {
      return NextResponse.json({ error: "데이터가 없습니다" }, { status: 400 });
    }

    const headers = (allData[0] as string[]).map(h => String(h || "").trim());
    const col = (name: string) => headers.indexOf(name);

    const dateCol = col("날짜");
    const impCol = col("노출수");
    const clickCol = col("클릭수");
    const spendCol = col("광고비(원)");
    const ordersCol = col("총 주문수 (1일)");
    const convCol = col("총 전환 매출액 (1일)(원)");

    if (dateCol < 0 || spendCol < 0) {
      return NextResponse.json({
        error: `필수 컬럼 누락. 날짜 컬럼: ${dateCol >= 0 ? "있음" : "없음"}, 광고비(원) 컬럼: ${spendCol >= 0 ? "있음" : "없음"}. 발견된 컬럼: ${headers.join(", ")}`,
      }, { status: 400 });
    }

    // 날짜별 집계
    const dailyAgg = new Map<string, { spend: number; impressions: number; clicks: number; conversions: number; conversion_value: number }>();

    for (let i = 1; i < allData.length; i++) {
      const row = allData[i] as unknown[];
      if (!row || !row[dateCol]) continue;
      const dateStr = parseDate(row[dateCol]);
      if (!dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) continue;

      const ex = dailyAgg.get(dateStr) || { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversion_value: 0 };
      ex.spend += Number(row[spendCol] || 0);
      ex.impressions += impCol >= 0 ? Number(row[impCol] || 0) : 0;
      ex.clicks += clickCol >= 0 ? Number(row[clickCol] || 0) : 0;
      ex.conversions += ordersCol >= 0 ? Number(row[ordersCol] || 0) : 0;
      ex.conversion_value += convCol >= 0 ? Number(row[convCol] || 0) : 0;
      dailyAgg.set(dateStr, ex);
    }

    if (dailyAgg.size === 0) {
      return NextResponse.json({ error: "날짜 파싱 실패. 날짜 컬럼 형식을 확인하세요 (YYYYMMDD 또는 YYYY-MM-DD)" }, { status: 400 });
    }

    const dbRows = Array.from(dailyAgg.entries()).map(([date, d]) => ({
      date,
      channel: "coupang_ads",
      brand,
      spend: Math.round(d.spend),
      impressions: d.impressions,
      clicks: d.clicks,
      conversions: d.conversions,
      conversion_value: Math.round(d.conversion_value),
    }));

    const { error } = await supabase
      .from("daily_ad_spend")
      .upsert(dbRows, { onConflict: "date,channel,brand" });

    if (error) throw error;

    const dates = dbRows.map(r => r.date).sort();
    const totalSpend = dbRows.reduce((s, r) => s + r.spend, 0);

    return NextResponse.json({
      ok: true,
      message: `쿠팡 광고 ${dates[0]} ~ ${dates[dates.length - 1]} 저장 완료 (${dbRows.length}일, ${brand})`,
      dailyRows: dbRows.length,
      totalSpend,
      dates: { from: dates[0], to: dates[dates.length - 1] },
    });
  } catch (error) {
    console.error("Upload coupang ads error:", error);
    return NextResponse.json({ error: "업로드 실패: " + String(error) }, { status: 500 });
  }
}
