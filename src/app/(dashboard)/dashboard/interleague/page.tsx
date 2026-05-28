import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/orgs/context";
import { InterleaguePageClient } from "@/components/interleague/interleague-page-client";

export default async function InterleaguePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const currentOrgId = await getCurrentOrgId(supabase, user!.id);

  return <InterleaguePageClient currentOrgId={currentOrgId} />;
}
