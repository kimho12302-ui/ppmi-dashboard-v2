export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import * as XLSX from "xlsx";
import { triggerSheetSync } from "@/lib/github-dispatch";

function parseDate(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, "0");
    const d = String(val.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof val === "number" && Number.isFinite(val) && val > 20000 && val < 80000) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const ms = epoch.getTime() + Math.round(val) * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  const s = String(val).trim().replace(/\.0$/, "");
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{4}\.\d{1,2}\.\d{1,2}/.test(s)) {
    const [y, m, d] = s.split(".");
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  if (/^\d{4}\/\d{1,2}\/\d{1,2}/.test(s)) {
    const [y, m, d] = s.split("/");
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return "";
}

function safeNum(val: unknown): number {
  if (val === null || val === undefined || val === "") return 0;
  const s = String(val).replace(/[,₩원\s%]/g, "");
  if (s === "" || s === "-") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function findCol(headers: string[], names: string[]): number {
  for (const name of names) {
    const i = headers.indexOf(name);
    if (i >= 0) return i;
  }
  return -1;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const brand = (formData.get("brand") as string) || "nutty";

    if (!file) {
      return NextResponse.json({ error: "파일이 필요합니다" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const allData = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true }) as unknown[][];

    if (allData.length < 2) {
      return NextResponse.json({
        error: `데이터가 없습니다 (시트: "${sheetName}", 총 ${allData.length}행)`,
      }, { status: 400 });
    }

    const headers = (allData[0] as unknown[]).map(h => String(h ?? "").trim());

    const dateCol = findCol(headers, ["날짜", "일자", "date", "Date"]);
    const impCol = findCol(headers, ["노출수", "노출", "impressions"]);
    const clickCol = findCol(headers, ["클릭수", "클릭", "clicks"]);
    const spendCol = findCol(headers, ["광고비(원)", "광고비", "비용(원)", "비용", "spend", "cost"]);
    const ordersCol = findCol(headers, ["총 주문수 (1일)", "총 주문수(1일)", "주문수", "전환수", "주문수(1일)"]);
    const convCol = findCol(headers, ["총 전환 매출액 (1일)(원)", "총 전환 매출액(1일)(원)", "전환매출액", "전환 매출액", "매출액"]);

    if (dateCol < 0 || spendCol < 0) {
      return NextResponse.json({
        error: "필수 컬럼 누락",
        sheetName,
        totalRows: allData.length,
        detectedHeaders: headers,
        matched: { date: dateCol, spend: spendCol, impressions: impCol, clicks: clickCol, orders: ordersCol, conv_value: convCol },
        hint: "엑셀 첫 행 헤더가 '날짜'와 '광고비(원)'(또는 동의어)을 포함해야 합니다",
      }, { status: 400 });
    }

    const dailyAgg = new Map<string, { spend: number; impressions: number; clicks: number; conversions: number; conversion_value: number; rowCount: number }>();
    let dateParseFailRows = 0;
    let nanRows = 0;
    const dateParseFailSamples: unknown[] = [];

    for (let i = 1; i < allData.length; i++) {
      const row = allData[i] as unknown[];
      if (!row || row.length === 0) continue;
      const rawDate = row[dateCol];
      if (rawDate === undefined || rawDate === null || rawDate === "") continue;

      const dateStr = parseDate(rawDate);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        dateParseFailRows++;
        if (dateParseFailSamples.length < 3) dateParseFailSamples.push(rawDate);
        continue;
      }

      const spend = safeNum(row[spendCol]);
      const imp = impCol >= 0 ? safeNum(row[impCol]) : 0;
      const click = clickCol >= 0 ? safeNum(row[clickCol]) : 0;
      const ord = ordersCol >= 0 ? safeNum(row[ordersCol]) : 0;
      const conv = convCol >= 0 ? safeNum(row[convCol]) : 0;
      if ([spend, imp, click, ord, conv].some(v => Number.isNaN(v))) {
        nanRows++;
        continue;
      }

      const ex = dailyAgg.get(dateStr) || { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversion_value: 0, rowCount: 0 };
      ex.spend += spend;
      ex.impressions += imp;
      ex.clicks += click;
      ex.conversions += ord;
      ex.conversion_value += conv;
      ex.rowCount++;
      dailyAgg.set(dateStr, ex);
    }

    if (dailyAgg.size === 0) {
      return NextResponse.json({
        error: "유효한 데이터 행이 0건입니다",
        sheetName,
        totalRows: allData.length,
        dataRows: allData.length - 1,
        dateParseFailRows,
        dateParseFailSamples,
        nanRows,
        detectedHeaders: headers,
        matched: { date: dateCol, spend: spendCol, impressions: impCol, clicks: clickCol, orders: ordersCol, conv_value: convCol },
        hint: dateParseFailRows > 0
          ? "날짜 컬럼 형식이 인식 안 됩니다 (YYYYMMDD / YYYY-MM-DD / 엑셀날짜 지원)"
          : "광고비/노출/클릭 등 숫자 컬럼이 NaN으로 파싱됐을 수 있습니다",
      }, { status: 400 });
    }

    // 엑셀에 없던 컬럼은 payload에서 제외 → 기존 값 보존(부분 업로드가 노출/클릭/전환을 0으로 덮는 사고 방지).
    // spend는 필수 매칭 컬럼(위 검증)이라 항상 포함.
    type AdRow = { date: string; channel: string; brand: string; spend: number; impressions?: number; clicks?: number; conversions?: number; conversion_value?: number };
    const dbRows: AdRow[] = Array.from(dailyAgg.entries()).map(([date, d]) => {
      const row: AdRow = { date, channel: "coupang_ads", brand, spend: Math.round(d.spend) };
      if (impCol >= 0) row.impressions = Math.round(d.impressions);
      if (clickCol >= 0) row.clicks = Math.round(d.clicks);
      if (ordersCol >= 0) row.conversions = Math.round(d.conversions);
      if (convCol >= 0) row.conversion_value = Math.round(d.conversion_value);
      return row;
    });

    const { error } = await supabase
      .from("daily_ad_spend")
      .upsert(dbRows, { onConflict: "date,channel,brand" });

    if (error) {
      return NextResponse.json({
        error: `DB upsert 실패: ${error.message}`,
        code: error.code,
        details: error.details,
        attemptedRows: dbRows.length,
        sampleRow: dbRows[0],
      }, { status: 500 });
    }

    const dates = dbRows.map(r => r.date).sort();
    // 업로드 직후 통계시트 즉시 반영 (best-effort, 비차단)
    const sheetSyncTriggered = await triggerSheetSync(dates[0], dates[dates.length - 1]);
    const totalSpend = dbRows.reduce((s, r) => s + r.spend, 0);
    const totalImp = dbRows.reduce((s, r) => s + (r.impressions || 0), 0);
    const totalClick = dbRows.reduce((s, r) => s + (r.clicks || 0), 0);
    const warnings: string[] = [];
    if (totalSpend === 0) warnings.push("⚠️ 광고비 합계가 0원입니다 (엑셀의 광고비 컬럼 값을 확인하세요)");
    if (dateParseFailRows > 0) warnings.push(`날짜 인식 실패 ${dateParseFailRows}행 스킵 (샘플: ${JSON.stringify(dateParseFailSamples)})`);
    if (nanRows > 0) warnings.push(`숫자 인식 실패 ${nanRows}행 스킵`);

    return NextResponse.json({
      ok: true,
      message: `쿠팡 광고 ${dates[0]} ~ ${dates[dates.length - 1]} 저장 (${dbRows.length}일, brand=${brand}, 광고비합 ${totalSpend.toLocaleString()}원)`,
      sheetSyncTriggered,
      dailyRows: dbRows.length,
      brand,
      totalSpend,
      totalImpressions: totalImp,
      totalClicks: totalClick,
      dates: { from: dates[0], to: dates[dates.length - 1] },
      warnings: warnings.length > 0 ? warnings : undefined,
      skipped: { dateParseFail: dateParseFailRows, nan: nanRows },
    });
  } catch (error) {
    const msg = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error("Upload coupang ads error:", error);
    return NextResponse.json({ error: `업로드 실패: ${msg}` }, { status: 500 });
  }
}
