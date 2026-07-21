import { createClient } from "@/lib/supabase/client";

// Conflict-override shared pieces (migration 0064). Conflicts on manual game
// writes BLOCK the save; the admin overrides by supplying a required reason,
// recorded one row per conflict type and surfaced in the game detail modal's
// "Conflict history" section. Reasons are deliberately separate from
// games.notes (free-form commissioner notes).

export type ConflictType =
  | "venue_double_book"
  | "venue_hours"
  | "team_double_book"
  // team_game_constraints (0076) severity-'block' hit — CHECK extended in 0077.
  // 'prefer' matches are non-blocking notices and never recorded here.
  | "team_constraint";

export type DetectedConflict = { type: ConflictType; message: string };

export const CONFLICT_TYPE_LABELS: Record<ConflictType, string> = {
  venue_double_book: "Venue double-book",
  venue_hours: "Venue hours",
  team_double_book: "Team double-book",
  team_constraint: "Team constraint",
};

/** One conflict_overrides row per distinct conflict type, single reason. */
export async function insertConflictOverrides(
  supabase: ReturnType<typeof createClient>,
  gameId: string,
  conflicts: DetectedConflict[],
  reason: string,
): Promise<{ error: string | null }> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return { error: "Not signed in." };
  const types = Array.from(new Set(conflicts.map((c) => c.type)));
  const { error } = await supabase.from("conflict_overrides").insert(
    types.map((conflict_type) => ({
      game_id: gameId,
      overridden_by: userId,
      conflict_type,
      reason,
    })) as never[],
  );
  return { error: error?.message ?? null };
}
