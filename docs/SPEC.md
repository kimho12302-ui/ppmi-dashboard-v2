---
type: project
created: 2026-04-03
tags:
  - PPMI
  - 대시보드
  - 마케팅
  - v3
  - 기획서
status: active
---

# PPMI 마케팅 대시보드 v3 기획서

> **입력은 간단하게. 표현은 다양하게. 데이터는 적확하게.**

## Changelog

| 버전 | 날짜 | 커밋 | 변경 내용 |
|------|------|------|----------|
| v0.1 | 2026-04-03 | — | 초안 작성 |
| v0.2 | 2026-04-03 | — | A~E 결정사항 반영, 전환데이터/API 최대활용/시트통합/동적설정/색상 확정 |
| v0.3 | 2026-04-03 | — | 리버스엔지니어링 완전판 반영, 인사이트/설정 상세/인코딩/Data Hub 시트 확정 |
| v0.4 | 2026-04-03 | — | v2 운영 교훈 19개 + 개발 지침 + 에러 처리 원칙 + 데이터 검증 체크리스트 반영 |
| v0.5 | 2026-04-04 | `6f6048c` | P1: 스켈레톤 10페이지, 사이드바, PageShell, URL 상태관리, date-fns 추가 |
| v0.6 | 2026-04-04 | `8e7c5d2` | P2-1: 광고(3탭+KPI+차트+GA4 UTM) + 매출(3탭+KPI+차트+TOP10) 실데이터 연결 |
| v0.7 | 2026-04-04 | `cede2ac` | P2-2: Overview(KPI 8+파이차트) + 퍼널(소스별 필터+바차트) + 키워드(TOP50+플랫폼필터) |
| v0.8 | 2026-04-04 | `0678578` | P3: 월별요약(월/주토글) + 예산현황(브랜드/채널) + Raw Data(5테이블+CSV) + 인사이트(Rule-based) |
| v0.9 | 2026-04-04 | `3163b14` | Overview 풀 리빌드 (KPI 드릴다운+경고+듀얼트렌드+채널광고/매출+퍼널+TOP5) |
| v1.0 | 2026-04-04 | `49acf41` | P4 기획안 작성 (설정 리빌드, 변화율, 목표 달성률, 동적 config) |
| v1.1 | 2026-04-04 | `610f5eb` | P4-2: 전기간 대비 변화율 (Overview+광고+매출 KPI ▲▼) |
| v1.2 | 2026-04-04 | `b6abe90` | P4-1: 설정 리빌드 5탭 + brand_config/channel_config CRUD + monthly_targets |
| v1.3 | 2026-04-04 | `79c54c8` | P4-3: 목표 대비 달성률 (Overview KPI 프로그레스바) |
| v1.4 | 2026-04-04 | `b8299b7` | P4-4: 동적 config (settings API에서 brand/channel config DB 로드) |
| v1.5 | 2026-04-04 | `ea1a45b` | 매출 페이지 공구별 탭 (밸런스랩 자체/공구 분류, 셀러별 테이블) |
| v1.6 | 2026-04-04 | `1b70894` | Overview 밸런스랩 공구 매출 섹션 추가 |
| v1.7 | 2026-04-04 | `bb98b0f` | 퍼널 기획서 6.1~6.3 구현 (가로플로우+채널독립+일별트렌드) |
| v1.8 | 2026-04-04 | `8818c3d` | 광고 5.2~5.4 (ROAS 트렌드+기준선, 전환성과테이블, 채널카드 강화) |
| v1.9 | 2026-04-04 | `4f7ba03` | 매출 4.3 (카테고리별 바차트, 주별/월별 토글) |
| v2.0 | 2026-04-04 | `0c8bc01` | Overview 7.2 누적매출 + 퍼널 6.5 Meta광고퍼널 |
| v2.1 | 2026-04-04 | `cea1874` | P5: use-config 전체 적용 (Overview/광고/매출 DB config) |
| v2.2 | 2026-04-04 | `e524cd3` | P5: use-config 나머지 (예산/월별/인사이트) |
| v2.3 | 2026-04-05 | `2ec4927` | 설정 엑셀 업로드 탭 + 키워드 9.3~9.4 (그룹핑/TOP비교) |
| v2.4 | 2026-04-05 | `f94a92d` | 월별 8.1 차트 (매출vs광고비, ROAS추이, MoM증감) |
| v2.5 | 2026-04-05 | `ae234a8` | 인사이트 14번 4단계분류 + 키워드 9.5 버블그래프 |
| v2.6 | 2026-04-05 | `41ca76b` | 모바일 더보기 메뉴 + UI 반응형 |
| v2.7 | 2026-04-05 | `808cdb3` | Overview 7.3 채널ROAS 바차트 + 모바일 폴리싱 |
| v2.8 | 2026-04-05 | `c2d3c8d` | daily_funnel channel 컬럼 추가, brand/channel 분리, 마이그레이션 완료, coupang_funnel 버그 수정 |
| v2.9 | 2026-04-05 | `10b4d5e` | v2 리버스엔지니어링 기반 P6~P11 전면 재구성 |
| v3.0 | 2026-04-05 | `a266213` | v2 UI+시트+스크립트 심층 분석 10개 누락항목 반영 (UTM, 드릴다운, 사분면, DailyInputGuide 등) |
| v3.1 | 2026-04-05 | `81b4a64` | P6 Dashboard API 전면 리빌드 (brand param, KPI 서버계산, 이상치감지, 공구분석, 이동평균) |
| v3.2 | 2026-04-05 | `13f4928` | P7-1 데이터 누락 알림 배너 + 이상치 감지 배너, 매출 브랜드 누적 차트 |
| v3.3 | 2026-04-05 | `ba73a06` | P8 brand-detail API + P9 Meta creatives/trend/video API |
| v3.4 | 2026-04-05 | `891b942` | P8+P9 프론트 연동 (Overview 브랜드 상세 + 광고 크리에이티브 탭) |
| v3.5 | 2026-04-05 | `092385f` | P10+P11 API 포팅 (content, gsc, naver-campaigns, utm, insights, monthly-summary) |
| v3.6 | 2026-04-06 | — | P10+P11 프론트 연동 (인사이트 API 전환, 콘텐츠/SNS 신규, 월별요약 API 전환) |
| v3.7 | 2026-04-06 | — | P12 데이터 정합성 감사: 12개 이슈 발견, 원인분석 + 해결계획 수립 |

---

## 개발 진행 현황

### ✅ P1 완료 — 스켈레톤 (2026-04-04, `6f6048c`)
- [x] 사이드바 10개 네비 (신규: 월별/예산/Raw Data/인사이트)
- [x] PageShell 공통 래퍼 (제목 + 필터 + Suspense)
- [x] URL 기반 상태관리 (useSearchParams, Context 금지)
- [x] 날짜 프리셋 7종 (어제/7/14/30/이번달/지난달/전체)
- [x] 브랜드 색상 확정 (너티=빨강, 아이언펫=주황, 밸런스랩=파랑, 사입=갈색)
- [x] types.ts 확장 (BrandConfig, ChannelConfig, v3 API 필드)
- [x] DataTable, KpiCard 공통 컴포넌트
- [x] date-fns 의존성 추가

### ✅ P2-1 완료 — 광고+매출 실데이터 (2026-04-04, `8e7c5d2`)
- [x] 광고 분석 3탭: 개요 / 채널별 상세 / GA4 UTM
- [x] 광고 KPI 6개: 총 광고비, ROAS, 클릭, CTR, 전환수, CPA
- [x] GA4 UTM 별도 탭 (중복 광고비 제외 처리)
- [x] 채널별 카드 + 일별 광고비 트렌드 AreaChart
- [x] 채널별 상세 테이블 (광고비/노출/클릭/CTR/CPC/전환/전환매출/ROAS)
- [x] 매출 분석 3탭: 매출 트렌드 / 채널별 / 제품별
- [x] 매출 KPI 3개: 매출, 주문수, 평균 객단가
- [x] 일별 매출 AreaChart + 채널별 수평 BarChart
- [x] TOP 10 제품 테이블 (브랜드 뱃지 포함)

### ✅ P2-2 완료 — 퍼널+Overview+키워드 (2026-04-04)
- [x] Overview: KPI 8개 (매출/광고비/ROAS/주문수/통상이익/이익률/CTR/객단가) + 매출 트렌드 + 브랜드 파이차트
- [x] 퍼널: KPI 4개 + 소스별 필터 (GA4/카페24/스마트스토어/쿠팡) + 바차트 + 비교 테이블
- [x] 키워드: KPI 4개 + 플랫폼 필터 6종 + TOP 50 테이블 + 정렬 옵션

### ✅ P3 완료 — 신규 4페이지 (2026-04-04)
- [x] 월별 요약: 월/주 토글 + 브랜드 필터 + 매출/광고비/ROAS/이익률 테이블
- [x] 예산 현황: 이번 달 KPI 3개 + 브랜드별 진행바 + 채널별 바차트 + 비중 테이블
- [x] Raw Data: 5개 DB 테이블 직접 조회 + 페이지네이션 + CSV 다운로드
- [x] 인사이트: Rule-based (ROAS<1 경고, 광고비 ±50% 변동, 매출 누락일)

### 📋 P4 기획안 — 설정+고도화 (승인 대기)

#### ✅ P4-1. 설정 페이지 리빌드 (완료)
- **일일 입력 탭**: cafe24/smartstore/coupang 퍼널 수기 입력 (브랜드 선택 포함)
- **브랜드 관리 탭**: CRUD (키/라벨/색상/카테고리/순서/활성) + 테이블 뷰
- **채널 관리 탭**: CRUD (키/라벨/색상/타입=광고|매출/자동여부/순서) + 테이블 뷰
- **제품 원가 탭**: 원가 목록 + 미등록 제품 경고
- **목표 설정 탭**: 월×브랜드별 매출/광고비/ROAS 목표 입력 + 테이블 뷰
- DB: `brand_config`, `channel_config`, `monthly_targets` 테이블 생성 완료

#### ✅ P4-2. 전기간 대비 변화율 (완료)
- 모든 KPI 카드에 전기간 대비 ▲/▼ % 표시
- 로직: 선택 기간 N일 → 직전 N일과 비교 (from-1일 기준으로 동일 기간)
- API: dashboard, ads 모두 prevSales/prevAds 추가 리턴
- 적용: Overview (8개), 광고 (6개), 매출 (3개) — 총 17개 KPI 카드

#### ✅ P4-3. 목표 대비 달성률 (완료)
- Overview 매출/광고비/ROAS KPI에 프로그레스바 표시
- `monthly_targets` 테이블 연동 (월×브랜드별 자동 매칭)
- 프로그레스바: 100%↑=초록, 70~100%=파랑, 70%↓=주황
- targets API에 ad_budget_target 필드 추가

#### ✅ P4-4. 동적 브랜드/채널 설정 (완료)
- settings API 기본 GET에 brand_config/channel_config 포함
- `use-config.ts` 훅이 DB에서 fetch → fallback 하드코딩 유지
- 설정 페이지에서 CRUD → 즉시 전 페이지 반영

#### P4 구현 순서
1. DB 테이블 생성 (brand_config, channel_config)
2. 설정 API 확장 (/api/settings에 config CRUD 추가)
3. 설정 페이지 리빌드
4. 전기간 대비 변화율 (dashboard API 확장 + KpiCard 연결)
5. 목표 대비 달성률 (targets API 연결)
6. 동적 config 전 페이지 적용

### ❌ 미해결 이슈

---

#### 이슈 1. daily_funnel channel 컬럼 누락 (우선순위: 높음)

**현상:** daily_funnel 테이블에 channel 컬럼이 없어서, 채널명(cafe24/smartstore/coupang)이 brand 컬럼에 들어감. 프론트에서 브랜드 필터가 퍼널에 적용 안 됨.

**원인:** 테이블 설계 시 channel 컬럼 누락. 다른 테이블(daily_sales, daily_ad_spend, product_sales)은 모두 brand+channel 구조인데 daily_funnel만 brand 단일 키.

**현재 DB 상태 (561행, 2025-07-31 ~ 2026-04-04):**
```
brand별 행수: nutty=248, cafe24=101, coupang=101, smartstore=101, balancelab_smartstore=7, all=3
```
```
date       | brand               | sessions | purchases
2026-04-04 | nutty               | 244      | 0         ← GA4 (brand 자리에 실제로는 채널 의미)
2026-04-01 | smartstore          | 145      | 0         ← 채널명이 brand에
2026-04-01 | coupang             | 293      | 20        ← 채널명이 brand에
2026-04-01 | cafe24              | 0        | 0         ← 채널명이 brand에
2026-03-29 | balancelab_smartstore| 700      | 0         ← 브랜드+채널 합성
```

**brand/channel 매핑 규칙 (확정):**
| 데이터 소스 | brand | channel | 비고 |
|---|---|---|---|
| GA4 (sync_all.py) | all | cafe24 | 자사몰 유입: 세션, 페이지뷰 (밸런스랩 제외) |
| 카페24 수기입력 (settings API) | all | cafe24 | 자사몰 전환: 장바구니, 회원가입, 재구매 |
| 스마트스토어 일반 (settings API) | all | smartstore | 너티/아이언펫/사입 퍼널 |
| 스마트스토어 밸런스랩 (settings API) | balancelab | smartstore | 밸런스랩 전용 |
| 쿠팡 (upload-coupang-funnel API) | all | coupang | 너티 위주 |

> - GA4와 카페24 수기입력은 같은 (date, all, cafe24) 행에 합쳐서 저장
> - cafe24(자사몰) = 밸런스랩 제외. 밸런스랩은 현재 스마트스토어만
> - brand="all"은 특정 브랜드가 아닌 해당 채널 전체를 의미

**데이터 마이그레이션 (기존 561행 → 변환):**
| 현재 brand 값 | → brand | → channel | 행수 |
|---|---|---|---|
| nutty | all | cafe24 | 248 |
| cafe24 | all | cafe24 | 101 (같은 행에 merge) |
| smartstore | all | smartstore | 101 |
| coupang | all | coupang | 101 |
| balancelab_smartstore | balancelab | smartstore | 7 |
| all | all | all | 3 (삭제 또는 유지) |

> nutty + cafe24 행은 같은 (date, all, cafe24)에 merge해야 함.
> nutty 행: sessions, impressions 값 있음 (GA4 유입 지표)
> cafe24 행: cart_adds, signups, repurchases 값 있음 (전환 지표)
> → 하나의 행으로 합침

**수정 범위 (파일별 상세):**

**Step 1. DB 스키마 변경** (Supabase 대시보드, service_role key 필요)
```sql
-- 1) channel 컬럼 추가
ALTER TABLE daily_funnel ADD COLUMN channel TEXT NOT NULL DEFAULT 'cafe24';

-- 2) 기존 데이터 마이그레이션
UPDATE daily_funnel SET channel = 'cafe24', brand = 'all' WHERE brand = 'nutty';
UPDATE daily_funnel SET channel = 'cafe24' WHERE brand = 'cafe24';
-- cafe24 + 기존 nutty 행 merge (같은 date에 대해)
-- → 별도 마이그레이션 스크립트 필요

UPDATE daily_funnel SET channel = 'smartstore', brand = 'all' WHERE brand = 'smartstore';
UPDATE daily_funnel SET channel = 'smartstore', brand = 'balancelab' WHERE brand = 'balancelab_smartstore';
UPDATE daily_funnel SET channel = 'coupang', brand = 'all' WHERE brand = 'coupang';
UPDATE daily_funnel SET channel = 'all' WHERE brand = 'all';

-- 3) 기존 unique constraint 삭제 + 새 constraint
ALTER TABLE daily_funnel DROP CONSTRAINT IF EXISTS daily_funnel_date_brand_key;
ALTER TABLE daily_funnel ADD CONSTRAINT daily_funnel_date_brand_channel_key UNIQUE (date, brand, channel);
```

**Step 2. Data Hub 시트 (Funnel 탭)**
- 현재 컬럼: date, brand, sessions, avg_duration, cart_adds, signups, purchases, repurchases, subscribers, impressions
- 변경: date, brand, **channel**, sessions, avg_duration, cart_adds, signups, purchases, repurchases, subscribers, impressions
- Python 스크립트로 기존 데이터 마이그레이션 (DB와 동일 규칙)

**Step 3. sync_all.py (GA4 퍼널 섹션, 라인 302~317)**
- 현재: `brand: "nutty"`, channel 없음
- 변경: `brand: "all"`, `channel: "cafe24"`
- onConflict: `"date,brand"` → `"date,brand,channel"`

**Step 4. API 수정 (정확한 코드 변경)**

**4-1. `src/app/api/settings/route.ts`**

smartstore_funnel (라인 88~106):
```typescript
// 현재
const dbBrand = brand === "balancelab" ? "balancelab_smartstore" : "smartstore";
const { error } = await supabase.from("daily_funnel").upsert(
  { date, brand: dbBrand, subscribers, sessions, avg_duration, repurchases },
  { onConflict: "date,brand" }
);

// 변경
const dbBrand = brand === "balancelab" ? "balancelab" : "all";
const { error } = await supabase.from("daily_funnel").upsert(
  { date, brand: dbBrand, channel: "smartstore", subscribers, sessions, avg_duration, repurchases },
  { onConflict: "date,brand,channel" }
);
```

cafe24_funnel (라인 110~123):
```typescript
// 현재
{ date, brand: "cafe24", cart_adds, signups, repurchases },
{ onConflict: "date,brand" }

// 변경
{ date, brand: "all", channel: "cafe24", cart_adds, signups, repurchases },
{ onConflict: "date,brand,channel" }
```

**4-2. `src/app/api/upload-coupang-funnel/route.ts` (라인 56~58)**
```typescript
// 현재
{ date: d, brand: "coupang", ...vals },
{ onConflict: "date,brand" }

// 변경
{ date: d, brand: "all", channel: "coupang", ...vals },
{ onConflict: "date,brand,channel" }
```

**4-3. `src/app/api/funnel/route.ts` (전체)**
```typescript
// 현재: 전체 조회, 필터 없음
supabase.from("daily_funnel").select("*").gte("date", from).lte("date", to).order("date")

// 변경: 그대로 유지 (프론트에서 channel 기준 필터)
// brand 파라미터가 있으면 적용
const brand = sp.get("brand");
let query = supabase.from("daily_funnel").select("*").gte("date", from).lte("date", to).order("date");
if (brand && brand !== "all") query = query.eq("brand", brand);
```

**4-4. `src/app/api/dashboard/route.ts` (라인 23)**
```typescript
// 현재 — Overview에서 brand="all" 퍼널만 조회
supabase.from("daily_funnel").select("*").eq("brand", "all").gte("date", from).lte("date", to).order("date")
// 변경 없음 — brand="all" 행이 채널별로 나뉘므로 전체 합산에 문제 없음
```

**4-5. `src/app/api/missing-dates/route.ts` (라인 20~27)**
```typescript
// 현재
supabase.from("daily_funnel").select("date, brand").gte("date", from).lte("date", to),
// ...
const cafe24Dates = new Set((funnelRes.data || []).filter((r) => r.brand === "cafe24").map((r) => r.date));
const ssDates = new Set((funnelRes.data || []).filter((r) => r.brand === "smartstore").map((r) => r.date));
const coupangFunnelDates = new Set((funnelRes.data || []).filter((r) => r.brand === "coupang").map((r) => r.date));

// 변경
supabase.from("daily_funnel").select("date, brand, channel").gte("date", from).lte("date", to),
// ...
const cafe24Dates = new Set((funnelRes.data || []).filter((r) => r.channel === "cafe24").map((r) => r.date));
const ssDates = new Set((funnelRes.data || []).filter((r) => r.channel === "smartstore" && r.brand === "all").map((r) => r.date));
const coupangFunnelDates = new Set((funnelRes.data || []).filter((r) => r.channel === "coupang").map((r) => r.date));
```

**4-6. `src/app/api/data-status/route.ts` (라인 32~39, 64, 77~81)**

getLatestFunnel 함수 변경:
```typescript
// 현재
async function getLatestFunnel(brand: string): Promise<string | null> {
  const { data } = await supabase.from("daily_funnel").select("date")
    .eq("brand", brand).order("date", { ascending: false }).limit(1);
  return data?.[0]?.date || null;
}

// 변경 — channel 기준으로 조회
async function getLatestFunnelByChannel(channel: string, brand?: string): Promise<string | null> {
  let query = supabase.from("daily_funnel").select("date").eq("channel", channel);
  if (brand) query = query.eq("brand", brand);
  const { data } = await query.order("date", { ascending: false }).limit(1);
  return data?.[0]?.date || null;
}
```

sourceDefs 변경 (라인 64):
```typescript
// 현재: getLatestFunnel("nutty")
// 변경: getLatestFunnelByChannel("cafe24")
```

퍼널 소스 정의 변경 (라인 77~81):
```typescript
// 현재
{ id: "coupang_funnel", ..., fetcher: () => getLatestFunnel("coupang") },
{ id: "smartstore_ironpet", ..., fetcher: () => getLatestFunnel("smartstore") },
{ id: "smartstore_balancelab", ..., fetcher: () => getLatestFunnel("balancelab_smartstore") },
{ id: "cafe24_funnel", ..., fetcher: () => getLatestFunnel("cafe24") },

// 변경
{ id: "coupang_funnel", ..., fetcher: () => getLatestFunnelByChannel("coupang") },
{ id: "smartstore_ironpet", ..., fetcher: () => getLatestFunnelByChannel("smartstore", "all") },
{ id: "smartstore_balancelab", ..., fetcher: () => getLatestFunnelByChannel("smartstore", "balancelab") },
{ id: "cafe24_funnel", ..., fetcher: () => getLatestFunnelByChannel("cafe24") },
```

**Step 5. 타입 + 프론트엔드 수정**

**5-1. `src/lib/types.ts` (라인 43~53)**
```typescript
// 현재
export interface DailyFunnel {
  date: string;
  brand: string;
  // ...
}

// 변경 — channel 추가
export interface DailyFunnel {
  date: string;
  brand: string;
  channel: string;  // 추가
  // ...
}
```

**5-2. `src/app/funnel/page.tsx`**

SOURCE_COLORS/LABELS 변경 (라인 16~23):
```typescript
// 현재
const SOURCE_COLORS: Record<string, string> = {
  nutty: "#2563eb", cafe24: "#2563eb", smartstore: "#16a34a",
  coupang: "#dc2626", balancelab_smartstore: "#7c3aed", all: "#6b7280",
};
const SOURCE_LABELS: Record<string, string> = {
  nutty: "GA4 (너티)", cafe24: "카페24", smartstore: "스마트스토어",
  coupang: "쿠팡", balancelab_smartstore: "밸런스랩 스마트스토어", all: "전체",
};

// 변경 — channel 기준, balancelab은 brand+channel 조합
const CHANNEL_COLORS: Record<string, string> = {
  cafe24: "#2563eb", smartstore: "#16a34a",
  coupang: "#dc2626", "balancelab:smartstore": "#7c3aed",
};
const CHANNEL_LABELS: Record<string, string> = {
  cafe24: "카페24 (자사몰)", smartstore: "스마트스토어",
  coupang: "쿠팡", "balancelab:smartstore": "밸런스랩 스마트스토어",
};
```

소스별 집계 변경 (라인 38~53):
```typescript
// 현재
const funnel = useMemo(() => (data?.funnel || []).filter((r) => r.brand !== "all"), [data]);
const bySource = useMemo(() => {
  for (const r of funnel) {
    const key = r.brand;  // brand 기준
    // ...
  }
}, [funnel]);

// 변경 — channel 기준, balancelab은 별도 키
const funnel = useMemo(() => data?.funnel || [], [data]);
const bySource = useMemo(() => {
  for (const r of funnel) {
    const key = r.brand === "balancelab" ? `balancelab:${r.channel}` : r.channel;
    // ...
  }
}, [funnel]);
```

일별 트렌드 필터 변경 (라인 68~80):
```typescript
// 현재: r.brand로 필터
if (selectedSource !== "all" && r.brand !== selectedSource) continue;

// 변경: channel 키로 필터
const key = r.brand === "balancelab" ? `balancelab:${r.channel}` : r.channel;
if (selectedSource !== "all" && key !== selectedSource) continue;
```

채널별 카드 (라인 189~190) — 스마트스토어/밸런스랩 판단 변경:
```typescript
// 현재
r.source === "smartstore" || r.source === "balancelab_smartstore"

// 변경
r.source === "smartstore" || r.source === "balancelab:smartstore"
```

**Step 6. 추가 프론트엔드 수정**

**6-1. `src/app/page.tsx` (Overview — 라인 68~71)**
```typescript
// 현재 — brand="all" 제외 (변경 전에는 brand="all"이 전체 합산 행이었음)
const funnel = useMemo(() => {
  const all = funnelData?.funnel || [];
  return all.filter((r) => r.brand !== "all");
}, [funnelData]);

// 변경 — brand="all"이 이제 정상 데이터(채널별)이므로 필터 제거
// Overview는 /api/funnel에서 전체 데이터를 가져와 합산하므로 전부 포함
const funnel = useMemo(() => funnelData?.funnel || [], [funnelData]);
```

> Overview의 funnelSummary(라인 200~210)는 전체 합산이므로 코드 변경 불필요.
> 단, Overview에서 /api/funnel을 호출하고 있으므로(라인 46), dashboard API의 brand="all" 필터와 중복 조회 아닌지 확인 필요.
> → page.tsx 라인 46에서 /api/funnel 호출, 라인 39에서 /api/dashboard 호출. dashboard API(라인 23)도 daily_funnel에서 brand="all"만 가져옴.
> → 변경 후: dashboard API는 brand="all" 행만 가져오므로 cafe24/smartstore/coupang 3행. /api/funnel은 전체.
> → Overview에서 funnel 데이터는 /api/funnel에서 가져오므로, funnelSummary 합산에 balancelab:smartstore도 포함됨. 이건 정상 동작.

**6-2. `src/app/settings/page.tsx` (라인 80~86)**
```typescript
// 현재 — payload는 API로 전달만 하므로 프론트 변경 불필요
// settings API 쪽에서 brand/channel 매핑하므로 그대로 유지
// 단, coupang_funnel은 settings API가 아닌 upload-coupang-funnel API를 쓰므로 확인
// → 라인 85: type: "coupang_funnel" → settings API에는 이 case가 없음!
// → 실제로는 설정 페이지에서 쿠팡 퍼널 수기입력 시 어디로 가는지 확인 필요
```

확인: 설정 페이지 쿠팡 퍼널 수기입력(라인 85)은 `type: "coupang_funnel"`로 settings API에 POST하는데, settings/route.ts에는 이 case가 없어서 `Unknown type` 400 에러가 남. **기존 버그.**

수정: settings/route.ts에 coupang_funnel case 추가하거나, 설정 페이지에서 upload-coupang-funnel API로 보내도록 변경.
```typescript
// settings/route.ts에 case 추가 (권장)
case "coupang_funnel": {
  const { date, impressions, sessions, cart_adds, purchases } = data;
  const { error } = await supabase.from("daily_funnel").upsert(
    {
      date, brand: "all", channel: "coupang",
      impressions: Number(impressions) || 0,
      sessions: Number(sessions) || 0,
      cart_adds: Number(cart_adds) || 0,
      purchases: Number(purchases) || 0,
    },
    { onConflict: "date,brand,channel" }
  );
  if (error) throw error;
  return NextResponse.json({ ok: true, message: `쿠팡 퍼널 저장 완료 (${date})` });
}
```

**6-3. `src/app/raw/page.tsx`**
```typescript
// 변경 불필요 — daily_funnel 테이블을 select("*")로 전체 조회하므로
// channel 컬럼 추가되면 자동으로 Raw Data 페이지에 표시됨
```

**검증 체크리스트:**
- [ ] DB: daily_funnel에 channel 컬럼 존재, unique (date, brand, channel)
- [ ] DB: brand에 채널명 없음 (all, balancelab만)
- [ ] DB: nutty+cafe24 merge 후 데이터 누락 없음
- [ ] Data Hub 시트: Funnel 탭 channel 컬럼 정상
- [ ] sync_all.py: GA4 → (all, cafe24) 정상 저장
- [ ] settings API: smartstore/cafe24 퍼널 정상 저장
- [ ] upload-coupang-funnel: (all, coupang) 정상 저장
- [ ] funnel 페이지: 소스별 필터 정상 작동
- [ ] Overview: 퍼널 데이터 정상 표시
- [ ] missing-dates: 채널별 누락 감지 정상

**확장 원칙:** 브랜드-채널 매핑은 설정 페이지(brand_config/channel_config)에서 동적 관리. 밸런스랩이 쿠팡 입점하면 설정에서 추가만 하면 되는 구조. 코드 수정 0, 배포 0.

**원칙:** 원본 시트(통계 시트)는 건드리지 않음. Data Hub 시트에서만 작업.

---

#### 이슈 2. product_sales unique constraint lineup 미포함 (우선순위: 중간)

**현상:** product_sales의 unique key가 (date, brand, product, channel)인데 lineup 미포함. 같은 상품+채널의 다른 셀러(코루비/키키맘 등) 구분 불가, upsert 시 덮어씌워짐.

**수정:**
```sql
ALTER TABLE product_sales DROP CONSTRAINT IF EXISTS product_sales_date_brand_product_channel_key;
ALTER TABLE product_sales ADD CONSTRAINT product_sales_date_brand_product_channel_lineup_key 
  UNIQUE (date, brand, product, channel, lineup);
```
Supabase 대시보드에서 실행. anon key로는 불가, service_role key 필요.

**영향 범위:** upload-sales API의 onConflict도 `"date,brand,product,channel,lineup"`으로 변경 필요.

---

#### 이슈 3. Vercel 공구 override 미작동 (우선순위: 낮음)

**현상:** upload-sales API에서 밸런스랩 공동구매 셀러를 channel=공구_셀러명으로 override하는 로직이 Vercel 배포 시 작동 안 함. 로컬 Python에서는 정상.

**현재 우회:** Python 스크립트로 직접 업로드.

**디버깅 계획:** Vercel 런타임 로그에서 override 조건 분기 도달 여부 확인. 인코딩(한글 비교) 문제 가능성 높음.

---

#### ~~이슈 4. Meta 전환 너티만 작동~~ (이슈 아님)
- 아이언펫: 너티와 같은 픽셀, 실제 전환 없어서 0
- 밸런스랩: 자사몰 한계로 전환 추적 불가

---

## 0. 철학

### 입력은 간단하게
- 하나의 엑셀 업로드로 끝나야 한다
- 수기 입력은 최소화. 자동화할 수 있으면 자동화
- 같은 데이터를 두 번 입력하게 하지 않는다

### 표현은 다양하게
- 같은 데이터를 여러 각도에서 본다 (일별/주별/월별, 채널별/브랜드별/제품별)
- KPI 카드 → 트렌드 차트 → 상세 테이블 (줌인 구조)
- 전월 대비, 목표 대비, 채널 간 비교 — 맥락을 준다
- **전체 탭 + 브랜드별 탭** — 각 브랜드마다 보여줄 내용이 다르다

### 데이터는 적확하게
- 숫자 하나가 어디서 왔는지 추적 가능해야 한다
- DB에 들어가는 순간 브랜드/채널/날짜가 정확해야 한다
- 중복 없음. 누락 없음. 불일치 없음.
- **API에서 가져올 수 있는 데이터는 최대한 가져온다**

### 확장은 쉽게
- 브랜드/채널/상품 추가 시 **코드 수정 0, 배포 0**
- 모든 분류는 DB에서 동적 관리 (하드코딩 금지)

### AI 비의존 (절대 원칙)
- **대시보드 자체에 AI 없음.** 수기 입력 + API 자동 수집 + 크론으로 운영
- AI는 인사이트 뽑기, 운영/관리/보수에만 개입
- AI가 죽어도 대시보드는 정상 작동해야 한다
- 데이터 파이프라인: Python 스크립트 + 크론 (AI 아님)
- 인사이트 페이지만 AI 활용 가능 (선택적, P8)

### 모듈형 제품 데이터
- 각 제품이 독립 데이터 모듈
- 제품 추가 = 설정 페이지에서 등록 → 자동으로 매출/광고/퍼널 연결
- 제품별 대시보드: 매출 트렌드, 채널별 비중, 재구매율, 원가/마진
- 제품 카드 → 클릭 시 상세 → 관련 광고/퍼널 자동 연결
- **기능이 모듈처럼 붙는 구조:** 제품에 광고 모듈, 퍼널 모듈, 재고 모듈 등 독립적으로 추가 가능

---

## 1. Phase 구조

### 완료된 Phase

| Phase | 이름 | 상태 | 커밋 |
|-------|------|------|------|
| **P0** | 데이터 아키텍처 | ✅ 완료 | — |
| **P1** | 뼈대 (레이아웃, 라우팅, 테마) | ✅ 완료 | `6f6048c` |
| **P2** | 매출 + 광고 + Overview + 퍼널 + 키워드 | ✅ 완료 | `cede2ac` |
| **P3** | 월별 + 예산 + Raw Data + 인사이트 | ✅ 완료 | `0678578` |
| **P4** | 설정 리빌드 + 변화율 + 목표달성률 + 동적 config | ✅ 완료 | `b8299b7` |
| **P5** | use-config 전체 적용 + 엑셀 업로드 + 키워드 고도화 | ✅ 완료 | `2ec4927` |
| **Fix** | daily_funnel channel 컬럼 추가 + 퍼널 v2 로직 포팅 | ✅ 완료 | `7bcea98` |

### 남은 Phase (v2 기능 복구 + 신규)

| Phase | 이름 | 핵심 | v2 대비 |
|-------|------|------|---------|
| **P6** | Dashboard API 강화 | brand 파라미터, KPI 서버 계산, 이상치 감지, 공구 분석 | ✅ API 완료, 프론트 연동 필요 |
| **P7** | 데이터 모니터링 | 데이터 누락 알림 배너, 이벤트 마커, 싱크 버튼 | ⏳ 7.1~7.2 완료, 7.3~7.5 남음 |
| **P8** | 브랜드 상세 분석 | 브랜드별 라인업/서브브랜드/옵션 분석, 공구 상세 | ✅ 완료 |
| **P9** | Meta 크리에이티브 | 소재별 성과, 소재 퍼널, 피로도 감지, 영상 미리보기 | ✅ API+기본UI 완료 |
| **P10** | Content/SNS + SEO | 콘텐츠 성과 분석, GSC 연동, 네이버 캠페인 | ✅ API 완료, 프론트 연동 필요 |
| **P11** | 고도화 | AI 인사이트, 월별 요약, 보고서 내보내기, Telegram 알림 | ✅ API 완료, 프론트 연동 필요 |

**원칙:** 각 Phase 완료 → 배포 → 기획서 Changelog 업데이트 → 다음 Phase

---

### P6. Dashboard API 강화 (v2 복구)

> v2의 `/api/dashboard`는 KPI를 서버에서 계산해서 반환했는데, v3는 raw data만 보냄.

**6.1 Dashboard API brand 파라미터 추가**
- 현재: `from`, `to`만 지원
- 변경: `brand` 파라미터 추가, 브랜드별 필터링

**6.2 KPI 서버 계산 추가**
현재 프론트에서 계산하는 것을 API에서 사전 계산:

| KPI | 계산식 | v2 참고 |
|-----|--------|---------|
| 매출 | SUM(revenue) | ✅ |
| 광고비 | SUM(spend) | ✅ |
| ROAS | SUM(conversion_value) / SUM(spend) | ✅ |
| 주문수 | SUM(orders) | ✅ |
| 이익 | 매출 - 광고비 - COGS - 배송비 | v2에 있었음 |
| MER | 매출 / 광고비 | v2에 있었음 |
| AOV | 매출 / 주문수 | v2에 있었음 |
| 이전 기간 대비 | prevRevenue, prevRoas 등 | v2에 있었음 |

**6.3 Anomaly Detection (이상치 감지)**
- 브랜드별 매출/광고비/ROAS 일일 변화율 계산
- 30% 이상 변동 시 anomalies 배열에 추가
- v2 참고: `marketing-dashboard/src/app/api/dashboard/route.ts`

**6.4 공동구매 분석 (밸런스랩)**
- Overview에서 자체판매 vs 공구 매출 분리
- gongguSales: 판매자별 매출/주문수
- gongguTargets: 월별 공구 목표 vs 실적
- selfGongguTrend: 일별 자체판매 vs 공구 추이
- v2 참고: `marketing-dashboard/src/app/api/dashboard/route.ts` 라인 200+

**6.5 채널별 ROAS 추이**
- 일별/주별 채널별 ROAS 라인차트 데이터
- 7일 이동평균 (maRevenue, maAdSpend)

**6.6 UTM 분석**
- `/api/utm` — GA4 UTM 파라미터별 성과
- utm_analytics 테이블 (source, medium, campaign별 sessions, users, conversions)
- v2 참고: `marketing-dashboard/scripts/sync_ga4_utm.py`

**6.7 Overview KPI 드릴다운**
- KPI 카드 클릭 시 상세 분석 카드 애니메이션 펼침
- 매출 클릭 → 브랜드별 매출 차트 + 채널별 매출 바
- v2 참고: `marketing-dashboard/src/app/page.tsx` (animate-in slide-in-from-top-2)

**수정 파일:**
- `src/app/api/dashboard/route.ts` — ✅ 전면 리빌드 완료 (`81b4a64`)
- `src/app/page.tsx` — ⏳ 새 API 응답 구조에 맞춰 프론트 수정 필요

**P6 프론트 연동 작업 (후속):**
1. Overview fetch URL에 brand 파라미터 추가: `/api/dashboard?from=${from}&to=${to}&brand=${brand}`
2. 응답 구조 변경: 기존 `{ sales, ads, products, funnel, prevSales, prevAds }` → 새 `{ kpi, trend, channels, ... }`
3. KPI 카드: 프론트 계산 제거, API의 `kpi.revenue`, `kpi.roas` 등 직접 사용
4. 이전 기간 대비: `kpi.revenuePrev`, `kpi.roasPrev` 등 사용
5. 트렌드 차트: API의 `trend` 배열 직접 사용 (7일 이동평균 포함)
6. 브랜드 비중/이익: API의 `brandRevenue`, `brandProfit` 사용
7. 채널 ROAS: API의 `channelRoasTrend` 사용
8. 공구 분석 섹션: API의 `gongguSales`, `gongguSalesTotal`, `selfSalesTotal` 사용
9. 이상치 배너: API의 `anomalies` 배열로 경고 표시
10. /api/funnel 별도 호출 제거 → dashboard API의 `funnelSummary` 사용

---

### P7. 데이터 모니터링 (v2 복구)

**7.1 데이터 누락 알림 배너**
- MissingDataAlert 컴포넌트
- `/api/missing-dates` 호출 → 최근 7일 누락 감지
- 대시보드 상단에 경고 배너 표시
- v2 참고: `marketing-dashboard/src/components/missing-data-alert.tsx`

**7.2 이벤트 마커**
- marketing_events 테이블 (이미 존재)
- `/api/events` GET/POST/DELETE (v3에 이미 있음)
- EventMarkers 컴포넌트: 차트 위에 프로모션/캠페인 마커 오버레이
- v2 참고: `marketing-dashboard/src/components/event-markers.tsx`

**7.3 싱크 버튼**
- SyncButton 컴포넌트: 수동 데이터 동기화 트리거
- 동기화 결과 피드백 (성공/실패 + 건수)
- v2 참고: `marketing-dashboard/src/components/sync-button.tsx`

**7.4 설정 DailyInputGuide**
- 5단계 체크리스트 (STEP 1~5) + 원형 진행도 바
- 각 STEP별 설명 + 탭 이동 버튼
- 완료 상태 localStorage 저장
- v2 참고: `marketing-dashboard/src/app/settings/page.tsx`

**7.5 OKR/예산 시트 연동**
- OKR 탭 → DB 연동 (월별 KPI 목표, 정성적 목표 포함)
- 광고 예산안 탭 → monthly_targets 테이블 확장
- 매체 예산 분배 → channel_config에 예산 비중 필드 추가
- 현재 시트에만 있고 DB에 없는 데이터

**수정 파일:**
- `src/components/missing-data-alert.tsx` — 신규
- `src/components/event-markers.tsx` — 신규
- `src/components/sync-button.tsx` — 신규
- `src/components/daily-input-guide.tsx` — 신규
- `src/app/page.tsx` — 배너 + 이벤트 마커 통합

---

### P8. 브랜드 상세 분석 (v2 복구)

**8.1 브랜드별 상세 페이지 또는 탭**

| 브랜드 | 특수 분석 | v2 참고 |
|--------|---------|---------|
| 너티 | 라인업별 매출 (사운드/하루루틴/기타), 제품 정규화 | brand-detail API |
| 아이언펫 | 기본 KPI | — |
| 사입 | 서브브랜드별 매출 (닥터레이/파미나/고네이티브/테라카니스) | brand-detail API |
| 밸런스랩 | 옵션 분석 (종이결과지/맞춤영양제), 공구 상세 (판매자별 추이) | brand-detail API |

**8.2 API: `/api/brand-detail`**
- 파라미터: brand, from, to
- 반환: lineupBreakdown, subBrandRevenue, optionBreakdown, gongguSales, selfGongguTrend
- v2 참고: `marketing-dashboard/src/app/api/dashboard/route.ts` (브랜드별 분기)

**8.3 인플루언서/체험단/공구 관리**
- 시트 "Influecer/체험단/공구" 탭 데이터 DB 연동
- 캠페인별 성과 추적 (비용, 노출, 전환)
- v2: 시트에만 존재, DB 미연동

**수정 파일:**
- `src/app/api/brand-detail/route.ts` — 신규
- `src/app/page.tsx` 또는 별도 브랜드 상세 페이지

---

### P9. Meta 크리에이티브 (v2 복구)

> 기획서 5.5절에 이미 상세 기획 있음.

**9.1 API: `/api/creatives`**
- Meta Graph API v19.0 연동
- 소재별: 썸네일, 광고비, 노출, CTR, CPC, ROAS, CAC
- 퍼널 메트릭: 랜딩뷰 → 장바구니 → 결제 → 구매
- 10분 캐시, 페이지네이션
- v2 참고: `marketing-dashboard/src/app/api/creatives/route.ts` (전체 구현됨)

**9.2 API: `/api/creative-trend`**
- 특정 광고의 시계열 성과 변화
- v2 참고: `marketing-dashboard/src/app/api/creative-trend/route.ts`

**9.3 API: `/api/video-source`**
- Meta 비디오 스트림 URL 반환
- v2 참고: `marketing-dashboard/src/app/api/video-source/route.ts`

**9.4 Meta 크리에이티브 상세 데이터**
- 헤드라인, 본문, 설명, CTA 텍스트 (Meta 시트 creative 탭에 있음)
- v2 참고: Meta 원본 시트 (너티_creative, 아이언펫_creative, 큐모발검사_creative)

**9.5 UI**
- 광고 페이지 하단 또는 별도 탭
- 소재 카드 그리드 + 정렬 + 소재 퍼널

---

### P10. Content/SNS + SEO (v2 복구)

**10.1 Content 페이지 (`/content`)**
- content_performance 테이블 연동
- 콘텐츠 유형별 성과 (게시물수, 노출, 클릭, CTR, 참여도)
- 인플루언서별 성과 (공식블로그, 준블로그 등)
- 주간 게시물 추이, 팔로워 증가 추이
- v2 참고: `marketing-dashboard/src/app/content/page.tsx`
- 시트 참고: 통계 시트 "Content" 탭 (1,412행)

**10.2 GSC 연동**
- `/api/gsc` — Google Search Console API
- 쿼리별 클릭, 노출, CTR, 평균 순위
- v2 참고: `marketing-dashboard/src/app/api/gsc/route.ts`

**10.3 네이버 캠페인**
- `/api/naver-campaigns` — 네이버 검색광고 API
- 캠페인별 성과, 비용, 전환
- v2 참고: `marketing-dashboard/src/app/api/naver-campaigns/route.ts`

---

### P11. 고도화 (v2 복구 + 신규)

**11.1 AI 인사이트 고도화**
- `/api/insights` — Rule-based + AI 근본 원인 분석
- Critical/Warning/Opportunity/Info 분류
- 감지 규칙: ROAS < 2.0, 장바구니 이탈 > 70%, 매출 15% 하락, 채널 집중도 > 40%
- v2 참고: `marketing-dashboard/src/app/api/insights/route.ts`

**11.2 보고서 내보내기**
- ExportReport 컴포넌트
- PDF/CSV 다운로드

**11.3 Telegram 알림**
- anomaly-alert.py — 매일 10:00 KST 이상치 감지 → Telegram 전송
- v2 참고: `marketing-dashboard/scripts/anomaly-alert.py`

**11.4 Sales 페이지 고도화**
- CAC vs ROAS 사분면 산점도 (채널별 효율 비교)
- v2 참고: `marketing-dashboard/src/app/sales/page.tsx`

**11.5 키워드 사분면 분석**
- 버블차트: X=CTR, Y=CPC, 크기=클릭수
- 사분면 분류: 스타(높CTR+낮CPC) / 비용최적화(높CTR+높CPC) / 잠재력(낮CTR+낮CPC) / 재검토(낮CTR+높CPC)
- 평균 CTR/CPC 참조선
- v2 참고: `marketing-dashboard/src/app/keywords/page.tsx`

**11.6 월별 YTD 합산 KPI**
- YTD 매출, YTD 주문, YTD 광고비, YTD ROAS, YTD AOV, YTD 통상이익
- MoM 성장률 차트 (월별 증감)
- v2 참고: `marketing-dashboard/src/app/monthly/page.tsx`

---

## 2. 데이터 아키텍처 (P0)

### 2.1 데이터의 일생

```
┌─────────────────────────────────────────────────────────┐
│                    데이터 소스 (입력)                       │
├─────────────┬──────────────┬────────────────────────────┤
│  🤖 자동 수집   │  📤 엑셀 업로드   │     ✍️ 수기 입력           │
├─────────────┼──────────────┼────────────────────────────┤
│ Meta API    │ 판매실적 엑셀  │ GFA 광고비                   │
│ Google Ads  │ 쿠팡 광고 엑셀  │ 스마트스토어 지표              │
│ GA4 API     │ 쿠팡 퍼널 엑셀  │ 카페24 퍼널                  │
│ Naver SA    │              │ 건별 비용                     │
│ Naver 키워드 │              │ 마케팅 이벤트                  │
└─────────────┴──────────────┴────────────────────────────┘
                       │
                       ▼
              ┌─────────────────┐
              │   Supabase DB    │  ← Single Source of Truth
              └────────┬────────┘
                       │
              ┌────────┴────────┐
              ▼                 ▼
     ┌──────────────┐  ┌───────────────┐
     │  API Routes   │  │ PPMI Data Hub │
     │  (대시보드용)   │  │ (시트 동기화)   │
     └──────┬───────┘  └───────────────┘
            ▼
     ┌──────────────┐
     │   프론트엔드    │
     └──────────────┘
```

### 2.2 브랜드 계층 구조

```
PPMI (전체)
├── 너티 (nutty) 🔴
│   ├── 사운드시리즈 (라인업)
│   │   ├── 스트레스제로껌
│   │   ├── 냠 단호박
│   │   ├── 바삭 닭가슴살
│   │   └── 사운드시리즈 냠+바삭
│   ├── 굿모닝퓨레
│   ├── 에너젯바
│   └── (추가 예정)
│
├── 아이언펫 (ironpet) 🟠
│   ├── 반려견 영양분석 키트
│   └── (추가 예정)
│
├── 사입 (saip) 🟤/🟣
│   ├── 사료 🟤
│   │   ├── 파미나 (펌킨, 오션, 앤세스트럴, 프라임...)
│   │   └── (추가 가능)
│   ├── 영양제 🟣
│   │   ├── 닥터레이 (프로키온, 후코이카, 오메가3...)
│   │   ├── 테라카니스
│   │   └── (추가 가능)
│   └── 기타
│
└── 밸런스랩 (balancelab) 🔵
    ├── 큐모발검사 🟢
    │   ├── 큐모발검사 뉴트리션
    │   ├── 큐모발검사 중금속
    │   └── 큐모발검사 뉴트리션 + 맞춤 영양제
    ├── 하루가꿈
    └── (추가 예정)
```

### 2.3 색상 체계 (형광 금지)

**브랜드 색상:**

| 브랜드 | 색상 | Hex | 용도 |
|--------|------|-----|------|
| 너티 | 🔴 레드 | `#dc2626` | 메인 브랜드색 |
| 아이언펫 | 🟠 오렌지 | `#ea580c` | 메인 브랜드색 |
| 밸런스랩 | 🔵 블루 | `#2563eb` | 메인 브랜드색 |
| 큐모발검사 | 🟢 그린 | `#16a34a` | 밸런스랩 하위 |
| 사입 (사료) | 🟤 브라운 | `#92400e` | 사입 하위 |
| 사입 (영양제) | 🟣 퍼플 | `#7c3aed` | 사입 하위 |

**광고 채널 색상:**

| 채널 | 색상 | Hex |
|------|------|-----|
| 메타 | 블루 | `#1d4ed8` |
| 네이버 검색 | 그린 | `#15803d` |
| 네이버 쇼핑 | 틸 | `#0e7490` |
| 구글 P-Max | 오렌지 | `#c2410c` |
| 구글 검색 | 앰버 | `#b45309` |
| GFA | 퍼플 | `#6d28d9` |
| 쿠팡 광고 | 레드 | `#b91c1c` |

**판매 채널 색상:**

| 채널 | 색상 | Hex |
|------|------|-----|
| 카페24 | 블루 | `#2563eb` |
| 스마트스토어 | 그린 | `#16a34a` |
| 쿠팡 | 레드 | `#dc2626` |
| 에이블리 | 핑크 | `#be185d` |
| 펫프렌즈 | 퍼플 | `#7c3aed` |
| 공구 | 라벤더 | `#8b5cf6` |

> 모든 색상은 `brand_config`, `channel_config` DB 테이블에서 관리. 변경 시 코드 수정 불필요.

### 2.4 판매 채널

| 키 | 이름 | 데이터 소스 | 브랜드 |
|----|------|------------|--------|
| `cafe24` | 카페24 | 엑셀 업로드 | 너티, 아이언펫, 사입 |
| `smartstore` | 스마트스토어 | 엑셀 업로드 | 너티, 아이언펫, 사입, 밸런스랩 |
| `coupang` | 쿠팡 | 엑셀 업로드 | 너티, 사입 |
| `ably` | 에이블리 | 엑셀 업로드 | (사용 중) |
| `petfriends` | 펫프렌즈 | 엑셀 업로드 | (사용 중) |
| `공구_*` | 공구(셀러명) | 엑셀 업로드 | 밸런스랩 |

### 2.5 광고 채널

| 키 | 이름 | 데이터 소스 | 브랜드 |
|----|------|------------|--------|
| `meta` | 메타 | API 자동 | 너티, 아이언펫, 밸런스랩 |
| `naver_search` | 네이버 검색 (파워링크) | API 자동 | 전체 |
| `naver_shopping` | 네이버 쇼핑 | API 자동 | 전체 |
| `google_pmax` | 구글 P-Max | API 자동 | 너티 |
| `google_search` | 구글 검색 | API 자동 | 너티 |
| `gfa` | GFA (네이버 DA) | 수기 입력 | 너티, 사입, 밸런스랩 |
| `coupang_ads` | 쿠팡 광고 | 엑셀 업로드 | 너티 |

> **GA4 데이터:** 광고비 집계에서 제외. 퍼널(세션/체류/전환) 전용.

### 2.6 API 최대 활용 — 수집 가능 필드 전체

#### Meta Marketing API

| 필드 | 설명 | 현재 | v3 |
|------|------|------|-----|
| spend | 광고비 | ✅ | ✅ |
| impressions | 노출 | ✅ | ✅ |
| clicks | 클릭 (전체) | ✅ | ✅ |
| reach | 도달 (유니크) | ✅ | ✅ |
| frequency | 1인당 평균 노출 | ❌ | ✅ |
| cpm | 1000노출당 비용 | ❌ | ✅ |
| link_clicks | 링크 클릭 | ❌ | ✅ |
| outbound_clicks | 외부 링크 클릭 | ❌ | ✅ |
| landing_page_views | 랜딩페이지 조회 | ❌ | ✅ |
| video_views | 영상 조회 | ❌ | ✅ |
| video_p25_watched | 25% 시청 | ❌ | ✅ |
| video_p50_watched | 50% 시청 | ❌ | ✅ |
| video_p75_watched | 75% 시청 | ❌ | ✅ |
| video_p100_watched | 100% 시청 | ❌ | ✅ |
| add_to_cart | 장바구니 추가 | ❌ | ✅ |
| initiate_checkout | 결제 시작 | ❌ | ✅ |
| purchases | 구매 전환 수 | ⚠️ 0 | ✅ (픽셀 확인) |
| purchase_value | 구매 전환 매출 | ⚠️ 0 | ✅ (픽셀 확인) |
| cost_per_purchase | 구매당 비용 (CPA) | ❌ | ✅ |

#### Google Ads API

| 필드 | 설명 | 현재 | v3 |
|------|------|------|-----|
| cost | 광고비 | ✅ | ✅ |
| impressions | 노출 | ✅ | ✅ |
| clicks | 클릭 | ✅ | ✅ |
| conversions | 전환수 | ✅ | ✅ |
| conversions_value | 전환매출 | ✅ | ✅ |
| avg_cpc | 평균 CPC | ❌ | ✅ |
| cost_per_conversion | 전환당 비용 | ❌ | ✅ |
| search_impression_share | 검색 노출 점유율 | ❌ | ✅ |
| video_views | 영상 조회 | ❌ | ✅ |
| view_through_conversions | 조회 후 전환 | ❌ | ✅ |
| interaction_rate | 상호작용률 | ❌ | ✅ |

#### GA4 Data API (퍼널 전용)

| 필드 | 설명 | 현재 | v3 |
|------|------|------|-----|
| sessions | 세션 | ✅ | ✅ |
| averageSessionDuration | 평균 체류 | ✅ | ✅ |
| activeUsers | 활성 사용자 | ❌ | ✅ |
| newUsers | 신규 사용자 | ❌ | ✅ |
| bounceRate | 이탈률 | ❌ | ✅ |
| engagementRate | 참여율 | ❌ | ✅ |
| screenPageViews | 페이지뷰 | ❌ | ✅ |
| screenPageViewsPerSession | 세션당 페이지뷰 | ❌ | ✅ |
| ecommercePurchases | 구매수 | ❌ | ✅ |
| purchaseRevenue | 구매매출 | ❌ | ✅ |
| addToCarts | 장바구니 | ❌ | ✅ |
| checkouts | 결제시작 | ❌ | ✅ |
| 소스/매체별 분리 | 유입 경로별 | ❌ | ✅ |

#### 네이버 검색광고 API

| 필드 | 설명 | 현재 | v3 |
|------|------|------|-----|
| impCnt | 노출 | ✅ | ✅ |
| clkCnt | 클릭 | ✅ | ✅ |
| salesAmt | 전환매출 | ✅ | ✅ |
| ccnt | 전환수 | ✅ | ✅ |
| ctr | CTR | ✅ | ✅ |
| cpc | CPC | ✅ | ✅ |
| avgRnk | 평균 순위 | ❌ | ✅ |
| reachCnt | 도달수 | ❌ | ✅ |
| viewCnt | 조회수 | ❌ | ✅ |
| ror | 전환률 | ❌ | ✅ |
| cpConv | 전환당 비용 | ❌ | ✅ |

### 2.7 퍼널 데이터 구조

**brand 필드 = "퍼널 소스":**

| brand 값 | 의미 | 전체 탭 표시 | 브랜드 탭 표시 |
|-----------|------|-------------|--------------|
| `nutty` | GA4 (자사몰) | ✅ | 너티 탭 |
| `cafe24` | 카페24 퍼널 | ✅ | 전체/너티/아이언펫/사입 탭 |
| `smartstore` | 스마트스토어 (너티/아이언펫/사입) | ✅ | 전체/너티/아이언펫/사입 탭 |
| `balancelab_smartstore` | 밸런스랩 스마트스토어 | ❌ (전체에서 제외) | 밸런스랩 탭에서만 |
| `coupang` | 쿠팡 | ✅ | 너티/사입 탭 |

### 2.8 시트 아키텍처 (통합)

**AS-IS (시트 5개):**
- 통계 시트 (1FzxD...) — Paid/Funnel/Sales + 수식탭
- 밸런스랩 시트 (1sQcl...) — [Q]Paid
- Meta 원본 (1JaKZ...) — API 수집
- Naver 원본 (1ky1r...) — API 수집
- GA4 원본 (1iFhY...) — API 수집

**TO-BE (시트 2개):**

```
📡 PPMI Data Hub (신규, 자동화 전용)
├── [N]Paid (너티)
├── [I]Paid (아이언펫)
├── [사입]Paid (사입)
├── [Q]Paid (밸런스랩)      ← 별도 시트에서 통합
├── Funnel
├── Sales
├── Keywords
├── 상품 목록
├── 원가
├── Meta Raw               ← 기존 별도 시트 → 탭으로
├── Naver Raw
├── Google Raw
└── GA4 Raw

📊 기존 통계 시트 (호 전용, 수식/분석)
├── [N]대시보드_OVERVIEW    ← IMPORTRANGE로 Data Hub 참조
├── (M)Dash Board
├── (W)Dash Board
├── 매체 예산 분배
├── 광고예산안
└── 기타 수식/분석 탭
```

### 2.9 DB 스키마

#### 신규 테이블: brand_config

```sql
CREATE TABLE brand_config (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,        -- nutty, ironpet, saip, balancelab
  label TEXT NOT NULL,              -- 너티, 아이언펫, 사입, 밸런스랩
  color TEXT NOT NULL,              -- #dc2626
  "order" INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true,
  parent_key TEXT,                   -- 상위 브랜드 (사입 하위 등)
  category TEXT,                     -- 사료, 영양제 등
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 신규 테이블: channel_config

```sql
CREATE TABLE channel_config (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,        -- meta, naver_search, cafe24, ...
  label TEXT NOT NULL,              -- 메타, 네이버 검색, ...
  color TEXT NOT NULL,
  type TEXT NOT NULL,               -- 'ad' or 'sales'
  auto BOOLEAN DEFAULT false,       -- 자동수집 여부
  "order" INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 확장: daily_ad_spend

```sql
-- 기존 컬럼
date, brand, channel, spend, impressions, clicks, reach,
conversions, conversion_value, roas, ctr, cpc,

-- v3 추가 컬럼
frequency NUMERIC DEFAULT 0,           -- Meta: 1인당 노출
cpm NUMERIC DEFAULT 0,                 -- 1000노출당 비용
link_clicks INTEGER DEFAULT 0,         -- 링크 클릭
outbound_clicks INTEGER DEFAULT 0,     -- 외부 링크 클릭
landing_page_views INTEGER DEFAULT 0,  -- 랜딩페이지 조회
video_views INTEGER DEFAULT 0,         -- 영상 조회
add_to_cart INTEGER DEFAULT 0,         -- 장바구니 추가
initiate_checkout INTEGER DEFAULT 0,   -- 결제 시작
purchases INTEGER DEFAULT 0,           -- 구매 전환 수
cost_per_purchase NUMERIC DEFAULT 0,   -- CPA
view_through_conv INTEGER DEFAULT 0,   -- 조회 후 전환
avg_rank NUMERIC DEFAULT 0,            -- 평균 순위 (Naver)
search_impression_share NUMERIC DEFAULT 0, -- 검색 노출 점유율 (Google)
```

#### 확장: daily_funnel (GA4)

```sql
-- 기존 컬럼
date, brand, impressions, sessions, cart_adds, signups,
purchases, repurchases, subscribers, avg_duration,

-- v3 추가 컬럼
active_users INTEGER DEFAULT 0,
new_users INTEGER DEFAULT 0,
bounce_rate NUMERIC DEFAULT 0,
engagement_rate NUMERIC DEFAULT 0,
page_views INTEGER DEFAULT 0,
pages_per_session NUMERIC DEFAULT 0,
ecom_purchases INTEGER DEFAULT 0,      -- GA4 구매수
ecom_revenue NUMERIC DEFAULT 0,        -- GA4 구매매출
ecom_add_to_cart INTEGER DEFAULT 0,    -- GA4 장바구니
ecom_checkouts INTEGER DEFAULT 0,      -- GA4 결제시작
```

#### 기존 유지 테이블

- `daily_sales` — 변경 없음
- `product_sales` — 변경 없음 (lineup unique 추가 완료)
- `keyword_performance` — 변경 없음
- `product_costs` — 변경 없음
- `product_list` — 변경 없음
- `misc_costs` — 변경 없음
- `marketing_events` — 변경 없음
- `monthly_targets` — `ad_spend_target NUMERIC` 컬럼 추가 (광고비 목표)

---

## 3. 공통 UI (P1)

### 3.1 레이아웃

```
┌──────────┬─────────────────────────────────────────┐
│          │  [날짜 선택] ─── [브랜드 필터]              │
│  사이드바  │  [전체] [너티] [아이언펫] [사입] [밸런스랩]   │
│          │  ┌─────────────────────────────────────┐ │
│ Overview │  │                                      │ │
│ 매출 분석 │  │          메인 콘텐츠 영역               │ │
│ 광고 분석 │  │                                      │ │
│ 퍼널     │  │  (브랜드 선택에 따라 내용 변경)           │ │
│ 키워드   │  │                                      │ │
│ 월별요약  │  │                                      │ │
│ ─────── │  │                                      │ │
│ Raw Data │  │                                      │ │
│ 설정     │  └─────────────────────────────────────┘ │
└──────────┴─────────────────────────────────────────┘
```

### 3.2 공통 필터 바

```
📅 2026-03-04 ~ 2026-04-03 │ 어제 7일 14일 30일 이번달 지난달 전체 │ [전체▼] 너티 아이언펫 사입 밸런스랩
```

- **프리셋:** 어제 / 7일 / 14일 / 30일 / 이번 달 / 지난 달 / 전체 기간
- **브랜드:** 단일 선택 (전체/너티/아이언펫/사입/밸런스랩)
- **URL 기반 상태 관리:** `?from=&to=&brand=`
- **페이지 이동 시 필터 유지**

### 3.3 사이드바

| # | 라벨 | 경로 | 아이콘 |
|---|------|------|--------|
| 1 | Overview | `/` | 📊 |
| 2 | 매출 분석 | `/sales` | 💰 |
| 3 | 광고 분석 | `/ads` | 📢 |
| 4 | 퍼널 | `/funnel` | 🔄 |
| 5 | 키워드 | `/keywords` | 🔍 |
| 6 | 월별 요약 | `/monthly` | 📅 |
| 7 | 예산 현황 | `/budget` | 💳 |
| — | 구분선 | | |
| 8 | Raw Data | `/raw` | 📋 |
| 9 | 설정 | `/settings` | ⚙️ |

### 3.4 공통 컴포넌트

| 컴포넌트 | 용도 |
|----------|------|
| `KpiCard` | 숫자 + 라벨 + 전기간 대비 변화율 + 목표 대비 |
| `Card` | 컨테이너 (타이틀 + 본문) |
| `ChartWrapper` | Recharts 래퍼 (반응형) |
| `DataTable` | 정렬/필터/검색 가능 테이블 |
| `Loading` | 스켈레톤 로딩 |
| `EmptyState` | 데이터 없음 |
| `GlobalFilter` | 상단 필터 바 |
| `BrandBadge` | 브랜드 칩 (DB 색상) |
| `ChannelBadge` | 채널 칩 (DB 색상) |
| `DateRangePicker` | 캘린더 날짜 선택 |
| `TrendIndicator` | ▲12.3% (초록) / ▼5.2% (빨강) |
| `TargetProgress` | 목표 대비 진행률 바 |

### 3.5 테마

- 다크/라이트 둘 다 지원
- **텍스트 가독성 필수 검증** (배경 대비 최소 4.5:1)
- 차트 색상도 테마별 조정

### 3.6 기술 스택

| 항목 | 결정 |
|------|------|
| 프레임워크 | Next.js 14 (App Router) |
| 스타일 | Tailwind CSS |
| 차트 | Recharts |
| 테이블 | @tanstack/react-table |
| 상태 | URL params (no Context) |
| 날짜 | date-fns |
| 테마 | next-themes |
| DB | Supabase |
| 배포 | Vercel (ppmi-dashboard) |

---

## 4. 매출 분석 (`/sales`) — P2

### 4.1 브랜드별 뷰 차이

| 뷰 | 전체 | 너티 | 아이언펫 | 사입 | 밸런스랩 |
|----|------|------|---------|------|---------|
| 채널별 매출 | ✅ | ✅ | ✅ | ✅ | ✅ + 공구별 |
| 카테고리별 | ✅ | 라인업별 | 키트/기타 | 사료/영양제 | 검사/기타 |
| 제품 테이블 | 전체 | 너티만 | 아이언펫만 | 사입만 | 밸런스랩만 |
| 공구 섹션 | ❌ | ❌ | ❌ | ❌ | ✅ (셀러별) |

### 4.2 KPI 카드

| KPI | 계산 | 비교 |
|-----|------|------|
| 매출 | SUM(revenue) | 전기간 대비 % |
| 주문 수 | SUM(orders) | 전기간 대비 % |
| 평균 객단가 | 매출/주문수 | 전기간 대비 |
| 전월 대비 | 이전 동일 기간 | ▲▼ 표시 |

### 4.3 차트

1. **브랜드별 누적 매출 트렌드** — 스택 에어리어 차트 (전체 탭: 너티/아이언펫/사입/밸런스랩 누적, 개별 브랜드 탭: 일별 매출 라인)
2. **채널별 매출 비교** — 바차트
3. **카테고리별 매출** — 바차트
4. **주별/월별 집계** — 토글로 전환

### 4.4 테이블

- 제품 매출: 순위, 제품명, 브랜드, 채널, 매출, 수량, 객단가 (sortable)
- 공구 매출 (밸런스랩): lineup별 매출/수량/셀러명

---

## 5. 광고 분석 (`/ads`) — P2

### 5.1 KPI 카드

| KPI | 계산 |
|-----|------|
| 총 광고비 | SUM(spend) |
| 통합 ROAS | SUM(conversion_value) / SUM(spend) |
| 총 클릭 | SUM(clicks) |
| 평균 CTR | SUM(clicks)/SUM(impressions)×100 |
| 전환수 | SUM(purchases) |
| CPA | SUM(spend)/SUM(purchases) |

### 5.2 채널별 카드

```
┌────────────────────────────────────┐
│ 📢 메타                     ROAS 0.82x │
│ 광고비 452만 │ 전환 23건 │ 전환매출 371만 │
│ CPA 19.7만 │ CTR 2.1% │ 링크클릭 8,500  │
│ ████████████░░░░░  47% of total       │
└────────────────────────────────────┘
```

- ROAS 색상: >3 초록, 1~3 노랑, <1 빨강

### 5.3 차트

1. **채널별 광고비 트렌드** — 스택 영역 차트
2. **채널별 ROAS 트렌드** — 라인차트 (기준선 1.0x)
3. **광고비 대비 매출 산점도** — 채널별 효율 비교
4. **채널별 비중 변화** — 월별 스택 바차트

### 5.4 전환 성과 테이블

| 채널 | 광고비 | 전환수 | 전환매출 | ROAS | CPA | CTR |
|------|--------|--------|---------|------|-----|-----|
| 메타 | 452만 | 23 | 371만 | 0.82x | 19.7만 | 2.1% |
| 구글 P-Max | 55만 | 15 | 467만 | 8.49x | 3.7만 | 1.8% |
| ... | | | | | | |

### 5.5 Meta 크리에이티브 성과 (P8)

> 광고 분석 페이지 하단 또는 별도 탭. P8에서 구현.

**데이터 소스:** Meta Graph API v19.0 — 광고 계정별 인사이트 + 크리에이티브 상세
- 너티: act_1510647003433200
- 아이언펫: act_8188388757843816

**API:** `/api/creatives?brand=nutty&from=2026-03-01&to=2026-04-01`

**소재별 표시 항목:**
| 항목 | 필드 | 설명 |
|------|------|------|
| 썸네일 | thumbnail_url | 소재 이미지 (1080x1080) |
| 광고명 | ad_name | 광고 이름 |
| 상태 | status | ACTIVE/PAUSED |
| 광고비 | spend | 소재별 지출 |
| 노출 | impressions | |
| 클릭/CTR/CPC | clicks, ctr, cpc | |
| 랜딩페이지뷰 | landing_page_views | |
| 장바구니 | add_to_cart | 픽셀 이벤트 |
| 결제시작 | initiate_checkout | 픽셀 이벤트 |
| 구매/매출 | purchases, revenue | 픽셀 이벤트 |
| ROAS | revenue/spend | |
| CPA | spend/purchases | |
| 장바구니→구매율 | purchases/add_to_cart | |

**UI 구성:**
1. 소재 카드 그리드 (썸네일 + KPI 오버레이)
2. 정렬: ROAS순 / 광고비순 / 전환수순
3. 소재 퍼널: 클릭 → 랜딩뷰 → 장바구니 → 구매 (소재별 전환 깔때기)
4. 피로도 감지: CTR 2일 연속 하락 시 경고

**v2 참고:** `marketing-dashboard/src/app/api/creatives/route.ts` 에 전체 로직 구현되어 있음. 10분 캐시, 페이지네이션, 브랜드별 필터 포함.

**구현 시점:** P8 (고도화 단계). 광고 분석 페이지에 탭으로 추가.

---

## 6. 퍼널 (`/funnel`) — P3

### 6.1 전체 퍼널 시각화 (가로 플로우)

```
노출(30,000) → 유입(10,000) → 장바구니(859) → 구매(417) → 재구매(2)
   100%          33.3%          2.86%         1.39%       0.01%
```

- 각 단계 사이에 **이탈률** 표시
- 가장 큰 이탈 구간 **빨간 강조**

### 6.2 채널별 독립 퍼널

```
┌─ 카페24 ──────────────────────────────────┐
│ 유입 7,529 → 장바구니 422 → 구매 33       │
│            5.6%           7.8%    전환 0.44% │
└──────────────────────────────────────────┘

┌─ 스마트스토어 ────────────────────────────┐
│ 유입 10,000 → 알림 150 → 재구매 2         │
│             1.5%                          │
└──────────────────────────────────────────┘

┌─ 쿠팡 ───────────────────────────────────┐
│ 노출 30,000 → 방문 10,000 → 장바구니 859 → 구매 417 │
│            33.3%          8.6%         48.5%  │
└──────────────────────────────────────────┘
```

- 채널별 비중 (파이차트 또는 바)

### 6.3 일별 퍼널 트렌드 (각 지표별 라인차트)

- 유입 일별 변화
- 장바구니 일별 변화
- 구매 일별 변화
- 전환율 일별 변화
- **각각 독립 차트** (한 차트에 다 넣으면 스케일이 달라서 안 보임)

### 6.4 브랜드 탭별

- **전체:** 카페24 + 스마트스토어(너티/아이언펫/사입) + 쿠팡
- **밸런스랩:** balancelab_smartstore + 공구별 (별도)

### 6.5 Meta 광고 퍼널 (v3 신규)

```
Meta 노출 → 링크클릭 → 랜딩페이지뷰 → 장바구니 → 결제 → 구매
```

- daily_ad_spend의 Meta 전환 데이터 활용

---

## 7. Overview (`/`) — P4

### 7.1 KPI 카드 (8개, 2행 배치)

| 행1 | 매출 | 광고비 | ROAS | 주문수 |
|-----|------|--------|------|--------|
| 행2 | 통상이익 | 이익률 | 전환율 | 신규고객수 |

- 각 카드에 **전기간 대비 %** 표시
- **목표 대비 달성률** 게이지 바

### 7.2 누적 매출 그래프 (x축: 일별)

```
₩
│    ╱──── 목표 라인
│   ╱
│  ╱──── 실제 누적 매출
│ ╱
│╱
└────────────── 날짜
  1일  5일  10일  15일  ...
```

- 누적 매출 vs 목표 라인
- 브랜드별 스택 영역
- 광고비 누적도 점선으로

### 7.3 기타 차트

- 브랜드별 매출 비중 (도넛)
- TOP 5 제품 (수평 바)
- 채널별 ROAS 비교 (바)
- 이벤트 마커 (차트 위 점)

---

## 8. 월별 요약 (`/monthly`) — P4

### 8.1 월별/주별 토글

**시각화 (차트):**
- 월별 매출 vs 광고비 (바 + 라인)
- 월별 ROAS 추이
- 브랜드별 월 매출 비중 변화 (스택 바)
- 목표 달성률

**테이블 (시트 구조 그대로):**

| 월 | 총매출 | 아이언펫 | 너티 | 영양제 | 사료 | 총비용 | 네검 | 쇼핑 | 메타 | GFA | 구글 | 쿠팡 | ROAS |
|----|--------|---------|------|-------|------|--------|------|------|------|-----|------|------|------|
| 12월 | 1,757만 | 58만 | 1,068만 | 222만 | 409만 | 952만 | 93만 | 75만 | 471만 | 23만 | 138만 | 52만 | 184% |
| 1월 | 2,490만 | 235만 | 1,135만 | ... | | | | | | | | | |

- MoM 증감률 색상 (▲초록 ▼빨강)
- 주별 동일 구조

---

## 9. 키워드 (`/keywords`) — P5

### 9.1 KPI

총 비용, 총 클릭, 키워드 수, 평균 CTR, 전환수, 키워드 ROAS

### 9.2 키워드 테이블 (sortable, filterable)

키워드, 브랜드, 플랫폼, 비용, 노출, 클릭, CTR, CPC, 전환, ROAS, 평균순위

### 9.3 키워드 그룹핑

- **브랜드명 키워드:** "너티", "아이언펫", "밸런스랩" 포함
- **일반 키워드:** 브랜드명 미포함
- 그룹별 성과 비교

### 9.4 TOP 비교

- 비용 TOP 10 vs 전환 TOP 10 (겹치는 키워드 하이라이트)

### 9.5 서치콘솔 버블 그래프 (기존 기능 복원)

- X축: CTR, Y축: 노출, 버블 크기: 비용
- 또는 X축: CPC, Y축: 전환율

---

## 10. 예산 현황 (`/budget`) — P7

### 10.1 월별 예산 vs 실적

| 항목 | 타겟 | 실적 | 진행률 | 잔여 |
|------|------|------|--------|------|
| 매출 | 9,300만 | 3,462만 | 37.2% | 5,838만 |
| 광고비 | 500만 | 653만 | 130.6% | ⚠️ 초과 |
| ROAS | 1860% | 409% | — | — |
| 날짜 | 31일 | 26일 | 83.9% | 5일 |

### 10.2 매체별 예산 분배

채널별 일예산 AS-IS / TO-BE / 실제 소진

---

## 11. Raw Data (`/raw`) — P7

### 11.1 테이블 선택

드롭다운: daily_sales / daily_ad_spend / product_sales / daily_funnel / keyword_performance

### 11.2 필터

날짜 범위, 브랜드, 채널, 검색

### 11.3 기능

- 정렬, 페이지네이션
- CSV 다운로드
- 행 수 표시

---

## 12. 설정 (`/settings`) — P6

### 12.1 탭 구조

| 탭 | 내용 |
|----|------|
| 📋 일일 입력 | 7개 입력 섹션 |
| 🎯 목표 설정 | 월별 매출/광고비/ROAS 목표 |
| 💰 제품 원가 | 상품별 원가/배송비 |
| 🏷️ 브랜드/채널 관리 | 동적 추가/수정/비활성화 |
| 📡 데이터 소스 | 수집 현황 + 누락 감지 |

### 12.2 브랜드/채널 관리 (v3 신규)

- 브랜드 추가/편집/비활성화 (색상, 라벨, 순서)
- 채널 추가/편집/비활성화 (색상, 라벨, 타입, 순서)
- 상품 카테고리 관리
- **코드 수정 없이 설정만으로 확장**

---

## 13. 기존 문제 해결 매핑

| # | 문제 | v3 해결 |
|---|------|---------|
| 1 | 공구 분리 안 됨 | ✅ product_sales unique constraint에 lineup 추가 완료 |
| 2 | 퍼널 brand 혼재 | ✅ brand = 퍼널 소스로 정의 + 밸런스랩 분리 |
| 3 | Meta API 중복 | ✅ 기존 행 삭제 후 추가 (이미 수정) |
| 4 | GA4 vs Google Ads 중복 | ✅ GA4는 퍼널 전용, 광고비 제외 |
| 5 | 채널명 영문 노출 | ✅ channel_config DB에서 한글 라벨 관리 |
| 6 | 기간 선택 불편 | ✅ 캘린더 + 프리셋 7종 |
| 7 | 브랜드 필터 누락 | ✅ 전 페이지 공통 필터 |
| 8 | 코드 ≠ 배포 불일치 | ✅ 프론트엔드 전체 새로 작성 |
| 9 | 밸런스랩 시트 분리 | ✅ Data Hub에 통합 |
| 10 | 하드코딩된 브랜드/채널 | ✅ DB 동적 관리 |
| 11 | 시트 5개 관리 불편 | ✅ Data Hub 1개로 통합 |
| 12 | 전환 데이터 부재 | ✅ API 최대 활용 (전환수/매출/CPA) |
| 13 | 월별/주별 표 없음 | ✅ /monthly 페이지 (시트 구조 그대로) |
| 14 | 테마 전환 시 글씨 안 보임 | ✅ 대비율 4.5:1 이상 검증 |

---

## 14. 인사이트 (`/insights`) — P8

> 기존 대시보드에 있던 기능. 자동 인사이트 생성.

### 자동 감지 항목
- **이상치:** 전일 대비 매출/광고비 ±30% 이상 변동
- **트렌드:** 3일 연속 상승/하락
- **효율:** ROAS 1.0 미만 채널 경고
- **누락:** 데이터 미수집 알림

### 인사이트 카드 분류
- 🔴 Critical — 즉시 대응 필요
- 🟡 Warning — 주의
- 🟢 Opportunity — 기회
- 🔵 Info — 참고

---

## 15. 설정 상세 — P6

### 일일 입력 7개 섹션

| # | 섹션 | 입력 방식 | DB 대상 | 상세 |
|---|------|----------|---------|------|
| 1 | 🟠 쿠팡 광고 | 엑셀 업로드 | daily_ad_spend (coupang_ads) | 광고보고서 XLSX |
| 2 | 🟠 쿠팡 퍼널 | 엑셀 업로드 | daily_funnel (coupang) | Daily Summary XLSX |
| 3 | 🟢 GFA 광고비 | 수기 (브랜드별) | daily_ad_spend (gfa) | 광고비/노출/클릭 |
| 4 | 🟩 스마트스토어 | 수기 (브랜드별) | daily_funnel (smartstore/balancelab_smartstore) | 유입/체류/알림/재구매 |
| 5 | 🛒 카페24 퍼널 | 수기 | daily_funnel (cafe24) | 장바구니/회원가입/재구매 |
| 6 | 📤 판매실적 | 엑셀 업로드 | daily_sales + product_sales + Sheet | 이카운트 XLSX, 채널/브랜드 자동매핑 |
| 7 | 🧾 건별 비용 | 수기 | misc_costs | 인플루언서/협찬/공구/기타 |

### 기타 탭
- 📌 마케팅 이벤트: 날짜/브랜드/제목/설명/색상 → 차트 마커
- 🎯 목표 설정: 월별×브랜드별 매출/광고비/ROAS 목표
- 💰 제품 원가: 상품별 원가/배송비, CSV 업로드, 미등록 상품 감지
- 🏷️ 브랜드/채널 관리: DB 동적 CRUD (색상/라벨/순서/활성)
- 📡 데이터 소스: 자동+수기 소스 현황, 누락 날짜

### 통상이익 계산식
```
통상이익 = 매출 - 광고비 - (수량 × 원가) - (수량 × 배송비) - 건별비용
이익률 = 통상이익 / 매출 × 100
```

---

## 16. 인코딩 방침

1. 모든 소스 파일: UTF-8 (BOM 없음)
2. Python: `sys.stdout.reconfigure(encoding='utf-8')` 최상단
3. PowerShell: `$env:PYTHONUTF8=1`
4. 한글 상수: DB/config에서 동적 로드 (코드 하드코딩 최소화)
5. .editorconfig: `charset = utf-8`

---

## 17. PPMI Data Hub 시트

**시트 ID:** `1qkTWrpPxUoNktmquXzjbVhMvZWUX1Mv2izJ06YKEzVM`

### 탭 구조
| 탭 | 용도 | 원본 |
|----|------|------|
| [N]Paid | 너티 광고 | 기존 통계시트 |
| [I]Paid | 아이언펫 광고 | 기존 통계시트 |
| [사입]Paid | 사입 광고 | 기존 통계시트 |
| [Q]Paid | 밸런스랩 광고 | 밸런스랩 시트 |
| Funnel | 퍼널 | 기존 통계시트 |
| Sales | 매출 | 기존 통계시트 |
| 상품 목록 | 품목 관리 | 기존 통계시트 |
| Meta Raw | Meta API 원본 | meta-ads-sheets |
| Naver Raw | Naver SA 원본 | naver-searchad-sheets |
| Google Raw | Google Ads 원본 | google-ads-sheets |
| GA4 Raw | GA4 원본 | GA4 시트 |

---

## 18. v2→v3 변경 총정리

### v2에서 없는 것 (v3 추가)
- 일별 매출 라인차트, 전기간 대비 변화율, 목표 대비 달성률
- 누적 매출 그래프, 공구별 매출 섹션
- 캠페인별 광고, 산점도, 채널 비중 변화
- 퍼널 브랜드 필터, Meta 광고 퍼널
- 키워드 그룹핑/ROAS/TOP 비교, 서치콘솔 버블
- 월별/주별 표, 예산 현황, Raw Data, 인사이트
- 브랜드/채널 동적 관리, 전환 데이터 활용

### 전환 데이터 상태
- Meta: 필드 수집 중, 값 0 → 픽셀/CAPI 설정 시 자동 표시
- Google Ads: conversions/conversions_value 수집 중 → 프론트 표시 추가
- 네이버 SA: salesAmt/ccnt 수집 중 → 동일
- 서치콘솔: P8에서 연동 (지금은 키워드 테이블로 대체)

---

## 19. v2 운영 교훈 (절대 원칙)

> 1개월 운영하면서 터진 버그 11개 + 교훈. **v3에서 반복하면 안 되는 것들.**

### 🚨 데이터 정합성 원칙

| # | 원칙 | 배경 |
|---|------|------|
| 1 | **Meta API = 진실의 원천** | 시트/DB 의심 시 반드시 API 직접 확인 |
| 2 | **지출 0원도 기록** | 캠페인 비활성화 시에도 노출/클릭 유지 필요 |
| 3 | **매출은 엑셀 업로드만** | GA4 전환 매출 ≠ 실매출. 이중 계산 위험 |
| 4 | **GA4 ≠ Google Ads** | 같은 P-Max 데이터가 2채널에 → 이중 집계 |
| 5 | **Funnel 열 절대 겹치지 않음** | GA4(X,Y) / cafe24(Z,AA,AC) / smartstore(AI~AM) / coupang(AQ~AT) |
| 6 | **None 값 안전 처리** | `r.get('reach', 0)` 아닌 `r.get('reach') or 0` |
| 7 | **시트 쓰기 = 삭제 + 삽입** | append-only → 중복. 항상 기존 삭제 후 삽입 |
| 8 | **집계 키에 lineup 포함** | lineup 빠지면 코루비/키키맘 합산됨 |
| 9 | **brand='all' 레코드 금지** | 개별 합산 = 전체. 별도 'all' 행 → 2배 중복 |
| 10 | **부분 성공 = 실패** | 에러 무시하고 200 응답 절대 금지 |

### 🔧 개발 원칙

| # | 원칙 | 배경 |
|---|------|------|
| 11 | **재시도 로직 필수** | sync_all.py 부분 실패 → 3회 재시도 + exit(1) |
| 12 | **exit code 정확하게** | 크론 실패 감지 = exit(1). 항상 0이면 모니터링 불가 |
| 13 | **DB→시트 원자적 실행** | sync_all.py 끝에 sync_db_to_sheet 자동 호출 |
| 14 | **크론 타이밍 = API 집계 완료 후** | 네이버 SA 08:30 완료 → 08:50 조회 |
| 15 | **필드 추가 시 전체 플로우 확인** | 원본시트 → sync_all → DB → sync_db_to_sheet → 통계시트 |
| 16 | **프론트 기대 필드 = API 반드시 반환** | gongguSales 미반환 → 빈 화면 |
| 17 | **검증 없이 '완료' 금지** | 최소 2-3일 모니터링 후 보고 |
| 18 | **에러 시 4xx/5xx 응답** | 200 금지. try-catch + 명확한 실패 |
| 19 | **인코딩 = UTF-8 강제** | cp949 → 한글 깨짐. 모든 파일/스크립트 UTF-8 |

### 🔍 디버깅 순서 (v3에도 적용)

문제 발생 시 **역순 추적:**
```
1. 화면 (사용자가 뭘 보는가?)
2. API 응답 (서버가 뭘 보냈는가?)
3. DB (실제 데이터는?)
4. 원본 데이터 (엑셀/API 원본은?)
```

**절대 코드만 보고 "정상이에요" 금지.**

### 📋 배포 전 체크리스트

- [ ] 에러 시 명확한 실패 응답 (4xx/5xx)
- [ ] 필수 필드 검증 (NOT NULL)
- [ ] 실제 운영 데이터로 테스트
- [ ] DB 직접 조회 검증
- [ ] 시트 직접 열어서 검증
- [ ] 중복 데이터 방지 (upsert or delete+insert)
- [ ] None/null 안전 처리
- [ ] 인코딩 확인 (한글 깨짐 없음)

### 🐛 v2에서 터진 버그 목록 (v3 방어)

| # | 버그 | 원인 | v3 방어 |
|---|------|------|---------|
| 1 | Meta 중복 5배 | append-only | upsert + 날짜별 삭제 후 삽입 |
| 2 | 네이버 SA 영구 누락 | 중복체크로 스킵 | 재수집 시 기존 삭제 후 재삽입 |
| 3 | GA4+Google 이중 집계 | 같은 데이터 2채널 | ga4_* 채널 total에서 제외 |
| 4 | brand='all' 2배 | 합산 레코드 별도 생성 | brand='all' 생성 금지 |
| 5 | 코루비/키키맘 합산 | lineup 미포함 키 | 집계 키에 lineup 포함 |
| 6 | quantity 항상 0 | daily_sales 집계 누락 | 모든 필드 명시적 포함 |
| 7 | category 누락 upsert 실패 | NOT NULL 미처리 | 필수 필드 검증 |
| 8 | reach 누락 | 코드 복붙 시 빠짐 | 필드 추가 시 전체 플로우 점검 |
| 9 | 크론 0건 수집 | API 집계 전 조회 | 크론 시간 = 집계 완료 + 여유 |
| 10 | sync 부분 실패 | exit(0) 고정 | 에러 추적 + exit(1) |
| 11 | 시트 재업로드 중복 | append-only | delete + insert 패턴 |

---

## 20. 브랜드/채널 분류 규칙 (현행)

> v3에서는 brand_config/channel_config DB로 동적 관리하지만, **마이그레이션 시 현행 규칙 그대로 초기 데이터로 넣어야 함.**

### 네이버 SA → 브랜드
```
캠페인명에 "아이언펫" → ironpet
캠페인명에 "너티" → nutty
캠페인명에 "사입" → saip
캠페인명에 "밸런스"/"큐모발" → balancelab
기본값 → nutty
```

### 네이버 SA → 채널
```
campaignTp == "SHOPPING" → naver_shopping
그 외 → naver_search
```

### Meta → 브랜드
```
시트명 "너티_campaign_v2" → nutty
시트명 "아이언펫_campaign_v2" → ironpet
시트명 "큐모발검사_campaign_v2" → balancelab
```

### 엑셀 업로드 → 브랜드
```
"너티"/"nutty" 포함 → nutty
"아이언펫"/"ironpet" 포함 → ironpet
"파미나"/"닥터레이" 포함 → saip
"밸런스랩"/"자체판매"/"큐모발" 포함 → balancelab
```

### 엑셀 업로드 → 채널
```
거래처명 CHANNEL_MAP:
  PPMI_자사몰(카페24) → cafe24
  PPMI_스마트스토어/YS_스마트스토어 → smartstore
  PPMI_쿠팡/PPMI_쿠팡 로켓그로스 → coupang
  매핑 없음 → other
```

### 공구 판별
```
상품목록 brand == "공동구매" 
  AND 거래처명에 "스마트스토어" 미포함
  → channel = "공구_{lineup}"
```

---

## 21. 자동화 크론 현황

| 시간 | 이름 | 작업 | 모델 |
|------|------|------|------|
| 01:00 | meta-ads-sync | Meta API → 시트 | Sonnet |
| 02:00 | marketing-data-sync-v2 | sync_all.py (시트→DB→시트) | Sonnet |
| 02:30 | sheet-sync-all-brands | DB→시트 백업 | Sonnet |
| 08:00 | naver-searchad-daily | 네이버 SA | Haiku |
| 08:05 | google-ads-daily | Google Ads | Haiku |
| 08:30 | ga4-funnel-daily | GA4→Funnel | Haiku |
| 08:50 | naver-searchad-daily | 네이버 SA (재) | Haiku |
| 10:00 | coupang-ads-sync-am | 쿠팡 광고 오전 | Haiku |
| 14:00 | coupang-ads-sync-pm | 쿠팡 광고 오후 | Haiku |

**v3에서 변경 필요:**
- 모든 시트 ID → Data Hub ID로 변경
- sync_db_to_sheet에 밸런스랩 추가
- 에러 시 텔레그램 알림 추가

---

## 22. 데이터 정합성 감사 (2026-04-06)

> 전체 API + DB + 프론트엔드 교차 검증 결과. 발견된 문제 → 원인 → 해결방안 → 재발방지.

### 22.1 발견된 문제 목록

| # | 심각도 | 문제 | 영향 |
|---|--------|------|------|
| D1 | CRITICAL | 공구 매출 전부 0 | Overview/매출 페이지에서 공구 데이터 미표시 |
| D2 | CRITICAL | 밸런스랩 매출 누락 (daily_sales에 공구분 미포함) | 밸런스랩 실제 매출의 ~40% 누락 |
| D3 | CRITICAL | Overview 누적매출 차트 빈 데이터 | sales/ads 배열 초기화 오류 |
| D4 | CRITICAL | daily_funnel 83%가 brand="all" | 브랜드별 퍼널 불가 |
| D5 | MAJOR | Dashboard funnelSummary 합산 불일치 (893 ≠ 844) | 퍼널 지표 부정확 |
| D6 | MAJOR | 광고비 cross-API 불일치 (miscCost 합산 기준 상이) | 페이지별 광고비 수치 불일치 |
| D7 | MAJOR | product_sales vs daily_sales 30%+ 차이 | 상품별 매출 ≠ 채널별 매출 |
| D8 | MAJOR | brand-detail 밸런스랩 lineupBreakdown 176% 차이 | 브랜드 드릴다운 수치 불일치 |
| D9 | MODERATE | 키워드 페이지 brand 파라미터 미전달 | 브랜드 필터 무시됨 |
| D10 | MODERATE | 광고 페이지 ROAS/CTR 프론트 재계산 | 서버 vs 클라이언트 계산 차이 가능 |
| D11 | MODERATE | content_performance 미래 날짜 (2026-12-21) | 잘못된 데이터 포함 |
| D12 | LOW | "all" 프리셋 하드코딩 2024-01-01 | 실제 데이터 시작일과 불일치 |

### 22.2 원인 분석

#### D1+D2: 공구 매출 0 & 밸런스랩 누락

**원인:** 엑셀 업로드 시 공구 주문은 `brand="공동구매"`, `channel="공구_{lineup}"`으로 저장되어야 하는데:
1. daily_sales에는 공구 데이터가 **아예 없음** (channel이 smartstore만 존재)
2. product_sales에는 공구 데이터가 **있음** (revenue 차이의 원인)
3. Dashboard API는 `r.channel.startsWith("공구_")`로 daily_sales만 조회 → 항상 0

**근본 원인:** sync_all.py 또는 엑셀 업로드 로직에서 공구 주문을 daily_sales에 별도 채널로 넣지 않고, product_sales에만 상품 단위로 넣음. daily_sales는 채널별 일 합산이라 공구가 smartstore에 합산되거나 누락됨.

#### D3: Overview 누적매출 빈 차트

**원인:** page.tsx에서 `const sales = []`, `const ads = []`로 빈 배열 초기화 후 누적 계산. API 응답의 `data.sales`를 사용해야 하는데 빈 배열로 덮어씀.

#### D4: daily_funnel brand="all"

**원인:** GA4 퍼널 데이터는 카페24 전체(너티+아이언펫+사입) 합산이라 개별 브랜드 분리 불가. sync_all.py에서 brand="all"로 저장. 밸런스랩만 스마트스토어 단독이라 분리 가능.

#### D5: funnelSummary 합산 오류

**원인:** daily_funnel의 purchases와 repurchases가 독립 집계됨. purchases는 daily_funnel 테이블, orders는 daily_sales 테이블에서 각각 합산 → 소스가 다름.

#### D6: 광고비 불일치

**원인:** Dashboard API는 `totalAdSpend = ad_spend + miscCost`로 합산. monthly-summary는 adSpend에 miscCost를 포함하지만 manual_monthly 테이블에서 별도 조회. 두 API의 miscCost 조회 조건이 다름 (하나는 date 기반, 하나는 month 기반).

#### D7: product_sales vs daily_sales 불일치

**원인:**
- daily_sales: 채널별 일 합산 (cafe24/smartstore/coupang 매출)
- product_sales: 상품별 매출 (모든 상품의 개별 매출)
- 밸런스랩: product_sales에 공구 포함 → daily_sales보다 큼
- 너티: product_sales 시작일(2025-12-22)이 daily_sales(2025-09-12)보다 늦음 → daily_sales가 더 큼

### 22.3 해결 계획 (P12: 데이터 정합성)

#### P12-1: 공구 매출 복구 (D1, D2, D8)

**방안:** daily_sales에 공구 데이터 삽입
```sql
-- product_sales에서 공구 매출을 daily_sales로 집계
INSERT INTO daily_sales (date, brand, channel, revenue, orders)
SELECT date, 'balancelab', '공구_' || lineup, SUM(revenue), SUM(quantity)
FROM product_sales 
WHERE brand = 'balancelab' AND product LIKE '%공구%'
GROUP BY date, lineup
ON CONFLICT (date, brand, channel) DO UPDATE SET revenue=EXCLUDED.revenue, orders=EXCLUDED.orders;
```
- 또는 Dashboard API에서 product_sales도 참조하여 공구 매출 산출
- sync_all.py에서 공구 주문을 daily_sales에 별도 channel로 적재하도록 수정

#### P12-2: Overview 빈 데이터 수정 (D3)

**방안:** page.tsx에서 빈 배열 초기화 제거, API 응답의 `data.sales`/`data.ads` 직접 사용
```typescript
// 수정 전: const sales = []; const ads = [];
// 수정 후: const sales = data?.sales || []; const ads = data?.ads || [];
```

#### P12-3: funnelSummary 정합성 (D5)

**방안:** Dashboard API의 funnelSummary에서 purchases를 daily_sales의 orders로 대체하거나, funnel API와 동일한 로직으로 통일
```
funnelSummary.purchases = KPI의 totalOrders (daily_sales 기준)
```

#### P12-4: 광고비 계산 통일 (D6)

**방안:** 모든 API에서 "광고비" 정의를 통일
- `adSpend` = 순수 매체비 (daily_ad_spend.spend 합산)
- `totalCost` = 매체비 + miscCost + shippingCost + COGS
- miscCost 조회: 항상 month 기반 (date가 아님)

#### P12-5: 키워드 brand 전달 (D9)

**방안:** keywords API에 brand 파라미터 추가, 프론트에서 전달

#### P12-6: 프론트 재계산 제거 (D3, D10)

**방안:** 서버에서 계산한 KPI를 그대로 사용. 프론트에서 재계산하는 모든 ROAS/CTR/CPC 로직 제거.
- Overview: API의 kpi 객체 직접 사용
- Ads: API에서 계산된 channel metrics 직접 사용
- Sales: API의 brandRevenue/topProducts 직접 사용

#### P12-7: content_performance 미래 데이터 정리 (D11)

```sql
DELETE FROM content_performance WHERE date > '2026-04-06';
```

### 22.4 재발 방지 원칙

1. **단일 진실 원천 (SSoT):** 모든 수치는 API 서버에서 1회 계산. 프론트엔드는 표시만.
2. **Cross-API 일관성 테스트:** 동일 기간 동일 브랜드로 dashboard/monthly-summary/brand-detail 호출 시 revenue 합계가 일치해야 함.
3. **공구 데이터 파이프라인:** sync 시 공구 주문은 반드시 daily_sales에 `channel="공구_{seller}"` 로 적재.
4. **프론트 재계산 금지:** KPI/ROAS/CTR 등은 API에서만 계산. 프론트는 `data.kpi.roas` 형태로만 접근.
5. **배포 전 정합성 체크:** 배포 전 `/api/dashboard`와 `/api/monthly-summary`의 매출 합계 교차 검증.

---

## 관련 노트

- [[PPMI 마케팅 대시보드 기획서]] — 기존 대시보드 분석
- [[PPMI 대시보드 v3 리버스엔지니어링]] — v2 상세 구조
- [[PPMI 회사 정보]]
