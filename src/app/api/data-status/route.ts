export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

interface SourceStatus {
  id: string;
  label: string;
  type: "auto" | "manual";
  latestDate: string | null;
  ok: boolean;
  // 하트비트 결합 상태: ok=정상 / no_activity=수집됐으나 데이터 없음(집행0) / disconnected=수집 끊김 / stale_manual=수기 미입력
  status: "ok" | "no_activity" | "disconnected" | "stale_manual";
  lastSync: string | null;
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


async function getLatestFunnelByChannel(channel: string, brand?: string, manualOnly = false): Promise<string | null> {
  let query = supabase.from("daily_funnel").select("date").eq("channel", channel);
  if (brand) query = query.eq("brand", brand);
  // GA4와 카페24 수기입력이 같은 행에 저장되므로, 수기 전용 필드(cart_adds)로 구분
  if (manualOnly) query = query.gt("cart_adds", 0);
  const { data } = await query.order("date", { ascending: false }).limit(1);
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
      { id: "google_ads", label: "Google Ads", type: "auto", fetcher: () => getLatestByChannel("google_pmax") },
      { id: "ga4", label: "GA4 (카페24 세션)", type: "auto", fetcher: () => getLatestFunnelByChannel("cafe24") },
      { id: "naver_sa", label: "\uB124\uC774\uBC84 \uAC80\uC0C9\uAD11\uACE0", type: "auto", fetcher: () => getLatestByChannel("naver_search") },
      { id: "naver_shopping", label: "\uB124\uC774\uBC84 \uC1FC\uD551\uAD11\uACE0", type: "auto", fetcher: () => getLatestByChannel("naver_shopping") },
      // Manual
      { id: "coupang_ads", label: "\uCFE0\uD321 \uAD11\uACE0\uBE44", type: "manual", fetcher: () => getLatestByChannel("coupang_ads") },
      { id: "gfa", label: "GFA \uAD11\uACE0\uBE44", type: "manual", fetcher: () => getLatestByChannel("gfa") },
      { id: "sales", label: "\uD310\uB9E4\uC2E4\uC801", type: "manual", fetcher: () => getLatestFromTable("daily_sales") },
      { id: "coupang_funnel", label: "\uCFE0\uD321 \uD37C\uB110", type: "manual", fetcher: () => getLatestFunnelByChannel("coupang") },
      { id: "smartstore_ironpet", label: "\uC2A4\uB9C8\uD2B8\uC2A4\uD1A0\uC5B4 (\uC544\uC774\uC5B8\uD3AB)", type: "manual", fetcher: () => getLatestFunnelByChannel("smartstore", "all") },
      { id: "smartstore_balancelab", label: "\uC2A4\uB9C8\uD2B8\uC2A4\uD1A0\uC5B4 (\uBC38\uB7F0\uC2A4\uB7A9)", type: "manual", fetcher: () => getLatestFunnelByChannel("smartstore", "balancelab") },
      { id: "cafe24_funnel", label: "\uCE74\uD39824 \uD37C\uB110", type: "manual", fetcher: () => getLatestFunnelByChannel("cafe24", undefined, true) },
    ];

    // 하트비트: 소스별 마지막 수집 성공 시각 (집행0 vs 연결끊김 구분)
    const { data: hbData } = await supabase.from("sync_heartbeat").select("source,last_success");
    const hbMap = new Map((hbData || []).map((h) => [h.source as string, h]));
    const HB_KEY: Record<string, string> = {
      meta_ads: "meta", google_ads: "google_ads", naver_sa: "naver_sa",
      naver_shopping: "naver_sa", ga4: "ga4_campaigns",
    };
    const recentThreshold = new Date(Date.now() + 32400000 - 2 * 86400000).toISOString().slice(0, 10);

    const sources: SourceStatus[] = await Promise.all(
      sourceDefs.map(async (def) => {
        let latestDate: string | null = null;
        try { latestDate = await def.fetcher(); } catch { latestDate = null; }
        const ok = !!latestDate && latestDate >= yesterday;
        const hb = hbMap.get(HB_KEY[def.id] || "");
        const lastSync = hb?.last_success ? String(hb.last_success).slice(0, 10) : null;
        const pipelineRan = !!lastSync && lastSync >= recentThreshold;
        let status: SourceStatus["status"];
        if (def.type === "manual") status = ok ? "ok" : "stale_manual";
        else if (ok) status = "ok";
        else if (pipelineRan) status = "no_activity"; // 수집은 됨 → 집행/활동 0
        else status = "disconnected"; // 수집 자체가 끊김
        return { id: def.id, label: def.label, type: def.type, latestDate, ok, status, lastSync };
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
