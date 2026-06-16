const REPO = "kimho12302-ui/marketing-dashboard";

// 업로드 직후 통계시트 즉시 반영용. sheet-sync 워크플로를 dispatch.
// best-effort·비차단: 토큰 없거나 실패해도 업로드 응답을 막지 않음.
// (워크플로가 아직 master에 없으면 404 → 조용히 무시. push 후 자동 동작.)
export async function triggerSheetSync(startDate?: string, endDate?: string): Promise<boolean> {
  const token = process.env.GH_DISPATCH_TOKEN;
  if (!token || !startDate) return false;
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
    return res.status === 204;
  } catch {
    return false;
  }
}
