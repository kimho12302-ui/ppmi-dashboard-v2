/**
 * 데이터 상태의 표시 어휘. 화면 여러 곳(상단 레일·설정 패널·KPI 배지)이
 * 같은 단어와 같은 색을 쓰도록 여기 한 곳에만 둔다.
 *
 * 원칙: 사람이 할 일이 있는 것(입력 필요)과 시스템이 고장난 것(고장)과
 * 애초에 안 돌리는 것(미운영)은 서로 다른 사건이다. 세 개를 한 색으로 칠하면
 * 진짜 고장이 노이즈에 묻힌다.
 */

export type StatusKey = "ok" | "broken" | "input_needed" | "inactive";

export interface StatusVocab {
  /** 화면에 쓰는 이름 */
  label: string;
  /** 무엇을 뜻하는지 한 줄 */
  meaning: string;
  color: string;
  surface: string;
  border: string;
  /** 시각 강도. loud=접힌 상태에서도 항목을 다 보여준다. */
  weight: "loud" | "medium" | "quiet";
}

export const STATUS: Record<StatusKey, StatusVocab> = {
  broken: {
    label: "고장",
    meaning: "자동 수집이 멈췄습니다. 이 소스가 채우는 숫자는 지금 믿을 수 없습니다",
    color: "var(--sig-danger)",
    surface: "var(--sig-danger-surface)",
    border: "var(--sig-danger-border)",
    weight: "loud",
  },
  input_needed: {
    label: "입력 필요",
    meaning: "API가 없어 사람이 넣는 항목입니다. 비어 있으면 화면에서 0으로 보입니다",
    color: "var(--sig-warn)",
    surface: "var(--sig-warn-surface)",
    border: "var(--sig-warn-border)",
    weight: "medium",
  },
  inactive: {
    label: "미운영",
    meaning: "지금 돌리지 않는 채널입니다. 고장이 아닙니다",
    color: "var(--sig-idle)",
    surface: "var(--sig-idle-surface)",
    border: "var(--sig-idle-border)",
    weight: "quiet",
  },
  ok: {
    label: "정상",
    meaning: "어제 데이터까지 들어와 있습니다",
    color: "var(--sig-ok)",
    surface: "var(--sig-ok-surface)",
    border: "var(--sig-ok-border)",
    weight: "quiet",
  },
};

export const MODE_LABEL: Record<string, string> = {
  auto: "자동 수집",
  manual: "수기 입력",
  inactive: "미운영",
};

export const REASON_LABEL: Record<string, string> = {
  auth_failed: "인증 만료",
  collector_stopped: "수집 중단",
  data_frozen: "데이터 정지",
  unknown: "원인 미확인",
};

export const COLLECTOR_HEALTH_LABEL: Record<string, string> = {
  running: "정상",
  frozen: "데이터 정지",
  failing: "실패 보고",
  stopped: "실행 중단",
};

/** 며칠 밀렸는지를 사람 문장으로. */
export function staleText(staleDays: number | null): string {
  if (staleDays === null) return "데이터 없음";
  if (staleDays <= 0) return "최신";
  return `${staleDays}일 밀림`;
}

/** 측정 신뢰도. 숫자 옆에 붙는다. */
export type Confidence = "measured" | "partial" | "unmeasurable";

export const CONFIDENCE: Record<Confidence, { label: string; color: string; surface: string; border: string }> = {
  measured: { label: "측정됨", color: "var(--sig-ok)", surface: "var(--sig-ok-surface)", border: "var(--sig-ok-border)" },
  partial: { label: "부분 측정", color: "var(--sig-warn)", surface: "var(--sig-warn-surface)", border: "var(--sig-warn-border)" },
  unmeasurable: { label: "측정 불가", color: "var(--sig-danger)", surface: "var(--sig-danger-surface)", border: "var(--sig-danger-border)" },
};
