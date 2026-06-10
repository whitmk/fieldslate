import { createClient } from "@/lib/supabase/client";

type RoleRow = { id: string; name: string; sort_order: number };

/**
 * Resolve official_roles ids for the given role names in a season, creating
 * any that don't exist yet (normalized role list, migration 0062). Returns a
 * trimmed-name → id map. Blank names are ignored; matching is exact after
 * trimming, mirroring the UNIQUE(season_id, name) constraint.
 *
 * Never throws — on read/insert failure it returns whatever could be
 * resolved, so callers fall back to text-only writes (role_id null) instead
 * of failing the assignment itself.
 */
export async function ensureSeasonRoleIds(
  supabase: ReturnType<typeof createClient>,
  seasonId: string,
  names: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const wanted = Array.from(
    new Set(names.map((n) => n.trim()).filter((n) => n !== "")),
  );
  if (wanted.length === 0) return map;

  const { data: existingRaw } = await supabase
    .from("official_roles")
    .select("id, name, sort_order")
    .eq("season_id", seasonId);
  const existing = (existingRaw ?? []) as RoleRow[];
  for (const r of existing) map.set(r.name, r.id);

  const missing = wanted.filter((n) => !map.has(n));
  if (missing.length === 0) return map;

  let nextSort =
    existing.reduce((max, r) => Math.max(max, r.sort_order), -1) + 1;
  const inserts = missing.map((name) => ({
    season_id: seasonId,
    name,
    sort_order: nextSort++,
  }));

  // Upsert with ignoreDuplicates so a concurrent writer creating the same
  // name doesn't fail the batch; the re-select below picks up ids either way.
  const { error } = await supabase
    .from("official_roles")
    .upsert(inserts as never[], {
      onConflict: "season_id,name",
      ignoreDuplicates: true,
    });
  if (error) return map;

  const { data: afterRaw } = await supabase
    .from("official_roles")
    .select("id, name")
    .eq("season_id", seasonId)
    .in("name", missing);
  for (const r of (afterRaw ?? []) as { id: string; name: string }[]) {
    map.set(r.name, r.id);
  }
  return map;
}
