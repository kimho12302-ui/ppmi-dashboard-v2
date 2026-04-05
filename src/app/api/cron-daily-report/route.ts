import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

function fmt(n: number) {
  return Math.round(n).toLocaleString("ko-KR");
}
function pct(n: number) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

async function sendTelegram(text: string) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn("Telegram env not set");
    return;
  }
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "HTML" }),
  });
}

export async function GET(req: NextRequest) {
  // Vercel cron 시크릿 검증
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = yesterday.toISOString().slice(0, 10);

    // 어제 매출
    const { data: sales } = await supabase.from("daily_sales").select("brand,revenue,orders")
      .eq("date", yStr).neq("brand", "all");
    // 어제 광고비 (GA4 제외)
    const { data: ads } = await supabase.from("daily_ad_spend").select("brand,channel,spend,conversion_value")
      .eq("date", yStr).neq("brand", "all");
    // 공구 (밸런스랩)
    const { data: gonggu } = await supabase.from("product_sales").select("channel,revenue")
      .eq("date", yStr).eq("brand", "balancelab");

    const totalRevenue = (sales || []).reduce((s, r) => s + Number(r.revenue), 0)
      + (gonggu || []).filter(r => r.channel?.startsWith("공구_")).reduce((s, r) => s + Number(r.revenue), 0);
    const totalAds = (ads || []).filter(r => !r.channel?.startsWith("ga4_")).reduce((s, r) => s + Number(r.spend), 0);
    const totalOrders = (sales || []).reduce((s, r) => s + Number(r.orders), 0);
    const roas = totalAds > 0 ? totalRevenue / totalAds : 0;

    // 브랜드별
    const brandMap = new Map<string, { revenue: number; orders: number }>();
    const brandLabels: Record<string, string> = { nutty: "너티", ironpet: "아이언펫", saip: "사입", balancelab: "밸런스랩" };
    for (const r of sales || []) {
      const e = brandMap.get(r.brand) || { revenue: 0, orders: 0 };
      e.revenue += Number(r.revenue); e.orders += Number(r.orders);
      brandMap.set(r.brand, e);
    }
    for (const r of gonggu || []) {
      if (r.channel?.startsWith("공구_")) {
        const e = brandMap.get("balancelab") || { revenue: 0, orders: 0 };
        e.revenue += Number(r.revenue);
        brandMap.set("balancelab", e);
      }
    }

    // 전일 대비 (그제)
    const dayBefore = new Date(yesterday);
    dayBefore.setDate(dayBefore.getDate() - 1);
    const dbStr = dayBefore.toISOString().slice(0, 10);
    const { data: prevSales } = await supabase.from("daily_sales").select("revenue,orders").eq("date", dbStr).neq("brand", "all");
    const { data: prevGonggu } = await supabase.from("product_sales").select("channel,revenue").eq("date", dbStr).eq("brand", "balancelab");
    const prevRevenue = (prevSales || []).reduce((s, r) => s + Number(r.revenue), 0)
      + (prevGonggu || []).filter(r => r.channel?.startsWith("공구_")).reduce((s, r) => s + Number(r.revenue), 0);
    const revChange = prevRevenue > 0 ? ((totalRevenue / prevRevenue) - 1) * 100 : 0;

    // 이달 누계 (월초~어제)
    const monthStart = yStr.slice(0, 7) + "-01";
    const { data: mtdSales } = await supabase.from("daily_sales").select("revenue").gte("date", monthStart).lte("date", yStr).neq("brand", "all");
    const { data: mtdGonggu } = await supabase.from("product_sales").select("channel,revenue").gte("date", monthStart).lte("date", yStr).eq("brand", "balancelab");
    const mtdRevenue = (mtdSales || []).reduce((s, r) => s + Number(r.revenue), 0)
      + (mtdGonggu || []).filter(r => r.channel?.startsWith("공구_")).reduce((s, r) => s + Number(r.revenue), 0);

    const brandLines = Array.from(brandMap.entries())
      .filter(([, d]) => d.revenue > 0)
      .sort(([, a], [, b]) => b.revenue - a.revenue)
      .map(([b, d]) => `  ${brandLabels[b] || b}: ₩${fmt(d.revenue)} (${d.orders}건)`)
      .join("\n");

    const msg = [
      `📊 <b>PPMI 일별 리포트 — ${yStr}</b>`,
      ``,
      `💰 <b>매출</b>: ₩${fmt(totalRevenue)} <b>${pct(revChange)}</b>`,
      `📦 주문수: ${totalOrders}건`,
      `📣 광고비: ₩${fmt(totalAds)}`,
      `📈 MER: ${roas.toFixed(2)}x`,
      ``,
      `<b>브랜드별</b>`,
      brandLines,
      ``,
      `📅 이달 누계(MTD): ₩${fmt(mtdRevenue)}`,
    ].join("\n");

    await sendTelegram(msg);
    return NextResponse.json({ ok: true, date: yStr, revenue: totalRevenue });
  } catch (error) {
    console.error("Cron error:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
