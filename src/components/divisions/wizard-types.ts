export type PlayingDay = "Mo" | "Tu" | "We" | "Th" | "Fr" | "Sa" | "Su";
export type ScheduleFormat = "round_robin" | "balanced" | "pool_play";

export type TeamEntry = {
  name: string;
  has_coach_conflict: boolean;
  conflict_division: string;
  conflict_team: string;
};

export type WizardData = {
  // Step 1 – Basics
  name: string;
  team_count: number;
  start_date: string;
  end_date: string;
  // Step 2 – Playing schedule
  games_per_team: number;
  max_games_per_week: number;
  max_games_per_team_per_day: number;
  playing_days: PlayingDay[];
  earliest_start: string;
  latest_start: string;
  game_duration: number;
  buffer_minutes: number;
  max_games_per_field_per_day: number;
  bye_weeks: number;
  // Step 3 – Fields
  venue_ids: string[];
  // Step 4 – Format
  format: ScheduleFormat;
  include_playoffs: boolean;
  auto_rotate: boolean;
  track_standings: boolean;
  // Step 5 – Coaches
  teams: TeamEntry[];
};

export const DEFAULT_WIZARD_DATA: WizardData = {
  name: "",
  team_count: 8,
  start_date: "",
  end_date: "",
  games_per_team: 10,
  max_games_per_week: 2,
  max_games_per_team_per_day: 1,
  playing_days: ["Sa", "Su"],
  earliest_start: "08:00",
  latest_start: "17:00",
  game_duration: 90,
  buffer_minutes: 15,
  max_games_per_field_per_day: 4,
  bye_weeks: 1,
  venue_ids: [],
  format: "round_robin",
  include_playoffs: true,
  auto_rotate: true,
  track_standings: true,
  teams: [],
};
