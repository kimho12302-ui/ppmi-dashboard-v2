// 재고 화면 색·숫자 표기 (2026-11-10). 상태 색은 기획 v2: 품절 빨강 · 발주 필요 주황 · 곧 발주 노랑 · 입고 대기 파랑 · 과재고 회색.
import type { InvGroup, InvStatus, InventoryResult } from "@/lib/inventory";

export interface Tone { color: string; surface: string; border: string }
export const STATUS_TONE: Record<InvStatus, Tone> = {
  soldout: { color: "var(--sig-danger)", surface: "var(--sig-danger-surface)", border: "var(--sig-danger-border)" },
  order: { color: "#ea580c", surface: "rgb(234 88 12 / 0.12)", border: "rgb(234 88 12 / 0.40)" },
  soon: { color: "#ca8a04", surface: "rgb(202 138 4 / 0.14)", border: "rgb(202 138 4 / 0.45)" },
  incoming: { color: "#2563eb", surface: "rgb(37 99 235 / 0.10)", border: "rgb(37 99 235 / 0.40)" },
  ok: { color: "var(--muted-foreground)", surface: "transparent", border: "transparent" },
  over: { color: "var(--sig-idle)", surface: "var(--sig-idle-surface)", border: "var(--sig-idle-border)" },
  nomove: { color: "var(--sig-idle)", surface: "transparent", border: "var(--sig-idle-border)" },
  excluded: { color: "var(--muted-foreground)", surface: "transparent", border: "var(--border)" },
};
/** 남은 날 막대 채움 색. 정상은 무채색 */
export const BAR_COLOR: Record<InvStatus, string> = {
  soldout: "var(--sig-danger)", order: "#ea580c", soon: "#ca8a04", incoming: "#2563eb",
  ok: "rgb(100 116 139 / 0.55)", over: "rgb(100 116 139 / 0.30)", nomove: "transparent", excluded: "rgb(100 116 139 / 0.25)",
};

export const GROUPS: { key: InvGroup; no: string; title: string; hint: string; open: boolean }[] = [
  { key: "act", no: "①", title: "지금 손댈 것", hint: "품절 · 발주 필요 · 곧 발주 · 입고 대기. 급한 순(남은 날 짧은 순)", open: true },
  { key: "ok", no: "②", title: "정상", hint: "곧 발주 기준보다 길고 과재고 기준 이하. 남은 날 짧은 순", open: false },
  { key: "over", no: "③", title: "과재고", hint: "남은 날이 과재고 기준보다 김 = 안 팔리고 돈이 묶인 것. 재고 가치 큰 순", open: true },
  { key: "nomove", no: "④", title: "출고 0", hint: "기간 안 위킵 출고가 없어 남은 날을 계산할 수 없음. 재고 가치 큰 순", open: true },
  { key: "excluded", no: "⑤", title: "판정 제외", hint: "부자재·판촉물, 판매 중지·단종 메모. 숫자만 보이고 판정은 안 함", open: false },
];

export const fmtInt = (n: number | null | undefined) => (n === null || n === undefined ? "-" : Math.round(n).toLocaleString("ko-KR"));
export const fmt1 = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(n) ? "-" : (Math.round(n * 10) / 10).toLocaleString("ko-KR", { maximumFractionDigits: 1 });
export const fmtWon = (n: number | null | undefined) => (n === null || n === undefined ? "원가 없음" : `${Math.round(n).toLocaleString("ko-KR")}원`);
/** 카드용: 1만 원 단위 */
export const fmtManWon = (n: number) => (n >= 10000 ? `${Math.round(n / 10000).toLocaleString("ko-KR")}만 원` : `${Math.round(n).toLocaleString("ko-KR")}원`);
/** 11-18 처럼 월-일 */
export const md = (ymd: string | null | undefined) => (ymd ? ymd.slice(5) : "-");

export type InventoryResponse = (InventoryResult & { mode: "db" | "dev-files"; missing: string[]; today: string; setupNeeded?: false })
  | { setupNeeded: true; mode: "db" | "dev-files"; missing: string[] };
