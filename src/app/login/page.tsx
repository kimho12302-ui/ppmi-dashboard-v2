"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";

function LoginForm() {
  const params = useSearchParams();
  const next = params.get("next") || "/influencers";
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, password }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    // 내부 경로로만 돌려보낸다
    if (r.ok) window.location.href = next.startsWith("/") && !next.startsWith("//") ? next : "/influencers";
    else setError(j.error || "로그인 실패");
  }

  return (
    <div className="max-w-sm mx-auto mt-16">
      <Card>
        <CardContent className="py-6 space-y-4">
          <div>
            <h1 className="text-xl font-bold">팀 전용 화면</h1>
            <p className="text-sm text-muted-foreground mt-1">팀 비밀번호와 이름을 넣어 주세요. 이름은 시트에 &lsquo;추가한 사람&rsquo;으로 남습니다.</p>
          </div>
          <form onSubmit={submit} className="space-y-3">
            <input className="w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="이름 (예: 김호)" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            <input className="w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="팀 비밀번호" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            {error && <p className="text-sm text-red-500">{error}</p>}
            <button disabled={busy} className="w-full rounded-md px-3 py-2 text-sm font-medium text-white disabled:opacity-50" style={{ background: "var(--primary)" }}>
              {busy ? "확인 중…" : "들어가기"}
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
