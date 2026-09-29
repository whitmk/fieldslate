// The org timezones FieldSlate supports — the SAME seven names the
// `profiles.timezone` CHECK constraint allows (migration 0099). Change one,
// change the other.
//
// Each entry carries what a calendar file needs to describe the zone: the
// standard and daylight offsets and abbreviations. US daylight time has run
// from the second Sunday of March to the first Sunday of November since 2007;
// Phoenix and Honolulu do not observe it.

export type OrgTimezone = {
  /** IANA name. */
  id: string;
  /** What the Settings dropdown shows. */
  label: string;
  standard: { offset: string; abbr: string };
  /** Absent for a zone with no daylight time. */
  daylight?: { offset: string; abbr: string };
};

export const DEFAULT_ORG_TIMEZONE = "America/Los_Angeles";

export const ORG_TIMEZONES: OrgTimezone[] = [
  { id: "America/New_York", label: "Eastern", standard: { offset: "-0500", abbr: "EST" }, daylight: { offset: "-0400", abbr: "EDT" } },
  { id: "America/Chicago", label: "Central", standard: { offset: "-0600", abbr: "CST" }, daylight: { offset: "-0500", abbr: "CDT" } },
  { id: "America/Denver", label: "Mountain", standard: { offset: "-0700", abbr: "MST" }, daylight: { offset: "-0600", abbr: "MDT" } },
  { id: "America/Phoenix", label: "Arizona (no daylight time)", standard: { offset: "-0700", abbr: "MST" } },
  { id: "America/Los_Angeles", label: "Pacific", standard: { offset: "-0800", abbr: "PST" }, daylight: { offset: "-0700", abbr: "PDT" } },
  { id: "America/Anchorage", label: "Alaska", standard: { offset: "-0900", abbr: "AKST" }, daylight: { offset: "-0800", abbr: "AKDT" } },
  { id: "Pacific/Honolulu", label: "Hawaii (no daylight time)", standard: { offset: "-1000", abbr: "HST" } },
];

export function findOrgTimezone(id: unknown): OrgTimezone | null {
  if (typeof id !== "string") return null;
  return ORG_TIMEZONES.find((z) => z.id === id) ?? null;
}
