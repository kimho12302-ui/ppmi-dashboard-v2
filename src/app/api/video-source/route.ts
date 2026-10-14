import { NextRequest, NextResponse } from "next/server";
import { cachedGET } from "@/lib/api-cache";

const META_TOKEN = process.env.META_ADS_TOKEN || "";

async function getImpl(request: NextRequest) {
  const videoId = request.nextUrl.searchParams.get("video_id") || "";
  if (!META_TOKEN || !videoId) {
    return NextResponse.json({ source: "", error: "missing params" });
  }

  try {
    const url = `https://graph.facebook.com/v19.0/${videoId}?fields=source&access_token=${META_TOKEN}`;
    const res = await globalThis.fetch(url);
    const data = await res.json();
    return NextResponse.json({ source: data.source || "" });
  } catch {
    return NextResponse.json({ source: "", error: "fetch failed" });
  }
}

// 5분 캐시·쓰기 후 무효화 (src/lib/api-cache.ts)
export const GET = cachedGET(getImpl, ["ext_meta"], ["video_id"]);
