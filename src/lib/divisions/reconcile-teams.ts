/**
 * Team reconciliation — the single source of truth for what a team RENAME
 * touches, plus the wizard-save reconcile (rename / add / report-only remove).
 *
 * Background: a team's name lives in TWO places — the `teams` row (identity)
 * and, redundantly, in `divisions.settings.teams[]` jsonb (name + coach-conflict
 * metadata, including name-keyed `conflict_team` back-references). Historically
 * the two rename surfaces each did half the job: the wizard save rewrote the
 * jsonb but INSERTED a net-new `teams` row for any name it didn't already see
 * (so a rename orphaned the old row and created a duplicate), while the inline
 * schedule-panel rename updated the `teams` row but left the jsonb stale. That
 * split is what corrupted SRALL Fall 2026 T-Ball (a real team appearing twice).
 *
 * The fix threads the live `teams.id` onto each wizard `TeamEntry` at edit-load,
 * so a rename (id present, name changed → UPDATE in place) is distinguishable
 * from a genuine add (no id → INSERT). Both surfaces now route every rename
 * through the shared primitives here, keeping the `teams` row, this division's
 * jsonb entry, AND every division's name-keyed `conflict_team` reference in sync.
 *
 * Removals are report-only by design: `teams` has CASCADE children
 * (practice_slots, team_availability_blocks, team_game_constraints,
 * official_conflicts) so deleting a "games-empty" team could silently destroy a
 * coach's entered data. A team omitted from the wizard's list is therefore kept
 * (re-appended to the jsonb so the two copies still agree) and surfaced, never
 * deleted.
 *
 * The functions take an optional injected Supabase client. Production callers
 * pass the browser client; the simulation harness
 * (scripts/sim/team-reconcile-sim.ts) injects an in-memory fake so this real
 * logic runs against fixtures. Same seam pattern as the umpires auto-assign
 * engine — do not add other client-construction paths.
 */

import { createClient } from "@/lib/supabase/client";
import type { TeamEntry } from "@/components/divisions/wizard-types";
import type { Plan } from "@/lib/plan/limits";
// Type-only — elided at runtime, so the Node sim harness never pulls in the
// client component this type happens to live in.
import type { CapName } from "@/components/plan/upgrade-cta";

export type ReconcileClient = ReturnType<typeof createClient>;

export type LiveTeam = { id: string; name: string };

/** A detected in-place rename: the `teams` row `id` keeps its identity while
 *  its name moves from `oldName` to `newName`. `oldName` is the authoritative
 *  DB value, so jsonb name matching keys off it. */
export type Rename = { id: string; oldName: string; newName: string };

/** A live team omitted from the submitted list. Kept (never deleted); the
 *  game count rides along so the caller can surface an honest notice. */
export type RemovedTeam = { id: string; name: string; gameCount: number };

export type ReconcilePlan = {
  renames: Rename[];
  /** Entries with no matching live id → genuine inserts. Names trimmed. */
  inserts: TeamEntry[];
  /** Live ids absent from the submitted list → report-only removals. */
  removedIds: string[];
  /** Non-null when the resulting team set would contain a duplicate name
   *  (case-insensitive, trimmed) — the caller must abort with this message. */
  collision: string | null;
};

const norm = (s: string) => s.trim().toLowerCase();

/**
 * PURE. Diff the submitted wizard entries against the live `teams` rows using
 * the threaded id as the stable identity. Blank-named entries are ignored
 * (mirrors the existing `nonBlankTeams` filter). Does no I/O.
 */
export function planTeamReconciliation(
  liveTeams: LiveTeam[],
  submitted: TeamEntry[],
): ReconcilePlan {
  const liveById = new Map(liveTeams.map((t) => [t.id, t.name]));
  const renames: Rename[] = [];
  const inserts: TeamEntry[] = [];
  const seenIds = new Set<string>();

  for (const e of submitted) {
    const name = e.name.trim();
    if (name === "") continue;
    if (e.id && liveById.has(e.id)) {
      seenIds.add(e.id);
      const oldName = liveById.get(e.id) as string;
      if (oldName.trim() !== name) renames.push({ id: e.id, oldName, newName: name });
    } else {
      // No id, or an id that no longer exists live → treat as a genuine add.
      inserts.push({ ...e, name });
    }
  }

  const removedIds = liveTeams.filter((t) => !seenIds.has(t.id)).map((t) => t.id);

  // Final name multiset = every live team (with rename applied; removed teams
  // are KEPT, so they stay with their old name) + inserts.
  const finalNames: string[] = [];
  for (const t of liveTeams) {
    const r = renames.find((x) => x.id === t.id);
    finalNames.push(norm(r ? r.newName : t.name));
  }
  for (const e of inserts) finalNames.push(norm(e.name));

  let collision: string | null = null;
  const counts = new Map<string, number>();
  for (const n of finalNames) {
    const c = (counts.get(n) ?? 0) + 1;
    counts.set(n, c);
    if (c === 2 && collision === null) {
      collision = "Two teams would share the same name. Give each team a unique name.";
    }
  }

  return { renames, inserts, removedIds, collision };
}

/**
 * PURE. Apply a set of renames to one division's `settings.teams[]` entries,
 * rewriting BOTH the renamed team's own `name` (only when these entries belong
 * to the division the renamed teams live in) AND every entry's name-keyed
 * `conflict_team` back-reference (in this or any other division, matched by the
 * reference's `conflict_division` pointing at the renamed teams' division).
 *
 * This is the one place rename-propagation semantics live; both the wizard save
 * and the inline panel rename call it. `id` is never written to jsonb — strip
 * it via {@link toJsonbEntries} at the write site.
 */
export function rewriteEntriesForRenames(
  entries: TeamEntry[],
  entriesDivisionId: string,
  renamedDivisionId: string,
  renames: Rename[],
): TeamEntry[] {
  if (renames.length === 0) return entries;
  const isSelf = entriesDivisionId === renamedDivisionId;
  return entries.map((e) => {
    let name = e.name;
    let conflictTeam = e.conflict_team;
    for (const r of renames) {
      if (isSelf && name.trim() === r.oldName.trim()) name = r.newName;
      if (e.conflict_division === renamedDivisionId && conflictTeam.trim() === r.oldName.trim()) {
        conflictTeam = r.newName;
      }
    }
    return { ...e, name, conflict_team: conflictTeam };
  });
}

/** Strip the transient `id` before persisting to jsonb — the jsonb stays
 *  name + coach-conflict metadata only; identity lives on the `teams` row. */
export function toJsonbEntries(entries: TeamEntry[]): TeamEntry[] {
  return entries.map((e) => {
    const rest: TeamEntry = {
      name: e.name,
      has_coach_conflict: e.has_coach_conflict,
      conflict_division: e.conflict_division,
      conflict_team: e.conflict_team,
    };
    if (e.practice_slots) rest.practice_slots = e.practice_slots;
    return rest;
  });
}

/** Minimal jsonb entry for a kept-but-omitted (report-only removed) team, so
 *  the jsonb name set keeps matching the `teams` table. */
function keptRemovedEntry(name: string): TeamEntry {
  return { name, has_coach_conflict: false, conflict_division: "", conflict_team: "" };
}

/**
 * PURE. Build the wizard's `data.teams` at edit-load from the LIVE `teams` rows
 * (authoritative identity: id + name) layered with coach-conflict metadata from
 * the jsonb, matched by normalized name. The live table — not the jsonb — is
 * the source of truth for which teams exist, so a drifted division shows its
 * real rows (duplicates included) rather than hiding them, and each entry
 * carries its `id` so the save can rename in place. Jsonb-only phantoms (an
 * entry with no live row) are dropped.
 */
export function mergeLiveTeamsWithJsonb(
  liveTeams: LiveTeam[],
  jsonbTeams: TeamEntry[],
): TeamEntry[] {
  const meta = new Map<string, TeamEntry>();
  for (const e of jsonbTeams) {
    // First occurrence wins — a duplicate jsonb name is itself drift.
    if (!meta.has(norm(e.name))) meta.set(norm(e.name), e);
  }
  return liveTeams.map((t) => {
    const m = meta.get(norm(t.name));
    return {
      id: t.id,
      name: t.name,
      has_coach_conflict: m?.has_coach_conflict ?? false,
      conflict_division: m?.conflict_division ?? "",
      conflict_team: m?.conflict_team ?? "",
      practice_slots: m?.practice_slots,
    };
  });
}

// ── Shared DB primitives (the ONLY rename path) ──────────────────────────────

/** The single `teams`-row rename statement used by every surface. */
async function renameTeamRow(
  client: ReconcileClient,
  teamId: string,
  newName: string,
): Promise<{ error: string | null }> {
  const { error } = await client
    .from("teams")
    .update({ name: newName } as never)
    .eq("id", teamId);
  return { error: error ? error.message : null };
}

/** Read one division's settings, apply the renames to its `teams[]`, and write
 *  it back only if something changed. Used uniformly for the edited division
 *  (self) and every sibling division. */
async function applyRenamesToDivisionSettings(
  client: ReconcileClient,
  divisionId: string,
  renamedDivisionId: string,
  renames: Rename[],
): Promise<{ error: string | null }> {
  const { data, error } = await client
    .from("divisions")
    .select("settings")
    .eq("id", divisionId)
    .single();
  if (error) return { error: error.message };

  const settings = ((data as { settings: unknown } | null)?.settings ?? {}) as Record<
    string,
    unknown
  >;
  const entries = Array.isArray(settings.teams) ? (settings.teams as TeamEntry[]) : [];
  const rewritten = rewriteEntriesForRenames(entries, divisionId, renamedDivisionId, renames);

  // Skip the write when nothing in this division referenced a renamed team.
  if (JSON.stringify(rewritten) === JSON.stringify(entries)) return { error: null };

  const { error: upErr } = await client
    .from("divisions")
    .update({ settings: { ...settings, teams: toJsonbEntries(rewritten) } } as never)
    .eq("id", divisionId);
  return { error: upErr ? upErr.message : null };
}

/** Propagate renames to every division in the league EXCEPT the edited one —
 *  cross-division `conflict_team` back-references. */
async function propagateRenamesToOtherDivisions(
  client: ReconcileClient,
  leagueId: string,
  excludeDivisionId: string,
  renames: Rename[],
): Promise<{ error: string | null }> {
  if (renames.length === 0) return { error: null };
  const { data, error } = await client
    .from("divisions")
    .select("id")
    .eq("league_id", leagueId)
    .neq("id", excludeDivisionId);
  if (error) return { error: error.message };

  for (const row of (data ?? []) as { id: string }[]) {
    const res = await applyRenamesToDivisionSettings(client, row.id, excludeDivisionId, renames);
    if (res.error) return res;
  }
  return { error: null };
}

async function countTeamGames(client: ReconcileClient, teamId: string): Promise<number> {
  const home = await client.from("games").select("id").eq("home_team_id", teamId);
  const away = await client.from("games").select("id").eq("away_team_id", teamId);
  const h = (home.data ?? []) as unknown[];
  const a = (away.data ?? []) as unknown[];
  return h.length + a.length;
}

// ── Inline rename (schedule panel) ───────────────────────────────────────────

export type InlineRenameResult = { ok: true } | { ok: false; error: string };

/**
 * The single rename entry point for the inline schedule-panel pencil. Replaces
 * the old bare `teams.update({name})` that left the jsonb stale. Renames the
 * row, rewrites this division's jsonb entry (name + self `conflict_team` refs),
 * and propagates the name change to sibling divisions' `conflict_team` refs.
 *
 * `siblingTeams` is the division's current roster (id + name) the caller
 * already holds — used for the duplicate-name guard and to resolve the old name
 * without an extra round-trip.
 */
export async function renameTeamInline(
  args: {
    leagueId: string;
    divisionId: string;
    teamId: string;
    newName: string;
    siblingTeams: LiveTeam[];
  },
  client: ReconcileClient = createClient(),
): Promise<InlineRenameResult> {
  const { leagueId, divisionId, teamId, siblingTeams } = args;
  const newName = args.newName.trim();
  if (!newName) return { ok: false, error: "Name cannot be blank." };

  const current = siblingTeams.find((t) => t.id === teamId);
  const oldName = current?.name ?? "";
  if (oldName.trim() === newName) return { ok: true }; // no-op

  const duplicate = siblingTeams.some(
    (t) => t.id !== teamId && norm(t.name) === norm(newName),
  );
  if (duplicate) {
    return { ok: false, error: "Another team in this division already has that name." };
  }

  const renames: Rename[] = [{ id: teamId, oldName, newName }];

  const rowRes = await renameTeamRow(client, teamId, newName);
  if (rowRes.error) return { ok: false, error: rowRes.error };

  const selfRes = await applyRenamesToDivisionSettings(client, divisionId, divisionId, renames);
  if (selfRes.error) return { ok: false, error: selfRes.error };

  const otherRes = await propagateRenamesToOtherDivisions(client, leagueId, divisionId, renames);
  if (otherRes.error) return { ok: false, error: otherRes.error };

  return { ok: true };
}

// ── Wizard save reconcile ────────────────────────────────────────────────────

export type SaveReconcileResult =
  | { ok: true; teamsForJsonb: TeamEntry[]; renames: Rename[]; removed: RemovedTeam[] }
  | { ok: false; error: string }
  | { ok: false; capHit: { cap: CapName; limit: number; plan: Plan } };

/**
 * Reconcile the wizard's submitted team list against the live `teams` rows on
 * an edit-mode save. Performs the `teams`-table renames + inserts and the
 * cross-division `conflict_team` propagation, and RETURNS the reconciled
 * `teams[]` for the caller to embed in its single division-row settings UPDATE
 * (so this division's jsonb is written exactly once, by the caller).
 *
 * Removals are report-only: omitted live teams are NOT deleted; they are
 * re-appended to `teamsForJsonb` (so jsonb and `teams` still agree) and
 * returned in `removed` for a non-blocking notice.
 */
export async function reconcileTeamsOnSave(
  args: {
    leagueId: string;
    divisionId: string;
    submitted: TeamEntry[];
    teamCount: number;
    teamLimit: number;
    plan: Plan;
  },
  client: ReconcileClient = createClient(),
): Promise<SaveReconcileResult> {
  const { leagueId, divisionId, submitted, teamCount, teamLimit, plan } = args;

  const { data: liveData, error: liveErr } = await client
    .from("teams")
    .select("id, name")
    .eq("division_id", divisionId);
  if (liveErr) return { ok: false, error: liveErr.message };
  const liveTeams = (liveData ?? []) as LiveTeam[];

  const planResult = planTeamReconciliation(liveTeams, submitted);
  if (planResult.collision) return { ok: false, error: planResult.collision };

  const { renames, inserts, removedIds } = planResult;

  // Upfront cap check — net-new teams only (existing rows stay). The per-team
  // RPC re-checks server-side; this fails fast before any write.
  if (teamLimit !== -1 && teamCount + inserts.length > teamLimit) {
    return { ok: false, capHit: { cap: "teamsPerOrg", limit: teamLimit, plan } };
  }

  // Renames — UPDATE in place, never a new row.
  for (const r of renames) {
    const res = await renameTeamRow(client, r.id, r.newName);
    if (res.error) return { ok: false, error: res.error };
  }

  // Inserts — genuine net-new teams via the capped RPC.
  for (const t of inserts) {
    const { data: rpcData, error: rpcErr } = await client.rpc("create_team" as never, {
      p_league_id: leagueId,
      p_division_id: divisionId,
      p_name: t.name.trim(),
    } as never);
    if (rpcErr) return { ok: false, error: rpcErr.message };
    const payload = rpcData as
      | { row: { id: string } }
      | { error: "cap_reached"; cap: CapName; limit: number; plan: Plan };
    if (payload && "error" in payload && payload.error === "cap_reached") {
      return { ok: false, capHit: { cap: payload.cap, limit: payload.limit, plan: payload.plan } };
    }
  }

  // Report-only removals — count games, never delete.
  const removed: RemovedTeam[] = [];
  for (const id of removedIds) {
    const live = liveTeams.find((t) => t.id === id);
    const gameCount = await countTeamGames(client, id);
    removed.push({ id, name: live?.name ?? "", gameCount });
  }

  // This division's jsonb: submitted entries with in-division renames applied,
  // then the kept-removed teams re-appended so the name set still matches the
  // `teams` table. `id` is stripped at the write.
  const rewritten = rewriteEntriesForRenames(
    submitted.filter((e) => e.name.trim() !== ""),
    divisionId,
    divisionId,
    renames,
  );
  const teamsForJsonb = toJsonbEntries([
    ...rewritten,
    ...removed.map((r) => keptRemovedEntry(r.name)),
  ]);

  // Cross-division conflict_team propagation.
  const otherRes = await propagateRenamesToOtherDivisions(client, leagueId, divisionId, renames);
  if (otherRes.error) return { ok: false, error: otherRes.error };

  return { ok: true, teamsForJsonb, renames, removed };
}

// ── Read-only blast-radius detection ─────────────────────────────────────────

/**
 * PURE. Detect a division whose live `teams` rows disagree with its persisted
 * `settings.teams[]` jsonb (the corruption shape this fix prevents). Detection
 * only — no repair. Returns a human notice string, or null when they agree.
 */
export function detectTeamJsonbDrift(
  liveTeams: LiveTeam[],
  jsonbTeams: { name: string }[],
): string | null {
  const liveNames = liveTeams.map((t) => norm(t.name)).sort();
  const jsonbNames = jsonbTeams.map((t) => norm(t.name)).sort();
  if (liveNames.length === jsonbNames.length && liveNames.every((n, i) => n === jsonbNames[i])) {
    return null;
  }
  if (liveTeams.length > jsonbTeams.length) {
    return (
      `This division has ${liveTeams.length} teams but its saved list has ` +
      `${jsonbTeams.length}. The extra team(s) may be duplicates from an earlier ` +
      `rename. Review the team names below before saving.`
    );
  }
  return (
    `This division's saved team list (${jsonbTeams.length}) doesn't match its ` +
    `${liveTeams.length} team row(s). Review the team names below before saving.`
  );
}
