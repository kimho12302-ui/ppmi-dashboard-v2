#!/usr/bin/env node
/**
 * 공구 제안 DM 워커. 시트 「인스타_공구후보」 를 보고 세 가지를 한다.
 *
 *  1. 초안: 상태가 '후보' 인 계정의 소개글·하이라이트·최근 게시물을 aside 로 읽고,
 *     Claude(이 PC 의 claude -p)가 원장 사실과 「DM_설정」 조건으로 맞춤 제안 DM 을 쓴다 → 'DM 초안'
 *  2. 발송: 사람이 대시보드에서 「발송 승인」 을 누른 행만 aside 로 보낸다
 *  3. 회신: 보낸 대화방에 상대가 답했는지 받은편지함에서 보고 'DM 상태 = 회신' 과 미리보기를 남긴다
 *
 * 왜 aside 인가: 인스타 공식 API 는 첫 DM 을 못 보낸다(상대가 먼저 보낸 뒤 24시간만, 2026-10-14 공식 문서 확인).
 *
 * 지키는 것 (2026-10-14 김호 결정)
 * - 사람이 승인한 행만 보낸다. 승인 뒤 24시간 안에 못 보내면 승인은 만료된다(늦게 몰래 나가지 않게)
 * - 한 번 보낸 사람에게는 다시 안 보낸다(시트 'DM 발송' + 이 PC 의 발송 장부 둘 다 본다)
 * - 하루 발송 상한(기본 10), 한 회차 최대 3건, 건 사이 2~6분 무작위 대기
 * - 로그인된 인스타 계정이 --expect 와 다르면 아무것도 보내지 않는다
 * - 비밀번호를 다루지 않는다. aside 프로필의 기존 로그인 세션만 쓴다
 *
 * 사용
 *   node scripts/influencer-dm-worker.mjs --account u1 --expect balancelab_official
 *   --do draft,send,replies   하는 일 고르기(기본 셋 다)
 *   --only <핸들>              그 행만(테스트)
 *   --daily-cap 10
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT, SCHEMA, STATE_DIR, ensureTab, kstDate, kstStamp, loggedInHandle, makeLog, readTab, repl as asideRepl, setCells, sheetsClient, upsertStatus } from "./lib/ig-shared.mjs";

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const ACCOUNT = arg("--account", "u1");
const EXPECT = (arg("--expect", process.env.DM_IG_HANDLE || "") || "").replace(/^@/, "").toLowerCase();
const DO = new Set(arg("--do", "draft,send,replies").split(","));
const ONLY = (arg("--only", "") || "").replace(/^@/, "").toLowerCase();
const DAILY_CAP = Number(arg("--daily-cap", "10"));
const MAX_DRAFTS = Number(arg("--max-drafts", "5"));
const MAX_SENDS_PER_RUN = 3;
const APPROVAL_TTL_H = 24;
const CLAUDE = process.env.CLAUDE_EXE || "C:/Users/harry/.local/bin/claude.exe";

const log = makeLog("dm-worker.log");
const repl = (body) => asideRepl(ACCOUNT, body);
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
const C = SCHEMA.candidates;

// 하루 발송 수와 보낸 핸들 장부. 시트 쓰기가 실패해도 다시 보내지 않게 이 PC 에도 남긴다
const STATE_FILE = join(STATE_DIR, "dm-state.json");
let st = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};
st.sentHandles ||= [];
if (st.date !== kstDate()) { st.date = kstDate(); st.sentToday = 0; }
const saveSt = () => writeFileSync(STATE_FILE, JSON.stringify(st, null, 1));

// ── 설정 ──
async function readSettings(s) {
  await ensureTab(s, SCHEMA.dmSettings, SCHEMA.dmSettings.defaults);
  const t = await readTab(s, SCHEMA.dmSettings.tab);
  return Object.fromEntries(t.rows.map((r) => [r.obj["항목"], r.obj["값"]]));
}

// ── 1. 초안 ──
function readContext(handle) {
  // 프로필 1장 + 최근 게시물 4장. 게시물 설명 메타에 '핸들 - 날짜: "캡션"' 이 온전히 있다
  return repl(`
    const p = await openTab('https://www.instagram.com/${handle}/');
    await pause(2500, 4000);
    if (isWall(p.url())) { console.log('@@OUT@@' + JSON.stringify({ wall: p.url() })); return; }
    const d = await p.locator('meta[name="description"]').first().getAttribute('content', { timeout: 1500 }).catch(() => '');
    const hdr = ((await p.locator('header').first().innerText({ timeout: 1500 }).catch(() => '')) || '').replace(/\\s+/g, ' ').slice(0, 1500);
    const hrefs = await p.locator('main a[href*="/p/"], main a[href*="/reel/"]').evaluateAll(as => [...new Set(as.map(a => a.getAttribute('href')))]);
    const posts = [];
    for (const h of hrefs.slice(0, 4)) {
      await p.goto('https://www.instagram.com' + h);
      await pause(2000, 4000);
      if (isWall(p.url())) break;
      const pd = await p.locator('meta[name="description"]').first().getAttribute('content', { timeout: 1500 }).catch(() => '') || '';
      posts.push({ href: h, desc: pd.slice(0, 700) });
    }
    await closeTab(p);
    console.log('@@OUT@@' + JSON.stringify({ d, hdr, posts }));`);
}

const BANNED = [/탈모/, /두피/, /진단/, /치료/, /효능/, /디톡스/, /저속\s*노화/, /항산화/, /항염/, /체중\s*감량/, /26\s*(종|개|가지)/, /—/, /--/, /오차/, /20년/, /32\s*(page|페이지|쪽)/i, /아정당/, /식약처/, /인슐린|갑상선|자율신경|부신/];

function buildPrompt(row, ctx, cfg, facts) {
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
  return `너는 밸런스랩 공구 담당자다. 아래 인스타 계정 주인에게 보낼 첫 인스타그램 DM 을 한국어로 쓴다.

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
- 인스타 DM 이라 짧게, 6~10줄. 줄바꿈으로 읽기 쉽게
- 상대 이름은 소개글·이름에서 자연스럽게 부를 수 있으면 부르고, 애매하면 "님"으로
- 이모지는 많아야 1~2개
- 마지막은 부담 없이 회신을 청하는 한 줄
- 긴 줄표(—)와 하이픈 두 개(--)를 쓰지 않는다
- 도구를 쓰지 말고 바로 본문을 출력한다`;
}

function callClaude(prompt) {
  const cwd = join(tmpdir(), "ppmi-dm-worker");
  mkdirSync(cwd, { recursive: true });
  // 프롬프트는 반드시 stdin 으로 (인자로 넘기면 여러 줄 한글이 조용히 뭉개진다, 2026-09-21 실측)
  const r = spawnSync(CLAUDE, ["-p", "--model", "sonnet", "--output-format", "text"], { cwd, input: prompt, encoding: "utf8", timeout: 300000, windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`claude -p 실패 (exit ${r.status}): ${(r.stderr || r.stdout || "").slice(-300)}`);
  return (r.stdout || "").trim().replace(/^```[a-z]*\n?|```$/g, "").trim();
}

async function doDrafts(s, cand, cfg) {
  const facts = readFileSync(join(ROOT, "scripts/lib/dm-facts.md"), "utf8");
  const targets = cand.rows.filter((r) => r.obj["상태"] === "후보" && ["", "초안 대기"].includes(r.obj["DM 상태"]) && !r.obj["DM 발송"])
    .filter((r) => !ONLY || r.obj["핸들"].toLowerCase() === ONLY).slice(0, MAX_DRAFTS);
  for (const t of targets) {
    const h = t.obj["핸들"];
    try {
      log(`초안: @${h} 계정 읽는 중`);
      const ctx = readContext(h);
      let text = callClaude(buildPrompt(t.obj, ctx, cfg, facts));
      let hit = BANNED.filter((re) => re.test(text)).map(String);
      if (hit.length) {
        log(`초안: @${h} 금지 표현 ${hit.join(" ")} → 다시 씀`);
        text = callClaude(`${buildPrompt(t.obj, ctx, cfg, facts)}\n\n## 주의\n앞 초안에 금지 표현이 있었다: ${hit.join(", ")}. 빼고 다시 쓴다.`);
        hit = BANNED.filter((re) => re.test(text)).map(String);
      }
      await setCells(s, C.tab, cand.header, t.rowNo, { "DM 초안": text, "DM 상태": "초안", "DM 오류": hit.length ? `금지 표현 남음, 손으로 고칠 것: ${hit.join(" ")}` : "" });
      log(`초안: @${h} 완료 (${text.length}자)`);
    } catch (e) {
      await setCells(s, C.tab, cand.header, t.rowNo, { "DM 상태": "초안 대기", "DM 오류": `초안 실패: ${e.message.slice(0, 200)}` });
      log(`초안: @${h} 실패 ${e.message}`);
    }
  }
}

// ── 2. 발송 ──
// 대화 칸 글자 = main 전체에서 왼쪽 '대화 리스트' 를 뺀 것 (브라우저 안에서 평가하는 식)
const PANE_JS = `(() => { const m = document.querySelector('main'); const nav = m && m.querySelector('[aria-label="대화 리스트"]'); return ((m && m.innerText) || '').replace((nav && nav.innerText) || '', ''); })()`;

// 대화방은 ig.me/m/<핸들> 로 연다. 팔로우하지 않는 계정 프로필에는 '메시지 보내기' 버튼이 없다(2026-10-14 실측)
function sendDM(handle, text) {
  const lines = text.replace(/\r/g, "").split("\n");
  return repl(`
    const p = await openTab('https://ig.me/m/${handle}');
    for (let i = 0; i < 30 && !/\\/direct\\/t\\//.test(p.url()); i++) await sleep(500);
    if (isWall(p.url())) { console.log('@@OUT@@' + JSON.stringify({ wall: p.url() })); return; }
    if (!/\\/direct\\/t\\//.test(p.url())) { const u = p.url(); await closeTab(p); console.log('@@OUT@@' + JSON.stringify({ ok: false, error: '대화방을 열지 못함: ' + u })); return; }
    await pause(2500, 4000);
    // 이미 우리와 대화한 사람(손으로 보낸 제안 포함)에게는 보내지 않는다
    const before = await p.evaluate(() => ${PANE_JS});
    if (/밸런스랩|큐모발|공구|협찬/.test(before)) { const u = p.url(); await closeTab(p); console.log('@@OUT@@' + JSON.stringify({ ok: false, error: '이미 대화 이력이 있음(밸런스랩 메시지 발견). 보내지 않음', url: u })); return; }
    const box = p.locator('div[role="textbox"][contenteditable="true"]').first();
    if (!(await box.count())) { await closeTab(p); console.log('@@OUT@@' + JSON.stringify({ ok: false, error: '대화 입력칸을 못 찾음', url: p.url() })); return; }
    await box.click();
    const lines = ${JSON.stringify(lines)};
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]) await p.keyboard.type(lines[i], { delay: 15 });
      if (i < lines.length - 1) { await p.keyboard.down('Shift'); await p.keyboard.press('Enter'); await p.keyboard.up('Shift'); }
    }
    await pause(800, 1500);
    const typed = ((await box.innerText().catch(() => '')) || '').replace(/\\s+/g, '');
    const want = lines.join('').replace(/\\s+/g, '');
    if (typed.length < want.length * 0.9) { await closeTab(p); console.log('@@OUT@@' + JSON.stringify({ ok: false, error: '입력이 다 안 들어감(' + typed.length + '/' + want.length + '자). 보내지 않음', url: p.url() })); return; }
    await p.keyboard.press('Enter');
    await pause(3000, 4500);
    const tail = lines.filter(Boolean).slice(-1)[0].slice(0, 15);
    const body = await p.evaluate(() => ${PANE_JS});
    const left = ((await box.innerText().catch(() => '')) || '').trim();
    const ok = body.includes(tail) && left.length === 0;
    const url = p.url();
    await closeTab(p);
    console.log('@@OUT@@' + JSON.stringify({ ok, url, error: ok ? '' : '전송 확인 실패(대화창에 메시지가 안 보임)' }));`, 170000);
}

function approvedAt(cell) {
  const m = String(cell || "").match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/);
  return m ? Date.parse(m[1].replace(" ", "T") + ":00+09:00") : NaN;
}

async function doSends(s, cand) {
  const queue = cand.rows.filter((r) => r.obj["DM 상태"] === "승인").filter((r) => !ONLY || r.obj["핸들"].toLowerCase() === ONLY);
  if (!queue.length) return 0;
  let sent = 0;
  for (const r of queue) {
    const h = r.obj["핸들"].toLowerCase();
    const at = approvedAt(r.obj["DM 승인"]);
    if (r.obj["DM 발송"] || st.sentHandles.includes(h)) {
      await setCells(s, C.tab, cand.header, r.rowNo, { "DM 상태": "실패", "DM 오류": "이미 보낸 계정이라 다시 보내지 않음" });
      continue;
    }
    if (!(Date.now() - at < APPROVAL_TTL_H * 3600000)) {
      await setCells(s, C.tab, cand.header, r.rowNo, { "DM 상태": "초안", "DM 오류": `승인 만료(${APPROVAL_TTL_H}시간 안에 발송 못 함). 다시 승인하세요` });
      log(`발송: @${h} 승인 만료`);
      continue;
    }
    if (st.sentToday >= DAILY_CAP) { log(`발송: 하루 상한 ${DAILY_CAP} 도달, 남은 승인은 다음 회차`); break; }
    if (sent >= MAX_SENDS_PER_RUN) break;
    if (sent > 0) { const w = 120000 + Math.floor(Math.random() * 240000); log(`발송: ${Math.round(w / 1000)}초 대기`); await sleepMs(w); }
    try {
      const out = sendDM(h, r.obj["DM 초안"]);
      if (out.ok) {
        st.sentHandles.push(h); st.sentToday += 1; saveSt();
        await setCells(s, C.tab, cand.header, r.rowNo, { "DM 상태": "발송됨", "DM 발송": `${kstStamp()} · @${EXPECT} · ${out.url}`, "DM 오류": "", 상태: "컨택함" });
        sent += 1;
        log(`발송: @${h} 완료 ${out.url}`);
      } else {
        await setCells(s, C.tab, cand.header, r.rowNo, { "DM 상태": "실패", "DM 오류": out.error || "알 수 없음" });
        log(`발송: @${h} 실패 ${out.error}`);
      }
    } catch (e) {
      await setCells(s, C.tab, cand.header, r.rowNo, { "DM 상태": "실패", "DM 오류": e.message.slice(0, 200) });
      log(`발송: @${h} 오류 ${e.message}`);
      break; // 로그인 벽 등은 다음 건도 막힌다
    }
  }
  return sent;
}

// ── 3. 회신 ──
async function doReplies(s, cand) {
  const watch = cand.rows.filter((r) => r.obj["DM 상태"] === "발송됨" && /\/direct\/t\//.test(r.obj["DM 발송"]))
    .filter((r) => !ONLY || r.obj["핸들"].toLowerCase() === ONLY).slice(0, 10);
  // 보낸 대화방을 열어 우리 메시지 마지막 줄 뒤에 상대 글이 있는지 본다.
  // (받은편지함 목록은 링크가 아니라 버튼이라 대화방 id 로 짝을 못 맞춘다, 2026-10-14 실측)
  for (const r of watch) {
    const url = (r.obj["DM 발송"].match(/https:\/\/www\.instagram\.com\/direct\/t\/\d+\/?/) || [])[0];
    const lastLine = r.obj["DM 초안"].split("\n").map((l) => l.trim()).filter(Boolean).slice(-1)[0] || "";
    try {
      const { pane } = repl(`
        const p = await openTab(${JSON.stringify(url)});
        await pause(3000, 4500);
        if (isWall(p.url())) { console.log('@@OUT@@' + JSON.stringify({ wall: p.url() })); return; }
        const pane = await p.evaluate(() => ${PANE_JS});
        await closeTab(p);
        console.log('@@OUT@@' + JSON.stringify({ pane: pane.slice(-4000) }));`);
      const i = pane.lastIndexOf(lastLine.slice(0, 20));
      if (i < 0) { log(`회신: @${r.obj["핸들"]} 대화방에서 우리 메시지를 못 찾음`); continue; }
      const rest = pane.slice(i + lastLine.length).split("\n").map((l) => l.trim())
        .filter((l) => l && !UI_NOISE.test(l) && !lastLine.includes(l));
      if (!rest.length) continue;
      const preview = rest.join(" ").slice(0, 200);
      await setCells(s, C.tab, cand.header, r.rowNo, { "DM 상태": "회신", 회신: `${kstStamp()} · ${preview}` });
      log(`회신: @${r.obj["핸들"]} ${preview.slice(0, 60)}`);
    } catch (e) {
      log(`회신: @${r.obj["핸들"]} 확인 실패 ${e.message}`);
    }
  }
}

// 대화방에서 메시지가 아닌 화면 글자(읽음 표시·시간 등)
const UI_NOISE = /^(보냄|읽음|확인함|전송됨|전송 중|Seen|Sent|좋아요|메시지 입력\.*|Enter|(오전|오후) \d{1,2}:\d{2}|\d+(분|시간|일|주)( 전)?|어제|오늘)$/;

async function main() {
  if (!EXPECT) throw new Error("--expect <보내는 인스타 핸들> 이 필요하다");
  const s = sheetsClient();
  let summary = "";
  try {
    await ensureTab(s, C);
    const cfg = await readSettings(s);
    const me = loggedInHandle(ACCOUNT);
    if (me !== EXPECT) throw new Error(`aside ${ACCOUNT} 에 로그인된 계정이 ${me || "확인 불가"} 다. 기대값 ${EXPECT} 와 달라 멈춘다`);
    log(`계정 확인: @${me}, 오늘 발송 ${st.sentToday}/${DAILY_CAP}`);
    let cand = await readTab(s, C.tab);
    if (DO.has("draft")) { await doDrafts(s, cand, cfg); cand = await readTab(s, C.tab); }
    let sent = 0;
    if (DO.has("send")) { sent = await doSends(s, cand); cand = await readTab(s, C.tab); }
    if (DO.has("replies")) await doReplies(s, cand);
    summary = `발송 ${sent}건`;
  } catch (e) {
    summary = `실패: ${e.message}`;
    log(summary);
    process.exitCode = 1;
  } finally {
    await upsertStatus(s, { "DM 워커 마지막 실행": kstStamp(), "DM 워커 결과": summary, "오늘 발송": `${st.sentToday}/${DAILY_CAP}`, "DM 발송 계정": `@${EXPECT}` }).catch((e) => log(`상태 기록 실패: ${e.message}`));
    log(`끝: ${summary}`);
  }
}

main();
