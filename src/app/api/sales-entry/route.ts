import { NextRequest, NextResponse } from "next/server";
import { cachedGET, NO_CACHE_HEADER, revalidateAfter } from "@/lib/api-cache";
import { API_KEY_HEADER, isApiKeyValid } from "@/lib/team-auth";
import { kstDate } from "@/lib/date";
import { SETUP_MESSAGE, isRealDate, validateSalesEntry } from "@/lib/sales-entry-core";
import { listSalesEntries, loadSalesEntry, saveSalesEntry } from "@/lib/sales-entry";

// 자동 판매입력 보관 (2026-11-26). 규칙은 src/lib/sales-entry-core.ts, DB 연결은 src/lib/sales-entry.ts.
//   POST /api/sales-entry              ← 볼트 sales_entry_push.py. 날짜 단위 통째 교체. x-ppmi-key 필수
//   GET  /api/sales-entry?days=30      → 최근 목록(날짜·줄 수·총매출·배송비·미매칭·누락·문제 수)
//   GET  /api/sales-entry?date=…       → 그날 상세(실행 행 + 줄 + 완료 판정)
//   GET  /api/sales-entry/xlsx?date=…  → 판매입력 엑셀
// 표가 없으면(SQL 실행 전) GET 은 200 { setupNeeded: true }, POST 는 503. 매출 원장·통계 시트에는 쓰지 않는다.
// 인증은 미들웨어(팀 로그인 쿠키 또는 x-ppmi-key). 쓰기는 수집기만 하므로 POST 는 여기서 키를 한 번 더 본다.

const DEFAULT_DAYS = 30;
const MAX_DAYS = 120;

async function getImpl(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const noCache = { headers: { [NO_CACHE_HEADER]: "1" } };
  try {
    const date = sp.get("date");
    if (date !== null) {
      if (!isRealDate(date)) return NextResponse.json({ error: `date 형식이 다릅니다(YYYY-MM-DD): ${date}` }, { status: 400 });
      const res = await loadSalesEntry(date);
      if (res.setupNeeded) return NextResponse.json({ setupNeeded: true, message: SETUP_MESSAGE }, noCache);
      if (res.error) return NextResponse.json({ error: "판매입력을 불러오지 못했습니다", message: res.error.message }, { status: 500 });
      return NextResponse.json({ date, ...res.data });
    }
    const n = Number(sp.get("days"));
    const days = Number.isInteger(n) && n >= 1 && n <= MAX_DAYS ? n : DEFAULT_DAYS;
    const from = kstDate(-(days - 1));
    const res = await listSalesEntries(from);
    if (res.setupNeeded) return NextResponse.json({ setupNeeded: true, message: SETUP_MESSAGE, days, from }, noCache);
    if (res.error) return NextResponse.json({ error: "판매입력 목록을 불러오지 못했습니다", message: res.error.message }, { status: 500 });
    return NextResponse.json({ setupNeeded: false, days, from, today: kstDate(), items: res.data });
  } catch (error) {
    console.error("sales-entry GET error:", error);
    return NextResponse.json({ error: "판매입력을 불러오지 못했습니다", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

async function postImpl(req: NextRequest) {
  if (!isApiKeyValid(req.headers.get(API_KEY_HEADER))) {
    return NextResponse.json({ ok: false, error: "수집기 접근 키(x-ppmi-key)가 필요합니다" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "JSON 파싱 실패" }, { status: 400 });
  }
  const v = validateSalesEntry(body, kstDate());
  if (!v.ok) return NextResponse.json({ ok: false, error: v.error, details: v.details }, { status: 400 });
  try {
    const res = await saveSalesEntry(v.value);
    return NextResponse.json(res.body, { status: res.status });
  } catch (error) {
    console.error("sales-entry POST error:", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export const GET = cachedGET(getImpl, ["sales_entry_runs", "sales_entry_lines"], ["days", "date"]);
export const POST = revalidateAfter(postImpl, ["sales_entry_runs", "sales_entry_lines"]);
