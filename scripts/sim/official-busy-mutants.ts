// Mutation pass for sim:official-busy (0129). Applied to the REAL source,
// restored byte-for-byte, killed only if the FIRST failing assertion is the
// one written for it. One mutant per caller that decides "busy" (CB1–CB5),
// and one per fail-closed path (FC1–FC7).
import { runMutants, type Mutant } from "./mutant-runner";

const CONFLICTS = "src/lib/umpires/conflicts.ts";
const AUTO = "src/lib/umpires/auto-assign.ts";
const SLOTS = "src/components/umpires/umpire-slots.tsx";
const PANEL = "src/components/divisions/division-schedule-panel.tsx";
const DETAIL = "src/components/umpires/game-detail-modal.tsx";
const RP = "src/components/schedule/record-played-modal.tsx";

const MUTANTS: Mutant[] = [
  // ── each caller deciding "busy" on its own again ──────────────────────
  {
    id: "CB1", what: "the manual save check reads every assignment itself (cancelled counted busy again)", file: CONFLICTS,
    find: "  const read = await fetchOfficialBookings(seasonId, [umpireId], client);\n  if (!read.ok) return { ok: false };\n  return { ok: true, conflict: findConflictInBookings(candidate, read.byUmpire.get(umpireId) ?? []) };\n",
    replace: "  const supabase = client ?? createClient();\n  const { data, error } = await supabase.from(\"game_umpires\").select(\"game:games(id, scheduled_at)\").eq(\"umpire_id\", umpireId);\n  if (error) return { ok: false };\n  const rows = ((data ?? []) as { game: { id: string; scheduled_at: string } | null }[]).filter((r) => r.game)\n    .map((r) => ({ id: r.game!.id, scheduled_at: r.game!.scheduled_at, duration_minutes: 90, home_team_name: \"TBD\", away_team_name: \"TBD\" }));\n  return { ok: true, conflict: findConflictInBookings(candidate, rows) };\n",
    expect: "B1",
  },
  {
    id: "CB2", what: "the division panel's roster re-reads bookings through the embed", file: PANEL,
    find: "           blackouts:official_blackouts(date)`,\n        )\n        .eq(\"season_id\", leagueId)",
    replace: "           blackouts:official_blackouts(date),\n           booking_rows:game_umpires(game:games(id, scheduled_at))`,\n        )\n        .eq(\"season_id\", leagueId)",
    expect: "S1",
  },
  {
    id: "CB3", what: "the game detail roster re-reads bookings through the embed", file: DETAIL,
    find: "             blackouts:official_blackouts(date)`,\n          )\n          .eq(\"season_id\", game.league_id)",
    replace: "             blackouts:official_blackouts(date),\n             booking_rows:game_umpires(game:games(id, scheduled_at))`,\n          )\n          .eq(\"season_id\", game.league_id)",
    expect: "S2",
  },
  {
    id: "CB4", what: "record-played reads the assigned officials' bookings through the embed", file: RP,
    find: "        .select(\"umpire:umpires(id, name)\")\n",
    replace: "        .select(\"umpire:umpires(id, name, booking_rows:game_umpires(game:games(id, scheduled_at)))\")\n",
    expect: "S3",
  },
  {
    id: "CB5", what: "auto-assign reads its own bookings with the old cancelled-only filter (postponed busy)", file: AUTO,
    find: "    fetchOfficialBookings(seasonId, umpireIds, supabase),\n",
    replace: "    (async () => {\n      const { data } = await supabase.from(\"game_umpires\").select(\"id, game_id, umpire_id, game:games(id, scheduled_at, status)\").in(\"umpire_id\", umpireIds);\n      const rows = ((data ?? []) as { id: string; game_id: string; umpire_id: string; game: { scheduled_at: string; status: string } | null }[])\n        .filter((r) => r.game && r.game.status !== \"cancelled\")\n        .map((r) => ({ game_umpire_id: r.id, umpire_id: r.umpire_id, game_id: r.game_id, scheduled_at: r.game!.scheduled_at, minutes: 90, home: null, away: null }));\n      return { ok: true as const, byUmpire: new Map(), rows };\n    })(),\n",
    expect: "B2",
  },
  // ── fail closed ────────────────────────────────────────────────────────
  {
    id: "FC1", what: "an rpc error reads as an empty list (everyone free)", file: CONFLICTS,
    find: "  if (error) return { ok: false };\n  const rows = parseOfficialBookings(data);\n",
    replace: "  if (error) return { ok: true, byUmpire, rows: [] };\n  const rows = parseOfficialBookings(data);\n",
    expect: "FC1",
  },
  {
    id: "FC2", what: "a reply that isn't a list reads as empty", file: CONFLICTS,
    find: "  if (!Array.isArray(raw)) return null;\n",
    replace: "  if (!Array.isArray(raw)) return [];\n",
    expect: "FC2",
  },
  {
    id: "FC3", what: "the manual save treats unread bookings as no conflict", file: CONFLICTS,
    find: "  if (!read.ok) return { ok: false };\n  return { ok: true, conflict:",
    replace: "  if (!read.ok) return { ok: true, conflict: null };\n  return { ok: true, conflict:",
    expect: "FC3",
  },
  {
    id: "FC4", what: "the picker treats unread bookings as free", file: SLOTS,
    find: "    if (!u.bookings) {\n      return { u, disabled: true, rank: 2, suffix: ` — ${BOOKINGS_UNREAD_SUFFIX}` };\n    }\n    const conflict = findConflictInBookings(candidate, u.bookings);\n",
    replace: "    const conflict = findConflictInBookings(candidate, u.bookings ?? []);\n",
    expect: "FC4",
  },
  {
    id: "FC5", what: "the division panel ignores an unread bookings list", file: PANEL,
    find: "    setOfficialsReadFailed(!!(seasonRolesErr || umpiresErr || assignsErr) || !bookings.ok);\n",
    replace: "    setOfficialsReadFailed(!!(seasonRolesErr || umpiresErr || assignsErr));\n",
    expect: "FC5",
  },
  {
    id: "FC6", what: "the game detail modal ignores an unread bookings list", file: DETAIL,
    find: "      if (!bookings.ok) {\n",
    replace: "      if (false && !bookings.ok) {\n",
    expect: "FC6",
  },
  {
    id: "FC7", what: "record-played treats unread bookings as none", file: RP,
    find: "          bookings: busy && busy.ok ? busy.byUmpire.get(u.id) ?? [] : null,\n",
    replace: "          bookings: busy && busy.ok ? busy.byUmpire.get(u.id) ?? [] : [],\n",
    expect: "FC7",
  },
];

runMutants({ sim: "scripts/sim/official-busy-sim.ts", timezones: ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"], mutants: MUTANTS });
