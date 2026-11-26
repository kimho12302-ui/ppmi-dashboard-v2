// /api/upload-sales(src/app/api/upload-sales/route.ts) 의 「판매정리」 읽기 부분만 옮긴 사본 (2026-11-26).
// 자동 판매입력 엑셀(src/lib/sales-entry-core.ts)이 그 라우트에 그대로 올라가는지 시험하려고 둔다.
// 원장 라우트는 건드리지 않으려고 로직을 복사했다. 라우트를 고치면 여기도 맞출 것(어긋나면 시험이 거짓 통과한다).
//   route.ts 137행 XLSX.read(cellDates: true) · 139~150행 파일명 6자리 → 날짜 · 152행 「판매정리」 시트 찾기
//   158행 sheet_to_json(header: 1) · 160~170행 위 6행에서 일자/날짜/결제일 + 품목코드/상품코드 머리글 행 찾기
//   172~175행 colMap(같은 이름이면 뒤 칸) · 179~200행 칸 고르기 · 281~299행 줄 읽기(날짜 필터·품목코드 필수)
//   310~313행 수량·단가·공급가액·부가세 (줄 번호는 2026-11-26 master cd40005 기준)
// 자식 프로세스로 돌리면(node upload-sales-parse.mjs <xlsx> <파일명>) 결과를 JSON 한 줄로 찍는다.
// 시험은 자식을 TZ=UTC 로 띄운다(Vercel 서버와 같은 조건, cellDates 의 toISOString 함정 때문).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

export function parseLikeUploadSales(buffer, fileName) {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  let fileDate = "";
  const fnMatch = fileName.match(/(\d{6})/);
  if (fnMatch) {
    const d = fnMatch[1];
    const yy = parseInt(d.slice(0, 2), 10);
    fileDate = `${yy >= 70 ? 1900 + yy : 2000 + yy}-${d.slice(2, 4)}-${d.slice(4, 6)}`;
  }
  const sheetName = wb.SheetNames.find((n) => n.includes("판매정리"));
  if (!sheetName) return { error: "판매정리 시트를 찾을 수 없습니다" };
  const allData = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1 });
  let headerRowIdx = 0;
  for (let r = 0; r < Math.min(6, allData.length); r++) {
    const row = allData[r];
    if (!row) continue;
    const cells = row.map((c) => String(c ?? "").trim());
    const hasDate = cells.some((c) => c === "일자" || c === "날짜" || c === "결제일");
    const hasCode = cells.some((c) => c === "품목코드" || c === "상품코드");
    if (hasDate && hasCode) { headerRowIdx = r; break; }
  }
  const headers = allData[headerRowIdx] || [];
  const colMap = {};
  headers.forEach((h, i) => { if (h) colMap[String(h).trim()] = i; });
  const dateCol = colMap["일자"] ?? colMap["날짜"] ?? colMap["결제일"] ?? -1;
  const clientCol = colMap["거래처명"] ?? colMap["판매몰"] ?? -1;
  const productCodeCol = colMap["품목코드"] ?? colMap["상품코드"] ?? -1;
  const qtyCol = colMap["수량"] ?? -1;
  const unitPriceCol = colMap["단가"] ?? colMap["상품가"] ?? -1;
  const supplyCol = colMap["공급가액"] ?? -1;
  const taxCol = colMap["부가세"] ?? -1;
  if (dateCol < 0 || productCodeCol < 0) return { error: "필수 컬럼 누락" };

  const rows = [];
  let skipped = 0;
  let dateFiltered = 0;
  for (let i = headerRowIdx + 1; i < allData.length; i++) {
    const row = allData[i];
    if (!row || !row[dateCol]) continue;
    const dateVal = row[dateCol];
    const dateStr = dateVal instanceof Date ? dateVal.toISOString().slice(0, 10) : String(dateVal).slice(0, 10);
    if (!dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) { skipped++; continue; }
    if (fileDate && dateStr !== fileDate) { dateFiltered++; continue; }
    const productCode = String(row[productCodeCol] || "").trim();
    if (!productCode) { skipped++; continue; }
    rows.push({
      date: dateStr,
      client: clientCol >= 0 ? String(row[clientCol] || "").trim() : "",
      productCode,
      qty: Number(row[qtyCol] || 0),
      unitPrice: Number(row[unitPriceCol] || 0),
      supply: supplyCol >= 0 ? Number(row[supplyCol] || 0) : 0,
      tax: taxCol >= 0 ? Number(row[taxCol] || 0) : 0,
    });
  }
  return { fileDate, headerRowIdx, cols: { dateCol, clientCol, productCodeCol, qtyCol, supplyCol, taxCol }, rows, skipped, dateFiltered };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [, , path, fileName] = process.argv;
  const res = parseLikeUploadSales(readFileSync(path), fileName);
  process.stdout.write(JSON.stringify({ tzOffset: new Date(2026, 10, 25).getTimezoneOffset(), ...res }));
}
