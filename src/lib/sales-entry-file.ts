// 판매입력 원본 엑셀 보관: Supabase Storage·DB 연결 (2026-11-26). 규칙(암호화·검사·판정)은 src/lib/sales-entry-file-core.ts.
//   POST /api/sales-entry/file         ← 볼트 sales_entry_push.py (x-ppmi-key)
//   GET  /api/sales-entry/xlsx         → 원본이 있으면 복호화한 원본, 없으면 생성본
//   GET  /api/sales-entry/file/health  → 열쇠·버킷 확인
// 버킷·칸: docs/sql/2026-11-26-sales-entry-files.sql
import { supabase } from "@/lib/supabase";
import { RUNS_TABLE } from "@/lib/sales-entry-core";
import {
  FILE_BUCKET, HEALTH_PROBE_PATH, bucketProbeOk,
  type FileUploadDeps, type StoreError,
} from "@/lib/sales-entry-file-core";

const bucket = () => supabase.storage.from(FILE_BUCKET);

const storeError = (e: unknown): StoreError | null => {
  if (!e) return null;
  const o = e as { message?: unknown; statusCode?: string | number; status?: number };
  return { message: typeof o.message === "string" ? o.message : String(e), statusCode: o.statusCode, status: o.status };
};

export const fileUploadDeps: FileUploadDeps = {
  runExists: async (date) => {
    const { data, error } = await supabase.from(RUNS_TABLE).select("date").eq("date", date).maybeSingle();
    return { exists: !!data, error };
  },
  put: async (path, blob) => {
    const { error } = await bucket().upload(path, blob, { upsert: true, contentType: "application/octet-stream", cacheControl: "0" });
    return { error: storeError(error) };
  },
  markRun: async (date, cols) => {
    const { data, error } = await supabase.from(RUNS_TABLE).update(cols).eq("date", date).select("date");
    return { updated: data?.length ?? 0, error };
  },
  clearStale: async (date) => {
    const { error } = await supabase.from(RUNS_TABLE).update({ original_stale: false }).eq("date", date);
    return { error };
  },
  now: () => new Date().toISOString(),
};

export async function downloadOriginal(path: string): Promise<{ data: Uint8Array | null; error: StoreError | null }> {
  const { data, error } = await bucket().download(path);
  if (error || !data) return { data: null, error: storeError(error) ?? { message: "빈 응답" } };
  return { data: new Uint8Array(await data.arrayBuffer()), error: null };
}

/** 버킷이 있는지(없는 경로를 받아 「Object not found」가 오는지). 쓰지 않는다 */
export async function probeBucket(): Promise<boolean> {
  try {
    const { data, error } = await bucket().download(HEALTH_PROBE_PATH);
    return bucketProbeOk({ data, error: storeError(error) });
  } catch {
    return false;
  }
}
