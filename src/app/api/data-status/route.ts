import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
  try {
    const tables = ["daily_sales", "daily_ad_spend", "daily_funnel", "product_sales", "keyword_performance"];
    const now = new Date(Date.now() + 32400000); // KST
    now.setDate(now.getDate() - 1);
    const yesterday = now.toISOString().slice(0, 10);

    const sources = await Promise.all(
      tables.map(async (table) => {
        try {
          const { data } = await supabase
            .from(table)
            .select("date")
            .order("date", { ascending: false })
            .limit(1);
          const latestDate = data?.[0]?.date || null;
          return {
            table,
            latestDate,
            isStale: !latestDate || latestDate < yesterday,
          };
        } catch {
          return { table, latestDate: null, isStale: true };
        }
      })
    );

    return NextResponse.json({
      sources,
      referenceDate: yesterday,
      summary: {
        total: sources.length,
        stale: sources.filter((s) => s.isStale).length,
      },
    });
  } catch (error) {
    console.error("Data status error:", error);
    return NextResponse.json({ sources: [], summary: { total: 0, stale: 0 } });
  }
}
