"use client";

import { Card, CardContent } from "@/components/ui/card";
import { useFetch } from "@/hooks/use-dashboard-data";
import { formatCurrency } from "@/lib/utils";

// 자동 수집 칸에 사람이 넣은 값(최근 30일). 규칙은 /api/manual-entries 주석.
interface Item { kind: string; date: string; brand: string; channel: string; enteredAt: string | null; spend?: number }

const BRAND: Record<string, string> = { all: "전체", nutty: "너티", ironpet: "아이언펫", saip: "사입", balancelab: "밸런스랩" };

export function ManualEntries() {
  const { data, loading } = useFetch<{ since: string; items: Item[]; error?: string }>("/api/manual-entries");
  if (loading || !data || data.error) return null;
  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="font-semibold text-sm">✋ 사람이 넣은 값 <span className="text-xs font-normal text-muted-foreground">최근 30일 · {data.items.length}칸</span></h3>
        <p className="text-xs text-muted-foreground mb-2">자동 수집이 채우는 칸인데 입력 폼·엑셀로 사람이 넣은 값입니다. 다음 자동 회차가 같은 칸을 쓰면 자동 값으로 바뀌고 여기서 빠집니다.</p>
        {data.items.length === 0 ? <p className="text-xs text-muted-foreground">없음. 모든 칸이 자동 수집 값입니다.</p> : (
          <table className="w-full text-xs">
            <thead><tr className="text-muted-foreground border-b">
              <th className="text-left py-1 pr-2">날짜</th><th className="text-left px-2">종류</th><th className="text-left px-2">채널</th>
              <th className="text-left px-2">브랜드</th><th className="text-right px-2">광고비</th><th className="text-right px-2">넣은 시각</th>
            </tr></thead>
            <tbody>{data.items.map((i) => (
              <tr key={`${i.kind}-${i.date}-${i.channel}-${i.brand}`} className="border-b last:border-0">
                <td className="py-1 pr-2">{i.date}</td><td className="px-2">{i.kind}</td><td className="px-2">{i.channel}</td>
                <td className="px-2">{BRAND[i.brand] || i.brand}</td>
                <td className="text-right px-2">{i.spend != null ? formatCurrency(i.spend) : "-"}</td>
                <td className="text-right px-2 whitespace-nowrap">{i.enteredAt ? new Date(i.enteredAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "-"}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
