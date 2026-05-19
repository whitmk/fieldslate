"use client";

import { createClient } from "@/lib/supabase/client";

export type AutoAssignResult =
  | {
      success: true;
      placed: number;
      unassigned: { team_id: string; team_name: string; reason: string }[];
    }
  | { success: false; error: string };

type TimeSlot = {
  id: string;
  label: string;
  start_time: string;
  days_of_week: string[];
};
type Venue = { id: string; name: string };
type Team = {
  id: string;
  name: string;
  practices_per_week: number;
  preferred_days: string[] | null;
  preferred_time_id: string | null;
  preferred_field_id: string | null;
};

type AvailabilityBlock = {
  team_id: string;
  day_of_week: string;
  start_time: string | null;
  end_time: string | null;
};

const DEFAULT_DAY_ORDER = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

// Mo=0, Tu=1, … Su=6. Used for the "at least one rest day between
// practices" soft constraint in chooseDays — distance is circular so
// Sun+Mon counts as consecutive, not 6-apart.
const DAY_INDEX: Record<string, number> = {
  Mo: 0, Tu: 1, We: 2, Th: 3, Fr: 4, Sa: 5, Su: 6,
};

function circularDayDistance(a: string, b: string): number {
  const ai = DAY_INDEX[a];
  const bi = DAY_INDEX[b];
  if (ai === undefined || bi === undefined) return 7;
  const d = Math.abs(ai - bi);
  return Math.min(d, 7 - d);
}

function spacedFromAll(chosen: string[], candidate: string): boolean {
  for (const c of chosen) {
    if (circularDayDistance(c, candidate) < 2) return false;
  }
  return true;
}

/**
 * Does any of `blocks` rule out this (day, wall_time)? A whole-day block
 * (start/end null) rules out every wall_time on that day. Otherwise the
 * wall_time has to fall in [start_time, end_time) — same half-open
 * convention as a calendar event.
 */
function isBlocked(
  blocks: AvailabilityBlock[],
  day: string,
  wallTime: string,
): boolean {
  for (const b of blocks) {
    if (b.day_of_week !== day) continue;
    if (b.start_time === null || b.end_time === null) return true;
    if (wallTime >= b.start_time && wallTime < b.end_time) return true;
  }
  return false;
}

/**
 * Pick `count` days from `priorityDays` (preferred first, then fallbacks),
 * restricted to `slotDays` (the days the time slot is configured to cover),
 * skipping any (day, start_time, field) combination already in `taken`, and
 * skipping any day this team is unavailable at this wall time.
 *
 * Soft spacing rule: by default we want at least one rest day between a
 * team's practices, measured as circular day distance ≥ 2 (Mo+We is OK,
 * Mo+Tu and Sa+Su are not). We do a first pass that enforces spacing,
 * then a second relaxed pass to fill remaining slots. Better to place a
 * team on consecutive days than leave them unassigned.
 *
 * Returns null if it can't find `count` free days even after the relaxed
 * pass.
 */
function chooseDays(
  count: number,
  priorityDays: string[],
  slotDays: Set<string>,
  startTime: string,
  fieldId: string,
  taken: Set<string>,
  blocks: AvailabilityBlock[],
): string[] | null {
  const chosen: string[] = [];

  function pass(requireSpacing: boolean) {
    for (const day of priorityDays) {
      if (chosen.length >= count) return;
      if (chosen.includes(day)) continue;
      if (!slotDays.has(day)) continue;
      if (isBlocked(blocks, day, startTime)) continue;
      const key = `${day}|${startTime}|${fieldId}`;
      if (taken.has(key)) continue;
      if (requireSpacing && !spacedFromAll(chosen, day)) continue;
      chosen.push(day);
    }
  }

  pass(true);
  if (chosen.length < count) pass(false);

  return chosen.length >= count ? chosen : null;
}

function reorderByPreference<T extends { id: string }>(
  items: T[],
  preferredId: string | null,
): T[] {
  if (!preferredId) return items;
  const preferred = items.filter((i) => i.id === preferredId);
  const rest = items.filter((i) => i.id !== preferredId);
  return [...preferred, ...rest];
}

export async function autoAssignPractices(
  divisionId: string,
): Promise<AutoAssignResult> {
  const supabase = createClient();

  // 1. Time slots for this division
  const { data: slotRows, error: slotErr } = await supabase
    .from("practice_time_slots")
    .select("id, label, start_time, days_of_week")
    .eq("division_id", divisionId)
    .order("sort_order", { ascending: true })
    .order("start_time", { ascending: true });
  if (slotErr) return { success: false, error: slotErr.message };
  const timeSlots = (slotRows ?? []) as TimeSlot[];
  if (timeSlots.length === 0) {
    return {
      success: false,
      error:
        "Add at least one practice time slot for this division before auto-assigning.",
    };
  }

  // 2. Practice-eligible venues for this division
  const { data: dvRows, error: dvErr } = await supabase
    .from("division_venues")
    .select("venue_id, allow_practices, venue:venues(id, name)")
    .eq("division_id", divisionId)
    .eq("allow_practices", true);
  if (dvErr) return { success: false, error: dvErr.message };
  type DvRow = { venue: Venue | null };
  const venues = ((dvRows ?? []) as DvRow[])
    .map((r) => r.venue)
    .filter((v): v is Venue => !!v)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (venues.length === 0) {
    return {
      success: false,
      error:
        "Assign at least one practice-eligible venue to this division before auto-assigning.",
    };
  }

  // 3. Teams in this division
  const { data: teamRows, error: teamErr } = await supabase
    .from("teams")
    .select(
      "id, name, practices_per_week, preferred_days, preferred_time_id, preferred_field_id",
    )
    .eq("division_id", divisionId)
    .order("name");
  if (teamErr) return { success: false, error: teamErr.message };
  const allTeams = (teamRows ?? []) as Team[];

  // 3b. Availability blocks for this division's teams — hard constraints
  //     that override every preference downstream.
  const allTeamIds = allTeams.map((t) => t.id);
  const { data: blockRows, error: blockErr } = allTeamIds.length
    ? await supabase
        .from("team_availability_blocks")
        .select("team_id, day_of_week, start_time, end_time")
        .in("team_id", allTeamIds)
    : { data: [], error: null };
  if (blockErr) return { success: false, error: blockErr.message };
  const allBlocks = (blockRows ?? []) as AvailabilityBlock[];
  const blocksByTeam = new Map<string, AvailabilityBlock[]>();
  for (const b of allBlocks) {
    const arr = blocksByTeam.get(b.team_id) ?? [];
    arr.push(b);
    blocksByTeam.set(b.team_id, arr);
  }

  // 4. Existing recurring practice slots — pre-seed `taken` org-wide so we
  //    don't double-book a field that's shared across divisions. Any slot on
  //    a field this division can use blocks that (day, time, field) for us,
  //    no matter which division owns it.
  const eligibleFieldIds = venues.map((v) => v.id);
  const { data: existingRows } = eligibleFieldIds.length
    ? await supabase
        .from("practice_slots")
        .select("team_id, time_slot_id, field_id, practice_days, type, start_time:practice_time_slots(start_time)")
        .in("field_id", eligibleFieldIds)
        .eq("type", "recurring")
    : { data: [] };
  type ExistingSlot = {
    team_id: string;
    time_slot_id: string | null;
    field_id: string | null;
    practice_days: string[];
    type: string;
    start_time: { start_time: string } | null;
  };
  const existing = (existingRows ?? []) as unknown as ExistingSlot[];
  // Our own teams that already have a slot — skip them in candidate selection.
  const ourTeamIds = new Set(allTeams.map((t) => t.id));
  const teamsWithSlot = new Set(
    existing.filter((r) => ourTeamIds.has(r.team_id)).map((r) => r.team_id),
  );
  // Block (day, start_time, field) — clock-time, not time_slot_id, since
  // different divisions have their own time_slot rows for the same wall clock.
  const taken = new Set<string>();
  for (const r of existing) {
    if (!r.field_id || !r.start_time?.start_time) continue;
    for (const day of r.practice_days) {
      taken.add(`${day}|${r.start_time.start_time}|${r.field_id}`);
    }
  }

  // 5. Candidate teams: practices_per_week > 0 and no existing recurring slot.
  //    Sort "most constrained first" — teams with more preferences and more
  //    availability blocks get placed earlier so they don't get squeezed out
  //    by less-picky ones. preferred_days contributes its length (a team that
  //    only practices on Sat is more constrained than one that practices on
  //    M/W/F), not just 1.
  const candidates = allTeams
    .filter(
      (t) => t.practices_per_week > 0 && !teamsWithSlot.has(t.id),
    )
    .map((t) => {
      const constraints =
        (t.preferred_days?.length ?? 0) +
        (t.preferred_time_id ? 1 : 0) +
        (t.preferred_field_id ? 1 : 0) +
        (blocksByTeam.get(t.id)?.length ?? 0);
      return { team: t, constraints };
    })
    .sort((a, b) => b.constraints - a.constraints || a.team.name.localeCompare(b.team.name))
    .map((x) => x.team);

  const placements: Array<{
    team_id: string;
    time_slot_id: string;
    field_id: string;
    practice_days: string[];
  }> = [];
  const unassigned: { team_id: string; team_name: string; reason: string }[] = [];

  // Days this division covers at all — union across every time slot. Used to
  // diagnose the "team's preferred days don't intersect any slot" case.
  const coveredDays = new Set<string>();
  for (const s of timeSlots) {
    for (const d of s.days_of_week) coveredDays.add(d);
  }

  for (const team of candidates) {
    const orderedTimes = reorderByPreference(timeSlots, team.preferred_time_id);
    const orderedFields = reorderByPreference(venues, team.preferred_field_id);

    // Day priority: try preferred days first, then any other day. The
    // fallback matters when preferred days produce SOME but not enough
    // valid slots — e.g. a team that needs 2 practices/week with
    // preferred=[Mo, Su] and only Sa/Su slots should land on Su (preferred)
    // and Sa (fallback) rather than failing. The "preferred set but
    // zero-overlap with any slot" case below still short-circuits to
    // unassigned so a config mistake (e.g. Sat-only team in a weekday-only
    // division) doesn't get silently placed on a weekday.
    const preferred = team.preferred_days ?? [];
    const dayPriority =
      preferred.length > 0
        ? [
            ...preferred,
            ...DEFAULT_DAY_ORDER.filter((d) => !preferred.includes(d)),
          ]
        : [...DEFAULT_DAY_ORDER];

    // Short-circuit: preferred days set but none of them appear in any slot's
    // days_of_week → infeasible. Report a clear reason instead of letting the
    // loop fail with a generic message.
    if (preferred.length > 0) {
      const anyOverlap = preferred.some((d) => coveredDays.has(d));
      if (!anyOverlap) {
        unassigned.push({
          team_id: team.id,
          team_name: team.name,
          reason: `No valid time slots for this team's preferred days (${preferred.join(", ")}). Division slots only cover: ${[...coveredDays].join(", ") || "no days"}.`,
        });
        continue;
      }
    }

    // Availability-block feasibility short-circuit. We only check the
    // team's PREFERRED days (or every day when no preferences are set) —
    // the fallback days in dayPriority are filler for hitting the weekly
    // count, not destinations the admin asked for. If a team's preferred
    // days are all blocked, silently relocating them to a fallback day
    // would mask the conflict, so we surface "Blocked" instead.
    const teamBlocks = blocksByTeam.get(team.id) ?? [];
    const considerDays =
      preferred.length > 0
        ? new Set(preferred)
        : new Set(DEFAULT_DAY_ORDER);
    let hasAnyFeasibleSlot = false;
    for (const slot of timeSlots) {
      if (hasAnyFeasibleSlot) break;
      for (const day of slot.days_of_week) {
        if (!considerDays.has(day)) continue;
        if (!isBlocked(teamBlocks, day, slot.start_time)) {
          hasAnyFeasibleSlot = true;
          break;
        }
      }
    }
    if (!hasAnyFeasibleSlot) {
      unassigned.push({
        team_id: team.id,
        team_name: team.name,
        reason: "Blocked by team availability constraints.",
      });
      continue;
    }

    let placed = false;
    outer: for (const slot of orderedTimes) {
      const slotDays = new Set(slot.days_of_week);
      for (const field of orderedFields) {
        const chosen = chooseDays(
          team.practices_per_week,
          dayPriority,
          slotDays,
          slot.start_time,
          field.id,
          taken,
          teamBlocks,
        );
        if (chosen) {
          chosen.forEach((d) => taken.add(`${d}|${slot.start_time}|${field.id}`));
          placements.push({
            team_id: team.id,
            time_slot_id: slot.id,
            field_id: field.id,
            practice_days: chosen,
          });
          placed = true;
          break outer;
        }
      }
    }
    if (!placed) {
      unassigned.push({
        team_id: team.id,
        team_name: team.name,
        reason: "Couldn't find enough free (day, time, field) combinations.",
      });
    }
  }

  // 6. Bulk insert
  if (placements.length > 0) {
    const { error: insertErr } = await supabase.from("practice_slots").insert(
      placements.map((p) => ({
        team_id: p.team_id,
        time_slot_id: p.time_slot_id,
        field_id: p.field_id,
        practice_days: p.practice_days,
        type: "recurring",
        placement_source: "auto",
      })) as never[],
    );
    if (insertErr) return { success: false, error: insertErr.message };
  }

  return { success: true, placed: placements.length, unassigned };
}
