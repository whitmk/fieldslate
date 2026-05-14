import { createClient } from "@/lib/supabase/server";
import { ActivityLogCollapsible } from "./activity-log-collapsible";

type ActivityLogEntry = {
  id: string;
  event_type: string;
  message: string;
  created_at: string;
};

interface Props {
  leagueId: string;
}

export async function ActivityLogPanel({ leagueId }: Props) {
  const supabase = createClient();
  console.log("[ActivityLogPanel] querying league_id:", leagueId);
  const { data, error } = await supabase
    .from("activity_log")
    .select("id, event_type, message, created_at")
    .eq("league_id", leagueId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) console.error("[ActivityLogPanel] SELECT failed:", error.message, error.code);
  console.log("[ActivityLogPanel] rows returned:", data?.length ?? 0);

  const entries = (data ?? []) as ActivityLogEntry[];

  return (
    <ActivityLogCollapsible
      entries={entries}
      storageKey={`activity-log-collapsed:${leagueId}`}
    />
  );
}
