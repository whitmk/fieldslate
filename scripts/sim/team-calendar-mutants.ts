// Mutation pass for team-calendar-sim.ts — see mutant-runner.ts for the rules.
// Runs the sim under three host timezones per mutant: TC1 (time converted
// through Date) survives under UTC by construction and dies only elsewhere.
import { runMutants, type Mutant } from "./mutant-runner";

const ICS = "src/lib/calendar/team-calendar-ics.ts";
const NORMALIZE = "src/lib/schedule/export-games.ts";

const MUTANTS: Mutant[] = [
  {
    id: "TC1", what: "start time converted through Date (host-local)", file: ICS,
    find: "`DTSTART;TZID=${zone.id}:${wallClockStamp(r.scheduledAt)}`",
    replace:
      "`DTSTART;TZID=${zone.id}:${((d: Date) => `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}T${pad2(d.getHours())}${pad2(d.getMinutes())}00`)(new Date(r.scheduledAt))}`",
    expect: "T1",
  },
  {
    id: "TC2", what: "UID built from the start time", file: ICS,
    find: "`UID:${gameUid(r.id)}`",
    replace: "`UID:${gameUid(r.id + r.scheduledAt.substring(0, 10))}`",
    expect: "U1",
  },
  {
    id: "TC3", what: "cancelled title not prefixed", file: ICS,
    find: "r.cancelled ? `CANCELLED: ${matchup}` : matchup",
    replace: "matchup",
    expect: "C1",
  },
  {
    id: "TC4", what: "cancelled games not kept", file: ICS,
    find: "normalizeExportGames(input.games, { keepCancelled: true })",
    replace: "normalizeExportGames(input.games)",
    expect: "C0",
  },
  {
    id: "TC5", what: "game note written into DESCRIPTION", file: ICS,
    find: "`DESCRIPTION:${escapeText(`${input.division.name} · ${input.season.name}`)}`",
    replace:
      "`DESCRIPTION:${escapeText(`${input.division.name} · ${input.season.name} ${String((input.games.find((x) => x.id === r.id) as unknown as { notes?: string }).notes ?? \"\")}`)}`",
    expect: "L1",
  },
  {
    id: "TC6", what: "comma escaping removed", file: ICS,
    find: '    .replace(/,/g, "\\\\,")\n',
    replace: "",
    expect: "X1",
  },
  {
    id: "TC7", what: "line folding removed", file: ICS,
    find: "lines.map(foldLine).join",
    replace: "lines.join",
    expect: "X3",
  },
  {
    id: "TC8", what: "end time includes 15 extra minutes (a buffer)", file: ICS,
    find: "wallClockPlusMinutes(r.scheduledAt, duration)}",
    replace: "wallClockPlusMinutes(r.scheduledAt, duration + 15)}",
    expect: "T2",
  },
  {
    id: "TC9", what: "unusable duration becomes 0 instead of start-only", file: ICS,
    find: "return Number.isFinite(n) && n > 0 ? n : null;",
    replace: "return Number.isFinite(n) && n > 0 ? n : 0;",
    expect: "T5",
  },
  {
    id: "TC10", what: "event timezone hardcoded to Pacific", file: ICS,
    find: "`DTSTART;TZID=${zone.id}:",
    replace: "`DTSTART;TZID=America/Los_Angeles:",
    expect: "Z2",
  },
  {
    id: "TC11", what: "unsupported timezone falls back instead of refusing", file: ICS,
    find: "const zone = findOrgTimezone(input.org.timezone);",
    replace: 'const zone = findOrgTimezone(input.org.timezone) ?? findOrgTimezone("America/Los_Angeles");',
    expect: "Z4",
  },
  {
    id: "TC12", what: "shared selection lets pending games through", file: NORMALIZE,
    find: '(keepCancelled && g.status === "cancelled")',
    replace: "keepCancelled",
    expect: "P1",
  },
  {
    id: "TC13", what: "builder throws (crash reporting)", file: ICS,
    find: "const rows = normalizeExportGames(",
    replace: "const rows = (null as unknown as typeof normalizeExportGames)(",
    expect: "CRASH-P",
  },
  {
    id: "TC14", what: "location prints the bare field, dropping the park", file: ICS,
    find: "? qualifiedVenueLabel({ name: r.venueName, location: r.locationName ? { name: r.locationName } : null })",
    replace: "? r.venueName",
    expect: "I4",
  },
];

runMutants({
  sim: "scripts/sim/team-calendar-sim.ts",
  timezones: ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"],
  mutants: MUTANTS,
});
