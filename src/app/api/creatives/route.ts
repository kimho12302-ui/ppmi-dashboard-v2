import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30; // Vercel serverless timeout (seconds)

const META_TOKEN = process.env.META_ADS_TOKEN || "";
const AD_ACCOUNTS: Record<string, string> = {
  nutty: process.env.META_NUTTY_AD_ACCOUNT || "act_1510647003433200",
  ironpet: process.env.META_IRONPET_AD_ACCOUNT || "act_8188388757843816",
};

interface Creative {
  id: string;
  name: string;
  status: string;
  brand: string;
  thumbnail_url: string;
  image_url: string;
  video_id: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  // Funnel metrics
  landing_page_views: number;
  add_to_cart: number;
  initiate_checkout: number;
  purchases: number;
  revenue: number;
  roas: number;
  // Calculated
  cac: number; // cost per purchase
  cart_to_purchase_rate: number;
  click_to_cart_rate: number;
}

async function fetchAllPages(initialUrl: string): Promise<any[]> {
  const all: any[] = [];
  let nextUrl: string | null = initialUrl;
  let iterations = 0;
  while (nextUrl && iterations < 10) {
    iterations++;
    const resp: Response = await globalThis.fetch(nextUrl);
    const body = await resp.json();
    if (body.data) all.push(...body.data);
    nextUrl = body.paging?.next || null;
    if (all.length > 500) break;
  }
  return all;
}

// Simple in-memory cache (survives across requests within same serverless invocation)
let cache: { key: string; data: any; ts: number } | null = null;
const CACHE_TTL = 10 * 60 * 1000; // 10 min

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const brand = sp.get("brand") || "all";
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";

  if (!META_TOKEN) {
    return NextResponse.json({ creatives: [], error: "META_ADS_TOKEN not configured" });
  }

  const cacheKey = `${brand}|${from}|${to}`;
  if (cache && cache.key === cacheKey && Date.now() - cache.ts < CACHE_TTL) {
    return NextResponse.json(cache.data);
  }

  try {
    const accounts = brand === "all"
      ? Object.entries(AD_ACCOUNTS)
      : AD_ACCOUNTS[brand]
        ? [[brand, AD_ACCOUNTS[brand]]]
        : [];

    const allCreatives: Creative[] = [];

    for (const [brandName, accountId] of accounts) {
      try {
      // Strategy: fetch insights first (only ads with data), then fetch creative details for those
      const insParams: Record<string, string> = {
        access_token: META_TOKEN,
        fields: "ad_id,ad_name,impressions,clicks,spend,ctr,cpc,actions,action_values",
        level: "ad",
        limit: "500",
      };
      if (from && to) {
        insParams.time_range = JSON.stringify({ since: from, until: to });
      } else {
        insParams.date_preset = "last_30d";
      }
      const insightsUrl = `https://graph.facebook.com/v19.0/${accountId}/insights?` +
        new URLSearchParams(insParams);
      const allInsights = await fetchAllPages(insightsUrl);
      console.log(`[creatives] ${brandName}: ${allInsights.length} insight rows`);

      // Fetch creative details only for ads with spend > 0
      const adsWithSpend = allInsights.filter(r => Number(r.spend || 0) > 0);
      const adIds = adsWithSpend.map(r => r.ad_id);
      
      // Batch fetch ad details (up to 50 at a time via IDs filter)
      const adDetailsMap = new Map<string, any>();
      for (let i = 0; i < adIds.length; i += 50) {
        const batch = adIds.slice(i, i + 50);
        const idsParam = batch.join(",");
        const adsUrl = `https://graph.facebook.com/v19.0/?ids=${idsParam}&fields=name,status,creative{thumbnail_url,image_url,effective_instagram_media_id,effective_object_story_id,video_id,object_story_spec}&access_token=${META_TOKEN}`;
        try {
          const resp = await globalThis.fetch(adsUrl);
          const body = await resp.json();
          for (const [id, data] of Object.entries(body)) {
            adDetailsMap.set(id, data);
          }
        } catch { /* continue without creative details */ }
      }

      for (const ins of adsWithSpend) {
        const ad = adDetailsMap.get(ins.ad_id) || {};
        const cr = (ad as any).creative || {};
        const spend = Number(ins.spend || 0);

        // Extract funnel actions
        let purchases = 0, revenue = 0, addToCart = 0, initiateCheckout = 0, landingPageViews = 0;
        for (const a of ins.actions || []) {
          if (a.action_type === "purchase" || a.action_type === "offsite_conversion.fb_pixel_purchase") purchases = Number(a.value || 0);
          if (a.action_type === "offsite_conversion.fb_pixel_add_to_cart" || a.action_type === "add_to_cart") addToCart = Number(a.value || 0);
          if (a.action_type === "offsite_conversion.fb_pixel_initiate_checkout" || a.action_type === "initiate_checkout") initiateCheckout = Number(a.value || 0);
          if (a.action_type === "landing_page_view") landingPageViews = Number(a.value || 0);
        }
        for (const a of ins.action_values || []) {
          if (a.action_type === "purchase" || a.action_type === "offsite_conversion.fb_pixel_purchase") revenue = Number(a.value || 0);
        }

        const clicks = Number(ins.clicks || 0);

        allCreatives.push({
          id: ins.ad_id,
          name: (ad as any).name || ins.ad_name || "",
          status: (ad as any).status || "UNKNOWN",
          brand: brandName,
          thumbnail_url: cr.thumbnail_url ? cr.thumbnail_url.replace(/\/s\d+x\d+\//, '/s1080x1080/') : "",
          image_url: cr.image_url || cr.object_story_spec?.link_data?.picture || "",
          video_id: cr.video_id || "",
          spend,
          impressions: Number(ins.impressions || 0),
          clicks,
          ctr: Number(ins.ctr || 0),
          cpc: Number(ins.cpc || 0),
          landing_page_views: landingPageViews,
          add_to_cart: addToCart,
          initiate_checkout: initiateCheckout,
          purchases,
          revenue,
          roas: spend > 0 ? revenue / spend : 0,
          cac: purchases > 0 ? spend / purchases : 0,
          cart_to_purchase_rate: addToCart > 0 ? (purchases / addToCart) * 100 : 0,
          click_to_cart_rate: clicks > 0 ? (addToCart / clicks) * 100 : 0,
        });
      }
      } catch (err) {
        console.error(`[creatives] ${brandName} error:`, err);
        // Continue with other accounts
      }
    }

    // Sort by spend descending
    allCreatives.sort((a, b) => b.spend - a.spend);

    const result = { creatives: allCreatives, total: allCreatives.length };
    cache = { key: cacheKey, data: result, ts: Date.now() };
    return NextResponse.json(result);
  } catch (error) {
    console.error("Creatives API error:", error);
    return NextResponse.json({ creatives: [], error: "Failed to fetch creatives" });
  }
}
