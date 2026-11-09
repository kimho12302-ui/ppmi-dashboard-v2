// 가이드·매뉴얼 문구 그리기 도우미 (2026-11-09 v2).
// 문구 안 **굵게** 는 <strong> 으로, 줄바꿈(\n)은 <br> 로 바꾼다. 「」 같은 다른 기호는 그대로 둔다.
import { Fragment } from "react";

const BOLD = /\*\*(.+?)\*\*/g;

function renderLine(line: string, keyBase: string) {
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of line.matchAll(BOLD)) {
    const at = m.index ?? 0;
    if (at > last) out.push(line.slice(last, at));
    out.push(
      <strong key={`${keyBase}-b${i++}`} className="font-semibold text-foreground">
        {m[1]}
      </strong>,
    );
    last = at + m[0].length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

export function RichText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {renderLine(line, String(i))}
        </Fragment>
      ))}
    </>
  );
}

/** 검색용: 굵게 표시를 뺀 맨 글자 */
export function plainText(text: string): string {
  return text.replace(BOLD, "$1");
}
