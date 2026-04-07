import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import * as XLSX from "xlsx";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const date = formData.get("date") as string;
    // 기획서 2.5: 쿠팡 광고는 너티 전용
    const brand = (formData.get("brand") as string) || "nutty";

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

    let totalSpend = 0, totalImp = 0, totalClick = 0, totalConv = 0, totalConvValue = 0;

    for (const r of rows) {
      totalSpend    += Number(r["광고비"] || r["총비용"] || r["spend"] || 0);
      totalImp      += Number(r["노출수"] || r["impressions"] || 0);
      totalClick    += Number(r["클릭수"] || r["clicks"] || 0);
      totalConv     += Number(r["전환수"] || r["conversions"] || 0);
      totalConvValue += Number(r["전환매출"] || r["총매출액"] || r["conversion_value"] || 0);
    }

    const { error } = await supabase.from("daily_ad_spend").upsert(
      {
        date,
        channel: "coupang_ads",
        brand,
        spend: totalSpend,
        impressions: totalImp,
        clicks: totalClick,
        conversions: totalConv,
        conversion_value: totalConvValue,
      },
      { onConflict: "date,channel,brand" }
    );

    if (error) throw error;
    return NextResponse.json({
      ok: true,
      message: `쿠팡 광고 ${date} 저장 완료 (${brand})`,
      spend: totalSpend,
      conversions: totalConv,
      conversion_value: totalConvValue,
    });
  } catch (error) {
    console.error("Upload coupang ads error:", error);
    return NextResponse.json({ error: "업로드 실패" }, { status: 500 });
  }
}
