# PPMI Dashboard QA 체크리스트

> 수정 후 또는 배포 전 반드시 이 시트를 기준으로 검증

---

## 실행 방법

```bash
# API 응답 검증 (로컬 서버 실행 중일 때)
curl -s "http://localhost:3000/api/dashboard?from=2026-04-01&to=2026-04-01&brand=all" -o C:/Temp/dash.json
curl -s "http://localhost:3000/api/data-status" -o C:/Temp/status.json
curl -s "http://localhost:3000/api/monthly-summary?year=2026&brand=all" -o C:/Temp/monthly.json
```

---

## 체크리스트

### 1. 세일즈 페이지 (`/sales`)

| # | 항목 | 검증 방법 | 기준 | 상태 |
|---|------|-----------|------|------|
| 1-1 | KPI 매출 — 공구 포함 | `kpi.revenue` in dashboard API | daily_sales + gongguSalesTotal | ✅ |
| 1-2 | gongguSalesTotal 존재 | `j.gongguSalesTotal > 0` (공구 기간 내) | 0보다 커야 함 | ✅ |
| 1-3 | brandRevenueTrend 공구 반영 | `brandRevenueTrend`에 밸런스랩 값 > 0 (공구일) | 공구매출 포함된 금액 | ✅ |
| 1-4 | 브랜드별 누적 막대그래프 | UI 확인 | 누적(stacked) BarChart, Legend 표시 | ✅ |
| 1-5 | 브랜드 필터 전환 | nutty / ironpet / saip / balancelab 개별 선택 | 해당 브랜드 KPI만 표시 | - |

**검증 쿼리 (4월 1일 기준)**
```js
// 기대값: kpi.revenue ≈ 9,628,490 / gongguSalesTotal = 8,773,000
// brandRevenueTrend[0].밸런스랩 = 8,773,000
```

---

### 2. 월별 요약 페이지 (`/monthly`)

| # | 항목 | 검증 방법 | 기준 | 상태 |
|---|------|-----------|------|------|
| 2-1 | 한글 정상 표시 | UI 확인 (테이블 헤더, 카드 라벨) | 월/매출/전월비/주문/AOV 등 한글 | ✅ |
| 2-2 | YTD 카드 표시 | `ytd.revenue > 0` | 0보다 커야 함 | ✅ |
| 2-3 | 월별 매출 데이터 | `summary` 배열 길이 > 0 | 해당 연도 월 수 | ✅ |
| 2-4 | 이익률 & ROAS 차트 | UI 확인 | 꺾은선 차트, 이중 Y축 | - |
| 2-5 | 연도 전환 (2025/2026) | UI 확인 | 선택 연도 데이터 로드 | - |
| 2-6 | 브랜드 필터 (월별 내) | UI 확인 | 전체/브랜드별 전환 | - |

---

### 3. 데이터 현황 (`/settings` > 데이터 현황 탭)

| # | 소스 | 검증 방법 | 정상 기준 | 이슈 이력 |
|---|------|-----------|-----------|-----------|
| 3-1 | Meta 광고비 | `latestDate` 비교 | 전일 이내 | - |
| 3-2 | Google Ads | `latestDate` 비교 | 전일 이내 | - |
| 3-3 | GA4 (카페24 세션) | `latestDate` 비교 | 전일 이내 | ga4_% 채널 삭제 후 cafe24 퍼널로 전환 |
| 3-4 | 네이버 검색광고 | `latestDate` 비교 | 전일 이내 | - |
| 3-5 | 네이버 쇼핑광고 | `latestDate` 비교 | 전일 이내 | - |
| 3-6 | 쿠팡 광고비 | `latestDate` 비교 | 전일 이내 (수동) | - |
| 3-7 | GFA 광고비 | `latestDate` 비교 | 전일 이내 (수동) | - |
| 3-8 | 판매실적 | `latestDate` 비교 | 전일 이내 (수동) | - |
| 3-9 | 쿠팡 퍼널 | `latestDate` 비교 | 전일 이내 (수동) | - |
| 3-10 | 스마트스토어 (아이언펫) | `latestDate != null` | null 아니어야 함 | brand="all"로 쿼리해야 함 (ironpet X) |
| 3-11 | 스마트스토어 (밸런스랩) | `latestDate` 비교 | 전일 이내 (수동) | - |
| 3-12 | 카페24 퍼널 | `latestDate` 비교 | 전일 이내 (수동) | - |

**⚠️ 전체 ⚠️ 상태는 정상**: 수동 업로드 소스는 수동으로 데이터 넣기 전까지 stale. 자동 소스(Meta/Google/네이버)는 스케줄러 정상 여부 확인.

---

### 4. 인사이트 페이지 (`/insights`)

| # | 항목 | 기준 | 상태 |
|---|------|------|------|
| 4-1 | 한글 정상 표시 | 즉시 대응 / 주의 / 기회 / 참고 배지 한글 | ✅ |
| 4-2 | 인사이트 카드 | 기간 내 이상치 있으면 카드 표시 | - |
| 4-3 | 특이사항 없음 | 이상치 없는 기간 선택 시 "특이사항 없음" 표시 | - |

---

### 5. 콘텐츠/SNS 페이지 (`/content`)

| # | 항목 | 기준 | 상태 |
|---|------|------|------|
| 5-1 | 한글 정상 표시 | 총 게시물/총 노출/클릭/팔로워 등 한글 | ✅ |
| 5-2 | 콘텐츠 없을 때 | "선택한 기간에 콘텐츠 데이터가 없습니다." | - |

---

## 알려진 이슈 & 해결 이력

| 날짜 | 이슈 | 원인 | 해결 |
|------|------|------|------|
| 2026-04-06 | 세일즈 공구 매출 누락 | `calcSalesKpi`가 daily_sales만 합산 | `gongguSalesTotal` 별도 합산 |
| 2026-04-06 | 브랜드 트렌드 공구 미반영 | `dailyTrend`를 daily_sales로만 계산 | API의 `brandRevenueTrend` 사용 |
| 2026-04-06 | monthly/content/insights 외계어 | JSX 텍스트 노드의 `\uXXXX` 리터럴 렌더링 | 실제 한글 문자로 교체 |
| 2026-04-06 | 스마트스토어(아이언펫) null | data-status에서 `brand="ironpet"` 쿼리 | `brand="all"`로 수정 (daily_funnel 저장 방식) |
| 2026-04-06 | GA4 data-status 오류 | ga4_% 채널 삭제 후 쿼리 실패 | cafe24 퍼널로 대체 |
