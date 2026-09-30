// 사진을 볼트 폴더에 바로 저장한다. 2026-09-30 신설.
//
// 왜 필요한가
// ──────────
// 일반 내려받기는 파일이 Downloads 로 떨어진다. 캐러셀 작업 폴더에 넣으려면 사람이
// 매번 옮겨야 한다. File System Access API 로 폴더를 한 번 잡아 두면 그 손이 없어진다.
//
// 어디서 되는가
// ────────────
// 크로미움 계열(Chrome · Edge)만 된다. Firefox · Safari 에는 showDirectoryPicker 가 없다.
// 그래서 isSupported() 가 false 면 화면은 그 버튼을 아예 감춘다. 버튼을 띄워 놓고
// 눌렀을 때 실패하게 두면 안 된다.
//
// 폴더 핸들을 왜 IndexedDB 에 넣는가
// ────────────────────────────────
// FileSystemDirectoryHandle 은 구조화 복제가 되므로 IndexedDB 에 그대로 저장된다.
// localStorage 는 문자열만 받으므로 못 쓴다. 저장해 두면 다음 방문에 폴더를 다시 안 묻는다.
// 다만 쓰기 권한은 탭·세션을 넘기면 만료되므로 그때는 requestPermission 으로 한 번 더 묻는다.

const DB_NAME = "ppmi-dashboard-photos";
const DB_VERSION = 1;
const STORE = "handles";
const HANDLE_KEY = "photo-dir";

/** 김호 작업 폴더. 화면에 그대로 적어 어디를 잡아야 하는지 헷갈리지 않게 한다. */
export const RECOMMENDED_DIR = String.raw`H:\내 드라이브\obsidian\Obsidian\Work\밸런스랩\projects\인스타그램-캐러셀\uploads`;

/** lib.dom 에 아직 없는 조각만 최소로 선언한다. */
type PermissionMode = "read" | "readwrite";
interface HandlePermission {
  queryPermission?(d: { mode: PermissionMode }): Promise<PermissionState>;
  requestPermission?(d: { mode: PermissionMode }): Promise<PermissionState>;
}
export type DirHandle = FileSystemDirectoryHandle & HandlePermission;

interface PickerWindow {
  showDirectoryPicker?(opts?: { id?: string; mode?: PermissionMode; startIn?: string }): Promise<DirHandle>;
}

export function isSupported() {
  if (typeof window === "undefined") return false;
  return typeof (window as unknown as PickerWindow).showDirectoryPicker === "function";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB 열기 실패"));
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const store = db.transaction(STORE, mode).objectStore(STORE);
        const req = run(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("IndexedDB 작업 실패"));
      }),
  );
}

export async function loadDirHandle(): Promise<DirHandle | null> {
  if (!isSupported()) return null;
  try {
    const h = await tx<DirHandle | undefined>("readonly", (s) => s.get(HANDLE_KEY) as IDBRequest<DirHandle | undefined>);
    return h ?? null;
  } catch {
    // 저장소를 못 읽는 것이 기능을 막을 이유는 아니다. 폴더를 다시 물으면 된다.
    return null;
  }
}

export async function saveDirHandle(handle: DirHandle) {
  try {
    await tx("readwrite", (s) => s.put(handle, HANDLE_KEY));
  } catch {
    // 기억만 못 하는 것이다. 이번 세션 저장은 그대로 된다.
  }
}

export async function clearDirHandle() {
  try {
    await tx("readwrite", (s) => s.delete(HANDLE_KEY));
  } catch {
    // 지우기 실패는 조용히 넘긴다. 다음 선택이 덮어쓴다.
  }
}

/** 폴더를 고른다. 취소하면 null(사고가 아니므로 에러로 올리지 않는다). */
export async function pickDir(): Promise<DirHandle | null> {
  const picker = (window as unknown as PickerWindow).showDirectoryPicker;
  if (!picker) return null;
  try {
    return await picker({ id: "ppmi-photo-dir", mode: "readwrite" });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return null;
    throw err;
  }
}

/**
 * 쓰기 권한 확인. 저장해 둔 핸들은 권한이 만료돼 있는 것이 정상이라
 * 처음 저장할 때 한 번 다시 묻는다. granted 가 아니면 false 를 돌려주고 화면이 안내한다.
 */
export async function ensureWritable(handle: DirHandle): Promise<boolean> {
  const q = await handle.queryPermission?.({ mode: "readwrite" });
  if (q === "granted") return true;
  const r = await handle.requestPermission?.({ mode: "readwrite" });
  return r === "granted";
}

/**
 * 파일 하나 쓰기. 파일명은 캐러셀 스크립트(pexels.mjs)와 같게 pexels-{id}.jpg 로 맞춘다.
 * 이름이 어긋나면 나중에 어느 사진인지 되짚을 수 없고 build 쪽과도 안 맞는다.
 */
export async function writeToDir(handle: DirHandle, fileName: string, blob: Blob) {
  const fileHandle = await handle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(blob);
  } finally {
    await writable.close();
  }
}

export const photoFileName = (id: number) => `pexels-${id}.jpg`;
