/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import * as XLSX from "xlsx";

function mapBrand(brandStr: string): string {
  const lower = String(brandStr).toLowerCase();
  if (lower.includes("너티") || lower.includes("nutty")) return "nutty";
  if (lower.includes("아이언펫") || lower.includes("ironpet")) return "ironpet";
  if (lower.includes("파미나") || lower.includes("닥터레이")) return "saip";
  if (lower.includes("밸런스랩") || lower.includes("자체판매") || lower.includes("큐모발")) return "balancelab";
  return "unknown";
}

function mapChannel(channelStr: string): string {
  const lower = String(channelStr).toLowerCase();
  if (lower.includes("스마트")) return "smartstore";
  if (lower.includes("cafe24") || lower.includes("카페24")) return "cafe24";
  if (lower.includes("쿠팡")) return "coupang";
  return channelStr;
}

function cleanRevenue(revStr: any): number {
  if (!revStr) return 0;
  return parseInt(String(revStr).replace(/[,원]/g, "").trim()) || 0;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const type = formData.get("type") as string; // "product_costs" | "sales"
    const fileDate = formData.get("fileDate") as string | null; // YYYY-MM-DD

    if (!file) {
      return NextResponse.json({ error: "파일이 없습니다" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
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
    } else if (type === "sales") {
      if (!fileDate) {
        return NextResponse.json({ error: "날짜(fileDate)가 필요합니다" }, { status: 400 });
      }

      // 날짜+브랜드+채널+제품별 그룹핑
      const grouped = new Map<string, any>();
      
      for (const r of rows) {
        const channelRaw = String(r["거래처명"] || "");
        const brandRaw = String(r["브랜드명"] || "");
        const product = String(r["제품"] || "");
        const lineup = String(r["라인업"] || "");
        const category = String(r["카테고리"] || "");
        const revenue = cleanRevenue(r["매출"] || 0);
        const quantity = Number(r["수량"] || 0);
        const buyers = Number(r["구매자 수"] || 0);

        if (!product || revenue === 0) continue;

        const brand = mapBrand(brandRaw);
        const channel = mapChannel(channelRaw);
        const key = `${fileDate}|${brand}|${channel}|${product}`;

        if (!grouped.has(key)) {
          grouped.set(key, {
            date: fileDate,
            brand,
            channel,
            product,
            lineup: lineup || null,
            category: category || null,
            revenue: 0,
            quantity: 0,
            buyers: 0,
          });
        }

        const item = grouped.get(key)!;
        item.revenue += revenue;
        item.quantity += quantity;
        item.buyers += buyers;
      }

      const salesData = Array.from(grouped.values()).map((item) => ({
        ...item,
        avg_price: item.buyers > 0 ? Math.floor(item.revenue / item.buyers) : item.revenue,
      }));

      // 기존 날짜 데이터 삭제
      await supabase.from("product_sales").delete().eq("date", fileDate);

      // 새 데이터 삽입
      result = await supabase.from("product_sales").insert(salesData);
      
      if (result.error) throw result.error;
      
      return NextResponse.json({ success: true, count: salesData.length, date: fileDate });
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
