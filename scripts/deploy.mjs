#!/usr/bin/env node
/**
 * 대시보드 배포 3단계를 한 번에.
 *
 * 왜 스크립트인가
 * ---------------
 * 배포는 (1) vercel 프로덕션 배포 (2) kappa 별칭 재지정 (3) git master 푸시 세 가지를
 * 전부 해야 끝난다. 하나라도 빠뜨리면 사고가 난다.
 *  - alias 를 안 걸면 사람이 보는 ppmi-dashboard-kappa.vercel.app 은 옛 배포를 계속 가리킨다.
 *  - git push 를 안 하면 다음 git 자동배포가 옛 코드로 프로덕션을 되돌린다(실제 발생 전례).
 * 손으로 세 번 치다 보니 자주 빠뜨려서 하나로 묶었다.
 *
 * 에이전트 모드 hang 방지
 * ----------------------
 * vercel CLI 가 TTY 를 기대하고 입력을 기다리면 세션이 멈춘다. cmd 로 감싸고 stdin 을
 * nul 로 막아서(`... < nul`) 대화형 프롬프트가 떠도 즉시 EOF 를 받게 한다.
 *
 * 사용: npm run deploy
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ALIAS = "ppmi-dashboard-kappa.vercel.app";
const BRANCH = "master";
const REPORT_PATH =
  "H:/내 드라이브/obsidian/Obsidian/settings/pipelines/state/reports/_deploy-report.json";

const GIT_TIMEOUT_MS = 2 * 60 * 1000;
const VERCEL_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * cmd 경유 실행. stdin 을 nul 로 막아 대화형 프롬프트에서 멈추지 않는다.
 *
 * `< nul` 만으로는 부족하다. 2026-09-16 실측에서 `vercel --version` 이 입력을 막았는데도
 * 응답 없이 매달렸다. 그래서 타임아웃을 따로 건다. 멈추는 것보다 실패하는 게 낫다.
 */
function sh(command, { allowFail = false, timeout = GIT_TIMEOUT_MS } = {}) {
  const res = spawnSync("cmd", ["/c", `${command} < nul`], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
    timeout,
  });
  const stdout = (res.stdout || "").trim();
  const stderr = (res.stderr || "").trim();
  if (res.error?.code === "ETIMEDOUT" || res.signal) {
    throw new Error(
      `${Math.round(timeout / 1000)}초 안에 안 끝나 중단: ${command}\n` +
        `터미널에서 직접 실행해 프롬프트가 떠 있는지 확인할 것.`,
    );
  }
  if (res.status !== 0 && !allowFail) {
    throw new Error(`실패(exit ${res.status}): ${command}\n${stderr || stdout}`);
  }
  return { status: res.status, stdout, stderr };
}

/** 배포 URL 은 stdout/stderr 어느 쪽에도 올 수 있다. 마지막 vercel.app URL 을 쓴다. */
function extractDeploymentUrl(text) {
  const matches = text.match(/https:\/\/[a-z0-9-]+\.vercel\.app/gi);
  return matches ? matches[matches.length - 1] : null;
}

function assertCleanTree() {
  const { stdout } = sh("git status --porcelain");
  if (stdout) {
    throw new Error(
      `작업 트리가 더럽다. 커밋하거나 되돌린 뒤 배포할 것:\n${stdout}`,
    );
  }
  const branch = sh("git rev-parse --abbrev-ref HEAD").stdout;
  if (branch !== BRANCH) {
    throw new Error(`브랜치가 ${branch} 다. ${BRANCH} 에서만 배포한다.`);
  }
}

function writeReport(report) {
  try {
    mkdirSync(dirname(REPORT_PATH), { recursive: true });
    // BOM 없는 UTF-8 (볼트 파일 규칙)
    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");
    console.log(`[5/5] 리포트 기록: ${REPORT_PATH}`);
  } catch (err) {
    // 리포트 실패가 배포 성공을 뒤집지는 않는다. 볼트가 동기화 중일 수 있다.
    console.error(`[5/5] 리포트 기록 실패(무시): ${err.message}`);
  }
}

function main() {
  const report = {
    date: new Date().toISOString(),
    deploymentUrl: null,
    alias: ALIAS,
    commit: null,
    ok: false,
  };

  try {
    console.log("[1/5] 작업 트리·브랜치 확인");
    assertCleanTree();
    report.commit = sh("git rev-parse HEAD").stdout;
    console.log(`      ${BRANCH} @ ${report.commit.slice(0, 8)} (clean)`);

    console.log("[2/5] vercel 프로덕션 배포");
    const deployed = sh("vercel --prod --yes");
    report.deploymentUrl = extractDeploymentUrl(
      `${deployed.stdout}\n${deployed.stderr}`,
    );
    if (!report.deploymentUrl) {
      throw new Error(
        `배포 URL 을 못 찾았다. vercel 출력:\n${deployed.stdout}\n${deployed.stderr}`,
      );
    }
    console.log(`      ${report.deploymentUrl}`);

    console.log(`[3/5] alias ${ALIAS} 재지정`);
    sh(`vercel alias set ${report.deploymentUrl} ${ALIAS}`);

    console.log(`[4/5] git push origin ${BRANCH}`);
    sh(`git push origin ${BRANCH}`);

    report.ok = true;
    console.log(`\n배포 완료: https://${ALIAS} → ${report.deploymentUrl}`);
  } catch (err) {
    report.error = err.message;
    console.error(`\n배포 중단: ${err.message}`);
  }

  writeReport(report);
  process.exit(report.ok ? 0 : 1);
}

main();
