// 스모크 시험: 빌드된 앱을 잠깐 띄워 핵심 화면이 열리는지만 본다.
// 사용: npm run smoke  (next build 후 이 스크립트가 next start 를 띄우고 끝나면 내린다)
//
// - 읽기만 하는 경로만 부른다. 저장·수집 트리거·텔레그램 알림을 부르는 API 는 넣지 않는다.
//   /api/pacing 은 Supabase select 만 한다(cachedGET).
// - 화면 페이지(/settings 등)는 정적 프리렌더라 HTML 에는 로딩 문구만 있다. 그래서 설정 7개 탭은
//   /settings 가 싣는 JS 묶음 안에 탭별 대표 제목이 들어 있는지로 확인한다(브라우저 렌더 시험은 아님).
// - 로그인 게이트(middleware)는 /influencers 만 막으므로 여기 경로는 인증이 필요 없다.
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const PORT = Number(process.env.SMOKE_PORT || 3111);
const BASE = `http://127.0.0.1:${PORT}`;
const READY_TIMEOUT_MS = 60_000;
const REQUEST_TIMEOUT_MS = 30_000;

const ROUTES = ["/", "/monthly", "/sales", "/settings", "/daily", "/channel", "/keywords", "/api/pacing", "/api/search-demand"];
const SETTINGS_HEADINGS = [
  "데이터 수집 현황", "엑셀 업로드", "브랜드 관리", "채널 관리", "제품 원가", "월별 목표 설정", "마케팅 이벤트 관리",
];

if (!fs.existsSync(path.join(process.cwd(), ".next", "BUILD_ID"))) {
  console.error("[smoke] .next 빌드가 없습니다. npm run smoke (빌드 포함) 로 실행하세요.");
  process.exit(1);
}

function startServer() {
  const nextBin = require.resolve("next/dist/bin/next");
  const child = spawn(process.execPath, [nextBin, "start", "-p", String(PORT)], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(PORT) },
  });
  child.stdout.on("data", (d) => process.stdout.write(`[next] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[next] ${d}`));
  return child;
}

function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGTERM");
  } catch {
    // 이미 종료된 경우
  }
}

async function get(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: ctrl.signal, redirect: "manual" });
  } finally {
    clearTimeout(timer);
  }
}

async function waitReady(child) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`next start 가 종료됨 (exit ${child.exitCode})`);
    try {
      await get(`${BASE}/favicon.ico`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`서버가 ${READY_TIMEOUT_MS / 1000}초 안에 뜨지 않음`);
}

async function checkSettingsBundle() {
  const html = await (await get(`${BASE}/settings`)).text();
  const srcs = [...new Set([...html.matchAll(/\/_next\/static\/chunks\/[^"']+\.js/g)].map((m) => m[0]))];
  let code = "";
  for (const src of srcs) {
    const res = await get(`${BASE}${src}`);
    if (res.ok) code += await res.text();
  }
  return SETTINGS_HEADINGS.map((h) => ({ heading: h, ok: code.includes(h) }));
}

async function main() {
  const child = startServer();
  const results = [];
  let failed = false;
  try {
    await waitReady(child);
    for (const route of ROUTES) {
      try {
        const res = await get(`${BASE}${route}`);
        const ok = res.status === 200;
        results.push({ route, status: res.status, ok });
        if (!ok) failed = true;
      } catch (e) {
        results.push({ route, status: `오류: ${e.message}`, ok: false });
        failed = true;
      }
    }
    const headings = await checkSettingsBundle();
    console.log("\n[smoke] 경로별 상태 코드");
    for (const r of results) console.log(`  ${r.ok ? "OK  " : "FAIL"} ${r.route} -> ${r.status}`);
    console.log("[smoke] /settings 탭 제목 (JS 묶음 안)");
    for (const h of headings) {
      console.log(`  ${h.ok ? "OK  " : "FAIL"} ${h.heading}`);
      if (!h.ok) failed = true;
    }
  } catch (e) {
    console.error(`[smoke] 실패: ${e.message}`);
    failed = true;
  } finally {
    stopServer(child);
  }
  console.log(failed ? "\n[smoke] 실패" : "\n[smoke] 통과");
  process.exit(failed ? 1 : 0);
}

main();
