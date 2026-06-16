import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { google } from "googleapis";
import { triggerSheetSync } from "@/lib/github-dispatch";

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

const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];
function toSheetDateLabel(date: string) {
  const dt = new Date(`${date}T00:00:00+09:00`);
  return `${dt.getMonth() + 1}월 ${dt.getDate()}일 (${DAY_NAMES[dt.getDay()]})`;
}

async function findFunnelRowIndex(date: string) {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: STATS_SHEET_ID,
    range: "Funnel!A:A",
  });
  const values = res.data.values || [];
  const target = toSheetDateLabel(date);
  for (let i = 0; i < values.length; i++) {
    if (String(values[i]?.[0] || "").includes(target)) return i + 1;
  }
  throw new Error(`Funnel row not found for ${date}`);
}

async function syncCafe24RowToSheet(date: string) {
  const rowNum = await findFunnelRowIndex(date);
  const { data } = await supabase.from("daily_funnel").select("*").eq("channel", "cafe24").eq("date", date);
  const rows = data || [];
  let sessions = 0, cartAdds = 0, newVisitors = 0, registrations = 0, repurchases = 0, avgDuration = 0, totalUsers = 0;
  for (const r of rows) {
    sessions = Math.max(sessions, Number(r.sessions || 0));
    cartAdds = Math.max(cartAdds, Number(r.cart_adds || 0));
    newVisitors = Math.max(newVisitors, Number(r.signups || 0));
    registrations = Math.max(registrations, Number(r.purchases || 0));
    repurchases = Math.max(repurchases, Number(r.repurchases || 0));
    avgDuration = Math.max(avgDuration, Number(r.avg_duration || 0));
    totalUsers = Math.max(totalUsers, Number(r.subscribers || 0));
  }
  const returning = Math.max(0, totalUsers - newVisitors);
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: STATS_SHEET_ID,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        { range: `Funnel!T${rowNum}`, values: [[sessions]] },
        { range: `Funnel!U${rowNum}`, values: [[newVisitors]] },
        { range: `Funnel!V${rowNum}`, values: [[returning]] },
        { range: `Funnel!W${rowNum}`, values: [[totalUsers]] },
        { range: `Funnel!X${rowNum}`, values: [[sessions]] },
        { range: `Funnel!Y${rowNum}`, values: [[Math.round(avgDuration)]] },
        { range: `Funnel!Z${rowNum}`, values: [[cartAdds]] },
        { range: `Funnel!AA${rowNum}`, values: [[registrations]] },
        { range: `Funnel!AC${rowNum}`, values: [[repurchases]] },
      ],
    },
  });
}

async function syncSmartstoreRowToSheet(date: string) {
  const rowNum = await findFunnelRowIndex(date);
  const { data } = await supabase.from("daily_funnel").select("*").eq("channel", "smartstore").eq("date", date);
  const rows = data || [];
  let sessions = 0, subscribers = 0, repurchases = 0, avgDuration = 0;
  for (const r of rows) {
    sessions += Number(r.sessions || 0);
    subscribers += Number(r.subscribers || 0);
    repurchases += Number(r.repurchases || 0);
    avgDuration = Math.max(avgDuration, Number(r.avg_duration || 0));
  }
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: STATS_SHEET_ID,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        { range: `Funnel!AI${rowNum}`, values: [[sessions]] },
        { range: `Funnel!AJ${rowNum}`, values: [[Math.round(avgDuration)]] },
        { range: `Funnel!AK${rowNum}`, values: [[subscribers]] },
        { range: `Funnel!AM${rowNum}`, values: [[repurchases]] },
      ],
    },
  });
}

// ─── GET ─────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const type = req.nextUrl.searchParams.get("type");

    if (type === "brand_config") {
      const { data } = await supabase.from("brand_config").select("*").order("order");
      return NextResponse.json({ brandConfig: data || [] });
    }

    if (type === "channel_config") {
      const { data } = await supabase.from("channel_config").select("*").order("order");
      return NextResponse.json({ channelConfig: data || [] });
    }

    if (type === "product_costs") {
      const [costsRes, listRes] = await Promise.all([
        supabase.from("product_costs").select("*").order("brand"),
        supabase.from("product_list").select("*"),
      ]);
      return NextResponse.json({
        productCosts: costsRes.data || [],
        productList: listRes.data || [],
      });
    }

    if (type === "shipping_costs") {
      const { data } = await supabase
        .from("shipping_costs")
        .select("*")
        .order("month", { ascending: false });
      return NextResponse.json({ shippingCosts: data || [] });
    }

    if (type === "misc_costs") {
      const { data } = await supabase
        .from("misc_costs")
        .select("*")
        .order("date", { ascending: false })
        .limit(100);
      return NextResponse.json({ miscCosts: data || [] });
    }

    // default: return everything
    const [costsRes, listRes, miscRes, shipRes, salesRes, brandRes, channelRes] = await Promise.all([
      supabase.from("product_costs").select("*").order("brand"),
      supabase.from("product_list").select("*"),
      supabase.from("misc_costs").select("*").order("date", { ascending: false }).limit(50),
      supabase.from("shipping_costs").select("*").order("month", { ascending: false }),
      supabase.from("product_sales").select("product, brand").order("product"),
      supabase.from("brand_config").select("*").order("order"),
      supabase.from("channel_config").select("*").order("order"),
    ]);

    const costs = costsRes.data || [];
    const allProducts = Array.from(new Map((salesRes.data || []).map((p: { product: string; brand: string }) => [p.product + p.brand, p])).values());
    const costSet = new Set(costs.map((c: { product: string; brand: string }) => c.product + c.brand));
    const missingProducts = allProducts.filter((p: { product: string; brand: string }) => !costSet.has(p.product + p.brand));

    return NextResponse.json({
      costs,
      productCosts: costs,
      productList: listRes.data || [],
      allProducts,
      missingProducts,
      manualCosts: [],
      miscCosts: miscRes.data || [],
      shippingCosts: shipRes.data || [],
      brands: brandRes.data || [],
      channels: channelRes.data || [],
    });
  } catch (error) {
    console.error("Settings GET error:", error);
    return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  }
}

// ─── POST ────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { type, data, forceOverride, extra } = body;

    switch (type) {
      // ── 스마트스토어 퍼널 (일반 / 밸런스랩) ──
      case "smartstore_funnel": {
        const { date, brand, subscribers, sessions, avg_duration, repurchases } = data;
        // 기획서 2.7: 너티/아이언펫/사입 통합 → brand="all", 밸런스랩 전용 → brand="balancelab"
        const dbBrand = brand === "balancelab" ? "balancelab" : "all";

        const { error } = await supabase.from("daily_funnel").upsert(
          {
            date,
            brand: dbBrand,
            channel: "smartstore",
            subscribers: Number(subscribers) || 0,
            sessions: Number(sessions) || 0,
            avg_duration: Number(avg_duration) || 0,
            repurchases: Number(repurchases) || 0,
          },
          { onConflict: "date,brand,channel" }
        );
        if (error) throw error;
        // 시트 역동기화는 best-effort: 실패해도 DB 저장은 완료된 상태이므로 200 유지
        let sheetWarning: string | null = null;
        try {
          await syncSmartstoreRowToSheet(date);
        } catch (e) {
          sheetWarning = e instanceof Error ? e.message : String(e);
          console.warn("smartstore sheet sync failed:", sheetWarning);
        }
        return NextResponse.json({
          ok: true,
          message: `smartstore 퍼널 저장 완료 (${date})`,
          ...(sheetWarning ? { sheetWarning } : {}),
        });
      }

      // ── 카페24 퍼널 ──
      case "cafe24_funnel": {
        const { date, cart_adds, purchases, repurchases } = data;
        // purchases 컬럼을 카페24 실제 회원가입 수 저장에 사용
        // signups는 GA4 신규방문자 전용이므로 수기입력 시 건드리지 않음
        const { error } = await supabase.from("daily_funnel").upsert(
          {
            date,
            brand: "all",
            channel: "cafe24",
            cart_adds: Number(cart_adds) || 0,
            purchases: Number(purchases) || 0,
            repurchases: Number(repurchases) || 0,
          },
          { onConflict: "date,brand,channel" }
        );
        if (error) throw error;
        let sheetWarning: string | null = null;
        try {
          await syncCafe24RowToSheet(date);
        } catch (e) {
          sheetWarning = e instanceof Error ? e.message : String(e);
          console.warn("cafe24 sheet sync failed:", sheetWarning);
        }
        return NextResponse.json({
          ok: true,
          message: `카페24 퍼널 저장 완료 (${date})`,
          ...(sheetWarning ? { sheetWarning } : {}),
        });
      }

      // ── 쿠팡 퍼널 (수기입력) ──
      case "coupang_funnel": {
        const { date, impressions, sessions, cart_adds, purchases } = data;
        const { error } = await supabase.from("daily_funnel").upsert(
          {
            date,
            brand: "all",
            channel: "coupang",
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

      // ── 수동 광고비 (GFA 등) ──
      case "manual_ad_spend": {
        const { date, channel, brand, spend, impressions, clicks, conversions, conversion_value } = data;
        // 기획서 원칙 9: daily_ad_spend에 brand="all" 금지 — 브랜드 필수
        if (!brand || brand === "all") {
          return NextResponse.json({ error: "브랜드를 선택해주세요" }, { status: 400 });
        }
        const row: Record<string, unknown> = {
          date,
          channel: channel || "gfa",
          brand,
          spend: Number(spend) || 0,
          impressions: Number(impressions) || 0,
          clicks: Number(clicks) || 0,
          conversions: Number(conversions) || 0,
          conversion_value: Number(conversion_value) || 0,
        };

        if (extra?.subscribers !== undefined) {
          (row as Record<string, unknown>).subscribers = Number(extra.subscribers) || 0;
        }

        if (!forceOverride) {
          const existing = await supabase
            .from("daily_ad_spend")
            .select("id")
            .eq("date", date)
            .eq("channel", row.channel as string)
            .eq("brand", row.brand as string)
            .maybeSingle();
          if (existing.data) {
            return NextResponse.json(
              { error: "중복", message: `${date} ${channel} 데이터가 이미 있습니다` },
              { status: 409 }
            );
          }
        }

        const { error } = await supabase
          .from("daily_ad_spend")
          .upsert(row, { onConflict: "date,channel,brand" });
        if (error) throw error;
        // GFA 등 수동 광고비는 정규 DB→시트 싱크가 GFA를 건너뛰므로, 저장 직후 해당 날짜 sheet-sync를 직접 트리거 → ~1분 내 시트 반영.
        const sheetSyncTriggered = await triggerSheetSync(date, date);
        return NextResponse.json({ ok: true, message: `${channel} ${date} 저장 완료`, sheetSyncTriggered });
      }

      // ── 제품 원가 ──
      case "product_cost": {
        const { product, brand, cost_price, manufacturing_cost, shipping_cost, category } = data;
        const { error } = await supabase.from("product_costs").upsert(
          {
            product,
            brand,
            cost_price: Number(cost_price) || 0,
            manufacturing_cost: Number(manufacturing_cost) || 0,
            shipping_cost: Number(shipping_cost) || 0,
            category: category || "",
          },
          { onConflict: "product,brand" }
        );
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }

      // ── 배송비 ──
      case "shipping_cost": {
        const { month, brand, total_cost, total_orders, note } = data;
        if (!forceOverride) {
          const existing = await supabase
            .from("shipping_costs")
            .select("id")
            .eq("month", month)
            .eq("brand", brand)
            .maybeSingle();
          if (existing.data) {
            return NextResponse.json(
              { error: "중복", message: `${month} ${brand} 배송비가 이미 있습니다` },
              { status: 409 }
            );
          }
        }
        const { error } = await supabase.from("shipping_costs").upsert(
          {
            month,
            brand,
            total_cost: Number(total_cost) || 0,
            total_orders: Number(total_orders) || 0,
            note: note || "",
          },
          { onConflict: "month,brand" }
        );
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }

      // ── 건별 비용 ──
      case "misc_cost": {
        const { date, brand, category, description, amount, note } = data;
        if (!forceOverride) {
          const existing = await supabase
            .from("misc_costs")
            .select("id")
            .eq("date", date)
            .eq("brand", brand)
            .eq("category", category || "other")
            .eq("description", description || "")
            .maybeSingle();
          if (existing.data) {
            return NextResponse.json(
              { error: "중복", message: "동일한 비용이 이미 있습니다" },
              { status: 409 }
            );
          }
        }
        const { error } = await supabase.from("misc_costs").insert({
          date,
          brand,
          category: category || "other",
          description: description || "",
          amount: Number(amount) || 0,
          note: note || "",
        });
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }

      // ── 브랜드 설정 ──
      case "brand_config": {
        const { key, label, color, order: ord, active, parent_key, category } = data;
        const { error } = await supabase.from("brand_config").upsert(
          { key, label, color: color || "#6b7280", order: ord || 0, active: active !== false, parent_key: parent_key || null, category: category || null },
          { onConflict: "key" }
        );
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }

      // ── 채널 설정 ──
      case "channel_config": {
        const { key, label, color, type: chType, auto: chAuto, order: ord, active } = data;
        const { error } = await supabase.from("channel_config").upsert(
          { key, label, color: color || "#6b7280", type: chType || "ad", auto: chAuto || false, order: ord || 0, active: active !== false },
          { onConflict: "key" }
        );
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }

      // ── 공구 목표 ──
      case "gonggu_target": {
        const { month, seller, target, note } = data;
        const { error } = await supabase.from("gonggu_targets").upsert(
          {
            month,
            seller,
            target: Number(target) || 0,
            note: note || "",
          },
          { onConflict: "month,seller" }
        );
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json({ error: `Unknown type: ${type}` }, { status: 400 });
    }
  } catch (error) {
    console.error("Settings POST error:", error);
    return NextResponse.json({ error: "저장 실패" }, { status: 500 });
  }
}

// ─── DELETE ──────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const type = sp.get("type");
    const id = sp.get("id");

    if (type === "brand_config" && id) {
      await supabase.from("brand_config").delete().eq("id", id);
      return NextResponse.json({ ok: true });
    } else if (type === "channel_config" && id) {
      await supabase.from("channel_config").delete().eq("id", id);
      return NextResponse.json({ ok: true });
    } else if (type === "product_cost" || !type) {
      const product = sp.get("product") || "";
      const brand = sp.get("brand") || "";
      if (product) {
        await supabase.from("product_costs").delete().eq("product", product).eq("brand", brand);
      }
    } else if (type === "shipping_cost" && id) {
      await supabase.from("shipping_costs").delete().eq("id", id);
    } else if (type === "misc_cost" && id) {
      await supabase.from("misc_costs").delete().eq("id", id);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Settings DELETE error:", error);
    return NextResponse.json({ error: "삭제 실패" }, { status: 500 });
  }
}
