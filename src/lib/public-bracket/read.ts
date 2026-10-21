// The one read behind /s/<token>/bracket/<division>/data. SERVER ONLY. A
// plain anon client — no cookies, no session: the token is the whole
// credential, and get_league_bracket_by_token (0116) derives the org from it,
// requires the division to belong to that org's season, and returns no league
// data unless its answer is 'ok'.
//
// FAILS CLOSED: an RPC error, a missing body or an answer this code does not
// recognise is { status: "error" } — never an empty bracket. The route sends
// that as 503 + no-store (public-schedule/links.ts).

import { createNoStoreClient } from "@/lib/supabase/no-store";
import { TOKEN_RE } from "@/lib/public-schedule/types";
import { DIVISION_ID_RE, type PublicBracketResponse } from "./types";

const ANSWERS = new Set(["ok", "unknown", "off", "plan", "unavailable", "unpublished", "no_bracket", "not_shareable"]);
const NAMED = new Set(["unpublished", "no_bracket", "not_shareable"]);

export async function readPublicBracket(token: string, divisionId: string): Promise<PublicBracketResponse> {
  // A malformed token or division id never reaches the database.
  if (!TOKEN_RE.test(token)) return { status: "unknown" };
  if (!DIVISION_ID_RE.test(divisionId)) return { status: "unavailable" };

  // no-store, ALWAYS (no-store.ts — the Majors incident, 2026-10-08).
  const supabase = createNoStoreClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const { data, error } = await supabase.rpc("get_league_bracket_by_token", {
    p_token: token,
    p_division_id: divisionId,
  });
  if (error || !data || typeof data !== "object") {
    console.error("[public bracket] reader failed:", error?.message ?? "no data");
    return { status: "error" };
  }
  const body = data as { status?: unknown; brackets?: unknown; division?: { name?: unknown } };
  const status = body.status;
  if (typeof status !== "string" || !ANSWERS.has(status)) {
    console.error("[public bracket] unexpected reader answer:", String(status));
    return { status: "error" };
  }
  if (status === "ok" && !Array.isArray(body.brackets)) {
    console.error("[public bracket] ok answer without brackets");
    return { status: "error" };
  }
  if (NAMED.has(status) && typeof body.division?.name !== "string") {
    console.error("[public bracket] refusal without a division name");
    return { status: "error" };
  }
  return data as PublicBracketResponse;
}
