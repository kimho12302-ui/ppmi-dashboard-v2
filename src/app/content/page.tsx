"use client";

import { Suspense, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { useFilterParams, useFetch } from "@/hooks/use-dashboard-data";
import { formatNumber, formatCurrency, cn } from "@/lib/utils";
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";

interface ContentByType {
  content_type: string;
  posts: number;
  impressions: number;
  clicks: number;
  ctr: number;
  engagement: number;
}

interface PostsTrend {
  date: string;
  [key: string]: string | number;
}

interface FollowerTrend {
  date: string;
  followers: number;
}

interface ContentData {
  byType: ContentByType[];
  postsTrend: PostsTrend[];
  followerTrend: FollowerTrend[];
}

const TYPE_COLORS: Record<string, string> = {
  reel: "#8b5cf6",
  carousel: "#3b82f6",
  image: "#10b981",
  story: "#f59e0b",
  video: "#ef4444",
  naver_blog: "#03c75a",
  magazine: "#0ea5e9",
};

const TYPE_LABELS: Record<string, string> = {
  reel: "릴스",
  carousel: "캐러셀",
  image: "이미지",
  story: "스토리",
  video: "비디오",
  naver_blog: "네이버블로그",
  magazine: "매거진",
};

export default function ContentPage() {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">Loading...</div>}>
      <ContentInner />
    </Suspense>
  );
}

function ContentInner() {
  const { brand, from, to } = useFilterParams();
  const { data, loading } = useFetch<ContentData>(
    `/api/content-v2?from=${from}&to=${to}&brand=${brand}`
  );
  const [tab, setTab] = useState<"overview" | "trend">("overview");

  const byType = data?.byType || [];
  const postsTrend = data?.postsTrend || [];
  const followerTrend = data?.followerTrend || [];

  const totalPosts = byType.reduce((s, r) => s + r.posts, 0);
  const totalImpressions = byType.reduce((s, r) => s + r.impressions, 0);
  const totalClicks = byType.reduce((s, r) => s + r.clicks, 0);
  const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
  const latestFollowers = followerTrend.length > 0 ? followerTrend[followerTrend.length - 1].followers : 0;

  // 트렌드 스택바 시리즈 = postsTrend에 실제 등장한 유형까지 합집합으로.
  // byType만 쓰면 특정 주 트렌드에만 있는 유형이 막대에서 누락되어 게시량이 과소표시됨.
  const contentTypes = Array.from(
    new Set([
      ...byType.map((r) => r.content_type),
      ...postsTrend.flatMap((row) => Object.keys(row).filter((k) => k !== "date")),
    ])
  );

  if (loading) {
    return (
      <PageShell title="콘텐츠/SNS" description="콘텐츠 유형별 성과 · 팔로워 추이 · 게시 트렌드">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="animate-pulse"><CardContent className="p-4"><div className="h-8 bg-muted rounded" /></CardContent></Card>
          ))}
        </div>
      </PageShell>
    );
  }

  if (byType.length === 0) {
    return (
      <PageShell title="콘텐츠/SNS" description="콘텐츠 유형별 성과 · 팔로워 추이 · 게시 트렌드">
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            선택한 기간에 콘텐츠 데이터가 없습니다.
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell title="콘텐츠/SNS" description="콘텐츠 유형별 성과 · 팔로워 추이 · 게시 트렌드">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">총 게시물</p>
            <p className="text-xl font-bold">{formatNumber(totalPosts)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">총 노출</p>
            <p className="text-xl font-bold">{formatNumber(totalImpressions)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">클릭</p>
            <p className="text-xl font-bold">{formatNumber(totalClicks)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">평균 CTR</p>
            <p className="text-xl font-bold">{avgCtr.toFixed(2)}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">팔로워</p>
            <p className="text-xl font-bold">{formatNumber(latestFollowers)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-0.5 rounded-lg bg-muted p-1 w-fit">
        {([
          { key: "overview", label: "유형별 성과" },
          { key: "trend", label: "트렌드" },
        ] as const).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
              tab === t.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <>
          {/* Content type performance bar chart */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardContent className="p-4">
                <h3 className="font-semibold text-sm mb-3">콘텐츠 유형별 게시 수</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={byType}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis
                      dataKey="content_type"
                      tick={{ fontSize: 11 }}
                      stroke="var(--muted-foreground)"
                      tickFormatter={(v) => TYPE_LABELS[v] || v}
                    />
                    <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                    <Tooltip
                      contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }}
                      labelFormatter={(v) => TYPE_LABELS[v] || v}
                    />
                    <Bar dataKey="posts" name="게시 수" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <h3 className="font-semibold text-sm mb-3">유형별 CTR & 인게이지먼트</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={byType}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis
                      dataKey="content_type"
                      tick={{ fontSize: 11 }}
                      stroke="var(--muted-foreground)"
                      tickFormatter={(v) => TYPE_LABELS[v] || v}
                    />
                    <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" tickFormatter={(v) => `${v}%`} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }}
                      labelFormatter={(v) => TYPE_LABELS[v] || v}
                      formatter={(val) => `${Number(val).toFixed(2)}%`}
                    />
                    <Legend />
                    <Bar dataKey="ctr" name="CTR" fill="#10b981" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="engagement" name="인게이지먼트" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Content type table */}
          <Card>
            <CardContent className="p-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b text-muted-foreground">
                    <th className="pb-2 pr-4">콘텐츠 유형</th>
                    <th className="pb-2 pr-4 text-right">게시 수</th>
                    <th className="pb-2 pr-4 text-right">노출</th>
                    <th className="pb-2 pr-4 text-right">클릭</th>
                    <th className="pb-2 pr-4 text-right">CTR</th>
                    <th className="pb-2 text-right">인게이지먼트</th>
                  </tr>
                </thead>
                <tbody>
                  {byType.map((r) => (
                    <tr key={r.content_type} className="border-b border-border/50 hover:bg-muted/50">
                      <td className="py-2 pr-4 font-medium">
                        <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ backgroundColor: TYPE_COLORS[r.content_type] || "#6b7280" }} />
                        {TYPE_LABELS[r.content_type] || r.content_type}
                      </td>
                      <td className="py-2 pr-4 text-right">{formatNumber(r.posts)}</td>
                      <td className="py-2 pr-4 text-right">{formatNumber(r.impressions)}</td>
                      <td className="py-2 pr-4 text-right">{formatNumber(r.clicks)}</td>
                      <td className="py-2 pr-4 text-right">{r.ctr.toFixed(2)}%</td>
                      <td className="py-2 text-right">{r.engagement.toFixed(2)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}

      {tab === "trend" && (
        <>
          {/* Posts trend by content type */}
          <Card>
            <CardContent className="p-4">
              <h3 className="font-semibold text-sm mb-3">주간별 게시 트렌드</h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={postsTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                  <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                  <Tooltip
                    contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }}
                  />
                  <Legend />
                  {contentTypes.map((ct) => (
                    <Bar
                      key={ct}
                      dataKey={ct}
                      name={TYPE_LABELS[ct] || ct}
                      stackId="posts"
                      fill={TYPE_COLORS[ct] || "#6b7280"}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Follower trend */}
          {followerTrend.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <h3 className="font-semibold text-sm mb-3">팔로워 추이</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={followerTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                    <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" tickFormatter={(v) => formatNumber(v)} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }}
                      formatter={(val) => formatNumber(Number(val))}
                    />
                    <Line type="monotone" dataKey="followers" name="팔로워" stroke="#8b5cf6" strokeWidth={2} dot />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* 콘텐츠 → 유입 → 전환. utm_analytics 는 수집되고 있었으나 어느 화면에도
              배선돼 있지 않아 "내 콘텐츠가 매출로 이어졌나"에 답할 수 없었다(2026-08 리뷰). */}
          <UtmSection from={from} to={to} />
        </>
      )}
    </PageShell>
  );
}

interface UtmCampaign {
  source: string; medium: string; campaign: string;
  sessions: number; conversions: number; revenue: number; bounce_rate: number; avg_duration: number;
}

function UtmSection({ from, to }: { from: string; to: string }) {
  const { data, loading } = useFetch<{ data: { source: string; medium: string; sessions: number }[]; campaigns: UtmCampaign[]; scopeNote?: string }>(
    `/api/utm?from=${from}&to=${to}`
  );
  const sources = (data?.data || []).slice(0, 8);
  const campaigns = data?.campaigns || [];
  if (loading) return null;
  if (sources.length === 0 && campaigns.length === 0) return null;

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <h3 className="font-semibold text-sm">유입 경로 · 캠페인 성과 (UTM)</h3>
          {data?.scopeNote && <span className="text-xs text-muted-foreground">{data.scopeNote}</span>}
        </div>

        <div>
          <p className="text-xs text-muted-foreground mb-2">소스/매체별 세션</p>
          <div className="space-y-1.5">
            {sources.map((s) => {
              const max = Math.max(...sources.map((x) => x.sessions));
              return (
                <div key={`${s.source}/${s.medium}`} className="flex items-center gap-3 text-sm">
                  <span className="w-40 shrink-0 truncate" title={`${s.source} / ${s.medium}`}>{s.source} <span className="text-muted-foreground">/ {s.medium}</span></span>
                  <div className="flex-1 h-3.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-indigo-500" style={{ width: `${max > 0 ? (s.sessions / max) * 100 : 0}%` }} />
                  </div>
                  <span className="w-16 text-right text-xs font-medium">{formatNumber(s.sessions)}</span>
                </div>
              );
            })}
          </div>
        </div>

        {campaigns.length > 0 && (
          <div className="overflow-x-auto">
            <p className="text-xs text-muted-foreground mb-2">캠페인별 (utm_campaign 이 붙은 유입만)</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b">
                  <th className="text-left py-2 font-medium">캠페인</th>
                  <th className="text-left py-2 font-medium">소스/매체</th>
                  <th className="text-right py-2 font-medium">세션</th>
                  <th className="text-right py-2 font-medium">전환</th>
                  <th className="text-right py-2 font-medium">매출</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.slice(0, 12).map((c) => (
                  <tr key={`${c.source}/${c.medium}/${c.campaign}`} className="border-b last:border-0">
                    <td className="py-2 truncate max-w-[220px]" title={c.campaign}>{c.campaign}</td>
                    <td className="py-2 text-muted-foreground text-xs">{c.source}/{c.medium}</td>
                    <td className="py-2 text-right">{formatNumber(c.sessions)}</td>
                    <td className="py-2 text-right">{formatNumber(c.conversions)}</td>
                    <td className="py-2 text-right font-medium">{formatCurrency(c.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
