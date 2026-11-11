// The volunteer side of the admin email-problems banner (0128): its two
// database functions and how a failed row is described. Rules and words:
// src/lib/outbound-email/problems.ts.
import { matchup, obj, str, wallDay, type ProblemsSpec } from "@/lib/outbound-email/problems";

export const VOLUNTEER_PROBLEMS: ProblemsSpec = {
  feature: "volunteers",
  rpc: { read: "volunteer_email_problems", ack: "volunteer_email_problems_ack" },
  describe: (f) => {
    const initial = str(f.first_initial);
    const last = str(f.last_name);
    const who = initial && last ? `${initial.toUpperCase()}. ${last}` : last ?? "A volunteer";
    const spot = obj(f.spot);
    if (!spot) return { who, what: null };
    const day = wallDay(str(spot.start));
    if (spot.kind === "shift") return { who, what: ["Snack shack", day].filter(Boolean).join(" · ") };
    const what = [str(spot.role_name), matchup(str(spot.home_team_name), str(spot.away_team_name)), day]
      .filter(Boolean)
      .join(" · ");
    return { who, what: what || null };
  },
};
