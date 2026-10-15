#!/usr/bin/env node
/**
 * 공구 셀러 수집기. 인스타 해시태그 → 올린 사람 → 프로필 → 점수 → 협찬 리스트 시트.
 *
 * 왜 이렇게 하나 (2026-10-14)
 * --------------------------
 * 인스타 공식 API 는 해시태그 게시물의 '올린 사람'을 주지 않는다. 그래서 셀러를 찾을 수 없었다
 * (김호: "이렇게 해서 셀러가 찾아지지 않을 거 같은디"). 사람이 하는 것처럼 로그인된 aside 브라우저로
 * 해시태그 검색 화면 → 게시물 → 프로필을 연다. 같은 날 #탈모샴푸공구 하나로 게시물 14개,
 * 서로 다른 계정 14개, 대부분 실제 공구 셀러가 나왔다.
 *
 * 지키는 것
 * - 읽기만 한다. 팔로우·좋아요·댓글·DM 은 하지 않는다
 * - 수집 계정 확인: 로그인된 핸들이 --expect 와 다르면 멈춘다(브랜드 계정으로 긁는 사고 방지)
 * - 하루 열람 상한(기본 300페이지), 페이지 사이 2~5초 무작위 대기
 * - 시트에 이미 있는 핸들(제안 리스트·컨택타깃·후보 탭)은 프로필을 열지도 않는다
 * - 인스타 내부 API(/api/v1/...)는 부르지 않는다. 화면에 보이는 것만 읽는다
 * - `aside update` 를 부르지 않는다(Windows 에서 끝나지 않고 매달린다, 2026-10-07)
 *
 * 사용
 *   node scripts/influencer-collector.mjs --account u1 --expect insadongworker            시트의 대기 태그 수집
 *   node scripts/influencer-collector.mjs --account u1 --expect insadongworker --dry-run --tags "#영양제공구"
 *       --dry-run 은 시트에 쓰지 않고 결과를 --out(기본 ./influencer-dry-run.json) 에 남긴다
 *   node scripts/influencer-collector.mjs --expect insadongworker --from-json influencer-dry-run.json
 *       dry-run 결과를 보고 괜찮으면 그대로 시트에 넣는다(인스타를 다시 열지 않는다)
 *
 * 필요: 이 PC 에 aside 가 켜져 있고 수집 계정이 그 프로필에 로그인돼 있을 것.
 *       구글 서비스계정 키 ~/.naver-searchad/google-service-account.json (GOOGLE_SA_KEY_FILE 로 바꿀 수 있음)
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMA, SHEET, STATE_DIR, WallError, ensureTab, kstDate, kstStamp, loggedInHandle, makeLog, normHandle, q, readTab, repl as asideRepl, setCells, sheetsClient, upsertStatus } from "./lib/ig-shared.mjs";

const STATE_FILE = join(STATE_DIR, "state.json");
const LOCK_FILE = join(STATE_DIR, "run.lock");

const POSTS_PER_TAG = 18;
const POSTS_PER_CALL = 10; // aside repl 한 번은 120초 제한. 실측 게시물 14개 72초
const PROFILES_PER_CALL = 8; // 실측 8개 35초
const RERUN_DAYS = 7; // 완료된 태그도 이만큼 지나면 다시 본다(최근 게시물이 바뀐다)

// ── 인자 ──
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const ACCOUNT = arg("--account", "u1");
const EXPECT = (arg("--expect", process.env.COLLECTOR_IG_HANDLE || "") || "").replace(/^@/, "").toLowerCase();
const MAX_PAGES = Number(arg("--max-pages", "300"));
// 하루에 새로 찾는 후보 수 상한 (2026-10-15 김호: 하루 30개, balancelab_official 로 수집)
const MAX_NEW = Number(arg("--max-new", "30"));
const DRY = args.includes("--dry-run");
const OUT = arg("--out", "influencer-dry-run.json");
const TAGS_ARG = arg("--tags", "");
const FROM = arg("--from-json", ""); // 앞선 dry-run 결과를 브라우저 없이 시트에 넣는다

const log = makeLog("collector.log");

// ── 하루 열람 예산 ──
let state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};
if (state.date !== kstDate()) state = { date: kstDate(), pages: 0, fresh: 0 };
state.fresh ||= 0;
const newLeft = () => MAX_NEW - state.fresh;
const saveState = () => writeFileSync(STATE_FILE, JSON.stringify(state));
const left = () => MAX_PAGES - state.pages;
function spend(n) { state.pages += n; saveState(); }

class BudgetError extends Error {}
const repl = (body) => asideRepl(ACCOUNT, body);
function checkAccount() { const h = loggedInHandle(ACCOUNT); spend(1); return h; }

function listTagPosts(tag) {
  if (left() < 1) throw new BudgetError();
  const q = tag.startsWith("#") ? tag : `#${tag}`;
  const out = repl(`
    const p = await openTab('https://www.instagram.com/explore/search/keyword/?q=' + encodeURIComponent(${JSON.stringify(q)}));
    await pause(3000, 4500);
    if (isWall(p.url())) { console.log('@@OUT@@' + JSON.stringify({ wall: p.url() })); return; }
    await p.evaluate(() => window.scrollBy(0, 5000));
    await pause(2000, 3000);
    const hrefs = await p.locator('main a[href*="/p/"], main a[href*="/reel/"]').evaluateAll(as => [...new Set(as.map(a => a.getAttribute('href')))]);
    await closeTab(p);
    console.log('@@OUT@@' + JSON.stringify({ hrefs }));`);
  spend(1);
  return out.hrefs.slice(0, POSTS_PER_TAG);
}

function readPosts(hrefs) {
  const out = [];
  for (let i = 0; i < hrefs.length; i += POSTS_PER_CALL) {
    const batch = hrefs.slice(i, i + Math.min(POSTS_PER_CALL, left()));
    if (!batch.length) throw new BudgetError();
    const r = repl(`
      const hs = ${JSON.stringify(batch)};
      const res = [];
      let p = null;
      for (const h of hs) {
        const url = 'https://www.instagram.com' + h;
        if (!p) p = await openTab(url); else await p.goto(url);
        await pause(2000, 4500);
        if (isWall(p.url())) { console.log('@@OUT@@' + JSON.stringify({ wall: p.url(), res })); return; }
        // 게시물 설명 메타: '핸들 - 날짜: "캡션"'. 화면에는 캡션이 h1 이 아니라 메타에만 온전히 있다
        const desc = await p.locator('meta[name="description"]').first().getAttribute('content', { timeout: 1500 }).catch(() => '') || '';
        const dm = desc.match(/^([A-Za-z0-9._]+) - ([^:]+): "([\\s\\S]*)/);
        const ls = await p.locator('main a').evaluateAll(as => as.map(a => [a.getAttribute('href'), (a.textContent || '').trim()]));
        const o = ls.find(([hr, tx]) => /^\\/[A-Za-z0-9._]+\\/$/.test(hr || '') && tx && hr === '/' + tx + '/');
        res.push({ href: h, owner: o ? o[1] : (dm ? dm[1] : null), date: dm ? dm[2] : '', caption: (dm ? dm[3] : '').replace(/"\\s*$/, '').replace(/\\s+/g, ' ').slice(0, 300) });
      }
      if (p) await closeTab(p);
      console.log('@@OUT@@' + JSON.stringify({ res }));`);
    spend(batch.length);
    out.push(...r.res);
  }
  return out;
}

function readProfiles(handles) {
  const out = [];
  for (let i = 0; i < handles.length; i += PROFILES_PER_CALL) {
    const batch = handles.slice(i, i + Math.min(PROFILES_PER_CALL, left()));
    if (!batch.length) throw new BudgetError();
    const r = repl(`
      const us = ${JSON.stringify(batch)};
      const res = [];
      let p = null;
      for (const u of us) {
        const url = 'https://www.instagram.com/' + u + '/';
        if (!p) p = await openTab(url); else await p.goto(url);
        await pause(2000, 4500);
        if (isWall(p.url())) { console.log('@@OUT@@' + JSON.stringify({ wall: p.url(), res })); return; }
        const d = await p.locator('meta[name="description"]').first().getAttribute('content', { timeout: 1500 }).catch(() => null);
        const hdr = await p.locator('header').first().innerText({ timeout: 1500 }).catch(() => '');
        const links = await p.locator('header a[href^="http"]').evaluateAll(as => as.map(a => (a.textContent || '').trim()).filter(Boolean)).catch(() => []);
        res.push({ u, d, hdr: (hdr || '').replace(/\\s+/g, ' ').slice(0, 1500), links });
      }
      if (p) await closeTab(p);
      console.log('@@OUT@@' + JSON.stringify({ res }));`);
    spend(batch.length);
    out.push(...r.res);
  }
  return out;
}

// ── 해석·점수 ──
function parseCount(s) {
  if (!s) return null;
  const m = String(s).replace(/,/g, "").match(/([\d.]+)\s*([KkMm만천]?)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const mul = { K: 1e3, k: 1e3, M: 1e6, m: 1e6, 만: 1e4, 천: 1e3 }[m[2]] || 1;
  return Math.round(n * mul);
}

// 큐모발은 모발로 몸의 미네랄·중금속을 보는 검사다(탈모 검사가 아니다). 맞는 셀러는 건강식품·영양제 공구를
// 해 본 생활·육아·운동 계정이다(공구-인플루언서-장부 2026-10-13: 바이오컴 미네랄·검사 공구 셀러가 그 결).
const CORE = ["영양제", "건강식품", "유산균", "비타민", "미네랄", "중금속", "모발검사", "영양", "롱제비티", "대사", "혈당", "다이어트", "검사"];
const NEAR = ["건강", "육아", "맘", "아이", "운동", "헬스", "필라테스", "이너뷰티", "식단"];
const SELL_LINK = /inpock|linkbio|instabio|litt\.ly|linktr\.ee|lnk\.bio|smartstore|link\.me|bit\.ly/i;

export function analyzeProfile(p, found) {
  const d = p.d || "";
  const followers = parseCount((d.match(/팔로워\s*([\d.,]+\s*[KkMm만천]?)\s*명/) || [])[1]);
  const posts = parseCount((d.match(/게시물\s*([\d.,]+\s*[KkMm만천]?)\s*개/) || [])[1]);
  const name = (d.match(/ - (.*?) \(@/) || [])[1] || "";
  const bio = ((d.match(/계정: '([\s\S]*)'\s*$/) || [])[1] || "").trim();
  const hdr = p.hdr || "";
  // 머리말 글자 순서: 핸들 이름 게시물 n 팔로워 n 팔로우 n [카테고리] 소개글 링크 팔로우 메시지 보내기 [하이라이트...]
  let category = "";
  const after = (hdr.match(/팔로우\s*[\d.,]+\s*[만천KkMm]?\s+(.*)/) || [])[1] || "";
  const bioHead = bio.replace(/\s+/g, " ").slice(0, 8);
  if (bioHead && after.indexOf(bioHead) > 0) category = after.slice(0, after.indexOf(bioHead)).trim().slice(0, 40);
  const hi = hdr.lastIndexOf("메시지 보내기");
  const highlights = hi >= 0 ? hdr.slice(hi + "메시지 보내기".length).trim().slice(0, 200) : "";
  // 머리말의 Threads 배지도 외부 링크라 걸러 낸다
  const links = (p.links || []).filter((t) => /\.|\//.test(t) && !/^Threads/i.test(t));
  const captions = found.map((f) => f.caption).join(" ");

  const signals = [];
  if (/공구|공동구매/.test(bio)) signals.push("소개글 공구");
  if (/🔛|🔜|진행\s*중|오픈\s*예정|OPEN/i.test(bio)) signals.push("공구 일정");
  if (links.some((l) => SELL_LINK.test(l))) signals.push("판매 링크");
  if (/공구|일정|오픈|OPEN/i.test(highlights)) signals.push("하이라이트 공구");
  if (/공구|공동구매|오픈|OPEN|마감/i.test(captions)) signals.push("공구 게시물");

  const lines = bio.split(/\n/).map((l) => l.trim());
  const sched = [];
  lines.forEach((l, i) => {
    if (!/🔛|🔜/.test(l)) return;
    sched.push(l);
    for (const n of lines.slice(i + 1, i + 4)) { if (!n || /👇|⬇|🔛|🔜/.test(n)) break; sched.push(n); }
  });

  const corpus = `${bio} ${highlights} ${captions} ${category}`;
  const coreHits = CORE.filter((k) => corpus.includes(k));
  const nearHits = NEAR.filter((k) => corpus.includes(k));
  const emails = Array.from(new Set((bio.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).map((e) => e.toLowerCase())));
  const kakao = Array.from(new Set([
    ...(bio.match(/(?:https?:\/\/)?(?:open|pf)\.kakao\.com\/[^\s)]+/gi) || []),
    ...Array.from(bio.matchAll(/(?<![./])(?:카톡|카카오톡|kakao)\s*(?:id|아이디)?\s*[:：]?\s*([A-Za-z0-9_-][A-Za-z0-9._-]{2,})/gi)).map((m) => `카톡 ${m[1]}`),
  ]));

  // 점수 0~100. 대시보드 화면에 기준을 적어 둔다
  const f = followers || 0;
  const sFollow = f < 1000 ? 0 : f < 3000 ? 8 : f <= 100000 ? 25 : f <= 300000 ? 15 : 5;
  const sSignal = [0, 15, 25, 30, 35, 35][Math.min(signals.length, 5)];
  const sRel = coreHits.length ? 20 : nearHits.length ? 10 : 0;
  const sTags = Math.min(10, (new Set(found.map((x) => x.tag)).size - 1) * 5);
  const sContact = emails.length || kakao.length ? 10 : 0;
  // "공구 제안 안받습니다" 같은 계정은 컨택해도 헛걸음이라 크게 깎는다(2026-10-14 첫 수집에서 11만 계정이 50점으로 떴다)
  const refuses = /(공구|협찬|광고|제휴)\s*(제안|문의)?\s*(안\s*받|사절|받지\s*않|x|X|❌)/.test(bio);
  if (refuses) signals.unshift("⚠ 제안 거절 명시");
  const score = Math.max(0, sFollow + sSignal + sRel + sTags + sContact - (refuses ? 40 : 0));

  return {
    핸들: p.u, 상태: "검토 전", 점수: score, 팔로워: followers ?? "", 이름: name, 카테고리: category,
    "공구 신호": signals.join(", "), "진행·예정 공구": sched.join(" / ").slice(0, 300),
    "관련 키워드": [...coreHits, ...nearHits].join(" "), 소개글: bio.slice(0, 500),
    "판매 링크": links.join(" "), 이메일: emails.join(" "), 카카오: kakao.join(" "), 하이라이트: highlights,
    "발견 태그": Array.from(new Set(found.map((x) => x.tag))).join(" "),
    "발견 게시물": found.map((x) => `https://www.instagram.com${x.href}`).slice(0, 3).join(" "),
    "게시물 캡션": `${found[0]?.date ? `[${found[0].date}] ` : ""}${found[0]?.caption || ""}`.slice(0, 220), "게시물 수": posts ?? "",
    프로필: `https://www.instagram.com/${p.u}/`, 추가일: kstDate(), 검토자: "", 검토일: "", 메모: "",
  };
}

// ── 시트 ──
async function ensureTabs(s) {
  for (const t of [SCHEMA.candidates, SCHEMA.tags, SCHEMA.status]) await ensureTab(s, t);
}

async function knownHandles(s) {
  const out = new Set();
  const cand = await readTab(s, SCHEMA.candidates.tab);
  cand.rows.forEach((r) => { const h = normHandle(r.obj["핸들"]); if (h) out.add(h); });
  const r = await s.spreadsheets.values.batchGet({ spreadsheetId: SHEET, ranges: SCHEMA.lookup });
  for (const vr of r.data.valueRanges || []) for (const row of vr.values || []) {
    if (/instagram\.com\//i.test(row[0] || "")) { const h = normHandle(row[0]); if (h) out.add(h); }
  }
  return out;
}

const heartbeat = (s, items) => upsertStatus(s, items);

// ── 실행 ──
async function main() {
  if (!EXPECT) throw new Error("--expect <수집 계정 핸들> 이 필요하다. 다른 계정으로 긁는 사고를 막으려는 확인이다");
  if (existsSync(LOCK_FILE) && Date.now() - JSON.parse(readFileSync(LOCK_FILE, "utf8")).at < 3 * 3600000) {
    log("다른 수집이 돌고 있다(잠금 파일). 끝낸다"); return;
  }
  writeFileSync(LOCK_FILE, JSON.stringify({ at: Date.now(), pid: process.pid }));
  const s = sheetsClient();
  let summary = "";
  try {
    if (!DRY) await ensureTabs(s);
    if (!FROM && newLeft() <= 0) { summary = `오늘 새 후보 상한(${MAX_NEW}) 채움`; return; }
    if (!FROM && left() <= 0) { summary = `오늘 열람 상한(${MAX_PAGES}) 소진`; return; }

    const tagTab = await readTab(s, SCHEMA.tags.tab);
    let perTag = [];
    let rows = [];
    if (FROM) {
      ({ perTag, rows } = JSON.parse(readFileSync(FROM, "utf8")));
      const known = await knownHandles(s);
      rows = rows.filter((r) => !known.has(r["핸들"]));
      const bare = (t) => t.replace(/^#/, "").toLowerCase();
      perTag = perTag.map((t) => ({ ...t, row: tagTab.rows.find((r) => bare(r.obj["태그"]) === bare(t.tag))?.rowNo || null }));
      log(`--from-json: 후보 ${rows.length}명(시트에 이미 있는 핸들 제외)`);
    } else {
    const me = checkAccount();
    if (me !== EXPECT) throw new Error(`로그인 계정이 ${me || "확인 불가"} 다. 기대값 ${EXPECT} 와 달라 멈춘다`);
    log(`수집 계정 확인: ${me}, 오늘 남은 열람 ${left()}`);

    // 태그 고르기: 인자로 받았으면 그것만, 아니면 시트의 대기 → 오래된 완료
    let jobs;
    if (TAGS_ARG) jobs = TAGS_ARG.split(/[,\s]+/).filter(Boolean).map((t) => ({ tag: t, row: null }));
    else {
      const old = (d) => !d || Date.now() - Date.parse(d.replace(" ", "T") + ":00+09:00") > RERUN_DAYS * 86400000;
      jobs = tagTab.rows.filter((r) => r.obj["태그"] && (["", "대기"].includes(r.obj["상태"]) || (r.obj["상태"] === "완료" && old(r.obj["마지막 수집"]))))
        .sort((a, b) => (a.obj["상태"] === "완료") - (b.obj["상태"] === "완료"))
        .map((r) => ({ tag: r.obj["태그"].trim(), row: r.rowNo }));
    }
    if (!jobs.length) { summary = "수집할 태그 없음"; log(summary); return; }

    const known = await knownHandles(s);
    log(`시트에 이미 있는 핸들 ${known.size}개`);
    const found = new Map(); // handle → [{tag, href, caption, date}]
    for (const job of jobs) {
      // 오늘 새 후보 상한을 이미 채울 만큼 모였으면 남은 태그는 대기로 둔다(다음 회차·다음 날)
      if (found.size >= newLeft()) { log(`오늘 새 후보 상한(${MAX_NEW}) 만큼 모여 남은 태그는 다음에`); break; }
      try {
        if (job.row && !DRY) await setCells(s, SCHEMA.tags.tab, tagTab.header, job.row, { 상태: "수집 중", 오류: "" });
        const hrefs = listTagPosts(job.tag);
        const posts = readPosts(hrefs);
        let fresh = 0;
        for (const p of posts) {
          if (!p.owner) continue;
          const h = p.owner.toLowerCase();
          if (known.has(h)) continue;
          if (!found.has(h)) { found.set(h, []); fresh++; }
          found.get(h).push({ tag: job.tag, href: p.href, caption: p.caption, date: p.date });
        }
        perTag.push({ ...job, posts: posts.length, fresh });
        log(`${job.tag}: 게시물 ${posts.length}, 새 계정 ${fresh}`);
      } catch (e) {
        perTag.push({ ...job, error: e.message });
        log(`${job.tag}: ${e.message}`);
        if (e instanceof BudgetError || e instanceof WallError) break;
      }
    }

    const handles = Array.from(found.keys());
    let profiles = [];
    try { profiles = readProfiles(handles.slice(0, Math.max(0, Math.min(left(), newLeft())))); }
    catch (e) { log(`프로필 읽기 중단: ${e.message}`); if (!(e instanceof BudgetError || e instanceof WallError)) throw e; }
    rows = profiles.filter((p) => p.d).map((p) => analyzeProfile(p, found.get(p.u)));
    rows.sort((a, b) => b.점수 - a.점수);
    log(`프로필 ${profiles.length}개 읽음, 후보 ${rows.length}개`);
    }

    if (DRY) {
      writeFileSync(OUT, JSON.stringify({ perTag, rows }, null, 1));
      log(`dry-run: 시트에 안 씀. 결과 ${OUT}`);
    } else {
      if (rows.length) {
        const cand = await readTab(s, SCHEMA.candidates.tab);
        const header = cand.header.length ? cand.header : SCHEMA.candidates.header;
        await s.spreadsheets.values.append({
          spreadsheetId: SHEET, range: `${q(SCHEMA.candidates.tab)}!A1`, valueInputOption: "RAW", insertDataOption: "INSERT_ROWS",
          requestBody: { values: rows.map((r) => header.map((h) => r[h] ?? "")) },
        });
      }
      for (const t of perTag) {
        if (!t.row) continue;
        const added = rows.filter((r) => r["발견 태그"].split(" ").includes(t.tag)).length;
        await setCells(s, SCHEMA.tags.tab, tagTab.header, t.row, t.error
          ? { 상태: "오류", 오류: t.error.slice(0, 200), "마지막 수집": kstStamp() }
          : { 상태: "완료", 오류: "", "마지막 수집": kstStamp(), "본 게시물": t.posts, "새 후보": added });
      }
    }
    if (!DRY) { state.fresh += rows.length; saveState(); }
    summary = `태그 ${perTag.length}개, 새 후보 ${rows.length}명`;
  } catch (e) {
    summary = `실패: ${e.message}`;
    log(summary);
    process.exitCode = 1;
  } finally {
    rmSync(LOCK_FILE, { force: true });
    if (!DRY) await heartbeat(s, { "마지막 실행": kstStamp(), 결과: summary, "오늘 열람": `${state.pages}/${MAX_PAGES}`, "오늘 새 후보": `${state.fresh}/${MAX_NEW}`, "수집 계정": EXPECT, PC: process.env.COMPUTERNAME || "" }).catch((e) => log(`상태 기록 실패: ${e.message}`));
    log(`끝: ${summary} (오늘 열람 ${state.pages}/${MAX_PAGES})`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
