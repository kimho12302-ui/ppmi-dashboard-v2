import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";
  const brand = sp.get("brand") || "all";

  try {
    let query = supabase
      .from("product_sales")
      .select("*")
      .gte("date", from)
      .lte("date", to)
      .order("revenue", { ascending: false })
      .range(0, 99999); // Supabase 기본 1000행 캡 → 넓은 기간 과소집계 방지

    if (brand !== "all") {
      query = query.eq("brand", brand);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ products: data || [] });
  } catch (error) {
    console.error("Product sales API error:", error);
    return NextResponse.json({ error: "Failed to fetch data" }, { status: 500 });
  }
}
