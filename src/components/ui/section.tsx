/**
 * 섹션 머리글.
 *
 * 개요·브랜드 화면은 카드가 15개 넘게 이어진다. 전부 같은 무게의 `<h3>` 라서
 * 스크롤하면 한 덩어리로 읽혔다. 섹션마다 얇은 규칙선 + 작은 라벨을 세워
 * 화면을 '띠'로 끊는다. 카드 안 제목이 아니라 카드 바깥에 서는 위계다.
 */
interface SectionProps {
  /** 대문자 라벨. 이 띠가 무엇에 대한 묶음인지. */
  eyebrow: string;
  /** 사람이 읽는 제목 */
  title: string;
  /** 집계 기준 등 오해를 막는 한 줄. 제목 옆에 작게 붙는다. */
  note?: string;
  /** 우측 컨트롤(토글·셀렉터) */
  action?: React.ReactNode;
}

export function SectionHeading({ eyebrow, title, note, action }: SectionProps) {
  return (
    <div className="pt-1 sm:pt-2">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="section-eyebrow">{eyebrow}</p>
          <div className="flex items-baseline gap-2 flex-wrap mt-0.5">
            <h2 className="text-base sm:text-lg font-semibold tracking-tight">{title}</h2>
            {note && <span className="text-xs text-muted-foreground">{note}</span>}
          </div>
        </div>
        {action}
      </div>
      <div className="section-rule mt-1.5 sm:mt-2" />
    </div>
  );
}
