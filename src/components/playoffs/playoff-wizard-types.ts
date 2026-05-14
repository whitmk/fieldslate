import type {
  PlayingDay,
  DayWindowMap,
  VenueAssignment,
} from "@/components/divisions/wizard-types";

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

export type PlayoffWizardData = {
  // Step 1 — Division
  division_id: string;
  division_name: string;
  // Step 2 — Format
  format: PlayoffFormat;
  // Step 3 — Seeding (ordered array; index 0 = seed 1)
  seeding: SeededTeam[];
  // Step 4 — Dates & time windows
  start_date: string;
  end_date: string;
  playing_days: PlayingDay[];
  day_windows: DayWindowMap;
  // Step 5 — Venues
  venue_assignments: VenueAssignment[];
  // Step 6 — Cross-division championship
  cross_division_enabled: boolean;
  cross_division_opponent_id: string;
  cross_division_opponent_name: string;
};

export const DEFAULT_PLAYOFF_DATA: PlayoffWizardData = {
  division_id: "",
  division_name: "",
  format: "single_elimination",
  seeding: [],
  start_date: "",
  end_date: "",
  playing_days: ["Sa", "Su"],
  day_windows: {
    Sa: { start: "09:00", end: "17:00" },
    Su: { start: "09:00", end: "17:00" },
  },
  venue_assignments: [],
  cross_division_enabled: false,
  cross_division_opponent_id: "",
  cross_division_opponent_name: "",
};
