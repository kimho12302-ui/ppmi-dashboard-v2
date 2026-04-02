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
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet) as Record<string, unknown>[];

    if (!rows.length) {
      return NextResponse.json({ error: "데이터가 비어있습니다" }, { status: 400 });
    }

    // 쿠팡 광고 보고서 파싱
    let totalSpend = 0, totalImp = 0, totalClick = 0, totalConvValue = 0;

    for (const r of rows) {
      const spend = Number(r["광고비"] || r["총비용"] || r["spend"] || 0);
      const imp = Number(r["노출수"] || r["impressions"] || 0);
      const click = Number(r["클릭수"] || r["clicks"] || 0);
      const convValue = Number(r["전환매출"] || r["총매출액"] || r["conversion_value"] || 0);
      totalSpend += spend;
      totalImp += imp;
      totalClick += click;
      totalConvValue += convValue;
    }

    const { error } = await supabase.from("daily_ad_spend").upsert(
      {
        date,
        channel: "coupang_ads",
        brand: "nutty",
        spend: totalSpend,
        impressions: totalImp,
        clicks: totalClick,
        conversions: 0,
        conversion_value: totalConvValue,
      },
      { onConflict: "date,channel,brand" }
    );

    if (error) throw error;
    return NextResponse.json({
      ok: true,
      message: `쿠팡 광고 ${date} 저장 완료`,
      spend: totalSpend,
      conversion_value: totalConvValue,
    });
  } catch (error) {
    console.error("Upload coupang ads error:", error);
    return NextResponse.json({ error: "업로드 실패" }, { status: 500 });
  }
}
