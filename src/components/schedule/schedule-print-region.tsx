import { fmtGameDate, fmtGameTime } from "@/lib/utils/game-time";
import type { ScheduleGame } from "./schedule-list";

// Print-only schedule layout. Hidden on screen (`hidden`); the global
// `@media print` block in globals.css reveals `.fieldslate-print-region` via
// position:absolute so it escapes the zero-collapsed app shell. Mirrors the
// division panel's games print region (division-schedule-panel.tsx) — same
// class names and structure.
//
// The matchup/venue/status helpers duplicate the private ones in
// schedule-list.tsx: that module is "use client", so a server component can't
// call functions imported across the client boundary. Keep these in sync.

function matchupLabel(g: ScheduleGame): string {
  const home = g.home_team?.name ?? "TBD";
  if (g.interleague_org_id) {
    const orgName = g.interleague_org?.name ?? "Other org";
    const opp = g.external_team_name?.trim() || `TBD — ${orgName}`;
    if (g.is_away) {
      return `${home} AT ${orgName}${g.external_team_name ? ` (${g.external_team_name})` : ""}`;
    }
    return `${home} vs ${opp}`;
  }
  return `${home} vs ${g.away_team?.name ?? "TBD"}`;
}

function venueLabel(g: ScheduleGame): string {
  if (g.venue?.name) return g.venue.name;
  if (g.is_away && g.proposed_venue_name) return g.proposed_venue_name;
  if (g.is_away && g.interleague_org?.name)
    return `TBD — ${g.interleague_org.name} venue`;
  return "—";
}

function gameStatusLabel(status: string): string {
  if (status === "cancelled") return "Rained out";
  if (status === "pending_interleague") return "Pending";
  if (status === "reschedule_pending") return "Reschedule pending";
  return status.replace("_", " ");
}

interface Props {
  games: ScheduleGame[];
  seasonName: string | null;
}

export function SchedulePrintRegion({ games, seasonName }: Props) {
  if (games.length === 0) return null;

  // Group by calendar day. Games arrive ordered by scheduled_at asc, so Map
  // insertion order is already chronological.
  const byDay = games.reduce((map, g) => {
    const k = g.scheduled_at.substring(0, 10);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(g);
    return map;
  }, new Map<string, ScheduleGame[]>());

  const printedDate = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="fieldslate-print-region hidden">
      <div className="fieldslate-print-header">
        <div className="fieldslate-print-wordmark">
          Field<span>Slate</span>
        </div>
        <p className="fieldslate-print-league">{seasonName ?? "Schedule"}</p>
        <p className="fieldslate-print-meta">
          Printed {printedDate} · {games.length} game
          {games.length !== 1 ? "s" : ""}
        </p>
      </div>
      {Array.from(byDay.entries()).map(([day, dayGames]) => (
        <div key={day}>
          <div className="fieldslate-print-date-group">
            {fmtGameDate(dayGames[0].scheduled_at)}
          </div>
          <table className="fieldslate-print-table">
            <thead>
              <tr>
                <th>Date/Time</th>
                <th>Matchup</th>
                <th>Division</th>
                <th>Venue</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {dayGames.map((g) => (
                <tr key={g.id}>
                  <td>
                    {fmtGameDate(g.scheduled_at)}, {fmtGameTime(g.scheduled_at)}
                  </td>
                  <td>{matchupLabel(g)}</td>
                  <td>{g.home_team?.division?.name ?? "—"}</td>
                  <td>{venueLabel(g)}</td>
                  <td>{gameStatusLabel(g.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
