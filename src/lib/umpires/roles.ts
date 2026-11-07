import { createClient } from "@/lib/supabase/client";

type RoleRow = { id: string; name: string; sort_order: number };

/** A season role a requested name resolved to: its id and its CANONICAL name
 *  (the spelling stored on official_roles). Write `name`, never the request. */
export type ResolvedRole = { id: string; name: string };

/** Trimmed, case-insensitive — the key 0118's unique index enforces
 *  (official_roles_season_name_ci_uniq) and rename_official_role compares. */
export function roleKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Pure: which requested names an existing role already answers (by roleKey),
 * and which must be created. A name that differs from a role only by case or
 * outer spaces resolves to THAT role (2026-11-07) — so a case variant never
 * creates a second role, and never becomes assignment text that matches no
 * role. Requests are trimmed; blanks are dropped; two requests with one key
 * create ONE role, spelled as first requested. When the season (legacy, before
 * the index) holds two roles with one key, the lower sort_order wins.
 */
export function resolveRequestedRoles(
  existing: readonly RoleRow[],
  names: readonly string[],
): { resolved: Map<string, ResolvedRole>; toCreate: string[] } {
  const byKey = new Map<string, ResolvedRole & { sort_order: number }>();
  for (const r of existing) {
    const k = roleKey(r.name);
    const cur = byKey.get(k);
    if (!cur || r.sort_order < cur.sort_order) byKey.set(k, { id: r.id, name: r.name, sort_order: r.sort_order });
  }
  const resolved = new Map<string, ResolvedRole>();
  const toCreate: string[] = [];
  const creating = new Set<string>();
  for (const raw of names) {
    const name = raw.trim();
    if (name === "") continue;
    const hit = byKey.get(roleKey(name));
    if (hit) {
      resolved.set(name, { id: hit.id, name: hit.name });
    } else if (!creating.has(roleKey(name))) {
      creating.add(roleKey(name));
      toCreate.push(name);
    }
  }
  return { resolved, toCreate };
}

/**
 * Resolve the season roles for the given names, creating any that don't exist
 * yet (normalized role list, migration 0062). Returns a TRIMMED requested name
 * → { id, canonical name } map. Callers write the canonical name as the
 * assignment / rate text, so text always matches a role exactly.
 *
 * Never throws — on read/insert failure it returns whatever could be
 * resolved, so callers fall back to the requested text with role_id null
 * instead of failing the assignment itself.
 */
export async function ensureSeasonRoleIds(
  supabase: ReturnType<typeof createClient>,
  seasonId: string,
  names: string[],
): Promise<Map<string, ResolvedRole>> {
  const { data: existingRaw } = await supabase
    .from("official_roles")
    .select("id, name, sort_order")
    .eq("season_id", seasonId);
  const existing = (existingRaw ?? []) as RoleRow[];
  const { resolved, toCreate } = resolveRequestedRoles(existing, names);
  if (toCreate.length === 0) return resolved;

  let nextSort =
    existing.reduce((max, r) => Math.max(max, r.sort_order), -1) + 1;
  const inserts = toCreate.map((name) => ({
    season_id: seasonId,
    name,
    sort_order: nextSort++,
  }));

  // Upsert with ignoreDuplicates so a concurrent writer creating the same
  // name doesn't fail the batch; the re-read below resolves either way. (A
  // concurrent CASE VARIANT trips 0118's case-insensitive index instead and
  // errors; the re-read still resolves to whichever role won.)
  await supabase
    .from("official_roles")
    .upsert(inserts as never[], {
      onConflict: "season_id,name",
      ignoreDuplicates: true,
    });

  const { data: afterRaw } = await supabase
    .from("official_roles")
    .select("id, name, sort_order")
    .eq("season_id", seasonId);
  // Re-resolve EVERY requested name, not just the created spellings: two
  // requests with one key ("Field", "FIELD") create one role, and both must
  // come back resolved to it (sim:role-rename E4).
  const again = resolveRequestedRoles((afterRaw ?? []) as RoleRow[], names);
  for (const [k, v] of again.resolved) if (!resolved.has(k)) resolved.set(k, v);
  return resolved;
}
