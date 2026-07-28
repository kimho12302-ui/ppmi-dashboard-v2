const REPO = "kimho12302-ui/marketing-dashboard";

// 업로드 직후 통계시트 즉시 반영용. sheet-sync 워크플로를 dispatch.
// best-effort·비차단: 토큰 없거나 실패해도 업로드 응답을 막지 않음.
// (워크플로가 아직 master에 없으면 404 → 조용히 무시. push 후 자동 동작.)
export async function triggerSheetSync(startDate?: string, endDate?: string): Promise<boolean> {
  const token = process.env.GH_DISPATCH_TOKEN;
  if (!token) { console.error("[sheet-sync-dispatch] GH_DISPATCH_TOKEN 없음(런타임 env 미주입)"); return false; }
  if (!startDate) return false;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/sheet-sync.yml/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "master", inputs: { start_date: startDate, end_date: endDate || startDate } }),
    });
    if (res.status !== 204) {
      let body = "";
      try { body = await res.text(); } catch {}
      // 조용한 실패 방지: 실패 사유를 로그로 남김(토큰 값은 노출 안 함 — 길이/접두만).
      console.error(`[sheet-sync-dispatch] 실패 status=${res.status} tokenLen=${token.length} tokenPrefix=${token.slice(0, 4)} body=${body.slice(0, 300)}`);
    }
    return res.status === 204;
  } catch (e) {
    console.error("[sheet-sync-dispatch] 예외", String(e));
    return false;
  }
}
