"use client";

import { useState, useCallback } from "react";
import { useFetch } from "@/hooks/use-dashboard-data";
import { Loading } from "@/components/ui/loading";
import { Card } from "@/components/ui/card";
import { BRAND_LABELS, BRAND_COLORS } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import type { ProductCost } from "@/lib/types";

// ─── Types ─────────────────────────────────────────────────────────
interface SettingsData {
  costs: ProductCost[];
  allProducts: { product: string; brand: string }[];
  missingProducts: { product: string; brand: string }[];
}

interface DataSourceStatusRaw {
  id: string;
  label: string;
  type: "auto" | "manual";
  latestDate: string | null;
  ok: boolean;
}

interface DataSourceStatus {
  source: string;
  label: string;
  type: "auto" | "manual";
  latestDate: string | null;
  status: "ok" | "missing" | "stale";
}

interface MarketingEvent {
  id: string;
  date: string;
  brand: string;
  title: string;
  description: string;
  color: string;
}

interface TargetRow {
  id?: string;
  month: string;
  brand: string;
  revenue_target: number;
  roas_target: number;
}

interface GfaRow {
  date: string;
  brand: string;
  spend: string;
  impressions: string;
  clicks: string;
  conversions: string;
  conversion_value: string;
}

interface SmartstoreRow {
  date: string;
  subscribers: string;
  sessions: string;
  avg_duration: string;
  repurchases: string;
}

interface Cafe24Row {
  date: string;
  cart_adds: string;
  signups: string;
  repurchases: string;
}

interface MiscCostForm {
  date: string;
  brand: string;
  category: string;
  description: string;
  cost: string;
  note: string;
}

interface EventForm {
  date: string;
  brand: string;
  title: string;
  description: string;
  color: string;
}

// ─── Constants ─────────────────────────────────────────────────────
const TABS = [
  { id: "daily", label: "📋 일일 입력" },
  { id: "targets", label: "🎯 목표 설정" },
  { id: "costs", label: "💰 제품 원가" },
  { id: "sources", label: "ℹ️ 데이터 소스" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const DAYS_KR = ["일", "월", "화", "수", "목", "금", "토"];

const BRAND_OPTIONS = [
  { value: "ironpet", label: "아이언펫" },
  { value: "nutty", label: "너티" },
  { value: "saip", label: "사입" },
  { value: "balancelab", label: "밸런스랩" },
];

const MISC_CATEGORIES = [
  "인플루언서",
  "협찬",
  "공구",
  "체험단",
  "촬영비",
  "디자인비",
  "샘플비",
  "배송비",
  "수수료",
  "기타",
];

const EVENT_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#3b82f6",
  "#8b5cf6",
];

const AUTO_SOURCES = [
  "Meta 광고 (너티/아이언펫/밸런스랩)",
  "Google Ads (P-Max/Search)",
  "네이버 검색광고",
  "GA4 세션/체류시간",
  "쿠팡 광고 (시트 동기화)",
];

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const dow = DAYS_KR[d.getDay()];
  return `${m}월 ${day}일 (${dow})`;
}

function makeGfaRow(): GfaRow {
  return { date: todayStr(), brand: "ironpet", spend: "", impressions: "", clicks: "", conversions: "", conversion_value: "" };
}

function makeSmartstoreRow(): SmartstoreRow {
  return { date: todayStr(), subscribers: "", sessions: "", avg_duration: "", repurchases: "" };
}

function makeCafe24Row(): Cafe24Row {
  return { date: todayStr(), cart_adds: "", signups: "", repurchases: "" };
}

// ─── Collapsible Section Component ─────────────────────────────────
function Section({ title, icon, children, defaultOpen = false }: {
  title: string;
  icon: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-muted/30 transition-colors"
      >
        <h3 className="text-sm font-semibold">
          {icon} {title}
        </h3>
        <span className="text-muted-foreground text-xs">{open ? "▲" : "▼"}</span>
      </button>
      {open && <div className="px-6 py-4 border-t space-y-4">{children}</div>}
    </Card>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────
export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabId>("daily");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">설정</h1>
        <p className="text-sm text-muted-foreground">일일 데이터 입력 및 설정 관리</p>
      </div>

      {/* Tab Buttons */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? "bg-primary text-primary-foreground"
                : "bg-muted/50 text-muted-foreground hover:bg-muted"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "daily" && <DailyInputTab />}
      {activeTab === "targets" && <TargetsTab />}
      {activeTab === "costs" && <CostsTab />}
      {activeTab === "sources" && <SourcesTab />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Tab 1: 📋 일일 데이터 입력
// ═══════════════════════════════════════════════════════════════════
function DailyInputTab() {
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [showRecent, setShowRecent] = useState(false);
  const { data: statusRaw } = useFetch<{ sources: DataSourceStatusRaw[] }>("/api/data-status");

  const statusData = {
    sources: (statusRaw?.sources || []).map((s) => ({
      source: s.id,
      label: s.label,
      type: s.type,
      latestDate: s.latestDate,
      status: (s.ok ? "ok" : s.latestDate ? "stale" : "missing") as "ok" | "missing" | "stale",
    })),
  };

  const manualSources = statusData.sources.filter((s) => s.type === "manual");
  const autoSources = statusData.sources.filter((s) => s.type === "auto");
  const filledCount = manualSources.filter((s) => s.status === "ok").length;
  const totalManual = manualSources.length || 6;

  return (
    <div className="space-y-4">
      {/* Date & Status Header */}
      <Card>
        <div className="px-6 py-4 space-y-3">
          <div className="flex flex-wrap items-center gap-4">
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="px-3 py-2 rounded-lg border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <span className="text-sm font-medium">{formatDateLabel(selectedDate)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-sm">
              {filledCount}/{totalManual}{" "}
              {filledCount < totalManual ? "⚠️ 미입력 데이터" : "✅ 입력 완료"}
            </span>
            <button
              onClick={() => setShowRecent(!showRecent)}
              className={`text-xs px-3 py-1 rounded-full transition-colors ${
                showRecent ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              최근 7일
            </button>
          </div>

          {/* Data collection status */}
          {statusData?.sources && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">수동 입력</p>
                {manualSources.map((s) => (
                  <div key={s.source} className="text-xs flex items-center gap-1">
                    {s.status === "ok" ? "✅" : "❌"} {s.label}
                    {s.latestDate && (
                      <span className="text-muted-foreground ml-1">({s.latestDate})</span>
                    )}
                  </div>
                ))}
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">자동 수집</p>
                {autoSources.map((s) => (
                  <div key={s.source} className="text-xs flex items-center gap-1">
                    {s.status === "ok" ? "✅" : "❌"} {s.label}
                    {s.latestDate && (
                      <span className="text-muted-foreground ml-1">({s.latestDate})</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Section 1: 쿠팡 데이터 */}
      <CoupangSection defaultDate={selectedDate} />

      {/* Section 2: GFA 광고비 */}
      <GfaSection defaultDate={selectedDate} />

      {/* Section 3: 스마트스토어 지표 */}
      <SmartstoreSection defaultDate={selectedDate} />

      {/* Section 4: 카페24 퍼널 */}
      <Cafe24Section defaultDate={selectedDate} />

      {/* Section 5: 판매 실적 */}
      <SalesUploadSection defaultDate={selectedDate} />

      {/* Section 6: 마케팅 이벤트 */}
      <EventSection defaultDate={selectedDate} />

      {/* Section 7: 건별 비용 */}
      <MiscCostSection defaultDate={selectedDate} />

      {/* Auto Sources Info */}
      <Card>
        <div className="px-6 py-4">
          <h3 className="text-sm font-semibold mb-2">🤖 자동 수집 (입력 불필요)</h3>
          <div className="space-y-1">
            {AUTO_SOURCES.map((s) => (
              <p key={s} className="text-xs text-muted-foreground">
                ✅ {s}
              </p>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}

// ─── Section: 쿠팡 데이터 ─────────────────────────────────────────
function CoupangSection({ defaultDate }: { defaultDate: string }) {
  const [adsDate, setAdsDate] = useState(defaultDate);
  const [funnelDate, setFunnelDate] = useState(defaultDate);
  const [productDate, setProductDate] = useState(defaultDate);
  const [uploading, setUploading] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const handleUpload = useCallback(
    async (file: File, type: string, date: string, endpoint: string) => {
      setUploading(type);
      setMsg("");
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("date", date);
        formData.append("type", type);
        const res = await fetch(endpoint, { method: "POST", body: formData });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "업로드 실패");
        setMsg(`✅ ${type}: ${json.count || json.parsed || 0}건 업로드 완료`);
      } catch (err) {
        setMsg(`❌ ${err instanceof Error ? err.message : "업로드 실패"}`);
      } finally {
        setUploading(null);
      }
    },
    []
  );

  const onFileChange = useCallback(
    (type: string, date: string, endpoint: string) =>
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) handleUpload(file, type, date, endpoint);
        e.target.value = "";
      },
    [handleUpload]
  );

  return (
    <Section title="쿠팡 데이터" icon="🟠">
      <div className="space-y-3">
        {/* 광고비 */}
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">광고비 날짜</label>
            <input type="date" value={adsDate} onChange={(e) => setAdsDate(e.target.value)}
              className="px-3 py-2 rounded-lg border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
          </div>
          <FileUploadButton
            label="광고비 (.xlsx)"
            accept=".xlsx,.xls"
            loading={uploading === "coupang_ads"}
            onChange={onFileChange("coupang_ads", adsDate, "/api/upload-coupang-ads")}
          />
        </div>
        {/* 일별 퍼널 */}
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">일별 퍼널 날짜</label>
            <input type="date" value={funnelDate} onChange={(e) => setFunnelDate(e.target.value)}
              className="px-3 py-2 rounded-lg border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
          </div>
          <FileUploadButton
            label="일별 퍼널 (.xlsx)"
            accept=".xlsx,.xls"
            loading={uploading === "coupang_funnel"}
            onChange={onFileChange("coupang_funnel", funnelDate, "/api/upload-coupang-funnel")}
          />
        </div>
        {/* 상품별 실적 */}
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">상품별 실적 날짜</label>
            <input type="date" value={productDate} onChange={(e) => setProductDate(e.target.value)}
              className="px-3 py-2 rounded-lg border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
          </div>
          <FileUploadButton
            label="상품별 실적 (.xlsx)"
            accept=".xlsx,.xls"
            loading={uploading === "coupang_product"}
            onChange={onFileChange("coupang_product", productDate, "/api/upload-coupang-ads")}
          />
        </div>
      </div>
      {msg && <p className="text-sm mt-2">{msg}</p>}
    </Section>
  );
}

// ─── Section: GFA 광고비 ───────────────────────────────────────────
function GfaSection({ defaultDate }: { defaultDate: string }) {
  const [rows, setRows] = useState<GfaRow[]>([{ ...makeGfaRow(), date: defaultDate }]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const addRow = () => setRows([...rows, { ...makeGfaRow(), date: defaultDate }]);

  const removeRow = (i: number) => {
    if (rows.length <= 1) return;
    setRows(rows.filter((_, idx) => idx !== i));
  };

  const updateRow = (i: number, field: keyof GfaRow, value: string) => {
    setRows(rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  };

  const handleSave = async () => {
    setSaving(true);
    setMsg("");
    try {
      const entries = rows.map((r) => ({
        date: r.date,
        channel: "gfa",
        brand: r.brand,
        spend: Number(r.spend) || 0,
        impressions: Number(r.impressions) || 0,
        clicks: Number(r.clicks) || 0,
        conversions: Number(r.conversions) || 0,
        conversion_value: Number(r.conversion_value) || 0,
      }));
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "manual_ad_spend", entries }),
      });
      if (!res.ok) throw new Error("저장 실패");
      setMsg("✅ GFA 광고비 저장 완료");
    } catch {
      setMsg("❌ 저장 실패");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title="GFA 광고비" icon="🟢">
      <div className="space-y-3">
        {rows.map((row, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2 pb-2 border-b border-border/50 last:border-b-0">
            <InputField label="날짜" type="date" value={row.date} onChange={(v) => updateRow(i, "date", v)} />
            <SelectField label="브랜드" value={row.brand} onChange={(v) => updateRow(i, "brand", v)} options={BRAND_OPTIONS} />
            <InputField label="광고비" type="number" value={row.spend} onChange={(v) => updateRow(i, "spend", v)} placeholder="0" />
            <InputField label="노출" type="number" value={row.impressions} onChange={(v) => updateRow(i, "impressions", v)} placeholder="0" />
            <InputField label="클릭" type="number" value={row.clicks} onChange={(v) => updateRow(i, "clicks", v)} placeholder="0" />
            <InputField label="전환" type="number" value={row.conversions} onChange={(v) => updateRow(i, "conversions", v)} placeholder="0" />
            <InputField label="전환매출" type="number" value={row.conversion_value} onChange={(v) => updateRow(i, "conversion_value", v)} placeholder="0" />
            {rows.length > 1 && (
              <button onClick={() => removeRow(i)} className="px-2 py-2 text-red-400 hover:text-red-300 text-sm">✕</button>
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-2">
        <button onClick={addRow} className="text-xs px-3 py-1.5 rounded-lg bg-muted text-muted-foreground hover:bg-muted/80 transition-colors">
          + 날짜 추가
        </button>
        <button onClick={handleSave} disabled={saving}
          className="text-xs px-4 py-1.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity">
          {saving ? "저장 중..." : "💾 저장"}
        </button>
      </div>
      {msg && <p className="text-sm mt-2">{msg}</p>}
    </Section>
  );
}

// ─── Section: 스마트스토어 지표 ───────────────────────────────────
function SmartstoreSection({ defaultDate }: { defaultDate: string }) {
  const [ironpetRows, setIronpetRows] = useState<SmartstoreRow[]>([{ ...makeSmartstoreRow(), date: defaultDate }]);
  const [balancelabRows, setBalancelabRows] = useState<SmartstoreRow[]>([{ ...makeSmartstoreRow(), date: defaultDate }]);
  const [saving, setSaving] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const handleSave = async (brand: string, rows: SmartstoreRow[]) => {
    setSaving(brand);
    setMsg("");
    try {
      for (const row of rows) {
        const res = await fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "smartstore_funnel",
            brand,
            date: row.date,
            subscribers: Number(row.subscribers) || 0,
            sessions: Number(row.sessions) || 0,
            avg_duration: Number(row.avg_duration) || 0,
            repurchases: Number(row.repurchases) || 0,
          }),
        });
        if (!res.ok) throw new Error("저장 실패");
      }
      setMsg(`✅ ${brand === "ironpet" ? "아이언펫" : "밸런스랩"} 스마트스토어 저장 완료`);
    } catch {
      setMsg("❌ 저장 실패");
    } finally {
      setSaving(null);
    }
  };

  const renderSubSection = (
    label: string,
    icon: string,
    brand: string,
    rows: SmartstoreRow[],
    setRows: React.Dispatch<React.SetStateAction<SmartstoreRow[]>>
  ) => (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold text-muted-foreground">{icon} {label}</h4>
      {rows.map((row, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2 pb-2 border-b border-border/50 last:border-b-0">
          <InputField label="날짜" type="date" value={row.date} onChange={(v) => setRows(rows.map((r, idx) => idx === i ? { ...r, date: v } : r))} />
          <InputField label="알림받기" type="number" value={row.subscribers} onChange={(v) => setRows(rows.map((r, idx) => idx === i ? { ...r, subscribers: v } : r))} placeholder="0" />
          <InputField label="유입" type="number" value={row.sessions} onChange={(v) => setRows(rows.map((r, idx) => idx === i ? { ...r, sessions: v } : r))} placeholder="0" />
          <InputField label="체류시간" type="number" value={row.avg_duration} onChange={(v) => setRows(rows.map((r, idx) => idx === i ? { ...r, avg_duration: v } : r))} placeholder="0" />
          <InputField label="재구매" type="number" value={row.repurchases} onChange={(v) => setRows(rows.map((r, idx) => idx === i ? { ...r, repurchases: v } : r))} placeholder="0" />
          {rows.length > 1 && (
            <button onClick={() => setRows(rows.filter((_, idx) => idx !== i))} className="px-2 py-2 text-red-400 hover:text-red-300 text-sm">✕</button>
          )}
        </div>
      ))}
      <div className="flex gap-2">
        <button onClick={() => setRows([...rows, { ...makeSmartstoreRow(), date: defaultDate }])}
          className="text-xs px-3 py-1.5 rounded-lg bg-muted text-muted-foreground hover:bg-muted/80 transition-colors">
          + 날짜 추가
        </button>
        <button onClick={() => handleSave(brand, rows)} disabled={saving === brand}
          className="text-xs px-4 py-1.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity">
          {saving === brand ? "저장 중..." : "💾 저장"}
        </button>
      </div>
    </div>
  );

  return (
    <Section title="스마트스토어 지표" icon="🟩">
      {renderSubSection("아이언펫 스마트스토어", "🐾", "ironpet", ironpetRows, setIronpetRows)}
      <div className="border-t border-border/50 my-4" />
      {renderSubSection("밸런스랩(큐모발검사) 스마트스토어", "🧬", "balancelab", balancelabRows, setBalancelabRows)}
      {msg && <p className="text-sm mt-2">{msg}</p>}
    </Section>
  );
}

// ─── Section: 카페24 퍼널 ─────────────────────────────────────────
function Cafe24Section({ defaultDate }: { defaultDate: string }) {
  const [rows, setRows] = useState<Cafe24Row[]>([{ ...makeCafe24Row(), date: defaultDate }]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const handleSave = async () => {
    setSaving(true);
    setMsg("");
    try {
      for (const row of rows) {
        const res = await fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "cafe24_funnel",
            date: row.date,
            brand: "cafe24",
            cart_adds: Number(row.cart_adds) || 0,
            signups: Number(row.signups) || 0,
            repurchases: Number(row.repurchases) || 0,
          }),
        });
        if (!res.ok) throw new Error("저장 실패");
      }
      setMsg("✅ 카페24 퍼널 저장 완료");
    } catch {
      setMsg("❌ 저장 실패");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title="카페24 퍼널" icon="🛒">
      {rows.map((row, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2 pb-2 border-b border-border/50 last:border-b-0">
          <InputField label="날짜" type="date" value={row.date} onChange={(v) => setRows(rows.map((r, idx) => idx === i ? { ...r, date: v } : r))} />
          <InputField label="장바구니" type="number" value={row.cart_adds} onChange={(v) => setRows(rows.map((r, idx) => idx === i ? { ...r, cart_adds: v } : r))} placeholder="0" />
          <InputField label="회원가입" type="number" value={row.signups} onChange={(v) => setRows(rows.map((r, idx) => idx === i ? { ...r, signups: v } : r))} placeholder="0" />
          <InputField label="재구매" type="number" value={row.repurchases} onChange={(v) => setRows(rows.map((r, idx) => idx === i ? { ...r, repurchases: v } : r))} placeholder="0" />
          {rows.length > 1 && (
            <button onClick={() => setRows(rows.filter((_, idx) => idx !== i))} className="px-2 py-2 text-red-400 hover:text-red-300 text-sm">✕</button>
          )}
        </div>
      ))}
      <div className="flex gap-2">
        <button onClick={() => setRows([...rows, { ...makeCafe24Row(), date: defaultDate }])}
          className="text-xs px-3 py-1.5 rounded-lg bg-muted text-muted-foreground hover:bg-muted/80 transition-colors">
          + 날짜 추가
        </button>
        <button onClick={handleSave} disabled={saving}
          className="text-xs px-4 py-1.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity">
          {saving ? "저장 중..." : "💾 저장"}
        </button>
      </div>
      {msg && <p className="text-sm mt-2">{msg}</p>}
    </Section>
  );
}

// ─── Section: 판매 실적 (이카운트) ────────────────────────────────
function SalesUploadSection({ defaultDate }: { defaultDate: string }) {
  const [salesDate, setSalesDate] = useState(defaultDate);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState("");

  const handleUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setUploading(true);
      setMsg("");
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("date", salesDate);
        const res = await fetch("/api/upload-sales", { method: "POST", body: formData });
        const json = await res.json();
        if (!res.ok) {
          if (json.unmatchedProducts && json.unmatchedProducts.length > 0) {
            const unmatchedList = json.unmatchedProducts
              .map((p: { code: string; name: string; count: number }) => `${p.code} (${p.name}) - ${p.count}건`)
              .join("\n");
            alert(`${json.error}\n\n미등록 품목코드 (${json.totalUnmatched}개):\n${unmatchedList}\n\n상품 목록 탭에 먼저 등록해주세요.`);
            throw new Error(json.error);
          }
          throw new Error(json.error || "업로드 실패");
        }
        setMsg(`✅ ${json.parsed || json.count}건 업로드 완료 (DB: ${json.productSales || 0}건, 시트: ${json.sheetAppended || 0}건)`);
      } catch (err) {
        setMsg(`❌ ${err instanceof Error ? err.message : "업로드 실패"}`);
      } finally {
        setUploading(false);
        e.target.value = "";
      }
    },
    [salesDate]
  );

  return (
    <Section title="판매 실적 (이카운트)" icon="📤">
      <div className="flex flex-wrap items-end gap-3">
        <InputField label="날짜" type="date" value={salesDate} onChange={setSalesDate} />
        <FileUploadButton label="매출 파일 (.xlsx)" accept=".xlsx,.xls" loading={uploading} onChange={handleUpload} />
      </div>
      {msg && <p className="text-sm mt-2">{msg}</p>}
    </Section>
  );
}

// ─── Section: 마케팅 이벤트 ───────────────────────────────────────
function EventSection({ defaultDate }: { defaultDate: string }) {
  const [form, setForm] = useState<EventForm>({
    date: defaultDate,
    brand: "nutty",
    title: "",
    description: "",
    color: EVENT_COLORS[0],
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const { data: events, refetch } = useFetch<MarketingEvent[]>(`/api/events?date=${form.date}`);

  const handleAdd = async () => {
    if (!form.title) return;
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("추가 실패");
      setMsg("✅ 이벤트 추가 완료");
      setForm((prev) => ({ ...prev, title: "", description: "" }));
      refetch();
    } catch {
      setMsg("❌ 추가 실패");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/events?id=${id}`, { method: "DELETE" });
      refetch();
    } catch {
      alert("삭제 실패");
    }
  };

  return (
    <Section title="마케팅 이벤트" icon="📌">
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <InputField label="날짜" type="date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} />
          <SelectField label="브랜드" value={form.brand} onChange={(v) => setForm({ ...form, brand: v })} options={BRAND_OPTIONS} />
          <InputField label="제목" value={form.title} onChange={(v) => setForm({ ...form, title: v })} placeholder="이벤트 제목" />
          <InputField label="설명" value={form.description} onChange={(v) => setForm({ ...form, description: v })} placeholder="설명 (선택)" />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">색상</label>
          <div className="flex gap-2">
            {EVENT_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setForm({ ...form, color: c })}
                className={`w-7 h-7 rounded-full border-2 transition-colors ${form.color === c ? "border-white" : "border-transparent"}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
        <button onClick={handleAdd} disabled={saving || !form.title}
          className="text-xs px-4 py-1.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity">
          {saving ? "추가 중..." : "📌 이벤트 추가"}
        </button>
        {msg && <p className="text-sm">{msg}</p>}

        {/* Event List */}
        {events && events.length > 0 && (
          <div className="pt-2 space-y-1">
            <p className="text-xs font-medium text-muted-foreground">{form.date} 이벤트</p>
            {events.map((ev) => (
              <div key={ev.id} className="flex items-center gap-2 text-xs">
                <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: ev.color }} />
                <span className="font-medium">{BRAND_LABELS[ev.brand] || ev.brand}</span>
                <span>{ev.title}</span>
                {ev.description && <span className="text-muted-foreground">- {ev.description}</span>}
                <button onClick={() => handleDelete(ev.id)} className="text-red-400 hover:text-red-300 ml-auto">삭제</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}

// ─── Section: 건별 비용 ───────────────────────────────────────────
function MiscCostSection({ defaultDate }: { defaultDate: string }) {
  const [form, setForm] = useState<MiscCostForm>({
    date: defaultDate,
    brand: "nutty",
    category: MISC_CATEGORIES[0],
    description: "",
    cost: "",
    note: "",
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const handleSave = async () => {
    if (!form.description || !form.cost) return;
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "misc_cost",
          date: form.date,
          brand: form.brand,
          category: form.category,
          description: form.description,
          cost: Number(form.cost) || 0,
          note: form.note,
        }),
      });
      if (!res.ok) throw new Error("저장 실패");
      setMsg("✅ 건별 비용 저장 완료");
      setForm((prev) => ({ ...prev, description: "", cost: "", note: "" }));
    } catch {
      setMsg("❌ 저장 실패");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title="건별 비용" icon="🧾">
      <div className="flex flex-wrap items-end gap-2">
        <InputField label="날짜" type="date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} />
        <SelectField label="브랜드" value={form.brand} onChange={(v) => setForm({ ...form, brand: v })} options={BRAND_OPTIONS} />
        <SelectField label="카테고리" value={form.category} onChange={(v) => setForm({ ...form, category: v })}
          options={MISC_CATEGORIES.map((c) => ({ value: c, label: c }))} />
        <InputField label="내용" value={form.description} onChange={(v) => setForm({ ...form, description: v })} placeholder="비용 내용" />
        <InputField label="금액" type="number" value={form.cost} onChange={(v) => setForm({ ...form, cost: v })} placeholder="0" />
        <InputField label="비고" value={form.note} onChange={(v) => setForm({ ...form, note: v })} placeholder="(선택)" />
      </div>
      <button onClick={handleSave} disabled={saving || !form.description || !form.cost}
        className="text-xs px-4 py-1.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity mt-2">
        {saving ? "저장 중..." : "💾 저장"}
      </button>
      {msg && <p className="text-sm mt-2">{msg}</p>}
    </Section>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Tab 2: 🎯 목표 설정
// ═══════════════════════════════════════════════════════════════════
function TargetsTab() {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const { data: targets, loading, refetch } = useFetch<TargetRow[]>("/api/targets");
  const [form, setForm] = useState({ brand: "nutty", revenue_target: "", roas_target: "" });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const handleSave = async () => {
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch("/api/targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month,
          brand: form.brand,
          revenue_target: Number(form.revenue_target) || 0,
          roas_target: Number(form.roas_target) || 0,
        }),
      });
      if (!res.ok) throw new Error("저장 실패");
      setMsg("✅ 목표 저장 완료");
      setForm({ brand: "nutty", revenue_target: "", roas_target: "" });
      refetch();
    } catch {
      setMsg("❌ 저장 실패");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading />;

  return (
    <div className="space-y-4">
      <Card>
        <div className="px-6 py-4 border-b">
          <h3 className="text-sm font-semibold text-muted-foreground">월간 목표 설정</h3>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">월</label>
              <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
                className="px-3 py-2 rounded-lg border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>
            <SelectField label="브랜드" value={form.brand} onChange={(v) => setForm({ ...form, brand: v })} options={BRAND_OPTIONS} />
            <InputField label="매출 목표 (원)" type="number" value={form.revenue_target} onChange={(v) => setForm({ ...form, revenue_target: v })} placeholder="0" />
            <InputField label="ROAS 목표" type="number" value={form.roas_target} onChange={(v) => setForm({ ...form, roas_target: v })} placeholder="0" />
            <div className="flex items-end">
              <button onClick={handleSave} disabled={saving}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity">
                {saving ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
          {msg && <p className="text-sm">{msg}</p>}
        </div>
      </Card>

      {/* Existing Targets */}
      {targets && targets.length > 0 && (
        <Card>
          <div className="px-6 py-4 border-b">
            <h3 className="text-sm font-semibold text-muted-foreground">등록된 목표</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="px-6 py-3 font-medium text-muted-foreground">월</th>
                  <th className="px-6 py-3 font-medium text-muted-foreground">브랜드</th>
                  <th className="px-6 py-3 font-medium text-muted-foreground text-right">매출 목표</th>
                  <th className="px-6 py-3 font-medium text-muted-foreground text-right">ROAS 목표</th>
                </tr>
              </thead>
              <tbody>
                {targets.map((t, i) => (
                  <tr key={i} className="border-b last:border-b-0 hover:bg-muted/50 transition-colors">
                    <td className="px-6 py-3">{t.month}</td>
                    <td className="px-6 py-3">
                      <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ backgroundColor: BRAND_COLORS[t.brand] || "#888" }} />
                      {BRAND_LABELS[t.brand] || t.brand}
                    </td>
                    <td className="px-6 py-3 text-right">{formatCurrency(t.revenue_target)}</td>
                    <td className="px-6 py-3 text-right">{t.roas_target}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Tab 3: 💰 제품 원가
// ═══════════════════════════════════════════════════════════════════
function CostsTab() {
  const { data, loading, refetch } = useFetch<SettingsData>("/api/settings");
  const [form, setForm] = useState({ product: "", brand: "", cost_price: "", shipping_cost: "", category: "" });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");

  const handleSave = useCallback(async () => {
    if (!form.product || !form.brand) return;
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product: form.product,
          brand: form.brand,
          cost_price: Number(form.cost_price) || 0,
          shipping_cost: Number(form.shipping_cost) || 0,
          category: form.category,
        }),
      });
      if (!res.ok) throw new Error("저장 실패");
      setMessage("✅ 저장 완료");
      setForm({ product: "", brand: "", cost_price: "", shipping_cost: "", category: "" });
      refetch();
    } catch {
      setMessage("❌ 저장 실패");
    } finally {
      setSaving(false);
    }
  }, [form, refetch]);

  const handleDelete = useCallback(async (product: string, brand: string) => {
    if (!confirm(`"${product}" 원가 정보를 삭제하시겠습니까?`)) return;
    try {
      await fetch(`/api/settings?product=${encodeURIComponent(product)}&brand=${encodeURIComponent(brand)}`, { method: "DELETE" });
      refetch();
    } catch {
      alert("삭제 실패");
    }
  }, [refetch]);

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setMessage("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("type", "product_costs");
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "업로드 실패");
      setMessage(`✅ ${json.count}건 업로드 완료`);
      refetch();
    } catch (err) {
      setMessage(`❌ ${err instanceof Error ? err.message : "업로드 실패"}`);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }, [refetch]);

  const handleMissingClick = (product: string, brand: string) => {
    setForm((prev) => ({ ...prev, product, brand }));
  };

  if (loading) return <Loading />;

  return (
    <div className="space-y-6">
      {/* Missing Products Warning */}
      {data && data.missingProducts.length > 0 && (
        <Card className="border-amber-500/50 bg-amber-500/5">
          <div className="px-6 py-4">
            <h3 className="text-sm font-semibold text-amber-600 dark:text-amber-400 mb-2">
              ⚠️ 원가 미등록 제품 ({data.missingProducts.length}건)
            </h3>
            <div className="flex flex-wrap gap-2">
              {data.missingProducts.slice(0, 20).map((p, i) => (
                <button
                  key={i}
                  onClick={() => handleMissingClick(p.product, p.brand)}
                  className="text-xs px-2 py-1 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 transition-colors"
                >
                  {p.product}
                </button>
              ))}
              {data.missingProducts.length > 20 && (
                <span className="text-xs text-muted-foreground py-1">... 외 {data.missingProducts.length - 20}건</span>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Cost Entry Form */}
      <Card>
        <div className="px-6 py-4 border-b">
          <h3 className="text-sm font-semibold text-muted-foreground">제품 원가 등록</h3>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">제품</label>
              <select
                value={form.product}
                onChange={(e) => {
                  const p = data?.allProducts.find((ap) => ap.product === e.target.value);
                  setForm((prev) => ({ ...prev, product: e.target.value, brand: p?.brand || prev.brand }));
                }}
                className="w-full px-3 py-2 rounded-lg border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="">제품 선택</option>
                {data?.allProducts.map((p, i) => (
                  <option key={i} value={p.product}>{p.product} ({BRAND_LABELS[p.brand] || p.brand})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">브랜드</label>
              <select
                value={form.brand}
                onChange={(e) => setForm((prev) => ({ ...prev, brand: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="">브랜드 선택</option>
                {Object.entries(BRAND_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">카테고리</label>
              <input
                type="text"
                value={form.category}
                onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
                placeholder="간식, 사료, 영양제..."
                className="w-full px-3 py-2 rounded-lg border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">원가 (원)</label>
              <input
                type="number"
                value={form.cost_price}
                onChange={(e) => setForm((prev) => ({ ...prev, cost_price: e.target.value }))}
                placeholder="0"
                className="w-full px-3 py-2 rounded-lg border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">배송비 (원)</label>
              <input
                type="number"
                value={form.shipping_cost}
                onChange={(e) => setForm((prev) => ({ ...prev, shipping_cost: e.target.value }))}
                placeholder="0"
                className="w-full px-3 py-2 rounded-lg border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={handleSave}
                disabled={saving || !form.product || !form.brand}
                className="w-full px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {saving ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
          {message && <p className="text-sm">{message}</p>}
        </div>
      </Card>

      {/* CSV Upload */}
      <Card>
        <div className="px-6 py-4 border-b">
          <h3 className="text-sm font-semibold text-muted-foreground">제품 원가 CSV/XLSX 업로드</h3>
        </div>
        <div className="px-6 py-4">
          <p className="text-xs text-muted-foreground mb-3">
            컬럼: product(제품), brand(브랜드), cost_price(원가), shipping_cost(배송비), category(카테고리)
          </p>
          <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border bg-card text-sm font-medium cursor-pointer hover:bg-muted transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            {uploading ? "업로드 중..." : "파일 선택"}
            <input type="file" accept=".csv,.xlsx,.xls" onChange={handleUpload} className="hidden" disabled={uploading} />
          </label>
        </div>
      </Card>

      {/* Registered Costs Table */}
      <Card>
        <div className="px-6 py-4 border-b">
          <h3 className="text-sm font-semibold text-muted-foreground">등록된 제품 원가 ({data?.costs.length || 0}건)</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="px-6 py-3 font-medium text-muted-foreground">제품</th>
                <th className="px-6 py-3 font-medium text-muted-foreground">브랜드</th>
                <th className="px-6 py-3 font-medium text-muted-foreground">카테고리</th>
                <th className="px-6 py-3 font-medium text-muted-foreground text-right">원가</th>
                <th className="px-6 py-3 font-medium text-muted-foreground text-right">배송비</th>
                <th className="px-6 py-3 font-medium text-muted-foreground text-right">작업</th>
              </tr>
            </thead>
            <tbody>
              {(data?.costs || []).map((row, i) => (
                <tr key={i} className="border-b last:border-b-0 hover:bg-muted/50 transition-colors">
                  <td className="px-6 py-3">{row.product}</td>
                  <td className="px-6 py-3">
                    <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ backgroundColor: BRAND_COLORS[row.brand] || "#888" }} />
                    {BRAND_LABELS[row.brand] || row.brand}
                  </td>
                  <td className="px-6 py-3 text-muted-foreground">{row.category}</td>
                  <td className="px-6 py-3 text-right">{formatCurrency(row.cost_price)}</td>
                  <td className="px-6 py-3 text-right">{formatCurrency(row.shipping_cost)}</td>
                  <td className="px-6 py-3 text-right">
                    <button onClick={() => handleDelete(row.product, row.brand)} className="text-red-500 hover:text-red-400 text-xs">삭제</button>
                  </td>
                </tr>
              ))}
              {(data?.costs || []).length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">등록된 원가 정보가 없습니다</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Tab 4: ℹ️ 데이터 소스
// ═══════════════════════════════════════════════════════════════════
function SourcesTab() {
  const { data: raw, loading } = useFetch<{ sources: DataSourceStatusRaw[] }>("/api/data-status");

  if (loading) return <Loading />;

  const sources: DataSourceStatus[] = (raw?.sources || []).map((s) => ({
    source: s.id,
    label: s.label,
    type: s.type,
    latestDate: s.latestDate,
    status: (s.ok ? "ok" : s.latestDate ? "stale" : "missing") as "ok" | "missing" | "stale",
  }));
  const autoSources = sources.filter((s) => s.type === "auto");
  const manualSources = sources.filter((s) => s.type === "manual");

  return (
    <div className="space-y-4">
      <Card>
        <div className="px-6 py-4 border-b">
          <h3 className="text-sm font-semibold text-muted-foreground">🤖 자동 수집 소스</h3>
        </div>
        <div className="px-6 py-4 space-y-2">
          {autoSources.length === 0 && <p className="text-sm text-muted-foreground">자동 수집 소스가 없습니다</p>}
          {autoSources.map((s) => (
            <div key={s.source} className="flex items-center justify-between py-1">
              <div className="flex items-center gap-2">
                <span className={s.status === "ok" ? "text-green-500" : "text-red-500"}>
                  {s.status === "ok" ? "✅" : "❌"}
                </span>
                <span className="text-sm">{s.label}</span>
              </div>
              <span className="text-xs text-muted-foreground">{s.latestDate || "데이터 없음"}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className="px-6 py-4 border-b">
          <h3 className="text-sm font-semibold text-muted-foreground">✍️ 수동 입력 소스</h3>
        </div>
        <div className="px-6 py-4 space-y-2">
          {manualSources.length === 0 && <p className="text-sm text-muted-foreground">수동 입력 소스가 없습니다</p>}
          {manualSources.map((s) => (
            <div key={s.source} className="flex items-center justify-between py-1">
              <div className="flex items-center gap-2">
                <span className={s.status === "ok" ? "text-green-500" : "text-red-500"}>
                  {s.status === "ok" ? "✅" : "❌"}
                </span>
                <span className="text-sm">{s.label}</span>
              </div>
              <span className="text-xs text-muted-foreground">{s.latestDate || "데이터 없음"}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Shared UI Components
// ═══════════════════════════════════════════════════════════════════
function InputField({ label, type = "text", value, onChange, placeholder }: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="px-3 py-2 rounded-lg border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 w-full min-w-[100px]"
      />
    </div>
  );
}

function SelectField({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-3 py-2 rounded-lg border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 w-full min-w-[100px]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function FileUploadButton({ label, accept, loading, onChange }: {
  label: string;
  accept: string;
  loading: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">파일</label>
      <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border bg-card text-sm font-medium cursor-pointer hover:bg-muted transition-colors">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
        {loading ? "업로드 중..." : label}
        <input type="file" accept={accept} onChange={onChange} className="hidden" disabled={loading} />
      </label>
    </div>
  );
}
