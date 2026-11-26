// 매칭표 라우트가 공유하는 연결(2026-11-26). Loaded 모양을 src/lib/sales-match-core.ts 흐름 함수가 받는 모양으로 바꾼다.
import { SHEET_HEADERS } from "@/lib/sales-entry-core";
import {
  deleteMatchRow, existingKeys, getMatchRow, getWarehouse, insertIgnoringExisting, isSeeded, listItems, markOriginalStale,
  patchDb, readProductList, upsertItem, upsertMatchRow,
  type Loaded,
} from "@/lib/sales-match";
import { ITEMS_TABLE, MATCH_TABLE, type DbError, type ItemSaveDeps, type SaveMatchDeps, type SeedDeps } from "@/lib/sales-match-core";

function flat<T>(r: Loaded<T>): { setupNeeded: boolean; error: DbError | null; data?: T } {
  if (r.setupNeeded) return { setupNeeded: true, error: null };
  if (r.error) return { setupNeeded: false, error: r.error };
  return { setupNeeded: false, error: null, data: r.data };
}

export const saveDeps: SaveMatchDeps = {
  isSeeded: async () => flat(await isSeeded()),
  readProductCodes: readProductList,
  getRow: async (k) => flat(await getMatchRow(k)),
  upsert: upsertMatchRow,
  getWarehouse,
  listItems,
  upsertItem,
  markOriginalStale,
  patchDb,
  headers: SHEET_HEADERS,
  now: () => new Date().toISOString(),
};

export const seedDeps: SeedDeps = {
  existingKeys: () => existingKeys(MATCH_TABLE, "key_norm"),
  existingCodes: () => existingKeys(ITEMS_TABLE, "code"),
  insertMatch: (rows) => insertIgnoringExisting(MATCH_TABLE, rows, "key_norm"),
  insertItems: (rows) => insertIgnoringExisting(ITEMS_TABLE, rows, "code"),
  now: () => new Date().toISOString(),
};

export const itemDeps: ItemSaveDeps = {
  listItems,
  upsertItem,
  readProductCodes: readProductList,
};

export { deleteMatchRow, getMatchRow };
