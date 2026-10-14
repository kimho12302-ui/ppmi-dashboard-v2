#!/usr/bin/env node
/**
 * 대시보드(Vercel) 의 META_ADS_TOKEN 을 새 토큰으로 바꾼다.
 *
 * 왜 있나
 * -------
 * 공구 인플루언서 발굴 화면(/influencers)은 대시보드 서버가 인스타 공식 API(business_discovery)를
 * 직접 부른다. 그런데 Vercel 에 든 META_ADS_TOKEN 은 2026-10-14 실측 "session has been invalidated"
 * 로 죽어 있었다. 살아 있는 토큰은 GitHub Secrets(수집기용)에만 있고 거기서는 꺼내 읽을 수 없다.
 *
 * 토큰을 채팅에 붙이지 않게 하려고 만들었다. 입력은 화면에 안 보이고, 이 스크립트 밖으로 나가지 않는다.
 *
 * 하는 일
 *  1. 토큰을 숨김 입력으로 받는다
 *  2. debug_token 으로 유효·만료일·권한을 확인한다. 30일 미만이거나 권한이 빠지면 저장하지 않는다
 *  3. vercel env 의 production META_ADS_TOKEN 을 지우고 새로 넣는다
 *
 * 다음 배포부터 반영된다. 수집기(GitHub Actions)도 같은 토큰을 쓰려면
 * marketing-dashboard 의 scripts/rotate_meta_token.py 를 같은 토큰으로 한 번 더 돌린다.
 *
 * 사용: node scripts/set-meta-token.mjs   (vercel link 된 폴더에서)
 */
import { spawnSync } from "node:child_process";
import readline from "node:readline";

const GRAPH = "https://graph.facebook.com/v19.0";
const NAME = "META_ADS_TOKEN";
const MIN_DAYS = 30;
// 발굴(business_discovery)에 필요한 것 + 광고 수집이 쓰는 것
const NEED = ["instagram_basic", "instagram_manage_insights", "pages_read_engagement", "pages_show_list", "ads_read"];

function askHidden(q) {
  return new Promise((res) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(q)) rl.output.write(s); };
    rl.question(q, (a) => { rl.close(); process.stdout.write("\n"); res(a.trim()); });
  });
}

const token = await askHidden("새 메타 토큰 (화면에 안 보임): ");
if (!token) { console.log("입력이 비었다. 멈춘다."); process.exit(1); }

const u = new URL(`${GRAPH}/debug_token`);
u.searchParams.set("input_token", token);
u.searchParams.set("access_token", token);
const d = (await (await fetch(u)).json()).data;
if (!d?.is_valid) { console.log("유효하지 않은 토큰이다. 저장하지 않는다.", d?.error?.message || ""); process.exit(1); }
const days = d.expires_at ? Math.floor((d.expires_at * 1000 - Date.now()) / 86400000) : Infinity;
const missing = NEED.filter((s) => !(d.scopes || []).includes(s));
console.log(`유효. 남은 기간 ${days === Infinity ? "만료 없음" : days + "일"}, 빠진 권한: ${missing.join(", ") || "없음"}`);
if (days < MIN_DAYS) { console.log(`${MIN_DAYS}일 미만이라 저장하지 않는다. 'Extend Access Token' 으로 늘린 토큰을 넣을 것.`); process.exit(1); }
if (missing.length) { console.log("권한이 빠져 저장하지 않는다. 그래프 탐색기에서 위 권한을 체크하고 다시 발급할 것."); process.exit(1); }

const sh = (cmd, input) => spawnSync("cmd", ["/c", cmd], { input, encoding: "utf8", timeout: 120000, windowsHide: true });
sh(`vercel env rm ${NAME} production --yes`);
const add = sh(`vercel env add ${NAME} production`, token);
if (add.status !== 0) { console.log("vercel env add 실패:", (add.stderr || add.stdout).trim()); process.exit(1); }
console.log(`Vercel production ${NAME} 갱신 완료. 다음 배포부터 반영된다.`);
