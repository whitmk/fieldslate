import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/orgs/context";
import { getCurrentSeasonId } from "@/lib/seasons/context";
import { InterleaguePageClient } from "@/components/interleague/interleague-page-client";

export default async function InterleaguePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const currentOrgId = await getCurrentOrgId(supabase, user!.id);

  // Season-scoped (Chunk B2): invites, counter-proposals, and reschedule
  // requests follow the topbar's selected season. The org directory itself
  // stays org-scoped. Null (no active seasons) disables invite actions via
  // the client's existing canSendInvite guard.
  const seasonId = await getCurrentSeasonId(supabase, currentOrgId);
  const { data: seasonRow } = seasonId
    ? await supabase
        .from("leagues")
        .select("id, name, season")
        .eq("id", seasonId)
        .maybeSingle()
    : { data: null };
  const season =
    (seasonRow as { id: string; name: string; season: string | null } | null) ??
    null;

  return <InterleaguePageClient currentOrgId={currentOrgId} season={season} />;
}
