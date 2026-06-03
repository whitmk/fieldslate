import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// Service-role Supabase client — BYPASSES RLS. Server-only. Used exclusively
// by trusted, session-less server contexts that have already authenticated the
// caller out-of-band (e.g. the Stripe webhook, which verifies the Stripe
// signature before touching the DB). NEVER import this into client code or a
// route that runs on a user session — it has no row-level protection.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase service role is not configured.");
  }
  return createSupabaseClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
