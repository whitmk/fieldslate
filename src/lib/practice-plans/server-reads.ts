// The field-request pages' reads, shared by the plans list and the planner so
// both prefill and hint from the same rows. Every read is complete-or-throw.
// Server components only (they get the server client passed in).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { fetchAllRows, type PagedResult } from "@/lib/supabase/fetch-all";
import { pickPrefill, type Prefill, type PrefillRow } from "./prefill";

type Client = SupabaseClient<Database>;

type DivisionReadRow = {
  id: string;
  name: string;
  created_at: string;
  league: { id: string; name: string; start_date: string | null; created_at: string; archived_at: string | null; owner_id: string };
  teams: { count: number }[];
};

/** Every division of the org with its season and live team count → the New plan prefill. */
export async function readPrefill(supabase: Client, orgId: string): Promise<Prefill> {
  const rows = await fetchAllRows<DivisionReadRow>("the league's divisions and team counts", ({ from, to, exactCount }) =>
    supabase
      .from("divisions")
      .select(
        "id, name, created_at, league:leagues!inner(id, name, start_date, created_at, archived_at, owner_id), teams(count)",
        exactCount ? { count: "exact" } : undefined,
      )
      .eq("league.owner_id", orgId)
      .order("id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<PagedResult<DivisionReadRow>>,
  );
  return pickPrefill(
    rows.map(
      (d): PrefillRow => ({
        seasonId: d.league.id,
        seasonName: d.league.name,
        seasonStart: d.league.start_date,
        seasonCreatedAt: d.league.created_at,
        seasonArchivedAt: d.league.archived_at,
        divisionId: d.id,
        divisionName: d.name,
        divisionCreatedAt: d.created_at,
        teamCount: d.teams?.[0]?.count ?? 0,
      }),
    ),
  );
}

/** The league's timezone and stored sunset city (profiles, the org owner's row). */
export async function readLeagueSettings(supabase: Client, orgId: string): Promise<{ timeZone: string; sunsetCity: string | null }> {
  const { data, error } = await supabase.from("profiles").select("timezone, sunset_city").eq("id", orgId).single();
  if (error || !data) throw new Error(`Could not load the league's settings: ${error?.message ?? "no row"}`);
  const row = data as { timezone: string; sunset_city: string | null };
  return { timeZone: row.timezone, sunsetCity: row.sunset_city };
}
