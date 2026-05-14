import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export async function logActivity(
  supabase: SupabaseClient<Database>,
  leagueId: string,
  divisionId: string | null,
  eventType: string,
  message: string,
): Promise<void> {
  await supabase.from("activity_log").insert({
    league_id: leagueId,
    division_id: divisionId,
    event_type: eventType,
    message,
  } as never);
}
