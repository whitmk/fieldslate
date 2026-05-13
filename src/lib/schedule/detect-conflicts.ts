// Pure conflict detection — no "use client", safe to import in server components.
// The same algorithm lives in generate-schedule.ts for client-side use.

export interface ConflictInputGame {
  id: string;
  scheduled_at: string;
  venue_id: string | null;
  venue_name: string;
  home_team_name: string;
  away_team_name: string;
  division_name?: string;
}

export interface DetectedConflict {
  venueId: string;
  venueName: string;
  date: string;
  gameIds: string[];
}

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function detectConflicts(
  games: ConflictInputGame[],
  gameDuration: number,
  bufferMinutes: number,
): DetectedConflict[] {
  const minGap = Number(gameDuration) + Number(bufferMinutes);
  const byVenueDay = new Map<string, ConflictInputGame[]>();

  for (const g of games) {
    if (!g.venue_id) continue;
    const key = `${g.venue_id}:${g.scheduled_at.substring(0, 10)}`;
    if (!byVenueDay.has(key)) byVenueDay.set(key, []);
    byVenueDay.get(key)!.push(g);
  }

  const results: DetectedConflict[] = [];

  for (const group of Array.from(byVenueDay.values())) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
    const conflicting = new Set<ConflictInputGame>();

    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const mA = timeToMinutes(sorted[i].scheduled_at.substring(11, 16));
        const mB = timeToMinutes(sorted[j].scheduled_at.substring(11, 16));
        if (Math.abs(mA - mB) < minGap) {
          conflicting.add(sorted[i]);
          conflicting.add(sorted[j]);
        }
      }
    }

    if (conflicting.size > 0) {
      const arr = Array.from(conflicting);
      results.push({
        venueId: arr[0].venue_id!,
        venueName: arr[0].venue_name,
        date: arr[0].scheduled_at.substring(0, 10),
        gameIds: arr.map((g) => g.id),
      });
    }
  }

  return results;
}
