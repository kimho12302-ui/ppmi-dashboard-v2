export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const BRANDS = ["nutty", "ironpet", "saip", "balancelab"];

// 최근 14일 브랜드×날짜 판매 커버리지.
// 핵심 구분: "그 날 판매 업로드가 됐는지(uploaded)" vs "그 브랜드가 그 날 매출이 있었는지".
//  - uploaded=true 인데 brand revenue=null/0  → 진짜 0매출 (정상)
//  - uploaded=false                          → 그 날 판매 파일 자체 미업로드 (진짜 공백)
// uploaded 판정: 그 날 daily_sales 에 (공구 제외) 어떤 브랜드든 행이 1개라도 있으면 업로드된 것.
export async function GET() {
  try {
    const now = new Date(Date.now() + 32400000); // KST
    const days: string[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().slice(0, 10));
    }
    const from = days[0];
    const to = days[days.length - 1];

    const { data } = await supabase
      .from("daily_sales")
      .select("date,brand,revenue")
      .gte("date", from).lte("date", to)
      .neq("channel", "total")
      .not("channel", "like", "공구%");

    const grid: Record<string, Record<string, number>> = {};
    for (const b of BRANDS) grid[b] = {};
    const uploadedDates = new Set<string>();

    for (const r of data || []) {
      if (!BRANDS.includes(r.brand)) continue;
      grid[r.brand][r.date] = (grid[r.brand][r.date] || 0) + Number(r.revenue || 0);
      uploadedDates.add(r.date);
    }

    const rows = BRANDS.map((b) => ({
      brand: b,
      cells: days.map((d) => ({
        date: d,
        revenue: grid[b][d] ?? null,      // null = 그 브랜드 행 없음
        uploaded: uploadedDates.has(d),    // 그 날 판매 파일이 들어왔는지
      })),
    }));

    // 미업로드 날짜(전 브랜드 공백) 목록 — 진짜 공백
    const notUploaded = days.filter((d) => !uploadedDates.has(d));

    return NextResponse.json({ days, brands: BRANDS, rows, notUploaded });
  } catch (error) {
    console.error("sales-coverage error:", error);
    return NextResponse.json({ days: [], brands: BRANDS, rows: [], notUploaded: [] });
  }
}
