"use client";

// 키워드 탭 > 네이버 검색어 탭의 밸런스랩 검색광고 칸. 2026-11-10 신설(김호 "키워드 탭 정리와 연결 진행해").
//   RoutineCandidates  : 「추가할 검색어」 안 「루틴이 본 후보」   (/api/sa-routine-candidates)
//   MedinexTestCard    : 「메디넥스 10일 시험」                 (/api/sa-medinex-test)
//   ShoppingRankCard   : 「메디넥스 쇼핑 자연 순위」            (/api/sa-shopping-rank)
// 셋 다 밸런스랩일 때만 그린다(부모가 가린다). 판정·집계는 src/lib/sa-balancelab.ts.
// 이 화면은 계정을 바꾸지 않는다. 잠금·입찰 변경은 SA 루틴이 하고 조정 이력에 남는다.

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useFetch } from "@/hooks/use-dashboard-data";
import { formatCurrency, formatNumber, cn } from "@/lib/utils";
import { SortTable, type SortCol } from "@/components/sort-table";
import { Notice, Folded } from "@/components/add-keyword-candidates";
import {
  groupRoutine, routineProducts, PAGE1_RANK,
  type RoutineCandidate, type MedinexRow, type MedinexGroup, type MedinexTotals, type RankView, type RankLine,
} from "@/lib/sa-balancelab";

type NotReady = { ready: false; reason: "sql" | "empty" };
const md = (d: string | null | undefined) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : "-");
const won = (n: number) => formatCurrency(Math.round(n));

function StateLine({ loading, error, notReady, emptyText, sqlText }: {
  loading: boolean; error: string | null | undefined; notReady: NotReady | null; emptyText: string; sqlText: string;
}) {
  if (loading) return <Notice>불러오는 중...</Notice>;
  if (error) return <Notice tone="warn">불러오기 오류: {error}</Notice>;
  if (notReady) return <Notice tone={notReady.reason === "sql" ? "warn" : "info"}>{notReady.reason === "sql" ? sqlText : emptyText}</Notice>;
  return null;
}

// ── 루틴이 본 후보 ─────────────────────────────────────────────

type RRow = RoutineCandidate & { name: string };
type RoutineResp = (NotReady | { ready: true; date: string; rows: RoutineCandidate[] }) & { error?: string };

const ROUTINE_COLS: SortCol<RRow>[] = [
  { key: "name", label: "검색어", value: (r) => r.name, render: (r) => r.name, left: true },
  { key: "product", label: "제품", value: (r) => r.product || "", render: (r) => r.product || "-", left: true },
  { key: "is_brand", label: "자사어", value: (r) => (r.is_brand ? 1 : 0), render: (r) => (r.is_brand ? "자사" : "일반"), left: true },
  { key: "source", label: "들어온 길", value: (r) => r.source || "", render: (r) => r.source || "-", left: true },
  { key: "stage", label: "단계", value: (r) => r.stage || "", render: (r) => r.stage || "-", left: true },
  { key: "devices", label: "기기", value: (r) => (r.devices || []).join(","), render: (r) => (r.devices || []).join("·") || "-", left: true },
  { key: "clicks_30d", label: "30일 클릭", value: (r) => r.clicks_30d || 0, render: (r) => formatNumber(r.clicks_30d || 0) },
  { key: "cost_30d", label: "30일 광고비", value: (r) => r.cost_30d || 0, render: (r) => won(r.cost_30d || 0) },
  { key: "volume", label: "월 검색량", value: (r) => r.volume || 0, render: (r) => (r.volume == null ? "-" : formatNumber(r.volume)) },
  { key: "start_bid", label: "시작 입찰", value: (r) => r.start_bid || 0, render: (r) => (r.start_bid == null ? "-" : formatNumber(r.start_bid)) },
  { key: "bid_basis", label: "입찰 근거값", value: (r) => r.bid_basis || 0, render: (r) => (r.bid_basis == null ? "-" : formatNumber(r.bid_basis)) },
  { key: "why", label: "이유", value: (r) => r.why || "", render: (r) => r.why || "-", left: true },
];

export function RoutineCandidates() {
  const { data, loading, error } = useFetch<RoutineResp>("/api/sa-routine-candidates");
  const [product, setProduct] = useState<string | null>(null);
  const rows = useMemo(() => (data && data.ready ? data.rows : []), [data]);
  const products = useMemo(() => routineProducts(rows), [rows]);
  const groups = useMemo(() => groupRoutine(rows, product), [rows, product]);
  const notReady = data && !data.ready ? data : null;

  return (
    <div className="space-y-2" data-tour="keywords-naver-routine">
      <h4 className="font-semibold text-sm">
        루틴이 본 후보 <span className="text-xs font-normal text-muted-foreground">밸런스랩 검색광고 일일 키워드 루틴이 본 검색어 전부와 결과{data?.ready ? ` · ${data.date} 회차 ${formatNumber(rows.length)}개` : ""}</span>
      </h4>
      <p className="text-xs text-muted-foreground">
        위 「실적에서 나온 후보」는 이 화면이 검색어 보고서로 계산한 것이고, 이 칸은 루틴이 그날 직접 본 결과입니다. 둘이 다르면 루틴 쪽이 등록 여부의 기록입니다.
        「등록」·「확인 필요」만 펼쳐 두고 나머지 결과는 접었습니다.
      </p>
      <StateLine loading={loading && !data} error={error || data?.error} notReady={notReady}
        sqlText="루틴 후보 표가 아직 DB 에 없습니다(SQL 실행 전). 볼트 settings/search-ads/routine/sql 의 표 정의를 실행하면 다음 루틴부터 나타납니다."
        emptyText="루틴이 아직 이 표에 남긴 후보가 없습니다. 루틴이 표에 적기 시작하면 가장 최근 회차가 여기에 나옵니다." />
      {data?.ready && (
        <>
          {products.length > 1 && (
            <div className="flex flex-wrap gap-0.5 rounded-lg bg-muted p-1 w-fit">
              {[null, ...products].map((p) => (
                <button key={p ?? "all"} onClick={() => setProduct(p)}
                  className={cn("px-3 py-1.5 text-xs rounded-md", product === p ? "bg-card shadow-sm font-medium" : "text-muted-foreground")}>
                  {p ?? "전체 제품"}
                </button>
              ))}
            </div>
          )}
          {groups.length === 0 && <Notice>이 제품에는 후보가 없습니다.</Notice>}
          {groups.map((g) => {
            const named: RRow[] = g.rows.map((r) => ({ ...r, name: r.keyword || r.keyword_norm }));
            const table = <SortTable rows={named} cols={ROUTINE_COLS} initial="clicks_30d" maxHeight={360} />;
            return g.open ? (
              <div key={g.result} className="space-y-1">
                <p className="text-xs font-medium">「{g.result}」 {formatNumber(g.rows.length)}개</p>
                {table}
              </div>
            ) : (
              <Folded key={g.result} title={`「${g.result}」`} count={g.rows.length}>{table}</Folded>
            );
          })}
        </>
      )}
    </div>
  );
}

// ── 메디넥스 10일 시험 ─────────────────────────────────────────

type MedinexResp = (NotReady | {
  ready: true; seenOn: string | null; testFrom: string; lockLine: number; dailyBudget: number;
  rows: MedinexRow[]; groups: MedinexGroup[]; total: MedinexTotals;
  firstAddedOn: string | null; reviewOn: string | null; missing: number;
}) & { error?: string };

type MRow = MedinexRow & { name: string };
type GRow = MedinexGroup & { name: string };

const pctOf = (p: number) => `${Math.round(p * 100)}%`;

function medinexCols(lockLine: number): SortCol<MRow>[] {
  return [
    { key: "name", label: "키워드", value: (r) => r.keyword, render: (r) => r.keyword, left: true },
    { key: "adgroup", label: "광고그룹", value: (r) => r.adgroup, render: (r) => r.adgroup, left: true },
    { key: "bid", label: "입찰", value: (r) => r.bid || 0, render: (r) => (r.bid == null ? "-" : formatNumber(r.bid)) },
    { key: "impressions", label: "노출", value: (r) => r.impressions, render: (r) => formatNumber(r.impressions) },
    { key: "clicks", label: "클릭", value: (r) => r.clicks, render: (r) => formatNumber(r.clicks) },
    { key: "cost", label: "누적 비용", value: (r) => r.cost, render: (r) => won(r.cost) },
    {
      key: "progress", label: `잠금선(${formatNumber(lockLine)}원) 대비`, value: (r) => r.progress,
      render: (r) => (r.overLine ? `${pctOf(r.progress)} 도달` : pctOf(r.progress)),
      danger: (r) => r.overLine && r.tone !== "locked",
    },
    { key: "state", label: "현재 상태", value: (r) => r.state, render: (r) => r.state, left: true, danger: (r) => r.tone === "locked" || r.tone === "missing" },
    { key: "reviewOn", label: "검토일", value: (r) => r.reviewOn || "", render: (r) => md(r.reviewOn), left: true },
  ];
}

const GROUP_COLS: SortCol<GRow>[] = [
  { key: "name", label: "광고그룹", value: (r) => r.adgroup, render: (r) => r.adgroup, left: true },
  { key: "keywords", label: "키워드", value: (r) => r.keywords, render: (r) => `${formatNumber(r.keywords)}개` },
  { key: "spent", label: "돈 쓴 키워드", value: (r) => r.spent, render: (r) => `${formatNumber(r.spent)}개` },
  { key: "impressions", label: "노출", value: (r) => r.impressions, render: (r) => formatNumber(r.impressions) },
  { key: "clicks", label: "클릭", value: (r) => r.clicks, render: (r) => formatNumber(r.clicks) },
  { key: "cost", label: "누적 비용", value: (r) => r.cost, render: (r) => won(r.cost) },
  { key: "overLine", label: "잠금선 도달", value: (r) => r.overLine, render: (r) => `${formatNumber(r.overLine)}개`, danger: (r) => r.overLine > r.locked },
  { key: "locked", label: "잠김", value: (r) => r.locked, render: (r) => `${formatNumber(r.locked)}개` },
];

export function MedinexTestCard() {
  const { data, loading, error } = useFetch<MedinexResp>("/api/sa-medinex-test");
  const notReady = data && !data.ready ? data : null;
  const ok = data && data.ready ? data : null;
  const rows: MRow[] = useMemo(() => (ok ? ok.rows.map((r) => ({ ...r, name: r.keyword_id || `${r.adgroup}|${r.keyword}` })) : []), [ok]);
  const groups: GRow[] = useMemo(() => (ok ? ok.groups.map((g) => ({ ...g, name: g.adgroup })) : []), [ok]);
  const cols = useMemo(() => medinexCols(ok?.lockLine || 10000), [ok]);
  const pending = ok ? ok.total.overLine - ok.total.locked : 0;

  return (
    <Card data-tour="keywords-medinex-test"><CardContent className="p-4 space-y-3">
      <div>
        <h3 className="font-semibold text-sm">
          메디넥스 10일 시험 <span className="text-xs font-normal text-muted-foreground">
            {ok ? `${md(ok.firstAddedOn)}~${md(ok.reviewOn)} · ` : ""}P10.메디넥스 파워링크 신규 키워드 · 일예산 {formatCurrency(ok?.dailyBudget ?? 25000)}
          </span>
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          판정 규칙: 키워드마다 <b>{formatCurrency(ok?.lockLine ?? 10000)}</b>을 쓰고 구매가 0이면 잠급니다(김호 승인 11-09). 검토일에 남은 키워드를 한 번에 판정합니다.
          비용·클릭은 네이버 등록 키워드 목록의 30일 합계(기준일 {ok?.seenOn ?? "-"})이고, 시험 키워드는 시작일에 새로 넣어 시험 누적과 같습니다.
        </p>
      </div>
      <StateLine loading={loading && !data} error={error || data?.error} notReady={notReady}
        sqlText="등록 키워드 표가 아직 DB 에 없습니다(SQL 실행 전)."
        emptyText="조정 기록에 시험 시작일 이후 P10.메디넥스 신규 키워드가 없습니다." />
      {ok && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 text-xs">
            {[
              ["시험 키워드", `${formatNumber(ok.total.keywords)}개`],
              ["누적 비용 합계", won(ok.total.cost)],
              ["클릭 합계", formatNumber(ok.total.clicks)],
              ["잠금선 도달", `${formatNumber(ok.total.overLine)}개`],
              ["잠김", `${formatNumber(ok.total.locked)}개`],
            ].map(([k, v]) => (
              <div key={k} className="rounded border px-3 py-2">
                <p className="text-muted-foreground">{k}</p>
                <p className="font-semibold text-sm num">{v}</p>
              </div>
            ))}
          </div>
          {pending > 0 && (
            <Notice tone="warn">잠금선을 넘었는데 아직 켜져 있는 키워드가 {formatNumber(pending)}개 있습니다. 구매가 났는지 루틴 보고서에서 확인할 대상입니다(이 화면에는 키워드별 구매가 없습니다).</Notice>
          )}
          {ok.missing > 0 && (
            <Notice tone="warn">등록 키워드 목록(기준일 {ok.seenOn ?? "-"})에서 못 찾은 키워드가 {formatNumber(ok.missing)}개 있습니다. 지워졌거나 목록 수집 전에 넣은 것입니다. 비용은 0으로 셉니다.</Notice>
          )}
          <Notice>구매 수는 싣지 않았습니다. 네이버가 키워드 단위 구매를 확실히 주는 원천이 없어, 구매 판정은 SA 루틴 보고서가 합니다.</Notice>
          <div className="space-y-1">
            <p className="text-xs font-medium">광고그룹별 소계</p>
            <SortTable rows={groups} cols={GROUP_COLS} initial="cost" maxHeight={300} />
            <p className="text-xs text-muted-foreground">
              전체 합계: 키워드 {formatNumber(ok.total.keywords)}개 · 돈 쓴 키워드 {formatNumber(ok.total.spent)}개 · 노출 {formatNumber(ok.total.impressions)} ·
              클릭 {formatNumber(ok.total.clicks)} · 누적 비용 {won(ok.total.cost)} · 잠금선 도달 {formatNumber(ok.total.overLine)}개 · 잠김 {formatNumber(ok.total.locked)}개
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium">키워드별</p>
            <SortTable rows={rows} cols={cols} initial="cost" maxHeight={480} />
          </div>
        </>
      )}
    </CardContent></Card>
  );
}

// ── 메디넥스 쇼핑 자연 순위 ────────────────────────────────────

type RankResp = (NotReady | ({ ready: true } & RankView)) & { error?: string };

// 양수 = 순위가 올라감(숫자가 작아짐). 둘 중 한쪽이라도 순위가 없으면 비교하지 않는다.
const oneDelta = (d: number | null) => (d == null ? "-" : d === 0 ? "그대로" : d > 0 ? `▲${d}` : `▼${-d}`);
const deltaText = (l: RankLine) => (l.hadPrev ? `우리 ${oneDelta(l.deltaOur)} · 카탈로그 ${oneDelta(l.deltaCatalog)}` : "직전 없음");

function RankTable({ lines, previous }: { lines: RankLine[]; previous: string | null }) {
  return (
    <div className="overflow-auto rounded border" style={{ maxHeight: 360 }}>
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-card">
          <tr className="text-muted-foreground border-b">
            <th className="py-1.5 px-2 text-left">검색어</th>
            <th className="py-1.5 px-2 text-left">묶음</th>
            <th className="py-1.5 px-2 text-right">우리 상품</th>
            <th className="py-1.5 px-2 text-right">가격비교 카탈로그</th>
            <th className="py-1.5 px-2 text-right">{previous ? `직전(${md(previous)}) 대비` : "직전 대비"}</th>
            <th className="py-1.5 px-2 text-right">본 깊이</th>
            <th className="py-1.5 px-2 text-left">같은 화면 광고</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.query} className="border-b last:border-0">
              <td className="py-1.5 px-2">{l.query}</td>
              <td className="py-1.5 px-2 text-muted-foreground">{l.query_group || "-"}</td>
              <td className="py-1.5 px-2 text-right num" style={l.our_rank == null ? { color: "var(--muted-foreground)" } : undefined}>{l.ourLabel}</td>
              <td className="py-1.5 px-2 text-right num" style={l.catalog_rank == null ? { color: "var(--muted-foreground)" } : undefined}>{l.catalogLabel}</td>
              <td className="py-1.5 px-2 text-right num">{deltaText(l)}</td>
              <td className="py-1.5 px-2 text-right num">{formatNumber(l.seen_up_to)}위까지</td>
              <td className="py-1.5 px-2">{l.ad_seen ? "보임" : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ShoppingRankCard() {
  const { data, loading, error } = useFetch<RankResp>("/api/sa-shopping-rank");
  const notReady = data && !data.ready ? data : null;
  const ok = data && data.ready ? data : null;

  return (
    <Card data-tour="keywords-medinex-rank"><CardContent className="p-4 space-y-3">
      <div>
        <h3 className="font-semibold text-sm">
          메디넥스 쇼핑 자연 순위 <span className="text-xs font-normal text-muted-foreground">
            네이버 쇼핑 · 광고 제외 · {ok ? `${ok.latest} 측정${ok.previous ? `, 직전 ${ok.previous}` : ", 직전 회차 없음"}` : "주간 실측"}
          </span>
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          제품마다 올리려는 검색어(목표 검색어)만 싣습니다. 1페이지 = {PAGE1_RANK}위 안입니다. 「우리 상품」은 밸런스랩스토어 단독 상품,
          「가격비교 카탈로그」는 여러 판매처가 묶인 카탈로그 자리입니다. 같은 화면에 우리 광고가 보였는지는 순위에 넣지 않고 따로 적습니다.
        </p>
      </div>
      <StateLine loading={loading && !data} error={error || data?.error} notReady={notReady}
        sqlText="쇼핑 순위 표가 아직 DB 에 없습니다(SQL 실행 전). 표가 없으면 측정 스크립트는 파일로만 남깁니다."
        emptyText="쇼핑 순위 측정 기록이 아직 없습니다." />
      {ok && (
        <>
          {ok.shallow && (
            <Notice tone="warn">
              이번 회차는 <b>얕은 측정</b>입니다(통합검색 화면의 가격비교 칸 3~8개만 봄). 순위가 비어 있으면 「없다」가 아니라 <b>판정 불가</b>입니다.
              1페이지({PAGE1_RANK}위) 안 여부는 깊은 측정 회차에서만 판정합니다.
            </Notice>
          )}
          {!ok.previous && <Notice>측정이 한 회차뿐이라 직전 대비 변화는 다음 회차부터 나옵니다.</Notice>}
          <p className="text-xs text-muted-foreground">
            이번 회차 {formatNumber(ok.latestRows)}줄 중 목표 검색어 {formatNumber(ok.targetRows)}줄 · 측정 방식 {ok.methods.join("·") || "-"}
          </p>
          {ok.products.length === 0 && <Notice>이번 회차에 목표 검색어 줄이 없습니다.</Notice>}
          {ok.products.map((p, i) => (
            <details key={p.product} open={i === 0 || p.ranked > 0} className="rounded border px-3 py-2">
              <summary className="cursor-pointer text-xs">
                <span className="font-medium">{p.product}</span>
                <span className="text-muted-foreground"> · 목표 검색어 {formatNumber(p.lines.length)}개 · 순위 잡힘 {formatNumber(p.ranked)}개</span>
              </summary>
              <div className="mt-2"><RankTable lines={p.lines} previous={ok.previous} /></div>
            </details>
          ))}
        </>
      )}
    </CardContent></Card>
  );
}
