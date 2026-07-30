export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getSourceStatuses } from "@/lib/data-sources";

// 데이터 동기화 watchdog.
// 오늘(KST) 수집 heartbeat가 없으면(=스케줄 누락) GitHub API로 daily-sync 워크플로를 재실행.
// Vercel cron(12:00·15:00 KST)에서 호출. ?dry=1 은 인증 없이 진단만(트리거 안 함).
//
// 자동수집(광고비)과 별개로 수기 입력 지연도 감시한다. 수기 입력은 워크플로 재실행으로
// 해결되지 않으므로 트리거 없이 텔레그램 알림만 보낸다.
// (2026-07: 카페24·스마트스토어 퍼널이 21일 비었는데 알림이 0건이었음)

const REPO = "kimho12302-ui/marketing-dashboard";

// 수기 입력은 매일이 아니라 주/월 단위로 몰아서 넣는 운영 방식이다(2026-07-29 확인).
// 따라서 "며칠 밀렸나"로 알리면 정상 리듬에도 계속 울린다.
// 기준은 "지난달 입력이 아직 안 끝났나" — 이번 달은 진행 중이므로 채근하지 않는다.
// 매달 이 날짜가 지나면 지난달 미완료를 알린다(월초 정리 기간을 준다).
const MANUAL_GRACE_DAY_OF_MONTH = 5;
// 알림 발송 기록용 의사 소스명. 하루 1회만 보내기 위한 상태 저장소로 sync_heartbeat를 재사용한다.
const ALERT_SOURCE = "watchdog_manual_alert";
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
    let lastManualAlertDay: string | null = null;
    for (const h of hb || []) {
      const d = h.last_success ? String(h.last_success).slice(0, 10) : null;
      // ALERT_SOURCE는 watchdog이 스스로 쓰는 행이라 '수집이 돌았는지' 판정에서 제외해야 한다.
      // 포함하면 maxLast가 항상 오늘이 되어 ranToday가 늘 true가 된다.
      if (h.source === ALERT_SOURCE) {
        lastManualAlertDay = d;
        continue;
      }
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

    // 수기 입력 지연 — 워크플로 재실행으로 해결되지 않으므로 알림만. 크론이 하루 3회라 1회로 제한.
    // 판정: 지난달 마지막 날까지 채워졌는지. 이번 달은 진행 중이라 보지 않는다.
    const [y, mo, dayOfMonth] = todayKST.split("-").map(Number);
    const prevMonthEnd = new Date(Date.UTC(y, mo - 1, 0)).toISOString().slice(0, 10); // 전월 말일
    const pastGrace = dayOfMonth >= MANUAL_GRACE_DAY_OF_MONTH;

    const { sources } = await getSourceStatuses();
    const staleManual = sources.filter(
      (s) => s.type === "manual" && (s.latestDate === null || s.latestDate < prevMonthEnd)
    );
    const manualAlertPending = pastGrace && staleManual.length > 0 && lastManualAlertDay !== todayKST;
    const staleManualLabels = staleManual.map(
      (s) => `${s.label}(최종 ${s.latestDate ?? "없음"})`
    );

    if (dry) {
      return NextResponse.json({
        ok: true, dry: true, todayKST, yesterdayKST, maxLast, ranToday, staleChannels, wouldTrigger,
        prevMonthEnd, pastGrace, staleManual: staleManualLabels, lastManualAlertDay, manualAlertPending,
      });
    }

    if (manualAlertPending) {
      const lines = staleManual
        .map((s) => `· ${s.label}: 최종 ${s.latestDate ?? "없음"}`)
        .join("\n");
      await sendTelegram(
        `📝 <b>지난달 수기 입력 미완료</b>\n${prevMonthEnd}까지 채워져 있어야 하는데 ${staleManual.length}개 소스가 비어 있습니다.\n${lines}\n\n대시보드 설정 &gt; 일일 입력에서 채워주세요.`
      );
      // 오늘 보냈다는 표시. 다음 크론(같은 날)에서는 재발송하지 않는다.
      await supabase.from("sync_heartbeat").upsert(
        {
          source: ALERT_SOURCE,
          last_run: new Date().toISOString(),
          last_success: new Date().toISOString(),
          ok: true,
          rows_written: staleManual.length,
          note: staleManual.map((s) => s.id).join(","),
        },
        { onConflict: "source" }
      );
    }

    if (!wouldTrigger) {
      return NextResponse.json({
        ok: true, ranToday: true, maxLast, staleChannels: [],
        staleManual: staleManualLabels, manualAlerted: manualAlertPending,
      });
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
    return NextResponse.json({
      ok, ranToday, maxLast, staleChannels, backfillYesterday, triggered: ok, dispatchStatus: status,
      staleManual: staleManualLabels, manualAlerted: manualAlertPending,
    });
  } catch (error) {
    console.error("watchdog error:", error);
    return NextResponse.json({ error: "watchdog failed" }, { status: 500 });
  }
}
