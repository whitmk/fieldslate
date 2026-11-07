// Renaming an official role — the app's half of 0118 (2026-11-07). The
// database function `rename_official_role` does the work in one transaction
// (role, assignments, pay rates, division role lists) and is the ONLY way to
// change a role's name: browser roles hold no UPDATE on official_roles.name.
// This module decides the client-side refusal and words every reply; the
// roles manager renders the sentences verbatim.

/** Trimmed, case-insensitive — the same rule the database's name_taken uses. */
export function sameRoleName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** A clash with ANOTHER role of the season, checked before the call. */
export function renameClash(
  roles: readonly { id: string; name: string }[],
  roleId: string,
  newName: string,
): boolean {
  return roles.some((r) => r.id !== roleId && sameRoleName(r.name, newName));
}

export const ROLE_NAME_TAKEN = "That role already exists for this season.";

export type RenameOutcome =
  | { ok: true; name: string; changed: boolean; assignments: number; rates: number; divisions: number }
  | { ok: false; message: string };

/**
 * The function's reply → what the manager shows. A reply that isn't a
 * committed rename OF THIS ROLE is an error ("nothing was changed"), never a
 * success — the 0108 rule.
 */
export function renameOutcome(
  data: unknown,
  error: { message?: string } | null,
  roleId: string,
  newName: string,
): RenameOutcome {
  const name = newName.trim();
  if (error) {
    const m = error.message ?? "";
    if (m.includes("name_taken")) return { ok: false, message: ROLE_NAME_TAKEN };
    if (m.includes("name_required")) return { ok: false, message: "Enter a role name." };
    if (m.includes("not_authorized")) {
      return { ok: false, message: "You don't have permission to rename roles in this season." };
    }
    if (m.includes("role_not_found")) {
      return { ok: false, message: "That role no longer exists — refresh the page." };
    }
    if (m.includes("assignment_role_conflict")) {
      return {
        ok: false,
        message: `Some games already have an assignment named “${name}”, so renaming would put two on one game. Nothing was changed.`,
      };
    }
    if (m.includes("rate_role_conflict")) {
      return {
        ok: false,
        message: `A pay rate named “${name}” already exists for this season. Nothing was changed.`,
      };
    }
    return { ok: false, message: "Couldn't rename the role. Nothing was changed." };
  }
  const r = (data ?? null) as Record<string, unknown> | null;
  const num = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);
  if (
    !r ||
    r.committed !== true ||
    r.role_id !== roleId ||
    typeof r.name !== "string" ||
    typeof r.changed !== "boolean" ||
    num(r.assignments) === null ||
    num(r.rates) === null ||
    num(r.divisions) === null
  ) {
    return { ok: false, message: "Couldn't rename the role. Nothing was changed." };
  }
  return {
    ok: true,
    name: r.name,
    changed: r.changed,
    assignments: num(r.assignments)!,
    rates: num(r.rates)!,
    divisions: num(r.divisions)!,
  };
}

/** The note after a rename, or null when nothing moved with it. */
export function renamedLine(o: Extract<RenameOutcome, { ok: true }>): string | null {
  if (!o.changed) return null;
  const parts: string[] = [];
  if (o.assignments > 0) parts.push(`${o.assignments} assignment${o.assignments === 1 ? "" : "s"}`);
  if (o.rates > 0) parts.push(`${o.rates} pay rate${o.rates === 1 ? "" : "s"}`);
  if (parts.length === 0) return null;
  return `Renamed to “${o.name}” — ${parts.join(" and ")} updated too.`;
}
