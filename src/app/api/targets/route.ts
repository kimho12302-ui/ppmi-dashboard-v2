import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { cachedGET, revalidateAfter } from "@/lib/api-cache";

async function getImpl() {
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

async function postImpl(req: NextRequest) {
  try {
    const { month, brand, revenue_target, ad_budget_target, roas_target, cac_target, note } = await req.json();
    const { error } = await supabase.from("monthly_targets").upsert(
      {
        month,
        brand: brand || "all",
        revenue_target: Number(revenue_target) || 0,
        ad_budget_target: Number(ad_budget_target) || 0,
        roas_target: Number(roas_target) || 0,
        cac_target: Number(cac_target) || 0,
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

// 5분 캐시·쓰기 후 무효화 (src/lib/api-cache.ts)
export const GET = cachedGET(getImpl, ["monthly_targets"]);
export const POST = revalidateAfter(postImpl, ["monthly_targets"]);
