// 공구 제안 DM 초안 규칙. PC 의 DM 워커(scripts/influencer-dm-worker.mjs)와
// 대시보드의 「바로 고치기」 API(src/app/api/influencers/dm)가 같이 쓴다. 둘이 따로 놀면 금지 표현이 어긋난다.
//
// ★ 이 파일은 node 와 Next(웹팩) 양쪽에서 읽는다. node: 모듈·fs 를 쓰지 않는다.
//   원장 사실(dm-facts.md)은 부르는 쪽이 읽어서 넘긴다.

// 인스타 DM 입력칸은 공백·줄바꿈 포함 1,000자에서 자른다(2026-10-20 실패 6건이 전부 정확히 1,000자에서 끊김).
// 초안은 900자 안으로 쓰게 하고, 1,000자를 넘는 초안은 보내지 않고 다시 쓰게 돌린다
export const IG_DM_MAX = 1000;
export const DRAFT_TARGET = 900;

export const BANNED = [/탈모/, /두피/, /진단/, /치료/, /효능/, /디톡스/, /저속\s*노화/, /항산화/, /항염/, /체중\s*감량/, /26\s*(종|개|가지)/, /—/, /--/, /오차/, /20년/, /32\s*(page|페이지|쪽)/i, /아정당/, /식약처/, /인슐린|갑상선|자율신경|부신/];

/** 글에 걸린 금지 표현(정규식 문자열) 목록 */
export const bannedHits = (text) => BANNED.filter((re) => re.test(text)).map(String);

/** DM 오류 칸 문구. 워커와 API 가 같은 문구를 쓴다 */
export const bannedError = (hit) => (hit.length ? `금지 표현 남음, 손으로 고칠 것: ${hit.join(" ")}` : "");
export const tooLongError = (len) => (len > IG_DM_MAX ? `${len}자라 인스타 DM(${IG_DM_MAX}자)에 다 안 들어감, 손으로 줄일 것` : "");
export const draftErrors = (text, hit) => [bannedError(hit), tooLongError(text.length)].filter(Boolean).join(" / ");

/** 모델 출력에서 코드 울타리를 벗긴다 */
export const cleanOutput = (s) => String(s || "").trim().replace(/^```[a-z]*\n?|```$/g, "").trim();

/**
 * 초안 프롬프트.
 * row: 시트 「인스타_공구후보」 한 행(열 이름 → 값). row["DM 지시"] 가 있으면 우선 반영
 * ctx: { hdr, posts: [{ desc }] } 프로필 머리말·최근 게시물. 대시보드에서는 시트에 있는 게시물 캡션만
 * cfg: 「DM_설정」 항목 → 값
 * facts: dm-facts.md 본문
 * opts.currentDraft: 있으면 새로 쓰지 않고 이 초안을 고친다(대시보드 「바로 고치기」). 없으면 워커와 같은 프롬프트
 */
export function buildPrompt(row, ctx, cfg, facts, opts = {}) {
  const yes = (k) => /^(예|yes|y|o|true)$/i.test((cfg[k] || "").trim());
  const conditions = [
    `제안 종류: ${cfg["제안 종류"] || "공구"}`,
    `상품: ${cfg["상품"] || "큐모발 뉴트리션"}`,
    `체험 키트 먼저 제공: ${yes("체험 키트 제공") ? "예 (직접 받아 보시라고 제안)" : "아니오 (언급하지 않는다)"}`,
    yes("공구가 언급") ? `공구가: ${cfg["공구가"]} (이 값 그대로만 쓴다)` : "공구가: 언급하지 않는다",
    yes("수수료 언급") ? `수수료: ${cfg["수수료"]} (이 값 그대로만 쓴다)` : "수수료: 언급하지 않는다. 조건은 회신 주시면 맞춰 드린다고만 한다",
    `보내는 사람: ${cfg["보내는 사람"] || "밸런스랩 공구 담당자"}`,
    cfg["추가로 써도 되는 사실"] ? `추가로 써도 되는 사실(이것만 추가 허용): ${cfg["추가로 써도 되는 사실"]}` : "",
    cfg["추가 요청"] ? `추가 요청: ${cfg["추가 요청"]}` : "",
    row["DM 지시"] ? `이번 초안에 대한 담당자 지시(우선 반영): ${row["DM 지시"]}` : "",
  ].filter(Boolean).join("\n");
  const base = `너는 밸런스랩 공구 담당자다. 처음 보는 사람이 읽어도 광고 스팸이 아니라 "내 계정을 보고 쓴 제안"으로 느끼게 쓴다. 아래 인스타 계정 주인에게 보낼 첫 인스타그램 DM 을 한국어로 쓴다.

## 목표
처음 연락하는 사람에게 ${cfg["제안 종류"] || "공구"} 를 제안한다. 상대가 '내 계정을 실제로 봤구나' 하고 느끼게, 최근 게시물·소개글에서 구체적인 것 1~2개를 짚는다(예: 진행했던 공구 상품, 자주 다루는 주제, 가족·운동 이야기). 칭찬을 늘어놓지 말고 왜 이 상품이 이 계정 팔로워에게 맞는지로 잇는다.

## 조건
${conditions}

## 써도 되는 사실과 금지 표현 (반드시 지킨다. 여기 없는 수치·사례·인증은 쓰지 않는다)
${facts}

## 참고 메시지 (말투·구성만 참고. 이 안의 사실·수치·소개처·체험담은 원장에 없으면 쓰지 않는다)
${cfg["참고 메시지"] || "(없음)"}

## 상대 계정
핸들: @${row["핸들"]}
이름: ${row["이름"]}
카테고리: ${row["카테고리"]}
팔로워: ${row["팔로워"]}
소개글: ${row["소개글"]}
진행·예정 공구: ${row["진행·예정 공구"]}
하이라이트: ${row["하이라이트"]}
프로필 머리말 원문: ${ctx.hdr || ""}
최근 게시물:
${(ctx.posts || []).map((p, i) => `${i + 1}. ${p.desc}`).join("\n")}

## 출력
- DM 본문만 출력한다. 따옴표·제목·설명·마크다운 없이
- 길이: 공백·줄바꿈 포함 ${DRAFT_TARGET}자 이내. 인스타 DM 은 ${IG_DM_MAX}자를 넘으면 잘려서 보낼 수 없다. 참고 메시지가 더 길어도 이 길이를 지킨다
- 구성·이모지는 참고 메시지와 '추가 요청'을 따른다. 줄바꿈으로 읽기 쉽게
- 상대 이름은 소개글·이름에서 자연스럽게 부를 수 있으면 부르고, 애매하면 "님"으로
- 참고 메시지의 [대괄호] 자리는 이 계정에 맞춰 채우고 대괄호는 남기지 않는다
- 마지막은 부담 없이 회신을 청하는 한 줄
- 긴 줄표(—)와 하이픈 두 개(--)를 쓰지 않는다
- 도구를 쓰지 말고 바로 본문을 출력한다`;
  if (!opts.currentDraft) return base;
  return `${base}

## 고칠 초안 (이번에는 새로 쓰지 않고 이 글을 고친다)
${opts.currentDraft}

## 고치는 방법
- 담당자 지시가 있으면 그것을 반영하고, 지시가 바꾸라고 하지 않은 부분은 되도록 그대로 둔다
- 이 초안에 이미 있는 이 계정만의 구체적인 내용(게시물·공구·관심사 언급)은 지우지 않는다. 지금은 계정을 다시 열어 볼 수 없으니 위 상대 계정 정보에 없는 새 사실을 지어내지 않는다
- 초안에 원장에 없는 사실이나 금지 표현이 있으면 같이 고친다
- 길이·출력 규칙은 위와 같다. 고친 DM 본문만 출력한다`;
}

/**
 * 초안을 쓰고 검사한다. 금지 표현이 걸리면 한 번 다시, 1,000자를 넘으면 한 번 줄여 다시.
 * call(prompt) → 모델 출력 문자열(동기·비동기 둘 다 됨)
 * hooks.onBanned(hit) / hooks.onTooLong(len) / hooks.canRetry() → false 면 다시 쓰지 않는다(시간 제한)
 * 반환: { text, hit, errors }  errors 는 DM 오류 칸 문구(문제 없으면 빈 문자열)
 */
export async function draftWithChecks(call, basePrompt, hooks = {}) {
  const canRetry = hooks.canRetry || (() => true);
  let text = cleanOutput(await call(basePrompt));
  let hit = bannedHits(text);
  if (hit.length && canRetry()) {
    hooks.onBanned?.(hit);
    text = cleanOutput(await call(`${basePrompt}\n\n## 주의\n앞 초안에 금지 표현이 있었다: ${hit.join(", ")}. 빼고 다시 쓴다.`));
    hit = bannedHits(text);
  }
  if (text.length > IG_DM_MAX && canRetry()) {
    hooks.onTooLong?.(text.length);
    const shorter = cleanOutput(await call(`${basePrompt}

## 주의
앞 초안이 공백 포함 ${text.length}자였다. 인스타 DM 은 ${IG_DM_MAX}자에서 잘린다. ${DRAFT_TARGET}자 이내로 줄여 다시 쓴다.`));
    const shorterHit = bannedHits(shorter);
    if (shorter.length <= IG_DM_MAX && shorterHit.length <= hit.length) { text = shorter; hit = shorterHit; }
  }
  return { text, hit, errors: draftErrors(text, hit) };
}
