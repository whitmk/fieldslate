import type { PlayingDay } from "@/components/divisions/wizard-types";

export type DayCode = PlayingDay;

export type TimeBlock = {
  id: string;
  start: string;
  end: string;
};

export type SnackShackWizardData = {
  season_id: string;
  start_date: string;
  end_date: string;
  days_of_week: DayCode[];
  time_blocks_by_day: Partial<Record<DayCode, TimeBlock[]>>;
  home_venue_ids: string[];
  scheduling_preference: "prefer_game_days" | "prefer_off_days";
};

export function emptyWizardData(season_id: string): SnackShackWizardData {
  return {
    season_id,
    start_date: "",
    end_date: "",
    days_of_week: [],
    time_blocks_by_day: {},
    home_venue_ids: [],
    scheduling_preference: "prefer_game_days",
  };
}

// DAY_TO_JS_INDEX maps DayCode → JS Date.getDay() (0=Sun)
export const DAY_TO_JS_INDEX: Record<DayCode, number> = {
  Mo: 1,
  Tu: 2,
  We: 3,
  Th: 4,
  Fr: 5,
  Sa: 6,
  Su: 0,
};
