// The season's snack shack shifts, for the admin volunteer screens (0122).
// One read, shared by the roles page and the who-signed-up page. Complete or
// throws — a short list would read as open spots that don't exist, and a
// failed read must never read as "no snack shack".
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows, type PagedResult } from "@/lib/supabase/fetch-all";
import { shiftsFromRows, type ShiftRow } from "./shifts";

type BlockRow = { id: string; date: string; start_time: string; end_time: string; assigned_team_id: string | null; people_needed: number | null };

export type SeasonShifts = { setUp: boolean; peoplePerShift: number; shifts: ShiftRow[] };

export async function loadSeasonShifts(supabase: SupabaseClient, seasonId: string): Promise<SeasonShifts> {
  const shack = await supabase.from("snack_shack_settings").select("id, people_per_shift").eq("season_id", seasonId).maybeSingle();
  if (shack.error) throw new Error(shack.error.message);
  const row = shack.data as { id: string; people_per_shift: number } | null;
  if (!row) return { setUp: false, peoplePerShift: 1, shifts: [] };
  const blocks = await fetchAllRows<BlockRow>("the snack shack shifts", ({ from, to, exactCount }) =>
    supabase
      .from("snack_shack_blocks")
      .select("id, date, start_time, end_time, assigned_team_id, people_needed", exactCount ? { count: "exact" } : undefined)
      .eq("snack_shack_id", row.id)
      .order("date", { ascending: true })
      .order("start_time", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<PagedResult<BlockRow>>,
  );
  return { setUp: true, peoplePerShift: row.people_per_shift, shifts: shiftsFromRows(blocks, row.people_per_shift) };
}
