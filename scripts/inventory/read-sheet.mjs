// 시트 「2026 재고·출고 통합관리」 탭별 값을 json 으로 받는다 (2026-11-10). 원가 시드(build-sql.mjs --sheet)와 판정 대조(status-report.mjs)의 입력.
//   node scripts/inventory/read-sheet.mjs <출력 json>
// .env.local 의 GOOGLE_SA_KEY(서비스 계정, 읽기 전용 범위)를 쓴다. 값을 찍지 않는다. 출력 파일은 회사 원가가 들어 있으니 리포에 넣지 않는다.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../package.json', import.meta.url));
const { google } = require('googleapis');
const env = Object.fromEntries(fs.readFileSync(new URL('../../.env.local', import.meta.url),'utf8').split(/\r?\n/).filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');let v=l.slice(i+1);if(v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1);return [l.slice(0,i),v]}));
let key = env.GOOGLE_SA_KEY; try { key = JSON.parse(key); } catch { key = JSON.parse(key.replace(/\n/g,'\n')); }
if (typeof key === 'string') key = JSON.parse(key);
const auth = new google.auth.GoogleAuth({ credentials: key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
const sheets = google.sheets({ version: 'v4', auth });
const id = '1qkPQjS-M2hz6PsWJms0Q9NMNtk6yDF8QFN6D5dFL5m0';
const meta = await sheets.spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties.title' });
const titles = meta.data.sheets.map(s=>s.properties.title);
console.log(titles.join(' | '));
const out = {};
for (const t of titles) { const r = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `'${t}'!A1:AZ200` }); out[t] = r.data.values || []; }
fs.writeFileSync(process.argv[2], JSON.stringify(out));
console.log('ok');
