// 판매 상품 구성표(product_components) 읽기. 규칙은 src/lib/product-components.ts.
//
// 표가 없으면(docs/sql/2026-11-09-product-components.sql 실행 전) 빈 색인을 돌려준다.
// 빈 색인이면 expandSales 가 모든 행을 그대로 통과시켜 화면은 예전과 똑같다.
// 다른 오류(연결 끊김 등)는 던진다. 조용히 빈 색인으로 넘어가면 세트가 안 풀린 숫자를
// 정상인 것처럼 보여 주게 된다.
//
// 로컬 확인용: PRODUCT_COMPONENTS_SEED_FILE 에 시드 JSON(scripts/product-components/seed.json)
// 경로를 주면 표 대신 그 파일을 읽는다. SQL 실행 전에 화면 숫자를 미리 보려고 둔 것이라
// 배포 환경에는 넣지 않는다.

import { readFileSync } from "node:fs";
import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/db";
import { isMissingTable } from "@/lib/bl-pnl";
import {
  PRODUCT_COMPONENTS_TABLE, EMPTY_COMPONENT_INDEX, buildComponentIndex,
  type ComponentIndex, type ComponentRow,
} from "@/lib/product-components";

const COLUMNS = "brand,sale_product,component,qty,price_share";

/** 표 줄 그대로. 화면(클라이언트)이 직접 풀어야 할 때 응답에 실어 보낸다. 표가 없으면 [] */
export async function loadComponentRows(): Promise<ComponentRow[]> {
  const seedFile = process.env.PRODUCT_COMPONENTS_SEED_FILE;
  if (seedFile) {
    const seed = JSON.parse(readFileSync(seedFile, "utf8").replace(/^﻿/, "")) as { rows?: ComponentRow[] };
    return seed.rows || [];
  }
  try {
    // 기본키가 (brand, sale_product, component) 라 id 가 없다. 그 셋으로 전순서를 만든다
    return await fetchAll<ComponentRow>(
      supabase.from(PRODUCT_COMPONENTS_TABLE).select(COLUMNS).order("brand").order("sale_product"),
      "component",
    );
  } catch (error) {
    if (isMissingTable(error as { code?: string })) return [];
    throw error;
  }
}

export async function loadComponentIndex(): Promise<ComponentIndex> {
  const rows = await loadComponentRows();
  return rows.length ? buildComponentIndex(rows) : EMPTY_COMPONENT_INDEX;
}
