import { NextResponse } from "next/server";
import { readProductList } from "@/lib/sales-match";

// 통계 시트 「상품 목록」 품목코드(2026-11-26). 「자동 판매입력」 카드의 코드 선택 상자가 쓴다.
//   GET /api/sales-match/products → {ok, items:[{code, name, brand, category, lineup}]}
// 캐시 없이 매번 시트를 읽는다(방금 시트에 넣은 코드를 바로 고를 수 있게). 시트는 읽기만 한다.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const list = await readProductList();
    return NextResponse.json(
      { ok: true, items: list.map((p) => ({ code: p.code, name: p.name, brand: p.brand, category: p.category, lineup: p.lineup })) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("sales-match products error:", error);
    return NextResponse.json(
      { ok: false, error: "통계 시트 「상품 목록」을 못 읽었습니다", message: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
