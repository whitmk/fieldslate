// The one read behind /s/<token> (the page's data route) and /s/<token>.ics.
// SERVER ONLY. A plain anon client — no cookies, no session: the token is the
// whole credential, and get_league_schedule_by_token (0105) derives everything
// else and returns no league data unless its answer is 'ok'.
//
// FAILS CLOSED: an RPC error, a missing body or an answer this code does not
// recognise is { status: "error" } — never an empty schedule. The routes send
// that as 503 + no-store (links.ts).

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { PublicScheduleResponse } from "./types";
import { TOKEN_RE } from "./types";

const ANSWERS = new Set(["ok", "unknown", "off", "plan"]);

export async function readPublicSchedule(token: string): Promise<PublicScheduleResponse> {
  // A malformed token never reaches the database.
  if (!TOKEN_RE.test(token)) return { status: "unknown" };

  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await supabase.rpc("get_league_schedule_by_token", { p_token: token });
  if (error || !data || typeof data !== "object") {
    console.error("[public schedule] reader failed:", error?.message ?? "no data");
    return { status: "error" };
  }
  const status = (data as { status?: unknown }).status;
  if (typeof status !== "string" || !ANSWERS.has(status)) {
    console.error("[public schedule] unexpected reader answer:", String(status));
    return { status: "error" };
  }
  if (status === "ok" && !Array.isArray((data as { seasons?: unknown }).seasons)) {
    console.error("[public schedule] ok answer without seasons");
    return { status: "error" };
  }
  return data as PublicScheduleResponse;
}
