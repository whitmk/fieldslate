// Derives the visible status pill for a season (a.k.a. "league" in the DB).
//
// Source of truth for the archive/active split is `archived_at`. The legacy
// `status` enum is now a downstream synced flag — we keep it in sync on
// archive/unarchive so older render paths still color correctly, but we never
// branch on it for the archive concept.
//
// Active-side flavors are derived from the calendar so the chip is informative
// at a glance: a season that hasn't started yet reads "Upcoming"; a season in
// flight reads "Active"; an archived season is always "Archived" regardless of
// dates (admin made the call).

export type SeasonStatusKind = "active" | "upcoming" | "archived";

export type SeasonStatus = {
  kind: SeasonStatusKind;
  label: string;
  /** Tailwind class fragment for the pill bg + text. */
  pillClass: string;
};

const PILL_BY_KIND: Record<SeasonStatusKind, { label: string; pillClass: string }> = {
  active: {
    label: "Active",
    pillClass: "bg-[#22C55E]/10 text-[#16a34a]",
  },
  upcoming: {
    label: "Upcoming",
    pillClass: "bg-blue-50 text-blue-600",
  },
  archived: {
    label: "Archived",
    pillClass: "bg-gray-100 text-gray-500",
  },
};

/** Today as a "YYYY-MM-DD" local-date string — for comparison with date columns. */
function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function deriveSeasonStatus(season: {
  archived_at: string | null;
  start_date: string | null;
  end_date: string | null;
}): SeasonStatus {
  if (season.archived_at) {
    return { kind: "archived", ...PILL_BY_KIND.archived };
  }
  const t = today();
  if (season.start_date && season.start_date > t) {
    return { kind: "upcoming", ...PILL_BY_KIND.upcoming };
  }
  return { kind: "active", ...PILL_BY_KIND.active };
}
