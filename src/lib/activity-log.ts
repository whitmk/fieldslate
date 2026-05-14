"use server";

import { createClient } from "@/lib/supabase/server";

export async function logActivity(
  leagueId: string,
  divisionId: string | null,
  eventType: string,
  message: string,
): Promise<{ ok: boolean; error?: string }> {
  console.log("[logActivity] server action executing:", eventType, { leagueId, divisionId });
  const supabase = createClient();
  const { error } = await supabase.from("activity_log").insert({
    league_id: leagueId,
    division_id: divisionId || null,
    event_type: eventType,
    message,
  } as never);
  if (error) {
    console.error("[logActivity] insert failed:", error.message, error.code, { leagueId, divisionId, eventType });
    return { ok: false, error: `${error.code}: ${error.message}` };
  }
  return { ok: true };
}
