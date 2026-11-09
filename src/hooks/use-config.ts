"use client";

import { useMemo } from "react";
import { useFetch } from "./use-dashboard-data";
import {
  BRAND_COLORS,
  BRAND_LABELS,
  CHANNEL_LABELS,
  CHANNEL_COLORS,
  type BrandConfig,
  type ChannelConfig,
} from "@/lib/types";

interface ConfigResponse {
  brands?: BrandConfig[];
  channels?: ChannelConfig[];
}

/**
 * 브랜드/채널 설정 fetch 훅.
 * API 실패 시 하드코딩 fallback 사용.
 */
export function useConfig() {
  // part=config: 브랜드·채널 설정만(질의 2개). 기본 응답은 원가·판매 상품까지 7개 질의 44KB 라 화면마다 받기엔 무겁다(2026-11-09).
  const { data, loading, error } = useFetch<ConfigResponse>("/api/settings?part=config");

  const brands = useMemo(() => {
    if (data?.brands?.length) {
      return data.brands
        .filter((b) => b.active)
        .sort((a, b) => a.order - b.order);
    }
    // fallback
    return Object.entries(BRAND_LABELS).map(([key, label], i) => ({
      id: i,
      key,
      label,
      color: BRAND_COLORS[key] || "#888",
      order: i,
      active: true,
    }));
  }, [data]);

  const channels = useMemo(() => {
    if (data?.channels?.length) {
      return data.channels
        .filter((c) => c.active)
        .sort((a, b) => a.order - b.order);
    }
    // fallback
    return Object.entries(CHANNEL_LABELS).map(([key, label], i) => ({
      id: i,
      key,
      label,
      color: CHANNEL_COLORS[key] || "#888",
      type: ["cafe24", "smartstore", "coupang", "ably", "petfriends"].includes(key)
        ? ("sales" as const)
        : ("ad" as const),
      auto: false,
      order: i,
      active: true,
    }));
  }, [data]);

  const brandMap = useMemo(() => {
    const m: Record<string, { label: string; color: string }> = {};
    // 색은 types.ts 가 정본이다(같은 대상 = 모든 화면 같은 색). 설정 DB 색은 types.ts 에 없는 새 키에만 쓴다.
    brands.forEach((b) => {
      m[b.key] = { label: b.label, color: BRAND_COLORS[b.key] || b.color };
    });
    return m;
  }, [brands]);

  const channelMap = useMemo(() => {
    const m: Record<string, { label: string; color: string; type: string }> = {};
    channels.forEach((c) => {
      m[c.key] = { label: c.label, color: CHANNEL_COLORS[c.key] || c.color, type: c.type };
    });
    return m;
  }, [channels]);

  return { brands, channels, brandMap, channelMap, loading, error };
}
