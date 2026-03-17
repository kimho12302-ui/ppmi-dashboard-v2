import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
  try {
    const [costsRes, productsRes] = await Promise.all([
      supabase.from("product_costs").select("*").order("brand"),
      supabase.from("product_sales").select("product, brand").order("product"),
    ]);

    // Unique products from product_sales
    const productSet = new Map<string, string>();
    (productsRes.data || []).forEach((p: { product: string; brand: string }) => {
      if (!productSet.has(p.product)) {
        productSet.set(p.product, p.brand);
      }
    });
    const allProducts = Array.from(productSet.entries()).map(([product, brand]) => ({ product, brand }));

    // Products that have costs registered
    const registeredProducts = new Set((costsRes.data || []).map((c: { product: string }) => c.product));
    const missingProducts = allProducts.filter((p) => !registeredProducts.has(p.product));

    return NextResponse.json({
      costs: costsRes.data || [],
      allProducts,
      missingProducts,
    });
  } catch (error) {
    console.error("Settings API error:", error);
    return NextResponse.json({ error: "Failed to fetch data" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { product, brand, cost_price, shipping_cost, category } = body;

    const { data, error } = await supabase
      .from("product_costs")
      .upsert({ product, brand, cost_price, shipping_cost, category }, { onConflict: "product,brand" })
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("Settings POST error:", error);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const product = sp.get("product") || "";
    const brand = sp.get("brand") || "";

    const { error } = await supabase
      .from("product_costs")
      .delete()
      .eq("product", product)
      .eq("brand", brand);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Settings DELETE error:", error);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}
