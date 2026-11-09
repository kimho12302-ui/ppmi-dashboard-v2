export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/db";
import { cachedGET } from "@/lib/api-cache";
import { PET_BRANDS } from "@/lib/brand-groups";

// 퍼널 관리도(일별 구매 전환율) 원천 (2026-11-03).
//
// ★ 전환율은 "같은 원천의 유입과 구매"로만 계산한다. 채널마다 유입을 재는 방법(수기·GA4·쿠팡 업로드)과
//   모집단이 달라서 채널을 섞어 합치면 성립하지 않는 비율이 나온다(src/app/page.tsx 퍼널 요약 주석).
//   그래서 /api/funnel 의 trend 를 쓰지 않는다. 그 응답은 브랜드를 고르면 유입을 광고 클릭으로 바꾸고,
//   구매도 smartstore 외 판매처를 smartstore 칸에 몰아넣는다.
// 원천 짝 = 유입(daily_funnel 의 한 brand·channel 행) ↔ 구매(daily_sales.orders 의 같은 판매처).

interface SourceDef {
  key: string;
  label: string;
  /** 이 원천을 보여 줄 브랜드 필터. "all" 은 항상. */
  filters: string[];
  funnel: { brand: string; channel: string };
  sales: { brands: string[]; channel: string };
  note?: string;
}

const SOURCES: SourceDef[] = [
  {
    key: "bl_smartstore", label: "밸런스랩 스마트스토어", filters: ["balancelab"],
    funnel: { brand: "balancelab", channel: "smartstore" },
    sales: { brands: ["balancelab"], channel: "smartstore" },
    note: "형식-A 공구 주문이 스마트스토어 구매에 섞여 있어, 공구 날은 전환율이 튀어 보일 수 있습니다",
  },
  {
    key: "pet_smartstore", label: "펫 스마트스토어 (너티·아이언펫·사입 통합)", filters: ["pet"],
    funnel: { brand: "all", channel: "smartstore" },
    sales: { brands: PET_BRANDS, channel: "smartstore" },
    note: "펫 스마트스토어 유입이 3개 브랜드 합산으로만 기록돼 브랜드 단독 전환율은 낼 수 없습니다",
  },
  {
    // 카페24 유입은 GA4(속성 1개) 수집기가 brand='nutty' 로 쓴다(marketing-dashboard/scripts/sync_ga4_funnel.py).
    // brand='all'|cafe24 행은 수기 장바구니·회원가입 칸이라 세션이 늘 0 이다. 합치면 나중에 이중집계가 되므로 쓰지 않는다.
    key: "pet_cafe24", label: "펫 카페24 (통합)", filters: ["pet"],
    funnel: { brand: "nutty", channel: "cafe24" },
    sales: { brands: PET_BRANDS, channel: "cafe24" },
    note: "카페24 유입은 GA4 세션(자사몰 전체), 구매는 펫 3개 브랜드 카페24 주문 합계입니다",
  },
  {
    key: "nutty_coupang", label: "쿠팡 (너티)", filters: ["pet", "nutty"],
    funnel: { brand: "all", channel: "coupang" },
    sales: { brands: ["nutty"], channel: "coupang" },
    note: "쿠팡 유입은 수기 업로드라 빠진 날이 있습니다",
  },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function getImpl(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const brand = sp.get("brand") || "all";
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json({ error: "from·to 는 YYYY-MM-DD" }, { status: 400 });
  }

  const sources = SOURCES.filter((s) => brand === "all" || s.filters.includes(brand));
  if (!sources.length) {
    return NextResponse.json({ sources: [], salesLastDate: null });
  }

  try {
    const funnelBrands = Array.from(new Set(sources.map((s) => s.funnel.brand)));
    const funnelChannels = Array.from(new Set(sources.map((s) => s.funnel.channel)));
    const salesBrands = Array.from(new Set(sources.flatMap((s) => s.sales.brands)));
    const salesChannels = Array.from(new Set(sources.map((s) => s.sales.channel)));

    const [funnelRows, salesRows, lastRow] = await Promise.all([
      fetchAll(supabase.from("daily_funnel").select("id,date,brand,channel,sessions,cart_adds")
        .gte("date", from).lte("date", to).in("brand", funnelBrands).in("channel", funnelChannels).order("date")),
      fetchAll(supabase.from("daily_sales").select("id,date,brand,channel,orders")
        .gte("date", from).lte("date", to).in("brand", salesBrands).in("channel", salesChannels).order("date")),
      // 판매 동기화가 어디까지 들어왔는지. 하루치가 한 번에 써지므로(created_at 동일) 전 브랜드 최대 날짜로 본다.
      // 이 날짜 이후의 "구매 0" 은 판매가 없었던 게 아니라 아직 안 들어온 것이다.
      supabase.from("daily_sales").select("date").neq("channel", "total").order("date", { ascending: false }).limit(1),
    ]);
    if (lastRow.error) throw lastRow.error;
    const salesLastDate: string | null = lastRow.data?.[0]?.date ?? null;

    const out = sources.map((s) => {
      const sessions = new Map<string, number>();
      // 장바구니는 유입과 "같은 행"에서만 읽는다(2026-11-03, /funnel 원천별 단계표용).
      // 예: 펫 카페24 유입은 nutty|cafe24(GA4) 행인데 장바구니는 all|cafe24(수기) 행에 있다.
      //     다른 행을 가져오면 모집단이 다른 숫자를 한 원천처럼 잇게 되므로 가져오지 않는다.
      const carts = new Map<string, number>();
      for (const r of funnelRows) {
        if (r.brand !== s.funnel.brand || r.channel !== s.funnel.channel) continue;
        sessions.set(r.date, (sessions.get(r.date) || 0) + (Number(r.sessions) || 0));
        carts.set(r.date, (carts.get(r.date) || 0) + (Number(r.cart_adds) || 0));
      }
      const orders = new Map<string, number>();
      for (const r of salesRows) {
        if (r.channel !== s.sales.channel || !s.sales.brands.includes(r.brand)) continue;
        orders.set(r.date, (orders.get(r.date) || 0) + (Number(r.orders) || 0));
      }
      const dates = Array.from(new Set([...sessions.keys(), ...orders.keys()])).sort();
      const days = dates.map((date) => ({
        date,
        // 행이 없으면 null(미수집). 0 이면 0. 둘 다 판정에서 빠지지만 의미가 다르다.
        sessions: sessions.has(date) ? sessions.get(date)! : null,
        orders: orders.get(date) || 0,
        cartAdds: carts.get(date) || 0,
      }));
      const totalSessions = days.reduce((a, d) => a + (d.sessions || 0), 0);
      return { key: s.key, label: s.label, note: s.note || null, totalSessions, days };
    });

    return NextResponse.json({ sources: out, salesLastDate });
  } catch (error) {
    console.error("funnel-control error:", error);
    const msg = error instanceof Error ? error.message : (error as { message?: string })?.message || String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// 5분 캐시·쓰기 후 무효화 (src/lib/api-cache.ts)
export const GET = cachedGET(getImpl, ["daily_funnel", "daily_sales"], ["brand", "from", "to"]);
