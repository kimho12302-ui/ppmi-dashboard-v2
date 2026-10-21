// 공구 DM 「바로 고치기」: 대시보드에서 Claude API 로 초안을 그 자리에서 고친다 (2026-10-21 김호 요청).
// 규칙(금지 표현·길이·프롬프트)은 PC 워커와 같은 scripts/lib/dm-rules.mjs 를 쓴다.
// Vercel 에서는 aside 로 인스타를 못 열므로 프로필을 다시 읽지 않는다. 시트에 있는 계정 정보 + 지금 초안 + 지시로만 고친다.
// 키(ANTHROPIC_API_KEY)가 없으면 이 모듈은 쓰지 않고, 라우트가 기존 방식(시트에 지시 → PC 워커 다음 정시)으로 넘긴다.

import { buildPrompt, draftWithChecks } from "../../scripts/lib/dm-rules.mjs";
import facts from "../../scripts/lib/dm-facts.md";
import type { Row } from "./influencer-sheet";

export const DM_MODEL = process.env.DM_CLAUDE_MODEL || "claude-sonnet-5-5";
const API_URL = "https://api.anthropic.com/v1/messages";
const CALL_TIMEOUT_MS = 25000;

export const hasApiKey = () => Boolean(process.env.ANTHROPIC_API_KEY);

class RetryableError extends Error {}

async function callOnce(prompt: string, timeoutMs: number): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(API_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY || "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: DM_MODEL, max_tokens: 1500, messages: [{ role: "user", content: prompt }] }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 429 || r.status >= 500) throw new RetryableError(`Claude API ${r.status}`);
    if (!r.ok) throw new Error(`Claude API ${r.status}: ${String(j?.error?.message || "").slice(0, 200)}`);
    const text = (j.content || []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("").trim();
    if (!text) throw new Error("Claude API 가 빈 글을 돌려줬습니다");
    return text;
  } catch (e) {
    // 시간 초과·연결 끊김도 한 번은 다시 해 볼 만하다
    if (e instanceof RetryableError || (e as Error).name === "AbortError" || e instanceof TypeError) throw new RetryableError((e as Error).name === "AbortError" ? "Claude API 응답 시간 초과" : (e as Error).message);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 초안을 고친다. deadline(ms 시각) 안에서만 다시 부른다(Vercel 함수 시간 제한).
 * 반환 errors 는 워커와 같은 DM 오류 문구(문제 없으면 빈 문자열).
 */
export async function fixDraft(row: Row, cfg: Record<string, string>, currentDraft: string, instruction: string, deadline: number) {
  if (!facts || facts.length < 200) throw new Error("원장 사실(dm-facts.md)을 읽지 못해 고치지 않았습니다");
  const left = () => deadline - Date.now();
  const call = async (prompt: string) => {
    try {
      return await callOnce(prompt, Math.min(CALL_TIMEOUT_MS, left()));
    } catch (e) {
      if (!(e instanceof RetryableError) || left() < CALL_TIMEOUT_MS) throw e;
      await new Promise((r) => setTimeout(r, 1500));
      return callOnce(prompt, Math.min(CALL_TIMEOUT_MS, left()));
    }
  };
  // 시트에 있는 계정 정보만 쓴다. 발견 게시물 캡션이 있으면 최근 게시물 자리에 넣는다
  const ctx = { hdr: "", posts: row["게시물 캡션"] ? [{ desc: row["게시물 캡션"].slice(0, 700) }] : [] };
  const prompt = buildPrompt({ ...row, "DM 지시": instruction }, ctx, cfg, facts, { currentDraft: currentDraft || undefined });
  return draftWithChecks(call, prompt, { canRetry: () => left() > CALL_TIMEOUT_MS });
}
