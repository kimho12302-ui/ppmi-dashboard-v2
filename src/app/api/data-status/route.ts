import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

interface SourceStatus {
  id: string;
  label: string;
  type: "auto" | "manual";
  latestDate: string | null;
  ok: boolean;
}

async function getLatestByChannel(channel: string): Promise<string | null> {
  const { data } = await supabase
    .from("daily_ad_spend")
    .select("date")
    .eq("channel", channel)
    .order("date", { ascending: false })
    .limit(1);
  return data?.[0]?.date || null;
}

async function getLatestByChannelLike(pattern: string): Promise<string | null> {
  const { data } = await supabase
    .from("daily_ad_spend")
    .select("date")
    .like("channel", pattern)
    .order("date", { ascending: false })
    .limit(1);
  return data?.[0]?.date || null;
}

async function getLatestFunnel(brand: string): Promise<string | null> {
  const { data } = await supabase
    .from("daily_funnel")
    .select("date")
    .eq("brand", brand)
    .order("date", { ascending: false })
    .limit(1);
  return data?.[0]?.date || null;
}

async function getLatestFromTable(table: string): Promise<string | null> {
  const { data } = await supabase
    .from(table)
    .select("date")
    .order("date", { ascending: false })
    .limit(1);
  return data?.[0]?.date || null;
}

export async function GET() {
  try {
    const now = new Date(Date.now() + 32400000); // KST
    now.setDate(now.getDate() - 1);
    const yesterday = now.toISOString().slice(0, 10);

    const sourceDefs: { id: string; label: string; type: "auto" | "manual"; fetcher: () => Promise<string | null> }[] = [
      // Auto - API
      { id: "meta_ads", label: "Meta \uAD11\uACE0\uBE44", type: "auto", fetcher: () => getLatestByChannel("meta") },
      { id: "google_pmax", label: "Google P-Max \uAD11\uACE0\uBE44", type: "auto", fetcher: () => getLatestByChannel("google_pmax") },
      { id: "ga4_pmax", label: "GA4 P-Max", type: "auto", fetcher: () => getLatestByChannelLike("ga4_%") },
      { id: "naver_sa", label: "\uB124\uC774\uBC84 \uAC80\uC0C9\uAD11\uACE0", type: "auto", fetcher: () => getLatestByChannel("naver_search") },
      { id: "naver_shopping", label: "\uB124\uC774\uBC84 \uC1FC\uD551\uAD11\uACE0", type: "auto", fetcher: () => getLatestByChannel("naver_shopping") },
      { id: "ga4_funnel", label: "GA4 \uD37C\uB110", type: "auto", fetcher: () => getLatestFunnel("nutty") },
      // Manual
      { id: "coupang_ads", label: "\uCFE0\uD321 \uAD11\uACE0\uBE44", type: "manual", fetcher: () => getLatestByChannel("coupang_ads") },
      { id: "gfa", label: "GFA \uAD11\uACE0\uBE44", type: "manual", fetcher: () => getLatestByChannel("gfa") },
      { id: "sales", label: "\uD310\uB9E4\uC2E4\uC801", type: "manual", fetcher: () => getLatestFromTable("daily_sales") },
      { id: "coupang_funnel", label: "\uCFE0\uD321 \uD37C\uB110", type: "manual", fetcher: () => getLatestFunnel("coupang") },
      { id: "smartstore_ironpet", label: "\uC2A4\uB9C8\uD2B8\uC2A4\uD1A0\uC5B4 (\uC544\uC774\uC5B8\uD3AB)", type: "manual", fetcher: () => getLatestFunnel("smartstore") },
      { id: "smartstore_balancelab", label: "\uC2A4\uB9C8\uD2B8\uC2A4\uD1A0\uC5B4 (\uBC38\uB7F0\uC2A4\uB7A9)", type: "manual", fetcher: () => getLatestFunnel("balancelab_smartstore") },
      { id: "cafe24_funnel", label: "\uCE74\uD39824 \uD37C\uB110", type: "manual", fetcher: () => getLatestFunnel("cafe24") },
    ];

    const sources: SourceStatus[] = await Promise.all(
      sourceDefs.map(async (def) => {
        try {
          const latestDate = await def.fetcher();
          return {
            id: def.id,
            label: def.label,
            type: def.type,
            latestDate,
            ok: !!latestDate && latestDate >= yesterday,
          };
        } catch {
          return { id: def.id, label: def.label, type: def.type, latestDate: null, ok: false };
        }
      })
    );

    const okCount = sources.filter(s => s.ok).length;

    return NextResponse.json({
      sources,
      referenceDate: yesterday,
      summary: {
        total: sources.length,
        ok: okCount,
        stale: sources.length - okCount,
      },
    });
  } catch (error) {
    console.error("Data status error:", error);
    return NextResponse.json({ sources: [], summary: { total: 0, ok: 0, stale: 0 } });
  }
}
