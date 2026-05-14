import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export async function logActivity(
  supabase: SupabaseClient<Database>,
  leagueId: string,
  divisionId: string | null,
  eventType: string,
  message: string,
): Promise<void> {
  const { error } = await supabase.from("activity_log").insert({
    league_id: leagueId,
    division_id: divisionId || null,
    event_type: eventType,
    message,
  } as never);
  if (error) console.error("[logActivity] insert failed:", error.message, { leagueId, eventType });
}
