import { createClient } from "@/lib/supabase/client";

export const DEFAULT_GAME_DURATION_MINS = 90;

export type GameTimeInfo = {
  id: string;
  scheduled_at: string;
  duration_minutes: number;
  home_team_name: string;
  away_team_name: string;
};

export function gameEndMs(g: { scheduled_at: string; duration_minutes: number }) {
  return new Date(g.scheduled_at).getTime() + g.duration_minutes * 60_000;
}

export function gamesOverlap(
  a: { scheduled_at: string; duration_minutes: number },
  b: { scheduled_at: string; duration_minutes: number },
): boolean {
  const aStart = new Date(a.scheduled_at).getTime();
  const bStart = new Date(b.scheduled_at).getTime();
  return aStart < gameEndMs(b) && bStart < gameEndMs(a);
}

/**
 * Returns the first existing game that conflicts with the candidate slot for
 * this umpire, or null if there is no conflict.
 *
 * Excludes the candidate game itself so re-assigning an umpire from one role
 * to another on the same game doesn't trigger a false positive.
 */
export async function findUmpireConflict(
  umpireId: string,
  candidate: GameTimeInfo,
): Promise<GameTimeInfo | null> {
  const supabase = createClient();

  type Row = {
    game:
      | {
          id: string;
          scheduled_at: string;
          home_team:
            | { name: string; division: { settings: unknown } | null }
            | null;
          away_team: { name: string } | null;
        }
      | null;
  };

  const { data } = await supabase
    .from("game_umpires")
    .select(
      `game:games(
        id,
        scheduled_at,
        home_team:teams!home_team_id(name, division:divisions(settings)),
        away_team:teams!away_team_id(name)
      )`,
    )
    .eq("umpire_id", umpireId)
    .neq("game_id", candidate.id);

  const rows = (data as unknown as Row[] | null) ?? [];
  for (const r of rows) {
    const g = r.game;
    if (!g) continue;
    const settings = (g.home_team?.division?.settings ?? {}) as {
      game_duration?: number;
    };
    const duration =
      typeof settings.game_duration === "number"
        ? settings.game_duration
        : DEFAULT_GAME_DURATION_MINS;
    const other: GameTimeInfo = {
      id: g.id,
      scheduled_at: g.scheduled_at,
      duration_minutes: duration,
      home_team_name: g.home_team?.name ?? "TBD",
      away_team_name: g.away_team?.name ?? "TBD",
    };
    if (gamesOverlap(candidate, other)) return other;
  }
  return null;
}

export function formatConflictTime(scheduled_at: string): string {
  const d = new Date(scheduled_at);
  const date = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date}, ${time}`;
}
