import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// 팀용 운영 상태(수집·콘텐츠·보고). 2026-09-18 신설. SQL: docs/sql/ops-status.sql
//
// 쓰는 쪽은 로컬 관제판(볼트 settings/vault-tools/bin/org-dashboard.mjs)이다. 관제판이 이미 계산한
// 판정 중 팀이 볼 칸만 골라 섹션 단위로 통째 교체한다. 보는 쪽은 settings·content 화면.
//
// 인증: /api/raw-ingest·/api/settings 와 같다(요청 단 인증 없음, 배포 자체가 보호 경계).

const SECTIONS = ["collector", "content", "report"] as const;
type Section = (typeof SECTIONS)[number];
const SIGNALS = new Set(["ok", "warn", "fail", "unknown"]);
const MAX_ITEMS = 100;

interface Item {
  item_key: string;
  label: string;
  signal: string;
  summary?: string;
  detail?: string;
  last_at?: string | null;
  sort_order?: number;
  metrics?: Record<string, unknown>;
}

const clip = (s: unknown, n: number) => String(s ?? "").slice(0, n);

function validate(items: unknown[]): { rows?: Item[]; error?: string } {
  if (items.length > MAX_ITEMS) return { error: `items 는 ${MAX_ITEMS}개까지` };
  const rows: Item[] = [];
  for (const [i, raw] of items.entries()) {
    const it = raw as Partial<Item>;
    if (!it || typeof it.item_key !== "string" || !it.item_key) return { error: `items[${i}].item_key 없음` };
    if (typeof it.label !== "string" || !it.label) return { error: `items[${i}].label 없음` };
    if (!SIGNALS.has(String(it.signal))) return { error: `items[${i}].signal 은 ok/warn/fail/unknown` };
    rows.push({
      item_key: clip(it.item_key, 80),
      label: clip(it.label, 120),
      signal: String(it.signal),
      summary: clip(it.summary, 300),
      detail: clip(it.detail, 1000),
      last_at: it.last_at ? clip(it.last_at, 40) : null,
      sort_order: Number.isFinite(it.sort_order) ? Number(it.sort_order) : i,
      metrics: it.metrics && typeof it.metrics === "object" ? it.metrics : {},
    });
  }
  return { rows };
}

export async function GET(req: NextRequest) {
  const section = req.nextUrl.searchParams.get("section");
  let q = supabase.from("ops_status").select("*").order("sort_order");
  if (section) {
    if (!SECTIONS.includes(section as Section)) {
      return NextResponse.json({ error: `모르는 section: ${section}` }, { status: 400 });
    }
    q = q.eq("section", section);
  }
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data || [] });
}

export async function POST(req: NextRequest) {
  let body: { section?: string; items?: unknown[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON 파싱 실패" }, { status: 400 });
  }
  const section = body.section as Section | undefined;
  if (!section || !SECTIONS.includes(section)) {
    return NextResponse.json({ error: `모르는 section: ${String(body.section)}`, allowed: SECTIONS }, { status: 400 });
  }
  if (!Array.isArray(body.items)) return NextResponse.json({ error: "items 배열 없음" }, { status: 400 });

  const { rows, error: invalid } = validate(body.items);
  if (invalid || !rows) return NextResponse.json({ error: invalid }, { status: 400 });

  // 섹션 통째 교체. 관제판에서 빠진 칸(단계 폐기 등)이 화면에 영원히 남지 않게 한다.
  const reportedAt = new Date().toISOString();
  const { error: delErr } = await supabase.from("ops_status").delete().eq("section", section);
  if (delErr) return NextResponse.json({ error: `삭제 실패: ${delErr.message}` }, { status: 500 });
  if (rows.length) {
    const { error: insErr } = await supabase
      .from("ops_status")
      .insert(rows.map((r) => ({ ...r, section, reported_at: reportedAt })));
    if (insErr) return NextResponse.json({ error: `기록 실패: ${insErr.message}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true, section, written: rows.length, reportedAt });
}
