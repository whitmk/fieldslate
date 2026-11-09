"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  DEFAULT_GAME_DURATION_MINS,
  assignmentPrecheckMessage,
  bookingsFromRows,
  findConflictInBookings,
  findUmpireBlackout,
  findUmpireConflict,
  formatConflictTime,
  type GameTimeInfo,
  type UmpireBookingRow,
} from "@/lib/umpires/conflicts";
import {
  gameDateKey,
  isWithinAvailability,
  type AvailabilityWindow,
} from "@/lib/umpires/eligibility";
import { ensureSeasonRoleIds } from "@/lib/umpires/roles";
import { coachTeamLabel } from "@/lib/umpires/team-options";
import { coiPhrase, coiRelationshipLabel, type CoiLink } from "@/lib/umpires/coi";

export type UmpireOption = {
  id: string;
  name: string;
  /** Team this official coaches (0063) — drives the coach-conflict warning. */
  team_id?: string | null;
  /** Coached team's name + division — display only, marks coaches in the picker. */
  team?: { name: string; division: { name: string } | null } | null;
  /** Conflict-of-interest links (0073) — drive the COI warning, parallel to
   *  the coach conflict. */
  conflicts?: CoiLink[] | null;
  /** Weekly windows / blackout dates / season-wide assignments (embedded on
   *  the roster feeds) — drive the pre-click eligibility state per option. */
  availability?: AvailabilityWindow[] | null;
  blackouts?: { date: string }[] | null;
  booking_rows?: UmpireBookingRow[] | null;
};

/** Pre-click option state, computed against the specific game. rank orders
 *  the picker: 0 eligible, 1 flagged-but-selectable, 2 disabled. */
type DecoratedOption = {
  u: UmpireOption;
  disabled: boolean;
  rank: 0 | 1 | 2;
  suffix: string;
};

export type SlotAssignment = {
  id: string;        // game_umpires.id
  umpire_id: string;
  umpire_name: string;
  role: string;
};

export type UmpireSlotsGame = {
  id: string;
  scheduled_at: string;
  duration_minutes?: number; // falls back to default if missing
  home_team_name: string;
  away_team_name: string;
  /** Team ids (0063) — enable the coach-conflict warning when provided. */
  home_team_id?: string | null;
  away_team_id?: string | null;
};

interface Props {
  game: UmpireSlotsGame;
  seasonId: string;                // leagues.id — resolves official_roles ids on write
  roles: string[];                 // ordered role labels for this division
  assignments: SlotAssignment[];   // existing rows for this game
  umpires: UmpireOption[];         // roster for the season
  layout?: "stacked" | "inline";   // "inline" = one row per slot; "stacked" = vertical
  compact?: boolean;               // smaller text/padding
  /** Fires after any successful write (assign/reassign/unassign). Parents
   *  that hold `assignments` in client state must re-fetch here —
   *  router.refresh() alone only reaches server components, so without this
   *  the select snaps back to its stale prop value. */
  onChanged?: () => void;
}

export function UmpireSlots({
  game,
  seasonId,
  roles,
  assignments,
  umpires,
  layout = "stacked",
  compact = false,
  onChanged,
}: Props) {
  const router = useRouter();
  const [errorByRole, setErrorByRole] = useState<Record<string, string>>({});
  const [warningByRole, setWarningByRole] = useState<Record<string, string>>({});
  const [pendingRole, setPendingRole] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Clear messages when user navigates away/clicks elsewhere.
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node) &&
        (Object.keys(errorByRole).length > 0 ||
          Object.keys(warningByRole).length > 0)
      ) {
        setErrorByRole({});
        setWarningByRole({});
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [errorByRole, warningByRole]);

  // Roles now come from the season's official_roles list, but legacy
  // game_umpires rows carry free-text labels that may not be on it. Append
  // those so an existing assignment is never invisible (an unseen row would
  // look like a free slot and invite double-staffing).
  const effectiveRoles = [...roles];
  for (const a of assignments) {
    if (!effectiveRoles.includes(a.role)) effectiveRoles.push(a.role);
  }

  if (effectiveRoles.length === 0) return null;

  const candidate: GameTimeInfo = {
    id: game.id,
    scheduled_at: game.scheduled_at,
    duration_minutes: game.duration_minutes ?? DEFAULT_GAME_DURATION_MINS,
    home_team_name: game.home_team_name,
    away_team_name: game.away_team_name,
  };

  // Pre-click eligibility per option, from feed-embedded data (no per-option
  // queries). Advisory only for flags; the save-time hard blocks below stay —
  // a second admin can create a conflict between render and click.
  // Wall-clock date of the stored time (eligibility.ts) — never the instant
  // read in the browser's zone.
  const gameDate = gameDateKey(game.scheduled_at);
  const decorated: DecoratedOption[] = umpires.map((u) => {
    const conflict = findConflictInBookings(
      candidate,
      bookingsFromRows(u.booking_rows ?? []),
    );
    if (conflict) {
      return {
        u,
        disabled: true,
        rank: 2,
        suffix: ` — already assigned ${conflict.home_team_name} vs ${conflict.away_team_name}, ${formatConflictTime(conflict.scheduled_at)}`,
      };
    }
    if ((u.blackouts ?? []).some((b) => b.date === gameDate)) {
      return { u, disabled: true, rank: 2, suffix: " — unavailable (blackout)" };
    }

    // Selectable flags. Zero windows = available anytime (eligibility.ts) —
    // only officials with listed windows can be "outside" them. The coach
    // link affects rank only: the base label already reads "coaches {team}".
    const flags: string[] = [];
    const windows = u.availability ?? [];
    if (
      windows.length > 0 &&
      !isWithinAvailability(windows, game.scheduled_at, candidate.duration_minutes)
    ) {
      flags.push("outside listed availability");
    }
    const coachesTeamInGame =
      u.team_id != null &&
      (u.team_id === game.home_team_id || u.team_id === game.away_team_id);
    for (const c of u.conflicts ?? []) {
      const isHome = c.team_id === game.home_team_id;
      const isAway = game.away_team_id != null && c.team_id === game.away_team_id;
      if (!isHome && !isAway) continue;
      flags.push(
        `${coiRelationshipLabel(c.relationship)}: ${
          isHome ? game.home_team_name : game.away_team_name
        }`,
      );
    }
    if (flags.length > 0 || coachesTeamInGame) {
      return {
        u,
        disabled: false,
        rank: 1,
        suffix: flags.length > 0 ? ` — ${flags.join("; ")}` : "",
      };
    }
    return { u, disabled: false, rank: 0, suffix: "" };
  });
  // Stable sort: eligible, then flagged, then disabled; feed order (name asc)
  // within each group.
  const orderedOptions = [...decorated].sort((a, b) => a.rank - b.rank);

  async function handleChange(role: string, nextUmpireId: string) {
    setPendingRole(role);
    setErrorByRole((prev) => {
      const next = { ...prev };
      delete next[role];
      return next;
    });
    setWarningByRole((prev) => {
      const next = { ...prev };
      delete next[role];
      return next;
    });

    const supabase = createClient();
    const existing = assignments.find((a) => a.role === role);

    // Empty selection — delete the existing row if there is one.
    if (nextUmpireId === "") {
      if (existing) {
        const { error } = await supabase
          .from("game_umpires")
          .delete()
          .eq("id", existing.id);
        if (error) {
          setErrorByRole({ [role]: error.message });
          setPendingRole(null);
          return;
        }
      }
      setPendingRole(null);
      router.refresh();
      onChanged?.();
      return;
    }

    // Conflict + blackout checks before persisting.
    const nextUmpire = umpires.find((u) => u.id === nextUmpireId);
    const umpName = nextUmpire?.name ?? "This umpire";
    // A check whose read fails refuses the save (2026-11-06) — it used to
    // read as "no conflict" and save. Wording: assignmentPrecheckMessage.
    const [conflictCheck, blackoutCheck] = await Promise.all([
      findUmpireConflict(nextUmpireId, candidate),
      findUmpireBlackout(nextUmpireId, game.scheduled_at),
    ]);
    const refusal = assignmentPrecheckMessage(umpName, conflictCheck, blackoutCheck);
    if (refusal) {
      setErrorByRole({ [role]: refusal });
      setPendingRole(null);
      return;
    }

    // Coach conflict (0063) and conflicts of interest (0073) are warnings,
    // not blocks, on manual assignment — auto-assign hard-blocks both, but
    // the commissioner can knowingly override here. Computed before the
    // save, shown after it succeeds. Both can apply at once.
    const warnings: string[] = [];
    if (
      nextUmpire?.team_id &&
      (nextUmpire.team_id === game.home_team_id ||
        nextUmpire.team_id === game.away_team_id)
    ) {
      const coachedTeam =
        nextUmpire.team_id === game.home_team_id
          ? game.home_team_name
          : game.away_team_name;
      warnings.push(
        `${umpName} coaches ${coachedTeam} — assigned anyway. Consider a neutral official.`,
      );
    }
    for (const c of nextUmpire?.conflicts ?? []) {
      const isHome = c.team_id === game.home_team_id;
      const isAway = game.away_team_id != null && c.team_id === game.away_team_id;
      if (!isHome && !isAway) continue;
      const conflictTeam = isHome ? game.home_team_name : game.away_team_name;
      warnings.push(
        `${umpName} is listed as ${coiPhrase(c.relationship)} on ${conflictTeam} — assigned anyway. Consider a neutral official.`,
      );
    }

    // Resolve this slot's label to its season role (created on the fly if
    // missing; a case/space variant resolves to the existing role). Its id
    // AND canonical name are written — on insert, and on reassign so legacy
    // text-only or case-variant rows converge as they're touched (2026-11-07).
    const resolvedRoles = await ensureSeasonRoleIds(supabase, seasonId, [role]);
    const resolved = resolvedRoles.get(role.trim());
    const roleId = resolved?.id ?? null;
    const roleText = resolved?.name ?? role;

    if (existing) {
      const { error } = await supabase
        .from("game_umpires")
        .update({ umpire_id: nextUmpireId, role: roleText, role_id: roleId } as never)
        .eq("id", existing.id);
      if (error) {
        setErrorByRole({ [role]: humanizeUniqueViolation(error.message) });
        setPendingRole(null);
        return;
      }
    } else {
      const { error } = await supabase
        .from("game_umpires")
        .insert([
          { game_id: game.id, umpire_id: nextUmpireId, role: roleText, role_id: roleId },
        ] as never[]);
      if (error) {
        setErrorByRole({ [role]: humanizeUniqueViolation(error.message) });
        setPendingRole(null);
        return;
      }
    }

    if (warnings.length > 0) {
      setWarningByRole({ [role]: warnings.join(" ") });
    }
    setPendingRole(null);
    router.refresh();
    onChanged?.();
  }

  const inputHeight = compact ? "h-8" : "h-9";
  const inputText = compact ? "text-xs" : "text-sm";

  return (
    <div ref={containerRef} className={`flex flex-col gap-2 ${compact ? "" : ""}`}>
      {effectiveRoles.map((role) => {
        const current = assignments.find((a) => a.role === role);
        const err = errorByRole[role];
        const warn = warningByRole[role];
        const isPending = pendingRole === role;

        return (
          <div key={role} className="flex flex-col gap-1">
            <div
              className={`flex items-center gap-2 ${
                layout === "inline" ? "flex-row" : "flex-row"
              }`}
            >
              <span
                className={`flex-shrink-0 font-medium text-gray-500 ${
                  compact ? "w-14 text-[11px]" : "w-16 text-xs"
                }`}
              >
                {role}
              </span>
              <div className="relative flex-1">
                <select
                  value={current?.umpire_id ?? ""}
                  disabled={isPending}
                  onChange={(e) => handleChange(role, e.target.value)}
                  className={`${inputHeight} ${inputText} w-full rounded-lg border border-gray-200 bg-white px-2 pr-7 text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20 disabled:opacity-50`}
                >
                  <option value="">— Unassigned —</option>
                  {orderedOptions.map(({ u, disabled: optDisabled, suffix }) => (
                    <option key={u.id} value={u.id} disabled={optDisabled}>
                      {u.team
                        ? `${u.name} — coaches ${coachTeamLabel(u.team.name, u.team.division?.name)}`
                        : u.name}
                      {suffix}
                    </option>
                  ))}
                </select>
                {isPending && (
                  <Loader2 className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-gray-400" />
                )}
              </div>
            </div>
            {err && (
              <div className="ml-[72px] flex items-start gap-1.5 text-[11px] text-red-600">
                <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />
                <span>{err}</span>
              </div>
            )}
            {warn && !err && (
              <div className="ml-[72px] flex items-start gap-1.5 text-[11px] text-amber-600">
                <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />
                <span>{warn}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function humanizeUniqueViolation(msg: string): string {
  // The database has two unique indexes on (game_id, umpire_id) and (game_id, role).
  // The role index is enforced via update path, but be defensive.
  if (/duplicate key|unique/i.test(msg)) {
    return "Slot already filled — refresh to see the latest assignments.";
  }
  return msg;
}
