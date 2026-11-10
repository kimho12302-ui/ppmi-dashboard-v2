// 재고 화면 색·숫자 표기 (2026-11-10). 상태 색은 기획 v2: 품절 빨강 · 발주 필요 주황 · 곧 발주 노랑 · 입고 대기 파랑 · 과재고 회색.
import { ABC_A_SHARE, ABC_B_SHARE, SCALE_LABEL, SCALE_POOL_LABEL, type InvGroup, type InvStatus, type InventoryResult, type InventoryRow, type ScaleGrade } from "@/lib/inventory";

export interface Tone { color: string; surface: string; border: string }
export const STATUS_TONE: Record<InvStatus, Tone> = {
  soldout: { color: "var(--sig-danger)", surface: "var(--sig-danger-surface)", border: "var(--sig-danger-border)" },
  order: { color: "#ea580c", surface: "rgb(234 88 12 / 0.12)", border: "rgb(234 88 12 / 0.40)" },
  soon: { color: "#ca8a04", surface: "rgb(202 138 4 / 0.14)", border: "rgb(202 138 4 / 0.45)" },
  // 쿠팡 입고 요청 = 발주가 아니라 위킵 → 쿠팡 보내기. 발주 계열(주황·노랑)과 섞이지 않게 청록
  restock: { color: "#0891b2", surface: "rgb(8 145 178 / 0.12)", border: "rgb(8 145 178 / 0.45)" },
  // 입고 지연 = 입고 예정일이 지난 발주. 품절과 같은 빨강 계열(진한 장미색)
  late: { color: "#be123c", surface: "rgb(190 18 60 / 0.14)", border: "rgb(190 18 60 / 0.55)" },
  incoming: { color: "#2563eb", surface: "rgb(37 99 235 / 0.10)", border: "rgb(37 99 235 / 0.40)" },
  ok: { color: "var(--muted-foreground)", surface: "transparent", border: "transparent" },
  over: { color: "var(--sig-idle)", surface: "var(--sig-idle-surface)", border: "var(--sig-idle-border)" },
  nomove: { color: "var(--sig-idle)", surface: "transparent", border: "var(--sig-idle-border)" },
  excluded: { color: "var(--muted-foreground)", surface: "transparent", border: "var(--border)" },
};
/** 남은 날 막대 채움 색. 정상은 무채색 */
export const BAR_COLOR: Record<InvStatus, string> = {
  soldout: "var(--sig-danger)", order: "#ea580c", soon: "#ca8a04", restock: "#0891b2", late: "#be123c", incoming: "#2563eb",
  ok: "rgb(100 116 139 / 0.55)", over: "rgb(100 116 139 / 0.30)", nomove: "transparent", excluded: "rgb(100 116 139 / 0.25)",
};

export const GROUPS: { key: InvGroup; no: string; title: string; hint: string; open: boolean }[] = [
  { key: "act", no: "①", title: "지금 손댈 것", hint: "입고 지연 맨 위 → 판매 규모 A → B → C 순, 같은 등급은 남은 날 짧은 순(품절 = 0일). 입고 대기는 맨 아래", open: true },
  { key: "ok", no: "②", title: "정상", hint: "곧 발주 기준보다 길고 과재고 기준 이하. 남은 날 짧은 순", open: false },
  { key: "over", no: "③", title: "과재고", hint: "남은 날이 과재고 기준보다 김 = 돈이 묶인 것. 재고 가치 큰 순. C·판매 없음 과재고가 먼저 손볼 대상(A 는 잘 팔리니 덜 문제)", open: true },
  { key: "nomove", no: "④", title: "출고 0", hint: "기간 안 위킵 출고가 없어 남은 날을 계산할 수 없음. 재고 가치 큰 순", open: true },
  { key: "excluded", no: "⑤", title: "판정 제외", hint: "부자재·판촉물, 판매 중지·단종 메모. 숫자만 보이고 판정은 안 함", open: false },
];

/** 판매 규모 배지 색. 등급이 높을수록 진하게(상태 색과 섞이지 않게 남색 한 가지 농도, 밝은·어두운 테마 둘 다 읽히는 indigo-500/600) */
export const SCALE_TONE: Record<ScaleGrade | "unknown", Tone> = {
  A: { color: "#fff", surface: "#4f46e5", border: "#4f46e5" },
  B: { color: "#6366f1", surface: "rgb(99 102 241 / 0.14)", border: "rgb(99 102 241 / 0.55)" },
  C: { color: "var(--muted-foreground)", surface: "transparent", border: "var(--border)" },
  none: { color: "var(--muted-foreground)", surface: "transparent", border: "var(--muted-foreground)" },
  unknown: { color: "var(--muted-foreground)", surface: "transparent", border: "var(--border)" },
};

const won = (n: number | null | undefined) => `${Math.round(n ?? 0).toLocaleString("ko-KR")}원`;
const pct1 = (x: number | null) => (x === null ? "-" : `${(Math.round(x * 1000) / 10).toLocaleString("ko-KR")}%`);

/** 판매 규모 칸 마우스 올림 산식 */
export function scaleTitle(row: InventoryRow): string {
  const s = row.scale;
  if (!s.pool) return row.status === "excluded" ? "판정 제외 상품은 판매 규모 등급을 매기지 않습니다" : "아이언펫·기타는 판매 규모 등급을 매기지 않습니다(사입 · 너티만)";
  const head = `${SCALE_POOL_LABEL[s.pool]} 안 등급`;
  const shared = s.shared_with > 1 ? ` · 같은 기본 품목 위킵 SKU ${s.shared_with}개가 위킵 출고 비율로 나눈 몫` : "";
  const basis = s.basis === "sales"
    ? `90일 판매 매출 ${won(s.revenue)} · 판매 ${s.sold_qty.toLocaleString("ko-KR")}개(판매 구성표로 낱개 풀어 셈)${shared}`
    : s.basis === "shipout"
      ? `판매 매출이 안 붙어 출고 기준: 90일 위킵 출고 ${s.shipout.toLocaleString("ko-KR")}개 × 원가 ${won(row.unit_cost)} = ${won(s.value)}(원가 기준이라 매출보다 낮게 잡힘)`
      : s.basis === "unknown"
        ? `판매 매출 0 · 90일 위킵 출고 ${s.shipout.toLocaleString("ko-KR")}개인데 원가가 없어 금액을 못 셈 → 미상(보류 규칙은 C 와 같음)`
        : "90일 판매 매출 0 · 위킵 출고 0 → 판매 없음";
  const rank = s.grade && s.grade !== "none" && s.before !== null
    ? ` · ${s.rank}위, 앞 누적 ${pct1(s.before)} · 자기 비중 ${pct1(s.share)} → ${SCALE_LABEL[s.grade]}(앞 누적 < ${ABC_A_SHARE * 100}% A, < ${ABC_B_SHARE * 100}% B, 나머지 C)`
    : s.grade === "none" ? " → 판매 없음" : "";
  return `${head}: ${basis}${rank}`;
}

export const fmtInt = (n: number | null | undefined) => (n === null || n === undefined ? "-" : Math.round(n).toLocaleString("ko-KR"));
export const fmt1 = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(n) ? "-" : (Math.round(n * 10) / 10).toLocaleString("ko-KR", { maximumFractionDigits: 1 });
/** 하루 출고: 1 미만은 소수 둘째 자리까지(0.04 를 0 으로 보이지 않게) */
export const fmtSpeed = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(n) ? "-" : n > 0 && n < 1 ? n.toFixed(2) : fmt1(n);
export const fmtWon = (n: number | null | undefined) => (n === null || n === undefined ? "원가 없음" : `${Math.round(n).toLocaleString("ko-KR")}원`);
/** 카드용: 1만 원 단위 */
export const fmtManWon = (n: number) => (n >= 10000 ? `${Math.round(n / 10000).toLocaleString("ko-KR")}만 원` : `${Math.round(n).toLocaleString("ko-KR")}원`);
/** 11-18 처럼 월-일 */
export const md = (ymd: string | null | undefined) => (ymd ? ymd.slice(5) : "-");

export type InventoryResponse = (InventoryResult & { mode: "db" | "dev-files"; missing: string[]; today: string; scale_error?: string | null; setupNeeded?: false })
  | { setupNeeded: true; mode: "db" | "dev-files"; missing: string[] };

/** 쿠팡 재고 출처 한 마디: 「WING 11-10」(로켓그로스 자동값) · 「손 입력 11-08」. 값이 없으면 null */
export const coupangSourceLabel = (row: Pick<InventoryRow, "coupang_source" | "coupang_as_of">) =>
  row.coupang_source === "wing" ? `WING ${md(row.coupang_as_of)}` : row.coupang_source === "manual" ? `손 입력 ${md(row.coupang_as_of)}` : null;
/** 쿠팡 칸 글자: 값 · 미입력(너티인데 아무 값도 없음) · -(쿠팡에 이 SKU 옵션이 없음) */
export const coupangText = (row: Pick<InventoryRow, "coupang" | "coupang_missing">) =>
  row.coupang !== null ? fmtInt(row.coupang) : row.coupang_missing ? "미입력" : "-";
