import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/orgs/context";
import { NewLeagueForm } from "@/components/leagues/new-league-form";

export default async function NewLeaguePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const currentOrgId = await getCurrentOrgId(supabase, user!.id);

  return <NewLeagueForm currentOrgId={currentOrgId} />;
}
