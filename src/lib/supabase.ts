import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL not configured");
if (!key) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY not configured");

export const supabase = createClient(url, key, {
  global: {
    fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
  },
});
