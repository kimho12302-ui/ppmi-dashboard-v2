import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

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
  "PPMI_?�사�?카페24)": "cafe24",
  "PPMI_?�마?�스?�어": "smartstore",
  "YS_?�마?�스?�어": "smartstore",
  "PPMI_쿠팡": "coupang",
  "PPMI_쿠팡 로켓그로??: "coupang",
};

// Brand detection: YSIET* = balancelab, rest from product list
function detectBrand(productCode: string, productListMap: Map<string, any>): string {
  if (productCode.toUpperCase().startsWith("YSIET")) return "balancelab";
  const info = productListMap.get(productCode);
  if (!info) return "unknown";
  const brandName = (info.brand || "").trim();
  const BRAND_MAP: Record<string, string> = {
    "?�티": "nutty", "?�이?�펫": "ironpet", "?��???: "saip",
    "?�터?�이": "saip", "고네?�티�?: "saip", "?�라카니??: "saip",
    "공동구매": "balancelab",
  };
  return BRAND_MAP[brandName] || "saip";
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });

    // User-provided date (from batch upload or form)
    const userDate = formData.get("date") as string | null;

    // Read Excel
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: "array", cellDates: true });

    // Find ?�매?�리 sheet
    // Extract date from filename: ?�매?�력_260319 ??2026-03-19
    let fileDate = userDate || "";
    if (!fileDate) {
      const fnMatch = file.name.match(/(\d{6})/);
      if (fnMatch) {
        const digits = fnMatch[1]; // e.g. "260319"
        const yy = parseInt(digits.slice(0, 2), 10);
        const mm = digits.slice(2, 4);
        const dd = digits.slice(4, 6);
        const year = yy >= 70 ? 1900 + yy : 2000 + yy;
        fileDate = `${year}-${mm}-${dd}`;
      }
    }

    const sheetName = wb.SheetNames.find(n => n.includes("?�매?�리"));
    if (!sheetName) {
      return NextResponse.json({ error: "?�매?�리 ??�� 찾을 ???�습?�다" }, { status: 400 });
    }
    const ws = wb.Sheets[sheetName];

    // Read range X2:AP (cols 24-42, 0-indexed: 23-41)
    // Row 2 = headers (index 1), Row 3+ = data
    const allData = XLSX.utils.sheet_to_json(ws, { header: 1, range: 1 }) as any[][];
    
    // Headers at row index 0 (which is row 2 in sheet)
    const headers = allData[0] || [];
    
    // Column indices (X=23, Y=24, ..., AG=32, ..., AP=41 in 0-based)
    // But sheet_to_json with range:1 starts from row 2, and columns from A
    // We need to map by header names
    const colMap: Record<string, number> = {};
    headers.forEach((h: any, i: number) => {
      if (h) colMap[String(h).trim()] = i;
    });

    const dateCol = colMap["?�자"] ?? -1;
    const paymentDateCol = colMap["결제??] ?? -1; // F?? 결제??(?�짜 ?�터링용)
    const clientCol = colMap["거래처명"] ?? -1;
    const warehouseCol = colMap["출하창고"] ?? -1;
    const productCodeCol = colMap["?�목코드"] ?? -1;
    const productNameCol = colMap["?�목�?] ?? -1;
    const qtyCol = colMap["?�량"] ?? -1;
    const unitPriceCol = colMap["?��?"] ?? -1;
    const supplyCol = colMap["공급가??] ?? -1;
    const taxCol = colMap["부가??] ?? -1;

    if (dateCol < 0 || productCodeCol < 0) {
      return NextResponse.json({ 
        error: `?�수 컬럼 ?�락: ?�자(${dateCol}), ?�목코드(${productCodeCol}). ?�더: ${headers.slice(0, 20).join(", ")}`,
      }, { status: 400 });
    }

    // Fetch product list from stats sheet
    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });
    const plRes = await sheets.spreadsheets.values.get({
      spreadsheetId: STATS_SHEET_ID,
      range: "?�품 목록!A3:E200",
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

    // Parse data rows
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
    const unmatchedCodes = new Map<string, { name: string; count: number }>();

    for (let i = 1; i < allData.length; i++) {
      const row = allData[i];
      if (!row || !row[dateCol]) continue;

      // Parse date
      let dateVal = row[dateCol];
      let dateStr = "";
      if (dateVal instanceof Date) {
        dateStr = dateVal.toISOString().slice(0, 10);
      } else {
        dateStr = String(dateVal).slice(0, 10);
      }
      if (!dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) { skipped++; continue; }

      // Date filtering: use ?�자(X??dateStr) instead of 결제??      // 결제?��? 쿠팡(00:00:00) ??비정??값이 ?�어 ?�터 부?�합
      // ?�자 기�??�로 fileDate?� 비교
      if (fileDate && dateStr !== fileDate) {
        dateFiltered++;
        continue; // Skip rows where ?�자 doesn't match filename date
      }

      const productCode = String(row[productCodeCol] || "").trim();
      if (!productCode) { skipped++; continue; }

      const client = clientCol >= 0 ? String(row[clientCol] || "").trim() : "";
      let channel = CHANNEL_MAP[client] || "other";
      const qty = Number(row[qtyCol] || 0);
      const unitPrice = Number(row[unitPriceCol] || 0);
      const supply = supplyCol >= 0 ? Number(row[supplyCol] || 0) : 0;
      const tax = taxCol >= 0 ? Number(row[taxCol] || 0) : 0;

      const brand = detectBrand(productCode, productListMap);
      const plInfo = productListMap.get(productCode) || {};

      // 밸런?�랩 공동구매: channel = 공구_?�?�명 (?�품목록 D??
      if (brand === "balancelab" && plInfo.brand === "공동구매") {
        const seller = plInfo.lineup || "기�?";
        channel = `공구_${seller}`;
      }

      // Track unmatched product codes
      if (!productListMap.has(productCode)) {
        const prodName = productNameCol >= 0 ? String(row[productNameCol] || "").trim() : productCode;
        const existing = unmatchedCodes.get(productCode);
        if (existing) { existing.count++; }
        else { unmatchedCodes.set(productCode, { name: prodName, count: 1 }); }
      }

      // Revenue = 공급가??AM?? + 부가??AN??
      const revenue = supply + tax;

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

    // Block upload if unmatched product codes exist
    if (unmatchedCodes.size > 0) {
      const unmatchedList = Array.from(unmatchedCodes.entries()).map(([code, info]) => ({
        code, name: info.name, count: info.count,
      }));
      return NextResponse.json({
        error: "미등�??�목코드가 ?�습?�다. ?�품 목록 ??�� 먼�? ?�록?�주?�요.",
        unmatchedProducts: unmatchedList,
        totalUnmatched: unmatchedList.length,
        totalRows: rows.length,
      }, { status: 400 });
    }

    // Aggregate for product_sales (by date + channel + product + lineup)
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

    // Aggregate for daily_sales (by date + brand + channel)
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

    // Upsert to Supabase
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    let dbResults: Record<string, any> = {};

    // product_sales
    for (let i = 0; i < productSalesRows.length; i += 500) {
      const chunk = productSalesRows.slice(i, i + 500);
      const { error } = await supabase.from("product_sales").upsert(chunk, { onConflict: "date,brand,product,channel" });
      if (error) dbResults.productSalesError = error.message;
    }

    // daily_sales
    for (let i = 0; i < dailySalesRows.length; i += 500) {
      const chunk = dailySalesRows.slice(i, i + 500);
      const { error } = await supabase.from("daily_sales").upsert(chunk, { onConflict: "date,brand,channel" });
      if (error) dbResults.dailySalesError = error.message;
    }

    // Write to Stats sheet Sales tab
    const DAY_NAMES = ["??, "??, "??, "??, "�?, "�?, "??];
    const salesSheetRows = rows.map(r => {
      const d = new Date(r.date + "T00:00:00");
      const month = d.getMonth() + 1;
      const day = d.getDate();
      const dayName = DAY_NAMES[d.getDay()];
      // A?? 26?????�식, B?? 3??21??(?? ?�식
      const yearMonth = `${String(d.getFullYear()).slice(2)}??{month}??;
      const dateText = `${month}??${day}??(${dayName})`;

      const plInfo = productListMap.get(r.productCode) || {};
      const brandKor: Record<string, string> = {
        "nutty": "?�티", "ironpet": "?�이?�펫", "saip": plInfo.brand || "?�입", "balancelab": "밸런?�랩",
      };
      const channelKor: Record<string, string> = {
        "cafe24": "카페24", "smartstore": "?�마?�스?�어", "coupang": "쿠팡", "pp": "?�피", "ably": "?�이블리", "petfriends": "?�프?�즈",
      };
      // 밸런?�랩: ?�품목록 C??brand)??"?�체?�매"/"공동구매" ??E?�에 그�?�??�용
      let brandLabel = brandKor[r.brand] || plInfo.brand || r.brand;
      if (r.brand === "balancelab" && (plInfo.brand === "?�체?�매" || plInfo.brand === "공동구매")) {
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

        // 1) Row 3부??�????�입
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: STATS_SHEET_ID,
          requestBody: {
            requests: [{
              insertDimension: {
                range: {
                  sheetId: SALES_SHEET_ID,
                  dimension: "ROWS",
                  startIndex: 2, // 0-indexed: row 3
                  endIndex: 2 + rowCount,
                },
                inheritFromBefore: false,
              },
            }],
          },
        });

        // 2) ?�이???�기
        await sheets.spreadsheets.values.update({
          spreadsheetId: STATS_SHEET_ID,
          range: `Sales!A3:K${2 + rowCount}`,
          valueInputOption: "RAW",
          requestBody: { values: salesSheetRows },
        });

        // 3) ?�식 + ?�롭?�운 ?�용
        const formatRequests: any[] = [];

        // ?�롭?�운: C???�매�? = ONE_OF_LIST
        formatRequests.push({
          setDataValidation: {
            range: { sheetId: SALES_SHEET_ID, startRowIndex: 2, endRowIndex: 2 + rowCount, startColumnIndex: 2, endColumnIndex: 3 },
            rule: {
              condition: { type: "ONE_OF_LIST", values: [
                { userEnteredValue: "?�마?�스?�어" }, { userEnteredValue: "카페24" },
                { userEnteredValue: "쿠팡" }, { userEnteredValue: "?�피" },
                { userEnteredValue: "?�이블리" }, { userEnteredValue: "?�프?�즈" },
              ]},
              strict: true, showCustomUi: true,
            },
          },
        });

        // ?�롭?�운: D??카테고리) = ?�품 목록 B??        formatRequests.push({
          setDataValidation: {
            range: { sheetId: SALES_SHEET_ID, startRowIndex: 2, endRowIndex: 2 + rowCount, startColumnIndex: 3, endColumnIndex: 4 },
            rule: {
              condition: { type: "ONE_OF_RANGE", values: [{ userEnteredValue: "='?�품 목록'!$B$4:$B" }] },
              strict: true, showCustomUi: true,
            },
          },
        });

        // ?�롭?�운: E??브랜?�명) = ?�품 목록 C??        formatRequests.push({
          setDataValidation: {
            range: { sheetId: SALES_SHEET_ID, startRowIndex: 2, endRowIndex: 2 + rowCount, startColumnIndex: 4, endColumnIndex: 5 },
            rule: {
              condition: { type: "ONE_OF_RANGE", values: [{ userEnteredValue: "='?�품 목록'!$C$4:$C" }] },
              strict: true, showCustomUi: true,
            },
          },
        });

        // ?�롭?�운: F???�인?? = ?�품 목록 D??        formatRequests.push({
          setDataValidation: {
            range: { sheetId: SALES_SHEET_ID, startRowIndex: 2, endRowIndex: 2 + rowCount, startColumnIndex: 5, endColumnIndex: 6 },
            rule: {
              condition: { type: "ONE_OF_RANGE", values: [{ userEnteredValue: "='?�품 목록'!$D$4:$D" }] },
              strict: true, showCustomUi: true,
            },
          },
        });

        // ?�식: ?�체 ????Arial, 가?�데 ?�렬
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

        // A???�짜 ?�맷: yy"??m"??
        formatRequests.push({
          repeatCell: {
            range: { sheetId: SALES_SHEET_ID, startRowIndex: 2, endRowIndex: 2 + rowCount, startColumnIndex: 0, endColumnIndex: 1 },
            cell: { userEnteredFormat: { numberFormat: { type: "DATE", pattern: "yy\"??"m\"??"" } } },
            fields: "userEnteredFormat.numberFormat",
          },
        });

        // B???�짜 ?�맷: mmmm" "d"??("ddd")"
        formatRequests.push({
          repeatCell: {
            range: { sheetId: SALES_SHEET_ID, startRowIndex: 2, endRowIndex: 2 + rowCount, startColumnIndex: 1, endColumnIndex: 2 },
            cell: { userEnteredFormat: { numberFormat: { type: "DATE", pattern: "m\"??\"d\"??(\"ddd\")\"" } } },
            fields: "userEnteredFormat.numberFormat",
          },
        });

        // J,K???�자 ?�맷: #,##0
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
      } catch (e) {
        dbResults.sheetError = String(e);
      }
    }

    // Summary by brand
    const brandSummary: Record<string, { count: number; revenue: number }> = {};
    for (const r of rows) {
      if (!brandSummary[r.brand]) brandSummary[r.brand] = { count: 0, revenue: 0 };
      brandSummary[r.brand].count += r.quantity;
      brandSummary[r.brand].revenue += r.revenue;
    }

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
      dates: rows.length > 0 ? { from: rows[0].date, to: rows[rows.length - 1].date } : null,
      ...dbResults,
    });
  } catch (error) {
    console.error("Upload sales error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

