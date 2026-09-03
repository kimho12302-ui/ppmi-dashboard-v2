export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { kstDate } from "@/lib/date";

const BRANDS = ["nutty", "ironpet", "saip", "balancelab"];
const WINDOW_DAYS = 14;

/**
 * 최근 14일 브랜드×날짜 판매 커버리지.
 *
 * ★ 2026-08-18 수정: uploaded 판정이 브랜드별이 아니었다.
 *   이전 코드는 "그 날 daily_sales 에 어떤 브랜드든 행이 1개라도 있으면 업로드됨"으로 봤다.
 *   그래서 너티만 들어온 날에도 아이언펫 칸이 '업로드됨 + 매출 0'(정상)으로 칠해졌고,
 *   아이언펫이 진짜 0매출이었는지 그 브랜드만 빠진 건지 구분할 수 없었다.
 *
 * 칸 상태 4가지:
 *   filled        그 브랜드 행이 있고 매출 > 0
 *   zero          그 브랜드 행이 있고 매출 0 → 진짜 0매출 (정상)
 *   brand_missing 그 날 다른 브랜드는 들어왔는데 이 브랜드만 행이 없음 → 확인 필요
 *   not_uploaded  그 날 어떤 브랜드도 행이 없음 → 판매 파일 자체 미업로드
 */
export type CoverageState = "filled" | "zero" | "brand_missing" | "not_uploaded";

export async function GET() {
  try {
    const days: string[] = [];
    for (let i = WINDOW_DAYS - 1; i >= 0; i--) days.push(kstDate(-i));
    const from = days[0];
    const to = days[days.length - 1];

    const { data, error } = await supabase
      .from("daily_sales")
      .select("date,brand,revenue")
      .gte("date", from).lte("date", to)
      .neq("channel", "total")
      .not("channel", "like", "공구%");
    if (error) throw error;

    // 브랜드×날짜 매출 합계와, "행이 존재했는지" 를 따로 기록한다.
    // 매출 0인 행도 '업로드됨'의 증거이므로 존재 여부는 합계와 분리해야 한다.
    const revenueGrid: Record<string, Record<string, number>> = {};
    const presentGrid: Record<string, Set<string>> = {};
    for (const b of BRANDS) { revenueGrid[b] = {}; presentGrid[b] = new Set(); }
    const anyRowDates = new Set<string>();

    for (const r of data || []) {
      if (!BRANDS.includes(r.brand)) continue;
      revenueGrid[r.brand][r.date] = (revenueGrid[r.brand][r.date] || 0) + Number(r.revenue || 0);
      presentGrid[r.brand].add(r.date);
      anyRowDates.add(r.date);
    }

    const rows = BRANDS.map((brand) => ({
      brand,
      cells: days.map((date) => {
        const present = presentGrid[brand].has(date);
        const revenue = present ? revenueGrid[brand][date] : null;
        let state: CoverageState;
        if (!anyRowDates.has(date)) state = "not_uploaded";
        else if (!present) state = "brand_missing";
        else if (!revenue) state = "zero";
        else state = "filled";
        return { date, revenue, state, uploaded: present };
      }),
    }));

    const notUploaded = days.filter((d) => !anyRowDates.has(d));
    // 브랜드별 결번: 그 날 파일은 들어왔는데 그 브랜드만 없는 날
    const brandGaps = BRANDS
      .map((brand) => ({
        brand,
        dates: days.filter((d) => anyRowDates.has(d) && !presentGrid[brand].has(d)),
      }))
      .filter((g) => g.dates.length > 0);

    return NextResponse.json({ days, brands: BRANDS, rows, notUploaded, brandGaps });
  } catch (error) {
    console.error("sales-coverage error:", error);
    // fail-closed: notUploaded: [] 를 200으로 주면 "미업로드 없음"으로 읽힌다(2026-08 수정).
    return NextResponse.json({ error: "판매 업로드 현황을 불러오지 못했습니다" }, { status: 500 });
  }
}
