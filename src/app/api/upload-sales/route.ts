/* eslint-disable @typescript-eslint/no-explicit-any, prefer-const */
import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { triggerSheetSync } from "@/lib/github-dispatch";

export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const STATS_SHEET_ID = "1FzxDCyR9FyAIduf7Q0lfUIOzvSqVlod21eOFqaPrXio";

function getAuth() {
  const saKey = process.env.GOOGLE_SA_KEY;
  if (!saKey) throw new Error("GOOGLE_SA_KEY not set");
  const creds = JSON.parse(saKey);
  return new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

// Channel mapping from 거래처명
const CHANNEL_MAP: Record<string, string> = {
  "PPMI_자사몰(카페24)": "cafe24",
  "PPMI_스마트스토어": "smartstore",
  "YS_스마트스토어": "smartstore",
  "PPMI_쿠팡": "coupang",
  "PPMI_쿠팡 로켓그로스": "coupang",
};

// Brand detection: YSIET* = balancelab, rest from product list.
// \uC0AC\uC785(saip)\uC740 \uC7AC\uACE0\uB9E4\uC785 \uC7AC\uD310\uB9E4 \uC804 \uBE0C\uB79C\uB4DC\uC758 \uCE90\uCE58\uC62C \uBC84\uD0B7(\uD30C\uBBF8\uB098/\uD14C\uB77C\uCE74\uB2C8\uC2A4/\uB2E5\uD130\uB808\uC774/\uACE0\uB124\uC774\uD2F0\uBE0C/... ).
// \uCF54\uB4DC\uAC00 \uC0C1\uD488\uBAA9\uB85D\uC5D0 \uC5C6\uC744 \uB54C\uB9CC "unknown"(\u2192 \uC0C1\uC704\uC5D0\uC11C \uBE14\uB85C\uD0B9). \uBAA9\uB85D\uC5D0 \uC788\uC73C\uBA74 \uD56D\uC0C1 4\uAC1C \uBE0C\uB79C\uB4DC \uC911 \uD558\uB098\uB85C \uADC0\uC18D.
function detectBrand(productCode: string, productListMap: Map<string, any>): string {
  if (productCode.toUpperCase().startsWith("YSIET")) return "balancelab";
  const info = productListMap.get(productCode);
  if (!info) return "unknown"; // \uC0C1\uD488\uBAA9\uB85D \uBBF8\uB4F1\uB85D \uCF54\uB4DC \u2192 \uBE14\uB85C\uD0B9
  const brandName = (info.brand || "").trim();
  if (brandName === "\uB108\uD2F0") return "nutty"; // \uB108\uD2F0
  if (brandName === "\uC544\uC774\uC5B8\uD3AB") return "ironpet"; // \uC544\uC774\uC5B8\uD3AB
  // \uBC38\uB7F0\uC2A4\uB7A9 \uBA85\uCE6D \uBCC0\uD615(\uBC38\uB7F0\uC2A4\uB7A9 / \uD050* \uAC80\uC0AC \uB77C\uC778 / \uD558\uB8E8\uAC00\uAFC8 / \uACF5\uB3D9\uAD6C\uB9E4)\uC744 \uC0AC\uC785\uC73C\uB85C \uD758\uB9AC\uC9C0 \uC54A\uACE0 balancelab \uB85C \uADC0\uC18D
  if (
    brandName.includes("\uBC38\uB7F0\uC2A4") || // \uBC38\uB7F0\uC2A4
    brandName.startsWith("\uD050") ||           // \uD050\uBAA8\uBC1C/\uD050\uD0C0\uC561/\uD050\uC9C0\uC5F0...
    brandName.includes("\uD558\uB8E8\uAC00\uAFC8") || // \uD558\uB8E8\uAC00\uAFC8
    brandName === "\uACF5\uB3D9\uAD6C\uB9E4"      // \uACF5\uB3D9\uAD6C\uB9E4
  ) return "balancelab";
  // \uADF8 \uC678(\uB108\uD2F0/\uC544\uC774\uC5B8\uD3AB/\uBC38\uB7F0\uC2A4\uB7A9\uC774 \uC544\uB2CC \uBAA8\uB4E0 \uBE0C\uB79C\uB4DC) = \uC0AC\uC785 (\uBE44\uC988\uB2C8\uC2A4 \uADDC\uCE59: \uC7AC\uD310\uB9E4 \uBC84\uD0B7)
  return "saip";
}

// 미등록 상품을 사람이 바로 알아볼 수 있게 이름 추출.
// 헤더(품목명/상품명)로 못 찾으면 → 상품코드 인접 셀 → 행 전체에서 '상품명다운' 셀(숫자·날짜·채널·코드 제외, 한글/영문 포함, 가장 긴 것) 순으로 자동 선택.
function pickProductName(row: unknown[], productNameCol: number, productCodeCol: number, productCode: string, client: string): string {
  if (productNameCol >= 0) {
    const v = String(row[productNameCol] ?? "").trim();
    if (v && v !== productCode) return v;
  }
  const isName = (s: string): boolean =>
    !!s && s !== productCode && s !== client &&
    !/^[\d,.\s]+$/.test(s) &&                              // 순수 숫자/콤마
    !/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(s) &&           // 날짜 YYYY-MM-DD 등
    !(/\b\d{1,2}:\d{2}\b/.test(s) && /\d{4}/.test(s)) &&   // JS Date 문자열(요일·시각 포함)
    /[가-힣A-Za-z]/.test(s) &&                             // 한글/영문 포함
    !/(_스마트스토어|_쿠팡|_카페24|_로켓그로스)/.test(s) && !/^(PPMI_|YS_)/.test(s); // 채널/거래처 잔재
  // 1) 이카운트는 상품명이 상품코드 바로 옆 칸인 경우가 많음 → 인접 셀 우선
  for (const idx of [productCodeCol + 1, productCodeCol - 1]) {
    if (idx >= 0 && idx < row.length) {
      const s = String(row[idx] ?? "").trim();
      if (isName(s)) return s;
    }
  }
  // 2) 행 전체에서 가장 긴 상품명다운 셀
  let best = "";
  for (const cell of row) {
    const s = String(cell ?? "").trim();
    if (isName(s) && s.length > best.length) best = s;
  }
  return best || productCode;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });

    const userDate = formData.get("date") as string | null;

    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: "array", cellDates: true });

    let fileDate = userDate || "";
    if (!fileDate) {
      const fnMatch = file.name.match(/(\d{6})/);
      if (fnMatch) {
        const digits = fnMatch[1];
        const yy = parseInt(digits.slice(0, 2), 10);
        const mm = digits.slice(2, 4);
        const dd = digits.slice(4, 6);
        const year = yy >= 70 ? 1900 + yy : 2000 + yy;
        fileDate = `${year}-${mm}-${dd}`;
      }
    }

    const sheetName = wb.SheetNames.find(n => n.includes("\uD310\uB9E4\uC815\uB9AC"));
    if (!sheetName) {
      return NextResponse.json({ error: "\uD310\uB9E4\uC815\uB9AC \uC2DC\uD2B8\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4" }, { status: 400 });
    }
    const ws = wb.Sheets[sheetName];

    const allData = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];

    // 헤더 행 자동 감지 — 위에서 6행까지 보고 "일자/날짜/결제일" + "품목코드/상품코드" 둘 다 있는 행
    let headerRowIdx = 0;
    for (let r = 0; r < Math.min(6, allData.length); r++) {
      const row = allData[r] as any[];
      if (!row) continue;
      const cells = row.map((c: any) => String(c ?? "").trim());
      const hasDate = cells.some((c: string) => c === "일자" || c === "날짜" || c === "결제일");
      const hasCode = cells.some((c: string) => c === "품목코드" || c === "상품코드");
      if (hasDate && hasCode) { headerRowIdx = r; break; }
    }
    const headers = allData[headerRowIdx] || [];

    const colMap: Record<string, number> = {};
    headers.forEach((h: any, i: number) => {
      if (h) colMap[String(h).trim()] = i;
    });

    // 이카운트 판매입력 포맷: 일자, 거래처명, 품목코드, 공급가액, 부가세
    // 이카운트 주문관리 포맷: 결제일, 판매몰, 상품코드, 실결제금액
    const dateCol = colMap["일자"] ?? colMap["날짜"] ?? colMap["결제일"] ?? -1;
    const clientCol = colMap["거래처명"] ?? colMap["판매몰"] ?? -1;
    const productCodeCol = colMap["품목코드"] ?? colMap["상품코드"] ?? -1;
    // 품목명/상품명 컬럼 탐지: ① 정확 매칭 → ② 헤더에 품목명/상품명/품명/제품명 포함 열 → ③ 품목코드 바로 옆 열(이카운트 관례, 숫자성 필드 제외)
    let productNameCol = colMap["품목명"] ?? colMap["상품명"] ?? colMap["품명"] ?? colMap["상품 명"] ?? colMap["품 명"] ?? colMap["제품명"] ?? colMap["name"] ?? -1;
    if (productNameCol < 0) {
      for (let ci = 0; ci < headers.length; ci++) {
        const h = String(headers[ci] ?? "").trim();
        if (/(품목명|상품명|품명|제품명)/.test(h) && ci !== productCodeCol) { productNameCol = ci; break; }
      }
    }
    if (productNameCol < 0 && productCodeCol >= 0) {
      const nextH = String(headers[productCodeCol + 1] ?? "").trim();
      if (nextH && !/(수량|단가|금액|공급가|부가세|가액|할인|합계|코드|일자|날짜|결제)/.test(nextH)) {
        productNameCol = productCodeCol + 1;
      }
    }
    const qtyCol = colMap["수량"] ?? -1;
    const unitPriceCol = colMap["단가"] ?? colMap["상품가"] ?? -1;
    const supplyCol = colMap["공급가액"] ?? -1;
    const taxCol = colMap["부가세"] ?? -1;
    const actualPayCol = colMap["실결제금액"] ?? -1;

    if (dateCol < 0 || productCodeCol < 0) {
      return NextResponse.json({
        error: `필수 컬럼 누락: 날짜(${dateCol}), 품목코드(${productCodeCol}). 헤더: ${headers.slice(0, 20).join(", ")}`,
      }, { status: 400 });
    }

    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });
    const plRes = await sheets.spreadsheets.values.get({
      spreadsheetId: STATS_SHEET_ID,
      range: "\uC0C1\uD488 \uBAA9\uB85D!A3:E200",
    });
    const plRows = plRes.data.values || [];
    const productListMap = new Map<string, any>();
    for (const row of plRows) {
      if (row[0]) {
        productListMap.set(String(row[0]).trim(), {
          category: row[1] || "",
          brand: row[2] || "",
          lineup: row[3] || "",
          product: row[4] || "",
        });
      }
    }

    interface SalesRow {
      date: string;
      channel: string;
      brand: string;
      category: string;
      lineup: string;
      product: string;
      productCode: string;
      quantity: number;
      unitPrice: number;
      revenue: number;
      supplyAmount: number;
    }

    const rows: SalesRow[] = [];
    let skipped = 0;
    let dateFiltered = 0;
    const unmatchedCodes = new Map<string, { name: string; count: number; firstRow: number; rowSample: string[] }>();

    for (let i = headerRowIdx + 1; i < allData.length; i++) {
      const row = allData[i];
      if (!row || !row[dateCol]) continue;

      let dateVal = row[dateCol];
      let dateStr = "";
      if (dateVal instanceof Date) {
        dateStr = dateVal.toISOString().slice(0, 10);
      } else {
        dateStr = String(dateVal).slice(0, 10);
      }
      if (!dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) { skipped++; continue; }

      if (fileDate && dateStr !== fileDate) {
        dateFiltered++;
        continue;
      }

      const productCode = String(row[productCodeCol] || "").trim();
      if (!productCode) { skipped++; continue; }

      const client = clientCol >= 0 ? String(row[clientCol] || "").trim() : "";
      // 이카운트 판매입력: CHANNEL_MAP 정확 매칭, 주문관리: 부분 문자열 매칭
      let channel = CHANNEL_MAP[client] || (
        client.includes("스마트") ? "smartstore" :
        client.includes("쿠팡") ? "coupang" :
        client.includes("카페24") || client.includes("cafe24") ? "cafe24" :
        "other"
      );
      const qty = Number(row[qtyCol] || 0);
      const unitPrice = Number(row[unitPriceCol] || 0);
      const supply = supplyCol >= 0 ? Number(row[supplyCol] || 0) : 0;
      const tax = taxCol >= 0 ? Number(row[taxCol] || 0) : 0;

      const brand = detectBrand(productCode, productListMap);
      const plInfo = productListMap.get(productCode) || {};

      // 밸런스랩 공동구매: channel = 공구_셀러명
      if (brand === "balancelab" && plInfo.brand === "\uACF5\uB3D9\uAD6C\uB9E4") {
        // 거래처명에 스마트스토어 포함 시 공구 로직 스킵
        if (!client.includes("\uC2A4\uB9C8\uD2B8\uC2A4\uD1A0\uC5B4")) {
          const seller = plInfo.lineup || "\uAE30\uD0C0";
          channel = `\uACF5\uAD6C_${seller}`;
        }
      }

      if (!productListMap.has(productCode)) {
        const prodName = pickProductName(row, productNameCol, productCodeCol, productCode, client);
        const existing = unmatchedCodes.get(productCode);
        if (existing) { existing.count++; }
        else {
          // 엑셀 row 번호: i 는 0-based 데이터 인덱스, 헤더 1행 + 1-based 표시 → i + 1 이 사용자 보는 행 번호
          const sample = row.slice(0, Math.min(row.length, 8)).map((v: unknown) => String(v ?? "").slice(0, 25));
          unmatchedCodes.set(productCode, { name: prodName, count: 1, firstRow: i + 1, rowSample: sample });
        }
      }

      // 공급가액+부가세 있으면 합산, 없으면 실결제금액 사용
      const revenue = (supply + tax > 0)
        ? supply + tax
        : (actualPayCol >= 0 ? Number(row[actualPayCol] || 0) : 0);

      rows.push({
        date: dateStr,
        channel,
        brand,
        category: plInfo.category || "",
        lineup: plInfo.lineup || "",
        product: plInfo.product || productCode,
        productCode,
        quantity: qty,
        unitPrice,
        revenue,
        supplyAmount: supply,
      });
    }

    if (unmatchedCodes.size > 0) {
      const unmatchedList = Array.from(unmatchedCodes.entries()).map(([code, info]) => ({
        code,
        name: info.name,
        count: info.count,
        firstRow: info.firstRow,
        rowSample: info.rowSample,
      }));
      return NextResponse.json({
        error: "\uBBF8\uB4F1\uB85D \uD488\uBAA9\uCF54\uB4DC\uAC00 \uC788\uC2B5\uB2C8\uB2E4. \uC0C1\uD488 \uBAA9\uB85D \uD0ED\uC5D0 \uBA3C\uC800 \uB4F1\uB85D\uD574\uC8FC\uC138\uC694.",
        unmatchedProducts: unmatchedList,
        totalUnmatched: unmatchedList.length,
        totalRows: rows.length,
        detectedHeaders: headers,
      }, { status: 400 });
    }

    // Aggregate for product_sales
    const prodAgg = new Map<string, any>();
    for (const r of rows) {
      const key = `${r.date}|${r.channel}|${r.product}|${r.lineup}`;
      const ex = prodAgg.get(key);
      if (ex) {
        ex.revenue += r.revenue;
        ex.quantity += r.quantity;
        ex.buyers += 1;
      } else {
        prodAgg.set(key, {
          date: r.date, channel: r.channel, product: r.product,
          brand: r.brand, category: r.category, lineup: r.lineup,
          revenue: r.revenue, quantity: r.quantity, buyers: 1,
        });
      }
    }
    const productSalesRows = Array.from(prodAgg.values());

    // Aggregate for daily_sales
    const dailyAgg = new Map<string, any>();
    for (const r of rows) {
      const key = `${r.date}|${r.brand}|${r.channel}`;
      const ex = dailyAgg.get(key);
      if (ex) {
        ex.revenue += r.revenue;
        ex.orders += r.quantity;
        ex.quantity += r.quantity;
      } else {
        dailyAgg.set(key, { date: r.date, brand: r.brand, channel: r.channel, revenue: r.revenue, orders: r.quantity, quantity: r.quantity });
      }
    }
    const dailySalesRows = Array.from(dailyAgg.values());

    // DB 저장 (product_sales: 날짜 삭제 후 재삽입 / daily_sales: upsert)
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    let dbResults: Record<string, any> = {};

    // product_sales: 날짜별 delete → insert (unique: date,brand,product,channel,lineup)
    const uploadDates = [...new Set(productSalesRows.map(r => r.date))];
    for (const d of uploadDates) {
      const { error: delErr } = await supabase.from("product_sales").delete().eq("date", d);
      if (delErr) dbResults.productSalesError = delErr.message;
    }
    for (let i = 0; i < productSalesRows.length; i += 500) {
      const chunk = productSalesRows.slice(i, i + 500);
      const { error } = await supabase.from("product_sales").insert(chunk);
      if (error) dbResults.productSalesError = error.message;
    }

    for (let i = 0; i < dailySalesRows.length; i += 500) {
      const chunk = dailySalesRows.slice(i, i + 500);
      const { error } = await supabase.from("daily_sales").upsert(chunk, { onConflict: "date,brand,channel" });
      if (error) dbResults.dailySalesError = error.message;
    }

    // Write to Stats sheet Sales tab
    const DAY_NAMES = ["\uC77C", "\uC6D4", "\uD654", "\uC218", "\uBAA9", "\uAE08", "\uD1A0"];
    const salesSheetRows = rows.map(r => {
      const d = new Date(r.date + "T00:00:00");
      const month = d.getMonth() + 1;
      const day = d.getDate();
      const dayName = DAY_NAMES[d.getDay()];
      const yearMonth = `${String(d.getFullYear()).slice(2)}\uB144${month}\uC6D4`;
      const dateText = `${month}\uC6D4 ${day}\uC77C (${dayName})`;

      const plInfo = productListMap.get(r.productCode) || {};
      const brandKor: Record<string, string> = {
        "nutty": "\uB108\uD2F0",
        "ironpet": "\uC544\uC774\uC5B8\uD3AB",
        "saip": plInfo.brand || "\uC0AC\uC785",
        "balancelab": "\uBC38\uB7F0\uC2A4\uB7A9",
      };
      const channelKor: Record<string, string> = {
        "cafe24": "\uCE74\uD398\u0032\u0034",
        "smartstore": "\uC2A4\uB9C8\uD2B8\uC2A4\uD1A0\uC5B4",
        "coupang": "\uCFE0\uD321",
        "pp": "\uD53C\uD53C",
        "ably": "\uC5D0\uC774\uBE14\uB9AC",
        "petfriends": "\uD3AB\uD504\uB80C\uC988",
      };
      let brandLabel = brandKor[r.brand] || plInfo.brand || r.brand;
      if (r.brand === "balancelab" && (plInfo.brand === "\uC790\uCCB4\uD310\uB9E4" || plInfo.brand === "\uACF5\uB3D9\uAD6C\uB9E4")) {
        brandLabel = plInfo.brand;
      }
      return [
        yearMonth, dateText,
        channelKor[r.channel] || r.channel,
        r.category, brandLabel,
        r.lineup, r.product, r.quantity, 1, r.revenue, r.revenue,
      ];
    });

    if (salesSheetRows.length > 0) {
      try {
        const SALES_SHEET_ID = 405001148;
        const rowCount = salesSheetRows.length;

        // Delete existing rows for the same date
        const existingRes = await sheets.spreadsheets.values.get({
          spreadsheetId: STATS_SHEET_ID,
          range: "Sales!B:B",
        });
        const existingVals = existingRes.data.values || [];
        const uploadDate = new Date(rows[0].date + "T00:00:00");
        const targetDateText = `${uploadDate.getMonth() + 1}\uC6D4 ${uploadDate.getDate()}\uC77C`;

        const deleteRequests: any[] = [];
        for (let ri = existingVals.length - 1; ri >= 2; ri--) {
          const cellVal = String(existingVals[ri]?.[0] || "");
          if (cellVal.includes(targetDateText)) {
            deleteRequests.push({
              deleteDimension: {
                range: {
                  sheetId: SALES_SHEET_ID,
                  dimension: "ROWS",
                  startIndex: ri,
                  endIndex: ri + 1,
                },
              },
            });
          }
        }

        if (deleteRequests.length > 0) {
          for (let di = 0; di < deleteRequests.length; di += 100) {
            const chunk = deleteRequests.slice(di, di + 100);
            await sheets.spreadsheets.batchUpdate({
              spreadsheetId: STATS_SHEET_ID,
              requestBody: { requests: chunk },
            });
          }
        }

        // Insert new rows at row 3
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: STATS_SHEET_ID,
          requestBody: {
            requests: [{
              insertDimension: {
                range: {
                  sheetId: SALES_SHEET_ID,
                  dimension: "ROWS",
                  startIndex: 2,
                  endIndex: 2 + rowCount,
                },
                inheritFromBefore: false,
              },
            }],
          },
        });

        // Write data
        await sheets.spreadsheets.values.update({
          spreadsheetId: STATS_SHEET_ID,
          range: `Sales!A3:K${2 + rowCount}`,
          valueInputOption: "RAW",
          requestBody: { values: salesSheetRows },
        });

        // Format
        const formatRequests: any[] = [];

        // Dropdown: C column (판매처)
        formatRequests.push({
          setDataValidation: {
            range: { sheetId: SALES_SHEET_ID, startRowIndex: 2, endRowIndex: 2 + rowCount, startColumnIndex: 2, endColumnIndex: 3 },
            rule: {
              condition: { type: "ONE_OF_LIST", values: [
                { userEnteredValue: "\uC2A4\uB9C8\uD2B8\uC2A4\uD1A0\uC5B4" },
                { userEnteredValue: "\uCE74\uD398\u0032\u0034" },
                { userEnteredValue: "\uCFE0\uD321" },
                { userEnteredValue: "\uD53C\uD53C" },
                { userEnteredValue: "\uC5D0\uC774\uBE14\uB9AC" },
                { userEnteredValue: "\uD3AB\uD504\uB80C\uC988" },
              ]},
              strict: true, showCustomUi: true,
            },
          },
        });

        // Dropdown: D column (카테고리)
        formatRequests.push({
          setDataValidation: {
            range: { sheetId: SALES_SHEET_ID, startRowIndex: 2, endRowIndex: 2 + rowCount, startColumnIndex: 3, endColumnIndex: 4 },
            rule: {
              condition: { type: "ONE_OF_RANGE", values: [{ userEnteredValue: "='\uC0C1\uD488 \uBAA9\uB85D'!$B$4:$B" }] },
              strict: true, showCustomUi: true,
            },
          },
        });

        // Dropdown: E column (브랜드명)
        formatRequests.push({
          setDataValidation: {
            range: { sheetId: SALES_SHEET_ID, startRowIndex: 2, endRowIndex: 2 + rowCount, startColumnIndex: 4, endColumnIndex: 5 },
            rule: {
              condition: { type: "ONE_OF_RANGE", values: [{ userEnteredValue: "='\uC0C1\uD488 \uBAA9\uB85D'!$C$4:$C" }] },
              strict: true, showCustomUi: true,
            },
          },
        });

        // Dropdown: F column (라인업)
        formatRequests.push({
          setDataValidation: {
            range: { sheetId: SALES_SHEET_ID, startRowIndex: 2, endRowIndex: 2 + rowCount, startColumnIndex: 5, endColumnIndex: 6 },
            rule: {
              condition: { type: "ONE_OF_RANGE", values: [{ userEnteredValue: "='\uC0C1\uD488 \uBAA9\uB85D'!$D$4:$D" }] },
              strict: true, showCustomUi: true,
            },
          },
        });

        // Format: center align, Arial
        formatRequests.push({
          repeatCell: {
            range: { sheetId: SALES_SHEET_ID, startRowIndex: 2, endRowIndex: 2 + rowCount, startColumnIndex: 0, endColumnIndex: 11 },
            cell: {
              userEnteredFormat: {
                horizontalAlignment: "CENTER",
                verticalAlignment: "BOTTOM",
                textFormat: { fontFamily: "Arial" },
              },
            },
            fields: "userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat.fontFamily)",
          },
        });

        // Number format for J,K columns
        formatRequests.push({
          repeatCell: {
            range: { sheetId: SALES_SHEET_ID, startRowIndex: 2, endRowIndex: 2 + rowCount, startColumnIndex: 9, endColumnIndex: 11 },
            cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "#,##0" } } },
            fields: "userEnteredFormat.numberFormat",
          },
        });

        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: STATS_SHEET_ID,
          requestBody: { requests: formatRequests },
        });

        dbResults.sheetAppended = salesSheetRows.length;
        dbResults.sheetDeletedDuplicates = deleteRequests.length;
      } catch (e) {
        dbResults.sheetError = String(e);
      }
    }

    const brandSummary: Record<string, { count: number; revenue: number }> = {};
    for (const r of rows) {
      if (!brandSummary[r.brand]) brandSummary[r.brand] = { count: 0, revenue: 0 };
      brandSummary[r.brand].count += r.quantity;
      brandSummary[r.brand].revenue += r.revenue;
    }

    // 업로드 직후 통계시트 즉시 반영 (best-effort, 비차단)
    const allDates = [...new Set(rows.map(r => r.date))].sort();
    const sheetSyncTriggered = allDates.length > 0 ? await triggerSheetSync(allDates[0], allDates[allDates.length - 1]) : false;

    return NextResponse.json({
      ok: true,
      parsed: rows.length,
      skipped,
      dateFiltered,
      fileDate: fileDate || null,
      productSales: productSalesRows.length,
      dailySales: dailySalesRows.length,
      sheetAppended: dbResults.sheetAppended || 0,
      brandSummary,
      sheetSyncTriggered,
      dates: rows.length > 0 ? { from: rows[0].date, to: rows[rows.length - 1].date } : null,
      ...dbResults,
    });
  } catch (error) {
    console.error("Upload sales error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
