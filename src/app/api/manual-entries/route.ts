import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// 사람이 넣은 값. 2026-09-18 신설. 수기입력 정본 7절 "사람이 일부러 덮어쓴 건 표시를 남긴다".
// 자동 수집(aside)이 채우는 칸에 사람이 입력 폼·엑셀로 넣은 값을 최근 30일만 보여 준다.
// 자동 값이 다음 회차에 같은 칸을 쓰면 entry_source 가 'aside' 로 바뀌어 여기서 빠진다(자동이 이긴다).

const DAYS = 30;

export async function GET() {
  const since = new Date(Date.now() - DAYS * 86400000).toISOString().slice(0, 10);
  const [funnel, ads] = await Promise.all([
    supabase.from("daily_funnel").select("date,brand,channel,entered_at")
      .eq("entry_source", "manual").gte("date", since).order("date", { ascending: false }).limit(500),
    supabase.from("daily_ad_spend").select("date,brand,channel,spend,entered_at")
      .eq("entry_source", "manual").gte("date", since).order("date", { ascending: false }).limit(500),
  ]);
  if (funnel.error || ads.error) {
    return NextResponse.json({ error: (funnel.error || ads.error)?.message }, { status: 500 });
  }
  const items = [
    ...(funnel.data || []).map((r) => ({ kind: "퍼널", date: r.date, brand: r.brand, channel: r.channel, enteredAt: r.entered_at })),
    ...(ads.data || []).map((r) => ({ kind: "광고비", date: r.date, brand: r.brand, channel: r.channel, enteredAt: r.entered_at, spend: r.spend })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));
  return NextResponse.json({ since, items });
}
