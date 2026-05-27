import { createClient } from "@/lib/supabase/server";
import type { League } from "@/types/database";
import { SeasonsListClient } from "@/components/seasons/seasons-list-client";

// Always render fresh — the auto-archive UPDATE needs to run on every visit,
// and the season list reflects mutations from the archive/unarchive modals.
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: { tab?: string };
}

export default async function LeaguesPage({ searchParams }: PageProps) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // ── Auto-archive (write-on-read) ───────────────────────────────────────────
  // Any season whose end_date is in the past and isn't already archived gets
  // archived on this visit. Idempotent, scoped to this owner, single cheap
  // UPDATE. Null end_date rows are excluded — those usually mean "draft"
  // seasons the admin hasn't fully set up yet.
  if (user) {
    const today = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    await supabase
      .from("leagues")
      .update({
        archived_at: new Date().toISOString(),
        status: "archived",
      } as never)
      .eq("owner_id", user.id)
      .is("archived_at", null)
      .not("end_date", "is", null)
      .lt("end_date", todayStr);
  }

  const { data } = await supabase
    .from("leagues")
    .select("*")
    .eq("owner_id", user!.id)
    .order("archived_at", { ascending: false, nullsFirst: true })
    .order("created_at", { ascending: false });
  const leagues = (data as League[] | null) ?? [];

  const initialTab = searchParams.tab === "archived" ? "archived" : "active";

  return <SeasonsListClient leagues={leagues} initialTab={initialTab} />;
}
