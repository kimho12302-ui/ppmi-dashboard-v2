export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// 데이터 동기화 watchdog.
// 오늘(KST) 수집 heartbeat가 없으면(=스케줄 누락) GitHub API로 daily-sync 워크플로를 재실행.
// Vercel cron(12:00·15:00 KST)에서 호출. ?dry=1 은 인증 없이 진단만(트리거 안 함).

const REPO = "kimho12302-ui/marketing-dashboard";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

async function sendTelegram(text: string) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "HTML" }),
    });
  } catch { /* best-effort */ }
}

async function triggerWorkflow(workflow: string, inputs?: Record<string, string>): Promise<number> {
  const token = process.env.GH_DISPATCH_TOKEN;
  if (!token) return 0;
  const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: "master", ...(inputs ? { inputs } : {}) }),
  });
  return res.status; // 204 = 성공
}

export async function GET(req: NextRequest) {
  const dry = req.nextUrl.searchParams.get("dry") === "1";

  // 트리거(쓰기성)는 cron 시크릿 필요. dry 진단은 공개.
  if (!dry) {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const todayKST = new Date(Date.now() + 32400000).toISOString().slice(0, 10);
    const yesterdayKST = new Date(Date.now() + 32400000 - 86400000).toISOString().slice(0, 10);

    // 수집 소스 heartbeat (행수 포함 — '돌았지만 0행' 실패를 잡기 위함)
    const { data: hb } = await supabase.from("sync_heartbeat").select("source,last_success,rows_written");
    let maxLast: string | null = null;
    for (const h of hb || []) {
      const d = h.last_success ? String(h.last_success).slice(0, 10) : null;
      if (d && (!maxLast || d > maxLast)) maxLast = d;
    }
    const ranToday = !!maxLast && maxLast >= todayKST;

    // ★ heartbeat.rows_written는 naver_sa/google/cafe24에서 성공해도 0으로 오보고됨(신뢰 불가).
    //   → 실제 daily_ad_spend 데이터로 '어제분(T-1)' 신선도를 판정한다.
    //   매일 자동수집되고 행수가 안정적인 채널만 사용(google=무집행, gfa/coupang=수기 → 제외).
    const lookbackStart = new Date(Date.now() + 32400000 - 8 * 86400000).toISOString().slice(0, 10);
    const RELIABLE = ["naver_search", "naver_shopping", "meta"];
    const { data: adRows } = await supabase
      .from("daily_ad_spend")
      .select("date,channel")
      .in("channel", RELIABLE)
      .gte("date", lookbackStart)
      .lte("date", yesterdayKST);
    const cnt: Record<string, Record<string, number>> = {};
    for (const r of adRows || []) {
      (cnt[r.channel] ||= {});
      cnt[r.channel][r.date] = (cnt[r.channel][r.date] || 0) + 1;
    }
    const staleChannels: string[] = [];
    for (const ch of RELIABLE) {
      const byDate = cnt[ch] || {};
      const priorCounts = Object.entries(byDate).filter(([d]) => d < yesterdayKST).map(([, c]) => c);
      const expected = priorCounts.length ? Math.max(...priorCounts) : 1;
      const yday = byDate[yesterdayKST] || 0;
      // 어제분이 0행(전무)이거나, 정상 3행 채널인데 어제만 모자라면(부분수집) 미완성으로 판정.
      if (yday === 0 || (expected >= 3 && yday < expected)) staleChannels.push(`${ch}(${yday}/${expected})`);
    }

    // 파이프라인이 아예 안 돌았으면 기본 재실행, 어제분이 미완성이면 '어제분'만 백필.
    const backfillYesterday = staleChannels.length > 0;
    const wouldTrigger = !ranToday || backfillYesterday;

    if (dry) {
      return NextResponse.json({ ok: true, dry: true, todayKST, yesterdayKST, maxLast, ranToday, staleChannels, wouldTrigger });
    }

    if (!wouldTrigger) {
      return NextResponse.json({ ok: true, ranToday: true, maxLast, staleChannels: [] });
    }

    const status = backfillYesterday
      ? await triggerWorkflow("daily-sync.yml", { start_date: yesterdayKST, end_date: yesterdayKST })
      : await triggerWorkflow("daily-sync.yml");
    const ok = status === 204;
    const reason = backfillYesterday
      ? `어제(${yesterdayKST}) 광고데이터 미완성: ${staleChannels.join(", ")} → 백필`
      : `오늘 수집 없음 (마지막 ${maxLast || "없음"})`;
    await sendTelegram(
      `⚠️ <b>데이터 동기화 watchdog</b>\n${reason}\n→ daily-sync ${ok ? "✅ 트리거됨" : `❌ 실패(HTTP ${status})`}`
    );
    return NextResponse.json({ ok, ranToday, maxLast, staleChannels, backfillYesterday, triggered: ok, dispatchStatus: status });
  } catch (error) {
    console.error("watchdog error:", error);
    return NextResponse.json({ error: "watchdog failed" }, { status: 500 });
  }
}
