import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/orgs/context";
import { PlayoffsPageClient } from "@/components/playoffs/playoffs-page-client";

export default async function PlayoffsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const currentOrgId = await getCurrentOrgId(supabase, user!.id);

  return <PlayoffsPageClient currentOrgId={currentOrgId} />;
}
