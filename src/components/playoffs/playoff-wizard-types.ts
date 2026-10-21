import type {
  PlayingDay,
  DayWindowMap,
  VenueAssignment,
} from "@/components/divisions/wizard-types";
import type { SeriesByRound } from "@/lib/playoffs/series-lengths";

export type { PlayingDay, DayWindowMap, VenueAssignment };

export type PlayoffFormat =
  | "single_elimination"
  | "double_elimination"
  | "round_robin";

export type PlayoffStatus = "draft" | "active" | "completed";

export type SeededTeam = {
  team_id: string;
  team_name: string;
};

/** A per-team daily limit: no team plays more than this many games in a day
 *  (round robin, and both stages of a two-stage setup). */
export type GamesPerDay = 1 | 2;

/** Stage 2 of a two-stage setup ("Round robin, then bracket"): its own dates,
 *  days, windows, fields and daily limit. Stage 1 uses the top-level fields. */
export type Stage2WizardData = {
  start_date: string;
  end_date: string;
  playing_days: PlayingDay[];
  day_windows: DayWindowMap;
  venue_assignments: VenueAssignment[];
  games_per_team_per_day: GamesPerDay;
  /** Each round's series length (0114); a round not listed is 1 game. */
  series_by_round: SeriesByRound;
  /** On by default: Stage 2 plays on Stage 1's fields. Wizard state only. */
  same_fields: boolean;
};

export type PlayoffWizardData = {
  // Step 1 — Division
  division_id: string;
  division_name: string;
  // Step 2 — Format. "Round robin, then bracket" is `format: "round_robin"`
  // with `two_stage: true`: Stage 1 is that round robin, Stage 2 a
  // single-elimination bracket for the top `advance_count` (0113).
  format: PlayoffFormat;
  two_stage: boolean;
  advance_count: number;
  // Step 3 — Seeding (ordered array; index 0 = seed 1)
  seeding: SeededTeam[];
  // Teams removed from THIS bracket in the Seeding step. Wizard state only:
  // never saved (settingsPayload leaves it out) — an existing bracket's
  // excluded teams are re-derived from the division (lib/playoffs/seeding.ts).
  excluded: SeededTeam[];
  // Step 4 — Dates & time windows
  start_date: string;
  end_date: string;
  playing_days: PlayingDay[];
  day_windows: DayWindowMap;
  /** Round robin (plain, or Stage 1), and a single elimination with a
   *  series round: games per team per day. */
  games_per_team_per_day: GamesPerDay;
  /** Single elimination only: each round's series length (0114); a round not
   *  listed is 1 game. Two-stage: Stage 2's is in `stage2`. */
  series_by_round: SeriesByRound;
  // Step 5 — Venues
  venue_assignments: VenueAssignment[];
  /** Two-stage only. */
  stage2: Stage2WizardData;
  // Cross-division championship — its step is HIDDEN (nothing reads these);
  // the values are carried through as saved (playoff-wizard.tsx).
  cross_division_enabled: boolean;
  cross_division_opponent_id: string;
  cross_division_opponent_name: string;
};

export const DEFAULT_PLAYOFF_DATA: PlayoffWizardData = {
  division_id: "",
  division_name: "",
  format: "single_elimination",
  two_stage: false,
  advance_count: 4,
  seeding: [],
  excluded: [],
  start_date: "",
  end_date: "",
  playing_days: ["Sa", "Su"],
  day_windows: {
    Sa: { start: "09:00", end: "17:00" },
    Su: { start: "09:00", end: "17:00" },
  },
  games_per_team_per_day: 1,
  series_by_round: {},
  venue_assignments: [],
  stage2: {
    start_date: "",
    end_date: "",
    playing_days: ["Sa", "Su"],
    day_windows: {
      Sa: { start: "09:00", end: "17:00" },
      Su: { start: "09:00", end: "17:00" },
    },
    venue_assignments: [],
    games_per_team_per_day: 1,
    series_by_round: {},
    same_fields: true,
  },
  cross_division_enabled: false,
  cross_division_opponent_id: "",
  cross_division_opponent_name: "",
};
