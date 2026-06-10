// Sport → user-facing title for the on-field official.
//
// Baseball and Softball share the term "Umpire"; every other sport uses
// "Referee". When the sport is unknown, ambiguous, or a view spans multiple
// sports (e.g. org-level lists), fall back to the neutral "Official".

function normalizeSport(sport: string | null | undefined): string {
  return (sport ?? "").trim().toLowerCase();
}

export function isUmpireSport(sport: string | null | undefined): boolean {
  const s = normalizeSport(sport);
  return s === "baseball" || s === "softball";
}

export function getOfficialTitle(sport: string | null | undefined): "Umpire" | "Referee" | "Official" {
  const s = normalizeSport(sport);
  if (s === "") return "Official";
  if (s === "baseball" || s === "softball") return "Umpire";
  return "Referee";
}

export function getOfficialTitlePlural(
  sport: string | null | undefined,
): "Umpires" | "Referees" | "Officials" {
  const s = normalizeSport(sport);
  if (s === "") return "Officials";
  if (s === "baseball" || s === "softball") return "Umpires";
  return "Referees";
}

export function getOfficialTitleLower(sport: string | null | undefined): "umpire" | "referee" | "official" {
  return getOfficialTitle(sport).toLowerCase() as "umpire" | "referee" | "official";
}

export function getOfficialTitlePluralLower(
  sport: string | null | undefined,
): "umpires" | "referees" | "officials" {
  return getOfficialTitlePlural(sport).toLowerCase() as "umpires" | "referees" | "officials";
}

/**
 * Pad a role-label list up to the division's umpires_per_game with
 * sport-aware fallbacks ("Umpire 3", "Referee 2"). Shared by every slot
 * surface so the padded labels — which become game_umpires.role text and
 * official_roles names on write — agree everywhere.
 */
export function padRoleLabels(
  roles: string[],
  count: number,
  sport: string | null | undefined,
): string[] {
  const padded = [...roles];
  const title = getOfficialTitle(sport);
  while (padded.length < count) {
    padded.push(`${title} ${padded.length + 1}`);
  }
  return padded;
}
