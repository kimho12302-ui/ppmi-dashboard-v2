import { NextRequest, NextResponse } from "next/server";

const META_TOKEN = process.env.META_ADS_TOKEN || "";

export async function GET(request: NextRequest) {
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
