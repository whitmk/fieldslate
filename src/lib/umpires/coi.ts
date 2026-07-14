// Conflict-of-interest shared pieces (official_conflicts, migration 0073).
// Additive to the umpires.team_id coach link — a second, parallel check with
// the same philosophy: manual assignment warns with override, auto-assign
// hard-blocks. Not related to conflict_overrides (0064, game-scheduling
// override audit trail).

export type CoiRelationship = "parent" | "sibling" | "family" | "other";

export const COI_RELATIONSHIP_OPTIONS: { value: CoiRelationship; label: string }[] = [
  { value: "parent", label: "Parent" },
  { value: "sibling", label: "Sibling" },
  { value: "family", label: "Family" },
  { value: "other", label: "Other" },
];

export function coiRelationshipLabel(relationship: string): string {
  return (
    COI_RELATIONSHIP_OPTIONS.find((o) => o.value === relationship)?.label ??
    relationship
  );
}

/** Reads inside "{name} is listed as {phrase} on {team}". */
export function coiPhrase(relationship: string): string {
  switch (relationship) {
    case "parent":
      return "a parent";
    case "sibling":
      return "a sibling";
    case "family":
      return "family";
    default:
      return "a listed conflict";
  }
}

/** The shape assignment surfaces embed on their roster feeds. */
export type CoiLink = { team_id: string; relationship: string };
