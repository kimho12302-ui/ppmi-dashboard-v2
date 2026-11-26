import { NextResponse } from "next/server";
import { parseFileKey } from "@/lib/sales-entry-file-core";
import { probeBucket } from "@/lib/sales-entry-file";

// 판매입력 원본 보관 점검 (2026-11-26). GET /api/sales-entry/file/health → { keyOk, bucketOk } 만.
//   keyOk: SALES_FILE_KEY 가 base64 32바이트인지(Vercel 민감 변수라 pull 로 확인이 안 된다). 값은 내주지 않는다.
//   bucketOk: 버킷 sales-entry-files 가 있는지(없는 경로를 받아 「Object not found」가 오는지). 정책 유무는 못 본다.
//   인증은 미들웨어(팀 쿠키 또는 x-ppmi-key).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const keyOk = parseFileKey(process.env.SALES_FILE_KEY).ok;
  const bucketOk = await probeBucket();
  return NextResponse.json({ keyOk, bucketOk }, { headers: { "Cache-Control": "no-store" } });
}
