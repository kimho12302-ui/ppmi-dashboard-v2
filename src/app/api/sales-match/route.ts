import { NextRequest, NextResponse } from "next/server";
import { revalidateAfter } from "@/lib/api-cache";
import { loadMatchTables, isSeeded } from "@/lib/sales-match";
import {
  MATCH_SETUP_MESSAGE, SOURCE_SEED, canDelete, normKey, saveMatch, sortMatches, toApiMatch,
} from "@/lib/sales-match-core";
import { deleteMatchRow, getMatchRow, saveDeps } from "./deps";

// 판매입력 매칭표 (2026-11-26). 규칙 src/lib/sales-match-core.ts, DB src/lib/sales-match.ts,
// 표 docs/sql/2026-11-26-sales-match.sql.
//   GET    /api/sales-match           → {ok, setupNeeded, seeded, match:[{key, code, source, note, updatedAt}], items:[{code, name, warehouse}]}
//                                        ★ 볼트 sales_entry_push.py fetch_match 가 매일 x-ppmi-key 로 받아 계산한다(정본). 캐시 안 씀
//   POST   /api/sales-match           ← {key, code, note?, warehouse?} 한 줄 넣기·바꾸기 + 보관된 #N/A 줄 고치기
//                                        warehouse: 그 코드의 출하창고가 없을(표에 없거나 빈) 때 고른 창고. 출하창고 표에 넣고 고친 줄에 쓴다.
//                                        고르기 목록 밖이면 400, 이미 다른 창고가 있는 코드면 409(「매칭표 보기」에서 바꾸기). 같은 창고면 그냥 지나간다
//                                        응답 {ok, saved, match, product, warehouse, patched:{dates, lines}, originalStale:[날짜], warnings}
//                                        originalStale = 줄을 고친 날 중 원본 파일이 있어 「원본 다시 만들기」 표시를 켠 날
//   POST   /api/sales-match/item      ← {code, warehouse} 품목코드별 출하창고 바꾸기(item/route.ts)
//   DELETE /api/sales-match?key=…     ← 대시보드에서 넣은 줄만 지운다
// 인증은 미들웨어(팀 로그인 쿠키 또는 x-ppmi-key). 통계 시트는 읽기만, 매출 원장은 안 건드린다.
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function GET() {
  try {
    const res = await loadMatchTables();
    if (res.setupNeeded) {
      return NextResponse.json({ ok: false, setupNeeded: true, seeded: false, message: MATCH_SETUP_MESSAGE, match: [], items: [] }, { headers: NO_STORE });
    }
    if (res.error) {
      return NextResponse.json({ ok: false, error: "매칭표를 불러오지 못했습니다", message: res.error.message }, { status: 500, headers: NO_STORE });
    }
    return NextResponse.json({
      ok: true,
      setupNeeded: false,
      seeded: res.data.match.some((m) => m.source === SOURCE_SEED),
      match: sortMatches(res.data.match.map(toApiMatch)),
      items: res.data.items.map((i) => ({ code: i.code, name: i.name, warehouse: i.warehouse })),
    }, { headers: NO_STORE });
  } catch (error) {
    console.error("sales-match GET error:", error);
    return NextResponse.json({ ok: false, error: "매칭표를 불러오지 못했습니다", message: errText(error) }, { status: 500, headers: NO_STORE });
  }
}

async function postImpl(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "JSON 파싱 실패" }, { status: 400 });
  }
  try {
    const res = await saveMatch(saveDeps, body);
    return NextResponse.json(res.body, { status: res.status });
  } catch (error) {
    console.error("sales-match POST error:", error);
    return NextResponse.json({ ok: false, error: errText(error) }, { status: 500 });
  }
}

async function deleteImpl(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (!key) return NextResponse.json({ ok: false, error: "key(매칭열쇠)가 필요합니다" }, { status: 400 });
  try {
    const seeded = await isSeeded();
    if (seeded.setupNeeded) return NextResponse.json({ ok: false, setupNeeded: true, error: MATCH_SETUP_MESSAGE }, { status: 503 });
    const row = await getMatchRow(normKey(key));
    if (row.setupNeeded) return NextResponse.json({ ok: false, setupNeeded: true, error: MATCH_SETUP_MESSAGE }, { status: 503 });
    if (row.error) return NextResponse.json({ ok: false, error: row.error.message }, { status: 500 });
    if (!row.data) return NextResponse.json({ ok: false, error: "매칭표에 없는 열쇠입니다" }, { status: 404 });
    if (!canDelete(row.data)) return NextResponse.json({ ok: false, error: "엑셀에서 옮긴 줄은 지울 수 없습니다. 코드를 바꾸세요" }, { status: 409 });
    const { error } = await deleteMatchRow(row.data.key_norm);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, deleted: row.data.match_key, note: "이미 고친 보관 줄은 그대로입니다" });
  } catch (error) {
    console.error("sales-match DELETE error:", error);
    return NextResponse.json({ ok: false, error: errText(error) }, { status: 500 });
  }
}

export const POST = revalidateAfter(postImpl, ["sales_match", "sales_item_codes", "sales_entry_runs", "sales_entry_lines"]);
export const DELETE = revalidateAfter(deleteImpl, ["sales_match"]);
