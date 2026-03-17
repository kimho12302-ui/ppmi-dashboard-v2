import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import * as XLSX from "xlsx";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const type = formData.get("type") as string; // "product_costs" | "ad_spend"

    if (!file) {
      return NextResponse.json({ error: "파일이 없습니다" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet) as Record<string, unknown>[];

    if (!rows.length) {
      return NextResponse.json({ error: "데이터가 비어있습니다" }, { status: 400 });
    }

    let result;
    if (type === "product_costs") {
      const mapped = rows.map((r) => ({
        product: String(r["product"] || r["제품"] || ""),
        brand: String(r["brand"] || r["브랜드"] || ""),
        cost_price: Number(r["cost_price"] || r["원가"] || 0),
        shipping_cost: Number(r["shipping_cost"] || r["배송비"] || 0),
        category: String(r["category"] || r["카테고리"] || ""),
      }));
      result = await supabase.from("product_costs").upsert(mapped, { onConflict: "product,brand" });
    } else {
      return NextResponse.json({ error: "지원하지 않는 타입입니다" }, { status: 400 });
    }

    if (result.error) throw result.error;

    return NextResponse.json({ success: true, count: rows.length });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json({ error: "업로드 실패" }, { status: 500 });
  }
}
