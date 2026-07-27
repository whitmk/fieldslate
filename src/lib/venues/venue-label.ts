// The ONE qualified-venue-label formatter. Used by every CHOOSER surface (where
// an admin picks a field to book) and by the partner-facing surfaces (Chunk 5).
//
// The safety rationale (see CLAUDE.md): once venue names are short ("Andrews"),
// a picker reading "Perry, Minors, Polley, Andrews" gives no way to tell whose
// park is whose — and SRALL's fields span four different leagues' parks. During
// a rainout, a mis-pick lands games at the wrong league's field. So anywhere the
// user CHOOSES a field, show "Monroe Complex — Andrews"; anywhere the user
// merely READS a schedule, the bare short name stays (those surfaces keep their
// own display helpers and are deliberately untouched).
//
// Location-first, " — " separator. No location → the bare name is returned
// UNCHANGED (byte-for-byte today's behavior), which is what keeps the fence
// intact for every org that hasn't adopted locations.

export interface VenueLabelInput {
  name: string;
  /** Joined location, from `location:locations(name)` on the venue embed.
   *  Absent/null → no location → bare name. */
  location?: { name: string | null } | null;
}

export function qualifiedVenueLabel(venue: VenueLabelInput): string {
  const loc = venue.location?.name?.trim();
  if (!loc) return venue.name;
  return `${loc} — ${venue.name}`;
}

/** Comparator that sorts picker options by their QUALIFIED label, so a park's
 *  fields cluster together (the label starts with the location name) instead of
 *  scattering alphabetically by bare field name. Order-only — never changes the
 *  option set. */
export function byQualifiedVenueLabel(
  a: VenueLabelInput,
  b: VenueLabelInput,
): number {
  return qualifiedVenueLabel(a).localeCompare(qualifiedVenueLabel(b));
}
