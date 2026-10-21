// dm-rules.mjs 의 타입 (대시보드 TS 에서 import 할 때 쓴다). 동작은 dm-rules.mjs 에 있다
export declare const IG_DM_MAX: number;
export declare const DRAFT_TARGET: number;
export declare const BANNED: RegExp[];
export declare function bannedHits(text: string): string[];
export declare function bannedError(hit: string[]): string;
export declare function tooLongError(len: number): string;
export declare function draftErrors(text: string, hit: string[]): string;
export declare function cleanOutput(s: string): string;
export declare function buildPrompt(
  row: Record<string, string>,
  ctx: { hdr?: string; posts?: { desc: string }[] },
  cfg: Record<string, string>,
  facts: string,
  opts?: { currentDraft?: string },
): string;
export declare function draftWithChecks(
  call: (prompt: string) => string | Promise<string>,
  basePrompt: string,
  hooks?: { onBanned?: (hit: string[]) => void; onTooLong?: (len: number) => void; canRetry?: () => boolean },
): Promise<{ text: string; hit: string[]; errors: string }>;
