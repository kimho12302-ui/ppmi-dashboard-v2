"use client";

import { Suspense, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { useFilterParams, useFetch } from "@/hooks/use-dashboard-data";
import { formatNumber, cn } from "@/lib/utils";
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
};

const TYPE_LABELS: Record<string, string> = {
  reel: "\uB9B4\uC2A4",
  carousel: "\uCE90\uB7EC\uC140",
  image: "\uC774\uBBF8\uC9C0",
  story: "\uC2A4\uD1A0\uB9AC",
  video: "\uBE44\uB514\uC624",
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

  // Content types found in data
  const contentTypes = byType.map((r) => r.content_type);

  if (loading) {
    return (
      <PageShell title="\uCF58\uD150\uCE20/SNS" description="\uCF58\uD150\uCE20 \uC720\uD615\uBCC4 \uC131\uACFC \xB7 \uD314\uB85C\uC6CC \uCD94\uC774 \xB7 \uAC8C\uC2DC \uD2B8\uB80C\uB4DC">
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
      <PageShell title="\uCF58\uD150\uCE20/SNS" description="\uCF58\uD150\uCE20 \uC720\uD615\uBCC4 \uC131\uACFC \xB7 \uD314\uB85C\uC6CC \uCD94\uC774 \xB7 \uAC8C\uC2DC \uD2B8\uB80C\uB4DC">
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            \uC120\uD0DD\uD55C \uAE30\uAC04\uC5D0 \uCF58\uD150\uCE20 \uB370\uC774\uD130\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell title="\uCF58\uD150\uCE20/SNS" description="\uCF58\uD150\uCE20 \uC720\uD615\uBCC4 \uC131\uACFC \xB7 \uD314\uB85C\uC6CC \uCD94\uC774 \xB7 \uAC8C\uC2DC \uD2B8\uB80C\uB4DC">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">\uCD1D \uAC8C\uC2DC\uBB3C</p>
            <p className="text-xl font-bold">{formatNumber(totalPosts)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">\uCD1D \uB178\uCD9C</p>
            <p className="text-xl font-bold">{formatNumber(totalImpressions)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">\uD074\uB9AD</p>
            <p className="text-xl font-bold">{formatNumber(totalClicks)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">\uD3C9\uADE0 CTR</p>
            <p className="text-xl font-bold">{avgCtr.toFixed(2)}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">\uD314\uB85C\uC6CC</p>
            <p className="text-xl font-bold">{formatNumber(latestFollowers)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-0.5 rounded-lg bg-muted p-1 w-fit">
        {([
          { key: "overview", label: "\uC720\uD615\uBCC4 \uC131\uACFC" },
          { key: "trend", label: "\uD2B8\uB80C\uB4DC" },
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
                <h3 className="font-semibold text-sm mb-3">\uCF58\uD150\uCE20 \uC720\uD615\uBCC4 \uAC8C\uC2DC \uC218</h3>
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
                    <Bar dataKey="posts" name="\uAC8C\uC2DC \uC218" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <h3 className="font-semibold text-sm mb-3">\uC720\uD615\uBCC4 CTR & \uC778\uAC8C\uC774\uC9C0\uBA3C\uD2B8</h3>
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
                    <Bar dataKey="engagement" name="\uC778\uAC8C\uC774\uC9C0\uBA3C\uD2B8" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
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
                    <th className="pb-2 pr-4">\uCF58\uD150\uCE20 \uC720\uD615</th>
                    <th className="pb-2 pr-4 text-right">\uAC8C\uC2DC \uC218</th>
                    <th className="pb-2 pr-4 text-right">\uB178\uCD9C</th>
                    <th className="pb-2 pr-4 text-right">\uD074\uB9AD</th>
                    <th className="pb-2 pr-4 text-right">CTR</th>
                    <th className="pb-2 text-right">\uC778\uAC8C\uC774\uC9C0\uBA3C\uD2B8</th>
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
              <h3 className="font-semibold text-sm mb-3">\uC8FC\uAC04\uBCC4 \uAC8C\uC2DC \uD2B8\uB80C\uB4DC</h3>
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
                <h3 className="font-semibold text-sm mb-3">\uD314\uB85C\uC6CC \uCD94\uC774</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={followerTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                    <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" tickFormatter={(v) => formatNumber(v)} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }}
                      formatter={(val) => formatNumber(Number(val))}
                    />
                    <Line type="monotone" dataKey="followers" name="\uD314\uB85C\uC6CC" stroke="#8b5cf6" strokeWidth={2} dot />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </PageShell>
  );
}
