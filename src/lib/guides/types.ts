// 화면별 「가이드」(단계별 투어)와 「매뉴얼」(목차 + 상세 설명서)의 틀. 2026-11-09 v2.
//
// 김호: "이용 가이드 존나 성의없이도 만들었네. https://qha.co.kr/track/ 여기서 가이드/매뉴얼 수준으로 만들어라".
// 기준 화면(qha.co.kr/track)은 오른쪽 위에 버튼 두 개를 둔다.
//  - 가이드: 화면 위 실제 요소를 하나씩 강조하며 말풍선으로 설명하는 투어(1 / N, 이전·다음, ← → 키, Esc).
//  - 매뉴얼: 큰 창. 왼쪽 목차, 오른쪽 본문(개요 · 화면 구성 · 카드·배지·색 뜻 표 · 조작 순서 · 계산 규칙 · 자주 묻는 질문).
//
// 쓰는 규칙
//  - 독자는 대시보드를 처음 쓰는 마케팅 팀원. 개발 용어(API, 캐시, upsert, RPC 등) 금지.
//  - 버튼·카드·칸 이름은 화면에 찍힌 글자 그대로 「」. 화면 코드에 없는 기능은 쓰지 않는다.
//  - 굵게는 **글자** 로 쓴다(그리는 쪽이 바꾼다). 긴 대시(U+2014)와 하이픈 두 개 금지.
//  - 화면 코드를 바꿔 버튼 이름이 달라지면 여기 문구와 data-tour 표식도 같이 고친다.

/** 매뉴얼 본문 한 덩어리 */
export type Block =
  | { kind: "p"; text: string }
  /** 절 안 소제목 */
  | { kind: "h"; text: string }
  | { kind: "list"; items: string[] }
  /** 번호 붙은 조작 순서 */
  | { kind: "steps"; items: string[] }
  /** 카드·배지·색·칸의 뜻 같은 대조표. 첫 행이 head */
  | { kind: "table"; head: string[]; rows: string[][] }
  /** 강조 상자. warn 은 숫자를 잘못 읽기 쉬운 함정 */
  | { kind: "note"; tone?: "info" | "warn"; text: string }
  /** 자주 묻는 질문 한 쌍 */
  | { kind: "qa"; q: string; a: string };

export interface ManualSection {
  /** 목차 앵커 (영문 소문자·하이픈) */
  id: string;
  /** 목차와 본문 제목 */
  title: string;
  blocks: Block[];
}

export interface TourStep {
  /**
   * 강조할 화면 요소의 data-tour 값(화면 코드에 data-tour="..." 로 붙인다).
   * 빈 문자열이면 화면 가운데 말풍선(첫 인사·마무리용).
   * 화면에 그 요소가 없으면(데이터가 없어 카드가 안 그려졌을 때 등) 그 단계는 건너뛴다.
   */
  target: string;
  title: string;
  body: string;
}

export interface ScreenGuide {
  /** screens/ 파일 이름과 같다 */
  key: string;
  /** 투어·매뉴얼 머리에 찍히는 화면 이름 */
  title: string;
  /** 한 줄 소개 (매뉴얼 창 제목 아래) */
  summary: string;
  /** 가이드(투어). 보통 8~14단계 */
  tour: TourStep[];
  /** 매뉴얼 절. 개요 · 화면 구성 · … · 자주 묻는 질문 순 */
  manual: ManualSection[];
}
