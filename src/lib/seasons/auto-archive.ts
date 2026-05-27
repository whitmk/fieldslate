// Write-on-read auto-archive. Any season with an end_date in the past and
// archived_at still null gets archived now. Single cheap UPDATE per visit,
// idempotent, scoped to the caller. Today's threshold is computed in the
// server's local time then stringified to YYYY-MM-DD — matches how the
// rest of the app handles date-only columns.
//
// Called from /dashboard/leagues (where the user manages seasons) and
// /dashboard (so admins who live on Overview don't see stale "active"
// seasons). Keep both in sync if the criteria ever changes — this helper is
// the single source of truth.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

function localTodayStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function autoArchivePastSeasons(
  supabase: SupabaseClient<Database>,
  ownerId: string,
): Promise<void> {
  await supabase
    .from("leagues")
    .update({
      archived_at: new Date().toISOString(),
      status: "archived",
    } as never)
    .eq("owner_id", ownerId)
    .is("archived_at", null)
    .not("end_date", "is", null)
    .lt("end_date", localTodayStr());
}
