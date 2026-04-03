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
  const { data, loading, error } = useFetch<ConfigResponse>("/api/settings");

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
    brands.forEach((b) => {
      m[b.key] = { label: b.label, color: b.color };
    });
    return m;
  }, [brands]);

  const channelMap = useMemo(() => {
    const m: Record<string, { label: string; color: string; type: string }> = {};
    channels.forEach((c) => {
      m[c.key] = { label: c.label, color: c.color, type: c.type };
    });
    return m;
  }, [channels]);

  return { brands, channels, brandMap, channelMap, loading, error };
}
