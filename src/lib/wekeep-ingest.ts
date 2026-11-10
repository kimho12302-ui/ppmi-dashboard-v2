// 수집기 원천을 받아 넣는다 (2026-11-10). 쓰는 쪽: 로컬 수집기 settings/collectors/bin/wekeep-inventory.mjs · coupang-rg-inventory.mjs --push.
//
// 두 길로 들어온다. 둘 다 이 함수 하나를 쓰고, 둘 다 x-ppmi-key(수집기 키)가 있어야 한다(사람 로그인 쿠키로는 못 씀).
//   - POST /api/wekeep-ingest  (위킵 전용)
//   - POST /api/raw-ingest     (볼트 lib/push.mjs pushRaw 가 부르는 공용 자리. source 가 wekeep-* · coupang-rg-* 면 여기로 넘김)
// 규칙(검증·중복·심박)은 src/lib/wekeep-ingest-core.ts. 여기는 supabase 를 이어 줄 뿐이다.
import { supabase } from "@/lib/supabase";
import { runCollectorIngest, type CollectorSource, type IngestDb, type IngestResult } from "@/lib/wekeep-ingest-core";

export {
  WEKEEP_SOURCES, isWekeepSource, WEKEEP_HEARTBEAT, COLLECTOR_SOURCES, isCollectorSource, COUPANG_RG_HEARTBEAT,
} from "@/lib/wekeep-ingest-core";

const db: IngestDb = {
  upsert: (table, rows, onConflict) => supabase.from(table).upsert(rows, { onConflict }),
  beat: (fields) => supabase.from("sync_heartbeat").upsert(fields, { onConflict: "source" }),
};

export function ingestWekeep(source: CollectorSource, rows: unknown, today: string): Promise<IngestResult> {
  return runCollectorIngest(source, rows, today, db);
}
