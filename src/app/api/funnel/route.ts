export const dynamic = "force-dynamic";

import { expandBrands } from "@/lib/brand-groups";
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/db";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const brand = sp.get("brand") || "all";
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";

  try {
    // Brand → funnel channels mapping
    const brandFunnelChannels: Record<string, string[]> = {
      pet: ["cafe24", "smartstore", "coupang"], // 너티+아이언펫+사입 통합 (퍼널 원천은 brand='all' 공용)
      nutty: ["cafe24", "smartstore", "coupang"],
      ironpet: ["cafe24", "smartstore"],
      saip: ["cafe24", "smartstore"],
      balancelab: ["smartstore"],
    };

    // ── 모든 DB 호출을 1회 병렬 배치로 (이전: 순차 4회 왕복) ──
    let adQuery = supabase
      .from("daily_ad_spend")
      .select("date, brand, channel, impressions, clicks")
      .gte("date", from).lte("date", to);
    if (brand !== "all") adQuery = adQuery.in("brand", expandBrands(brand));

    let salesQuery = supabase
      .from("daily_sales")
      .select("date, brand, channel, orders, revenue")
      .gte("date", from).lte("date", to)
      .neq("channel", "total"); // total 집계행 제외 (채널별 합산과 이중 계산 방지)
    if (brand !== "all") salesQuery = salesQuery.in("brand", expandBrands(brand));

    const [adRows, allFunnelRows, salesRows, metaRes] = await Promise.all([
      fetchAll(adQuery),
      fetchAll(supabase.from("daily_funnel").select("*").gte("date", from).lte("date", to).order("date", { ascending: true })),
      fetchAll(salesQuery),
      supabase.from("daily_ad_spend")
        .select("date,brand,impressions,clicks,conversions,conversion_value,reach,spend")
        .eq("channel", "meta").gte("date", from).lte("date", to).order("date"),
    ]);
    const metaData = metaRes.data;

    // Filter funnel rows by brand
    let funnelRows = allFunnelRows;
    if (brand !== "all") {
      const channels = brandFunnelChannels[brand];
      if (channels) {
        if (brand === "balancelab") {
          // 밸런스랩 → balancelab|smartstore만
          funnelRows = allFunnelRows.filter((r) => r.brand === "balancelab");
        } else {
          // 너티/아이언펫/사입 → all|cafe24, all|smartstore, all|coupang (해당 채널만)
          funnelRows = allFunnelRows.filter((r) => r.brand === "all" && channels.includes(r.channel));
        }
      }
    }

    // (salesRows는 위 병렬 배치에서 이미 가져옴)

    // ── Aggregate by date ──
    const dateMap = new Map<string, {
      impressions: number; clicks: number; sessions: number;
      cart_adds: number; purchases: number; orders: number; repurchases: number;
      imp_meta: number; imp_naver: number; imp_google: number; imp_coupang: number;
      sess_smartstore: number; sess_cafe24: number; sess_coupang: number;
      purch_smartstore: number; purch_cafe24: number; purch_coupang: number;
      signups: number; signups_cafe24: number; signups_smartstore: number;
      cart_smartstore: number; cart_cafe24: number; cart_coupang: number;
      subscribers: number;
    }>();

    const getDay = (date: string) => {
      if (!dateMap.has(date)) {
        dateMap.set(date, {
          impressions: 0, clicks: 0, sessions: 0, cart_adds: 0,
          purchases: 0, orders: 0, repurchases: 0,
          imp_meta: 0, imp_naver: 0, imp_google: 0, imp_coupang: 0,
          sess_smartstore: 0, sess_cafe24: 0, sess_coupang: 0,
          purch_smartstore: 0, purch_cafe24: 0, purch_coupang: 0,
          signups: 0, signups_cafe24: 0, signups_smartstore: 0,
          cart_smartstore: 0, cart_cafe24: 0, cart_coupang: 0,
          subscribers: 0,
        });
      }
      return dateMap.get(date)!;
    };

    // Impressions from ads
    for (const r of adRows) {
      const d = getDay(r.date);
      const imp = Number(r.impressions) || 0;
      d.impressions += imp;
      d.clicks += Number(r.clicks) || 0;
      if (r.channel === "meta") d.imp_meta += imp;
      else if (r.channel.startsWith("naver")) d.imp_naver += imp;
      else if (r.channel === "google_pmax" || r.channel === "google_ads" || r.channel === "google_search") d.imp_google += imp;
      else if (r.channel.startsWith("coupang")) d.imp_coupang += imp;
    }

    // Sessions/cart/signups from funnel (now using channel column)
    for (const r of funnelRows) {
      const d = getDay(r.date);
      const sess = Number(r.sessions) || 0;
      const cart = Number(r.cart_adds) || 0;
      const signups = Number(r.signups) || 0;
      const subscribers = Number(r.subscribers) || 0;
      d.sessions += sess;
      d.cart_adds += cart;
      // brand="all" 재구매는 통합 스마트스토어 수치 → brand 특정 조회 시 제외 (이중집계 방지)
      if (brand === "all" || r.brand !== "all") {
        d.repurchases += Number(r.repurchases) || 0;
      }
      d.signups += signups;
      d.subscribers += subscribers;
      // Channel breakdown (using r.channel)
      if (r.channel === "smartstore") {
        d.sess_smartstore += sess;
        d.cart_smartstore += cart;
        d.signups_smartstore += subscribers; // 스마트스토어 알림받기
      } else if (r.channel === "cafe24") {
        d.sess_cafe24 += sess;
        d.cart_cafe24 += cart;
        d.signups_cafe24 += signups;
      } else if (r.channel === "coupang") {
        d.sess_coupang += sess;
        d.cart_coupang += cart;
      }
    }

    // Purchases from sales
    for (const r of salesRows) {
      const d = getDay(r.date);
      const orders = Number(r.orders) || 0;
      d.orders += orders;
      const ch = r.channel || "";
      if (ch.includes("smartstore") || ch.includes("공구")) d.purch_smartstore += orders;
      else if (ch === "cafe24") d.purch_cafe24 += orders;
      else if (ch === "coupang") d.purch_coupang += orders;
      else d.purch_smartstore += orders;
    }

    const dates = Array.from(dateMap.entries()).sort(([a], [b]) => a.localeCompare(b));

    // Totals
    const totals = { impressions: 0, clicks: 0, sessions: 0, cart_adds: 0, purchases: 0, repurchases: 0, signups: 0 };
    const channelTotals = {
      cart_smartstore: 0, cart_cafe24: 0, cart_coupang: 0,
      sess_smartstore: 0, sess_cafe24: 0, sess_coupang: 0,
      signups_cafe24: 0, signups_smartstore: 0,
      purch_smartstore: 0, purch_cafe24: 0, purch_coupang: 0,
    };
    for (const [, d] of dates) {
      totals.impressions += d.impressions;
      totals.clicks += d.clicks;
      totals.sessions += d.sessions;
      totals.cart_adds += d.cart_adds;
      totals.signups += d.signups_cafe24 + d.signups_smartstore;
      const funnelPurch = d.purch_smartstore + d.purch_cafe24 + d.purch_coupang;
      totals.purchases += Math.max(funnelPurch, d.orders);
      totals.repurchases += d.repurchases;
      channelTotals.cart_smartstore += d.cart_smartstore;
      channelTotals.cart_cafe24 += d.cart_cafe24;
      channelTotals.cart_coupang += d.cart_coupang;
      channelTotals.sess_smartstore += d.sess_smartstore;
      channelTotals.sess_cafe24 += d.sess_cafe24;
      channelTotals.sess_coupang += d.sess_coupang;
      channelTotals.signups_cafe24 += d.signups_cafe24;
      channelTotals.signups_smartstore += d.signups_smartstore;
      channelTotals.purch_smartstore += d.purch_smartstore;
      channelTotals.purch_cafe24 += d.purch_cafe24;
      channelTotals.purch_coupang += d.purch_coupang;
    }

    // brand 필터 시: 노출/유입은 광고 데이터(브랜드별)를 우선 사용
    // GA4 funnel sessions은 brand="all" 합산이라 브랜드별 분리 불가
    if (brand !== "all" && totals.clicks > 0) {
      totals.sessions = totals.clicks;
      for (const [, d] of dates) {
        d.sessions = d.clicks;
      }
    }
    // all 브랜드에서도 funnel sessions 없으면 clicks fallback
    if (totals.sessions === 0 && totals.clicks > 0) {
      totals.sessions = totals.clicks;
      for (const [, d] of dates) {
        d.sessions = d.clicks;
      }
    }

    // 6-step funnel
    // 장바구니가 실제로 수집되는 채널만 골라, 그 채널의 구매만 분자로 쓴다(커버리지 정합).
    const cartCoverage = (() => {
      const defs = [
        { key: "카페24", cart: channelTotals.cart_cafe24, purch: channelTotals.purch_cafe24 },
        { key: "스마트스토어", cart: channelTotals.cart_smartstore, purch: channelTotals.purch_smartstore },
        { key: "쿠팡", cart: channelTotals.cart_coupang, purch: channelTotals.purch_coupang },
      ];
      const withCart = defs.filter(d => d.cart > 0);
      return {
        cart: withCart.reduce((s, d) => s + d.cart, 0),
        purch: withCart.reduce((s, d) => s + d.purch, 0),
        channels: withCart.map(d => d.key),
        partial: withCart.length > 0 && withCart.length < defs.length,
      };
    })();

    const funnel = [
      { name: "노출", value: totals.impressions },
      { name: "유입", value: totals.sessions,
        rate: totals.impressions > 0 ? (totals.sessions / totals.impressions) * 100 : 0,
        channels: { 카페24: channelTotals.sess_cafe24, 스마트스토어: channelTotals.sess_smartstore, 쿠팡: channelTotals.sess_coupang } },
      { name: "장바구니", value: totals.cart_adds,
        rate: totals.sessions > 0 ? (totals.cart_adds / totals.sessions) * 100 : 0,
        channels: { 카페24: channelTotals.cart_cafe24, 스마트스토어: channelTotals.cart_smartstore, 쿠팡: channelTotals.cart_coupang } },
      { name: "회원가입", value: totals.signups,
        rate: totals.sessions > 0 ? (totals.signups / totals.sessions) * 100 : 0,
        channels: { 카페24: channelTotals.signups_cafe24, "스마트스토어(알림)": channelTotals.signups_smartstore } },
      { name: "구매", value: totals.purchases,
        // ★ 장바구니→구매 전환율은 "두 단계 모두 데이터가 있는 채널"로만 계산한다.
        //   장바구니는 일부 채널만 수집되는데 구매는 전 채널 합산이라, 그대로 나누면
        //   548% 같은 값이 나와 퍼널 전체의 신뢰를 깼다(2026-08 리뷰).
        rate: cartCoverage.cart > 0 ? (cartCoverage.purch / cartCoverage.cart) * 100 : 0,
        rateNote: cartCoverage.partial
          ? `장바구니 수집 채널(${cartCoverage.channels.join("·") || "없음"}) 기준 — 다른 채널은 장바구니 미수집이라 제외`
          : null,
        rateBase: cartCoverage.cart, rateNum: cartCoverage.purch },
    ];
    const repurchase = { value: totals.repurchases, rate: totals.purchases > 0 ? (totals.repurchases / totals.purchases * 100) : 0 };

    // Daily trend
    const trend = dates.map(([date, d]) => ({
      date,
      sessions: d.sessions,
      cart_adds: d.cart_adds,
      purchases: Math.max(d.purch_smartstore + d.purch_cafe24 + d.purch_coupang, d.orders),
      impressions: d.impressions,
      sessions_smartstore: d.sess_smartstore,
      sessions_cafe24: d.sess_cafe24,
      sessions_coupang: d.sess_coupang,
      purchases_smartstore: d.purch_smartstore,
      purchases_cafe24: d.purch_cafe24,
      purchases_coupang: d.purch_coupang,
      imp_meta: d.imp_meta,
      imp_naver: d.imp_naver,
      imp_google: d.imp_google,
      imp_coupang: d.imp_coupang,
    }));

    // Channel-level funnel summaries — purchases from daily_sales (기준 데이터)
    const channelMap = new Map<string, { sessions: number; cart_adds: number; purchases: number; repurchases: number }>();
    for (const r of funnelRows) {
      const ch = r.channel;
      const existing = channelMap.get(ch) || { sessions: 0, cart_adds: 0, purchases: 0, repurchases: 0 };
      existing.sessions += Number(r.sessions) || 0;
      existing.cart_adds += Number(r.cart_adds) || 0;
      if (brand === "all" || r.brand !== "all") {
        existing.repurchases += Number(r.repurchases) || 0;
      }
      channelMap.set(ch, existing);
    }
    // 구매수는 daily_sales에서 채널별로 집계 (기획서: 매출 데이터가 기준)
    for (const r of salesRows) {
      const ch = r.channel || "";
      const chKey = ch === "cafe24" ? "cafe24" : ch === "coupang" ? "coupang" : "smartstore";
      const existing = channelMap.get(chKey) || { sessions: 0, cart_adds: 0, purchases: 0, repurchases: 0 };
      existing.purchases += Number(r.orders) || 0;
      channelMap.set(chKey, existing);
    }
    const channelLabels: Record<string, string> = { cafe24: "카페24", smartstore: "스마트스토어", coupang: "쿠팡" };
    const channelFunnel = Array.from(channelMap.entries()).map(([ch, d]) => ({
      channel: channelLabels[ch] || ch,
      sessions: d.sessions,
      cart_adds: d.cart_adds,
      purchases: d.purchases,
      repurchases: d.repurchases,
      convRate: d.sessions > 0 ? (d.purchases / d.sessions * 100) : 0,
    }));

    // (metaData는 위 병렬 배치에서 이미 가져옴)
    return NextResponse.json({ funnel, trend, channelFunnel, repurchase, metaAds: metaData || [] });
  } catch (error) {
    console.error("Funnel API error:", error);
    return NextResponse.json({ error: "Failed to fetch funnel data" }, { status: 500 });
  }
}
