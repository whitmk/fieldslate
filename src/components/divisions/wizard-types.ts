export type PlayingDay = "Mo" | "Tu" | "We" | "Th" | "Fr" | "Sa" | "Su";
export type ScheduleFormat = "round_robin" | "balanced" | "pool_play";

export type DayWindow = { start: string; end: string }; // "HH:MM" 24-hour
export type DayWindowMap = Partial<Record<PlayingDay, DayWindow>>;

export const ORDERED_DAYS: { key: PlayingDay; label: string }[] = [
  { key: "Su", label: "Sun" },
  { key: "Mo", label: "Mon" },
  { key: "Tu", label: "Tue" },
  { key: "We", label: "Wed" },
  { key: "Th", label: "Thu" },
  { key: "Fr", label: "Fri" },
  { key: "Sa", label: "Sat" },
];

export const DEFAULT_DAY_WINDOW: DayWindow = { start: "09:00", end: "17:00" };

export type VenueAssignment = {
  venue_id: string;
  allow_games: boolean;
  allow_practices: boolean;
};

export type PracticeSlotEntry = {
  day?: PlayingDay;
  start?: string;    // "HH:MM" 24-hour
  venue_id?: string;
};

export type TeamEntry = {
  name: string;
  has_coach_conflict: boolean;
  conflict_division: string;
  conflict_team: string;
  // Optional pinned practice slots (locked for the whole season)
  practice_slots?: PracticeSlotEntry[];
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
  day_windows: DayWindowMap;       // per-day time windows (keyed by PlayingDay)
  use_league_schedule: boolean;    // true = also save windows to league on submit
  game_duration: number;
  buffer_minutes: number;
  max_games_per_field_per_day: number; // derived; kept for backward compat
  bye_weeks: number;
  // Activities per week and practice season dates
  activities_per_week: number;
  practice_season_start: string;
  practice_season_end: string;
  // Step 3 – Fields
  venue_assignments: VenueAssignment[];
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
  day_windows: {
    Sa: { start: "09:00", end: "17:00" },
    Su: { start: "09:00", end: "17:00" },
  },
  use_league_schedule: false,
  game_duration: 90,
  buffer_minutes: 15,
  max_games_per_field_per_day: 4,
  bye_weeks: 1,
  activities_per_week: 2,
  practice_season_start: "",
  practice_season_end: "",
  venue_assignments: [],
  format: "round_robin",
  include_playoffs: true,
  auto_rotate: true,
  track_standings: true,
  teams: [],
};
