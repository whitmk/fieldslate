// The officials side of the admin email-problems banner (0128): its two
// database functions and how a failed row is described. Rules and words:
// src/lib/outbound-email/problems.ts.
import { matchup, obj, str, wallDay, type ProblemsSpec } from "@/lib/outbound-email/problems";

export const OFFICIAL_PROBLEMS: ProblemsSpec = {
  feature: "officials",
  rpc: { read: "official_email_problems", ack: "official_email_problems_ack" },
  describe: (f) => {
    const who = f.to_contact === true ? "Your officials contact" : str(f.official_name) ?? "An official";
    const game = obj(f.game);
    if (!game) return { who, what: null };
    const what = [str(game.division), matchup(str(game.home), str(game.away)), wallDay(str(game.start))]
      .filter(Boolean)
      .join(" · ");
    return { who, what: what || null };
  },
};
