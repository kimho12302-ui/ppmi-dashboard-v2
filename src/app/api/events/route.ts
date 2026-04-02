import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const from = sp.get("from");
    const to = sp.get("to");

    let query = supabase.from("marketing_events").select("*").order("date");
    if (from) query = query.gte("date", from);
    if (to) query = query.lte("date", to);

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ events: data || [] });
  } catch (error) {
    console.error("Events GET error:", error);
    return NextResponse.json({ events: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { date, brand, title, description, color } = await req.json();
    if (!title?.trim()) {
      return NextResponse.json({ error: "이벤트명을 입력하세요" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("marketing_events")
      .insert({ date, brand: brand || "all", title: title.trim(), description: description || null, color: color || "#6366f1" })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ ok: true, event: data });
  } catch (error) {
    console.error("Events POST error:", error);
    return NextResponse.json({ error: "이벤트 저장 실패" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id 필요" }, { status: 400 });
    await supabase.from("marketing_events").delete().eq("id", id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Events DELETE error:", error);
    return NextResponse.json({ error: "삭제 실패" }, { status: 500 });
  }
}
