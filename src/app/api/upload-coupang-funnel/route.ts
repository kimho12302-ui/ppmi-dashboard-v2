export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import * as XLSX from "xlsx";

function safeNum(val: unknown): number {
  if (val === null || val === undefined || val === "") return 0;
  const s = String(val).replace(/[,₩원\s%]/g, "");
  if (s === "" || s === "-") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function colIdx(headers: string[], names: string[]): number {
  for (const n of names) {
    const i = headers.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
}

function parseRowDate(val: unknown, fallback: string): string {
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  if (typeof val === "number" && Number.isFinite(val) && val > 20000 && val < 80000) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(epoch.getTime() + Math.round(val) * 86400000).toISOString().slice(0, 10);
  }
  const s = String(val ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (/^\d{4}[./]\d{1,2}[./]\d{1,2}/.test(s)) {
    const [y, m, d] = s.split(/[./]/);
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return fallback;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const date = formData.get("date") as string;

    if (!file || !date) {
      return NextResponse.json({ error: "파일과 날짜가 필요합니다" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true }) as unknown[][];

    if (rawData.length < 2) {
      return NextResponse.json({
        error: `데이터가 비어있습니다 (시트: "${sheetName}", 총 ${rawData.length}행)`,
      }, { status: 400 });
    }

    const headers = (rawData[0] as unknown[]).map(h => String(h ?? "").trim());
    const dateCol    = colIdx(headers, ["날짜", "일자", "date", "Date"]);
    const sessionCol = colIdx(headers, ["방문자", "방문수", "방문자수", "방문자 수", "유입자", "유입자수", "고객 방문수", "visitors", "sessions"]);
    const impCol     = colIdx(headers, ["조회", "조회수", "노출", "노출수", "상품 노출수", "상품 조회수", "pageViews", "impressions"]);
    const cartCol    = colIdx(headers, ["장바구니", "장바구니 추가", "장바구니수", "관심상품", "cartAdds", "cart_adds"]);
    const orderCol   = colIdx(headers, ["주문", "주문수", "주문건수", "구매", "구매건수", "구매수", "purchases", "orders"]);

    const matched = { date: dateCol, sessions: sessionCol, impressions: impCol, cart_adds: cartCol, purchases: orderCol };
    const matchedFieldCount = [sessionCol, impCol, cartCol, orderCol].filter(i => i >= 0).length;
    if (matchedFieldCount === 0) {
      return NextResponse.json({
        error: "엑셀 헤더에서 방문자/조회/장바구니/주문 컬럼을 하나도 못 찾았습니다",
        sheetName,
        totalRows: rawData.length,
        detectedHeaders: headers,
        matched,
        hint: "지원 헤더: 방문자/조회/장바구니/주문 (및 동의어들). 다른 이름이면 알려주세요.",
      }, { status: 400 });
    }

    const byDate = new Map<string, { impressions: number; sessions: number; cart_adds: number; purchases: number; rowCount: number }>();
    let nanRows = 0;

    const aggregateRow = (rowDate: string, row: unknown[]) => {
      const sess = sessionCol >= 0 ? safeNum(row[sessionCol]) : 0;
      const imp  = impCol     >= 0 ? safeNum(row[impCol])     : 0;
      const cart = cartCol    >= 0 ? safeNum(row[cartCol])    : 0;
      const pur  = orderCol   >= 0 ? safeNum(row[orderCol])   : 0;
      if ([sess, imp, cart, pur].some(v => Number.isNaN(v))) { nanRows++; return; }
      const ex = byDate.get(rowDate) || { impressions: 0, sessions: 0, cart_adds: 0, purchases: 0, rowCount: 0 };
      ex.sessions    += sess;
      ex.impressions += imp;
      ex.cart_adds   += cart;
      ex.purchases   += pur;
      ex.rowCount++;
      byDate.set(rowDate, ex);
    };

    if (dateCol < 0) {
      for (let i = 1; i < rawData.length; i++) {
        const row = rawData[i] as unknown[];
        if (!row || row.length === 0) continue;
        aggregateRow(date, row);
      }
    } else {
      for (let i = 1; i < rawData.length; i++) {
        const row = rawData[i] as unknown[];
        if (!row || row[dateCol] === undefined || row[dateCol] === null || row[dateCol] === "") continue;
        const rowDate = parseRowDate(row[dateCol], date);
        aggregateRow(rowDate, row);
      }
    }

    if (byDate.size === 0) {
      return NextResponse.json({
        error: "처리된 행이 0건입니다",
        sheetName,
        totalRows: rawData.length,
        detectedHeaders: headers,
        matched,
        nanRows,
        hint: dateCol < 0 ? "전체 합산 모드인데 행이 비어있음" : "날짜 컬럼은 잡혔는데 값이 모두 비어있음",
      }, { status: 400 });
    }

    let funnelDays = 0;
    const errors: string[] = [];
    const perDate: Array<{ date: string; sessions: number; impressions: number; cart_adds: number; purchases: number; rows: number }> = [];

    for (const [d, vals] of byDate.entries()) {
      const { error } = await supabase.from("daily_funnel").upsert(
        {
          date: d,
          brand: "all",
          channel: "coupang",
          impressions: Math.round(vals.impressions),
          sessions: Math.round(vals.sessions),
          cart_adds: Math.round(vals.cart_adds),
          purchases: Math.round(vals.purchases),
        },
        { onConflict: "date,brand,channel" }
      );
      if (error) errors.push(`${d}: ${error.message}`);
      else funnelDays++;
      perDate.push({ date: d, sessions: vals.sessions, impressions: vals.impressions, cart_adds: vals.cart_adds, purchases: vals.purchases, rows: vals.rowCount });
    }

    const totalSum = perDate.reduce((s, x) => s + x.sessions + x.impressions + x.cart_adds + x.purchases, 0);
    const warnings: string[] = [];
    if (totalSum === 0) warnings.push("⚠️ 모든 지표 합계가 0입니다 — 엑셀 헤더가 잡혔어도 값 셀이 비었거나 다른 컬럼일 수 있습니다");
    if (nanRows > 0) warnings.push(`숫자 인식 실패 ${nanRows}행 스킵`);
    if (errors.length > 0) warnings.push(...errors);

    return NextResponse.json({
      ok: true,
      funnel: funnelDays,
      message: `쿠팡 퍼널 ${funnelDays}일 반영 (방문 ${Math.round(perDate.reduce((s,x)=>s+x.sessions,0))} / 조회 ${Math.round(perDate.reduce((s,x)=>s+x.impressions,0))} / 장바구니 ${Math.round(perDate.reduce((s,x)=>s+x.cart_adds,0))} / 주문 ${Math.round(perDate.reduce((s,x)=>s+x.purchases,0))})`,
      sheetName,
      matched,
      detectedHeaders: headers,
      perDate,
      ...(warnings.length > 0 && { warnings }),
    });
  } catch (error) {
    const msg = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error("Upload coupang funnel error:", error);
    return NextResponse.json({ error: `업로드 실패: ${msg}` }, { status: 500 });
  }
}
