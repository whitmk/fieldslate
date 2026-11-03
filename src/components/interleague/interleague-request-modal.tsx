"use client";

// The ONE modal for a host-side interleague reschedule or makeup REQUEST
// (POST /api/interleague/games/[id]/reschedule). Every surface that sends one
// renders this — useScheduleReschedule and the division schedule panel — and
// none of them decides how the time is chosen. This does, by the picker's own
// rule (resolveEditMode, keyed on venue_id — never is_away):
//
//   * a field of ours → the interleague picker (ResolveEditModal, purpose
//     "request"): real open times at that field, makeup days kept only for a
//     rained-out game, "Enter a time manually" as the secondary fallback;
//   * no field of ours (the partner hosts) → today's free-typed
//     RescheduleRequestModal, unchanged. We have neither the partner's hours
//     nor their bookings, so there are no times we could call available.
//
// The submit stays with the caller (each passes submitInterleagueRescheduleRequest),
// and the route's lock / hours / occupancy gates stay authoritative: the
// picker only stops offering times they would refuse.
//
// Not the rainout picker: RainoutRescheduleModal refuses every interleague
// game (picker-guard.ts) and must keep doing so — it MOVES a game, and an
// interleague game's time changes only by the partner's agreement.

import { RescheduleRequestModal } from "@/components/interleague/reschedule-request-modal";
import { ResolveEditModal } from "@/components/interleague/resolve-edit-modal";
import { resolveEditMode } from "@/lib/schedule/interleague-resolve-picker";
import { requestModalLabels } from "@/lib/schedule/panel-reschedule-route";

export type InterleagueRequestGame = {
  id: string;
  status: string;
  scheduled_at: string;
  league_id: string;
  home_team_id: string;
  venue_id: string | null;
  is_away: boolean;
  external_team_name: string | null;
  proposed_venue_name: string | null;
  home_team: { name: string; division: { id: string; name: string } | null } | null;
  venue: { name: string } | null;
  interleague_org: { name: string } | null;
};

export type InterleagueRequestPayload = {
  scheduled_at: string; // wall-clock ISO
  venue_name?: string;
  note?: string;
};

export function InterleagueRequestModal({
  game,
  intro,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  game: InterleagueRequestGame;
  intro: string;
  busy: boolean;
  error: string | null;
  onSubmit: (payload: InterleagueRequestPayload) => void;
  onClose: () => void;
}) {
  if (resolveEditMode(game) === "picker") {
    return (
      <ResolveEditModal
        purpose="request"
        intro={intro}
        game={{
          id: game.id,
          status: game.status,
          league_id: game.league_id,
          home_team_id: game.home_team_id,
          venue_id: game.venue_id,
          scheduled_at: game.scheduled_at,
          // A request is on an accepted or rained-out game, which carries no
          // partner proposal to seed from or tag.
          proposed_scheduled_at: null,
          proposed_venue_name: game.proposed_venue_name,
          external_team_name: game.external_team_name,
          is_away: game.is_away,
          home_team: game.home_team,
          venue: game.venue,
          interleague_org: game.interleague_org,
        }}
        busy={busy}
        error={error}
        onSave={onSubmit}
        onClose={onClose}
      />
    );
  }
  return (
    <RescheduleRequestModal
      {...requestModalLabels(game.status)}
      intro={intro}
      game={{
        scheduled_at: game.scheduled_at,
        is_away: game.is_away,
        external_team_name: game.external_team_name,
        proposed_venue_name: game.proposed_venue_name,
        home_team: game.home_team ? { name: game.home_team.name } : null,
        venue: game.venue,
        interleague_org: game.interleague_org,
      }}
      busy={busy}
      error={error}
      onSubmit={onSubmit}
      onClose={onClose}
    />
  );
}
