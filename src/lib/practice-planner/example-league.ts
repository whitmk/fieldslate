// What the calculator shows on first load: a generic example league (no real
// league's name or numbers) — the mockup's divisions, at Sacramento.
//
// THE SEASON DATES ARE FIXED, ON PURPOSE: a default computed from the clock
// would be a render-path clock read (a hydration mismatch). They need bumping
// before spring 2028 — see CLAUDE.md "Open items".

import { DEFAULT_CITY_ID } from "./us-cities";
import type { DivisionInput, PlannerInput } from "./types";

const WEEKDAYS = [0, 1, 2, 3, 4];

export const EXAMPLE_DIVISIONS: DivisionInput[] = [
  { name: "T-Ball", teams: 6, perWeek: 1, lengthMin: 60, days: WEEKDAYS, start: "17:00", end: "19:00", fieldType: "diamond60", teamsPerField: 2 },
  { name: "Rookie", teams: 6, perWeek: 2, lengthMin: 75, days: WEEKDAYS, start: "17:00", end: "19:30", fieldType: "diamond60", teamsPerField: 2 },
  { name: "Minors AA", teams: 8, perWeek: 2, lengthMin: 90, days: WEEKDAYS, start: "17:00", end: "20:00", fieldType: "diamond60", teamsPerField: 1 },
  { name: "Minors AAA", teams: 8, perWeek: 2, lengthMin: 90, days: WEEKDAYS, start: "17:00", end: "20:00", fieldType: "diamond60", teamsPerField: 1 },
  { name: "Majors", teams: 6, perWeek: 2, lengthMin: 90, days: WEEKDAYS, start: "17:00", end: "20:00", fieldType: "diamond60", teamsPerField: 1 },
  { name: "50/70", teams: 4, perWeek: 2, lengthMin: 90, days: WEEKDAYS, start: "17:30", end: "20:00", fieldType: "diamond5070", teamsPerField: 1 },
  { name: "Juniors", teams: 3, perWeek: 2, lengthMin: 120, days: [0, 2, 4], start: "17:30", end: "20:30", fieldType: "diamond90", teamsPerField: 1 },
];

export const EXAMPLE_LEAGUE: PlannerInput = {
  seasonStart: "2027-02-22",
  seasonEnd: "2027-05-29",
  cityId: DEFAULT_CITY_ID,
  minutesBetween: 0,
  divisions: EXAMPLE_DIVISIONS,
};

/** What "Add a division" starts from (the mockup's new row). */
export const NEW_DIVISION: Omit<DivisionInput, "id"> = {
  name: "New division",
  teams: 4,
  perWeek: 2,
  lengthMin: 90,
  days: WEEKDAYS,
  start: "17:30",
  end: "20:00",
  fieldType: "diamond60",
  teamsPerField: 1,
};
