/* eslint-disable @typescript-eslint/no-explicit-any, prefer-const */
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
  "PPMI_자사몰(카페24)": "cafe24",
  "PPMI_스마트스토어": "smartstore",
  "YS_스마트스토어": "smartstore",
  "PPMI_쿠팡": "coupang",
  "PPMI_쿠팡 로켓그로스": "coupang",
};

// Brand detection: YSIET* = balancelab, rest from product list
function detectBrand(productCode: string, productListMap: Map<string, any>): string {
  if (productCode.toUpperCase().startsWith("YSIET")) return "balancelab";
  const info = productListMap.get(productCode);
  if (!info) return "unknown";
  const brandName = (info.brand || "").trim();
  const BRAND_MAP: Record<string, string> = {
    "\uB108\uD2F0": "nutty",
    "\uC544\uC774\uC5B8\uD3AB": "ironpet",
    "\uC0AC\uC785": "saip",
    "\uB2E5\uD130\uB808\uC774": "saip",
    "\uACE0\uB124\uC774\uD2F0\uBE0C": "saip",
    "\uD30C\uB77C\uCE74\uB2C8": "saip",
    "\uACF5\uB3D9\uAD6C\uB9E4": "balancelab",
  };
  return BRAND_MAP[brandName] || "saip";
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

    const allData = XLSX.utils.sheet_to_json(ws, { header: 1, range: 1 }) as any[][];
    const headers = allData[0] || [];

    const colMap: Record<string, number> = {};
    headers.forEach((h: any, i: number) => {
      if (h) colMap[String(h).trim()] = i;
    });

    const dateCol = colMap["\uB0A0\uC790"] ?? -1;
    const clientCol = colMap["\uAC70\uB798\uCC98\uBA85"] ?? -1;
    const productCodeCol = colMap["\uD488\uBAA9\uCF54\uB4DC"] ?? -1;
    const productNameCol = colMap["\uD488\uBAA9\uBA85"] ?? -1;
    const qtyCol = colMap["\uC218\uB7C9"] ?? -1;
    const unitPriceCol = colMap["\uB2E8\uAC00"] ?? -1;
    const supplyCol = colMap["\uACF5\uAE09\uAC00\uC561"] ?? -1;
    const taxCol = colMap["\uBD80\uAC00\uC138"] ?? -1;

    if (dateCol < 0 || productCodeCol < 0) {
      return NextResponse.json({
        error: `\uD544\uC218 \uCEEC\uB7FC \uB204\uB77D: \uB0A0\uC790(${dateCol}), \uD488\uBAA9\uCF54\uB4DC(${productCodeCol}). \uD5E4\uB354: ${headers.slice(0, 20).join(", ")}`,
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
    const unmatchedCodes = new Map<string, { name: string; count: number }>();

    for (let i = 1; i < allData.length; i++) {
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
      let channel = CHANNEL_MAP[client] || "other";
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
        const prodName = productNameCol >= 0 ? String(row[productNameCol] || "").trim() : productCode;
        const existing = unmatchedCodes.get(productCode);
        if (existing) { existing.count++; }
        else { unmatchedCodes.set(productCode, { name: prodName, count: 1 }); }
      }

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

    if (unmatchedCodes.size > 0) {
      const unmatchedList = Array.from(unmatchedCodes.entries()).map(([code, info]) => ({
        code, name: info.name, count: info.count,
      }));
      return NextResponse.json({
        error: "\uBBF8\uB4F1\uB85D \uD488\uBAA9\uCF54\uB4DC\uAC00 \uC788\uC2B5\uB2C8\uB2E4. \uC0C1\uD488 \uBAA9\uB85D \uD0ED\uC5D0 \uBA3C\uC800 \uB4F1\uB85D\uD574\uC8FC\uC138\uC694.",
        unmatchedProducts: unmatchedList,
        totalUnmatched: unmatchedList.length,
        totalRows: rows.length,
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

    // Upsert to Supabase
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    let dbResults: Record<string, any> = {};

    for (let i = 0; i < productSalesRows.length; i += 500) {
      const chunk = productSalesRows.slice(i, i + 500);
      const { error } = await supabase.from("product_sales").upsert(chunk, { onConflict: "date,brand,product,channel" });
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
