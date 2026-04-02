import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
  try {
    const { data } = await supabase.from("monthly_targets").select("*");
    const targets: Record<string, unknown> = {};
    (data || []).forEach((r: Record<string, unknown>) => {
      const key = `${r.month}_${r.brand}`;
      targets[key] = r;
    });
    return NextResponse.json({ targets });
  } catch (error) {
    console.error("Targets GET error:", error);
    return NextResponse.json({ targets: {} });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { month, brand, revenue_target, roas_target, note } = await req.json();
    const { error } = await supabase.from("monthly_targets").upsert(
      {
        month,
        brand: brand || "all",
        revenue_target: Number(revenue_target) || 0,
        roas_target: Number(roas_target) || 0,
        note: note || "",
      },
      { onConflict: "month,brand" }
    );
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Targets POST error:", error);
    return NextResponse.json({ error: "저장 실패" }, { status: 500 });
  }
}
