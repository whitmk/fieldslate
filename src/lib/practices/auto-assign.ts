"use client";

import { createClient } from "@/lib/supabase/client";

export type AutoAssignResult =
  | {
      success: true;
      placed: number;
      unassigned: { team_id: string; team_name: string; reason: string }[];
    }
  | { success: false; error: string };

type TimeSlot = { id: string; label: string; start_time: string };
type Venue = { id: string; name: string };
type Team = {
  id: string;
  name: string;
  practices_per_week: number;
  preferred_days: string[] | null;
  preferred_time_id: string | null;
  preferred_field_id: string | null;
};

const DEFAULT_DAY_ORDER = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/**
 * Pick `count` days from `priorityDays` (preferred first, then fallbacks),
 * skipping any (day, start_time, field) combination already in `taken`.
 * Returns null if it can't find `count` free days.
 */
function chooseDays(
  count: number,
  priorityDays: string[],
  startTime: string,
  fieldId: string,
  taken: Set<string>,
): string[] | null {
  const chosen: string[] = [];
  for (const day of priorityDays) {
    if (chosen.includes(day)) continue;
    const key = `${day}|${startTime}|${fieldId}`;
    if (!taken.has(key)) chosen.push(day);
    if (chosen.length >= count) break;
  }
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
    .select("id, label, start_time")
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
  //    Sort "most constrained first" — teams with more preferences set get
  //    placed earlier so they don't get squeezed out by less-picky ones.
  const candidates = allTeams
    .filter(
      (t) => t.practices_per_week > 0 && !teamsWithSlot.has(t.id),
    )
    .map((t) => {
      const constraints =
        (t.preferred_days?.length ? 1 : 0) +
        (t.preferred_time_id ? 1 : 0) +
        (t.preferred_field_id ? 1 : 0);
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

  for (const team of candidates) {
    const orderedTimes = reorderByPreference(timeSlots, team.preferred_time_id);
    const orderedFields = reorderByPreference(venues, team.preferred_field_id);

    // Day priority: preferred days first, then the rest, then never-preferred ones.
    const preferred = team.preferred_days ?? [];
    const dayPriority = [
      ...preferred,
      ...DEFAULT_DAY_ORDER.filter((d) => !preferred.includes(d)),
    ];

    let placed = false;
    outer: for (const slot of orderedTimes) {
      for (const field of orderedFields) {
        const chosen = chooseDays(
          team.practices_per_week,
          dayPriority,
          slot.start_time,
          field.id,
          taken,
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
      })) as never[],
    );
    if (insertErr) return { success: false, error: insertErr.message };
  }

  return { success: true, placed: placements.length, unassigned };
}
