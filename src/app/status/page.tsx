"use client";

import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import { OpsStatusPanel } from "@/components/ops-status-panel";
import { useDashboardHealth } from "@/hooks/use-dashboard-health";
import { Verdict, IssueList, SourceTable, CollectorTable, InputList, SectionTitle, LEVEL } from "@/components/status/health-parts";

// 대시보드 상태 (2026-11-06 김호 요청: "왼쪽 상단에 ppmi를 누르면 볼 수 있는 대시보드의 상태").
// 사이드바 로고로만 들어온다(메뉴 항목은 늘리지 않는다).
// 읽는 순서 = 판단 순서: 결론 → 고장·주의 → 소스별 신선도 → 자동화 → 손 입력.

export default function StatusPage() {
  const { data, failed, loading, refresh } = useDashboardHealth();

  return (
    <PageShell title="대시보드 상태" description="지금 화면의 숫자를 믿어도 되는지, 무엇이 언제까지 들어왔는지" hideFilters>
      {failed && (
        <div
          className="rounded-xl border p-4 text-sm"
          style={{ backgroundColor: LEVEL.broken.surface, borderColor: LEVEL.broken.border, color: LEVEL.broken.color }}
        >
          상태를 읽지 못했습니다. 못 읽은 것은 이상 없음이 아닙니다. 잠시 뒤 다시 확인해 주세요.
          <button onClick={refresh} className="ml-2 underline underline-offset-2">다시 확인</button>
        </div>
      )}

      {!data && !failed && <div className="h-20 rounded-xl border bg-muted/30 animate-pulse" />}

      {data && (
        <div className="space-y-6">
          <Verdict data={data} onRefresh={refresh} loading={loading} />

          <section>
            <SectionTitle title="고장·주의" hint={`기준일 ${data.referenceDate} (어제까지 들어와 있어야 정상)`} />
            <IssueList issues={data.issues} />
          </section>

          <section>
            <SectionTitle
              title="소스별 신선도"
              hint="회색은 일부러 멈췄거나 운영하지 않는 채널입니다. 고장이 아닙니다"
            />
            <SourceTable rows={data.sources} />
          </section>

          <section className="space-y-3">
            <SectionTitle title="자동화 상태" hint="매일 도는 수집이 오늘 돌았는지" />
            <CollectorTable rows={data.collectors} dailySync={data.dailySync} />
            <OpsStatusPanel
              section="collector"
              title="로컬 자동 수집 (관제판 보고)"
              hint="쿠팡 광고비·GFA·카페24·스마트스토어는 로컬 aside 수집기가 매일 07:36 에 채웁니다. 로그인이 풀리면 사람이 다시 로그인해야 합니다"
            />
            <OpsStatusPanel section="report" title="보고 자동화" />
            <p className="text-xs text-muted-foreground">
              콘텐츠 자동화 상태는 <Link href="/content" className="underline underline-offset-2">콘텐츠/SNS</Link> 화면에 있습니다.
            </p>
          </section>

          <section>
            <SectionTitle title="손 입력 대기" />
            <InputList inputs={data.inputs} />
          </section>
        </div>
      )}
    </PageShell>
  );
}
