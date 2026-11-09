// Two DISPLAY-ONLY reads for the officials slot UI (0124), both fail-soft:
//   * which assignments an official took through their link ("Signed up")
//   * each official's division list (the manual picker's warning)
// A failed read (or 0124 not applied yet) shows no tag and no warning; it
// never blocks an assignment. The rules that matter run in the database:
// claims and auto-assign's write both check the division list under lock.
import type { createClient } from "@/lib/supabase/client";

type Client = ReturnType<typeof createClient>;

export async function selfClaimedIds(supabase: Client, assignmentIds: string[]): Promise<Set<string>> {
  if (assignmentIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from("official_self_claims")
    .select("game_umpire_id")
    .in("game_umpire_id", assignmentIds);
  if (error) return new Set();
  return new Set(((data ?? []) as { game_umpire_id: string }[]).map((r) => r.game_umpire_id));
}

/** umpire id → the divisions they may work; an official with no list is absent. */
export async function officialDivisionLists(supabase: Client, umpireIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (umpireIds.length === 0) return out;
  const { data, error } = await supabase
    .from("official_divisions")
    .select("umpire_id, division_id")
    .in("umpire_id", umpireIds);
  if (error) return out;
  for (const r of (data ?? []) as { umpire_id: string; division_id: string }[]) {
    if (!out.has(r.umpire_id)) out.set(r.umpire_id, []);
    out.get(r.umpire_id)!.push(r.division_id);
  }
  return out;
}

export const NOT_IN_DIVISIONS_FLAG = "not set to work this division";
export const SIGNED_UP_SLOT_TAG = "Signed up";
