import { NextRequest, NextResponse } from "next/server";
import { revalidateAfter } from "@/lib/api-cache";
import { API_KEY_HEADER, isApiKeyValid } from "@/lib/team-auth";
import { kstDate } from "@/lib/date";
import { MAX_UPLOAD_BYTES, runSalesFileUpload } from "@/lib/sales-entry-file-core";
import { fileUploadDeps } from "@/lib/sales-entry-file";

// 판매입력 원본 엑셀 올리기 (2026-11-26). POST /api/sales-entry/file?date=YYYY-MM-DD  ← 볼트 sales_entry_push.py
//   x-ppmi-key 만 받는다(팀 쿠키로는 못 올린다). 본문 = xlsx 바이트(application/octet-stream) 또는 multipart 의 file 칸.
//   서버에서 AES-256-GCM 으로 암호화해 비공개 버킷에 넣고 sales_entry_runs 원본 칸을 갱신한다.
//   ★ 그날 JSON(POST /api/sales-entry)을 먼저 보내야 한다(없으면 409). Vercel 은 4.5MB 넘는 본문을 라우트 전에 413 으로 막는다.
//   규칙: src/lib/sales-entry-file-core.ts. 내용·고객정보·열쇠를 로그에 찍지 않는다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readBody(req: NextRequest): Promise<{ bytes: Uint8Array } | { status: number; error: string }> {
  const len = Number(req.headers.get("content-length"));
  if (Number.isFinite(len) && len > MAX_UPLOAD_BYTES + 64 * 1024) {
    return { status: 413, error: `파일이 너무 큽니다: ${len}바이트 (최대 ${MAX_UPLOAD_BYTES})` };
  }
  const type = req.headers.get("content-type") ?? "";
  if (type.startsWith("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) return { status: 400, error: "multipart 에 file 칸이 없습니다" };
    return { bytes: new Uint8Array(await file.arrayBuffer()) };
  }
  return { bytes: new Uint8Array(await req.arrayBuffer()) };
}

async function postImpl(req: NextRequest) {
  if (!isApiKeyValid(req.headers.get(API_KEY_HEADER))) {
    return NextResponse.json({ ok: false, error: "수집기 접근 키(x-ppmi-key)가 필요합니다" }, { status: 401 });
  }
  const date = req.nextUrl.searchParams.get("date") ?? "";
  try {
    const body = await readBody(req);
    if ("error" in body) return NextResponse.json({ ok: false, error: body.error }, { status: body.status });
    const res = await runSalesFileUpload(fileUploadDeps, date, body.bytes, process.env.SALES_FILE_KEY, kstDate());
    return NextResponse.json(res.body, { status: res.status });
  } catch (error) {
    // 오류 객체만 남긴다(본문·열쇠는 오류에 들어가지 않는다)
    console.error("sales-entry file POST error:", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ ok: false, error: "원본 저장 중 오류", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export const POST = revalidateAfter(postImpl, ["sales_entry_runs"]);
