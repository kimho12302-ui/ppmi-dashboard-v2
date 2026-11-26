import { NextRequest, NextResponse } from "next/server";
import { revalidateAfter } from "@/lib/api-cache";
import { saveItemWarehouse } from "@/lib/sales-match-core";
import { itemDeps } from "../deps";

// 품목코드별 출하창고 바꾸기 (2026-11-26). 「자동 판매입력」 카드 「매칭표 보기」 안 「품목코드별 출하창고」가 부른다.
//   POST /api/sales-match/item  {code, warehouse}
//     warehouse 는 sales_item_codes 에 실제로 쓰인 값 중 하나만(직접 입력 안 받음, 목록 밖이면 400).
//     표에 있는 코드는 창고만 바꾸고, 없는 코드는 통계 시트 「상품 목록」에 있을 때만 넣는다(이름 = E열).
//     이미 보관된 판매입력 줄의 출하창고는 그대로다(회사 PC 가 다음 계산부터 이 창고를 쓴다).
//   응답 {ok, item:{code, name, warehouse}, previous, unchanged?, note}
// 규칙 src/lib/sales-match-core.ts saveItemWarehouse. 인증은 미들웨어(팀 로그인 쿠키 또는 x-ppmi-key).
export const dynamic = "force-dynamic";

async function postImpl(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "JSON 파싱 실패" }, { status: 400 });
  }
  try {
    const res = await saveItemWarehouse(itemDeps, body);
    return NextResponse.json(res.body, { status: res.status });
  } catch (error) {
    console.error("sales-match item POST error:", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export const POST = revalidateAfter(postImpl, ["sales_item_codes"]);
