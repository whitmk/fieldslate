"use client";

// Interleague Case A — the SIGNED-IN partner's invite form. Same games, same
// times, same accept / suggest changes / decline as the anonymous form
// (invite-form.tsx, which is untouched), plus: an identity bar with the
// escape hatch, a season picker, one division picker per host division,
// a per-game team dropdown filtered by that mapping, a field picker for games
// we host, and Accept disabled until every game is mapped. Every decision
// comes from src/lib/interleague/signed-in-accept.ts; this file only renders.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Ban,
  Check,
  Loader2,
  Lock,
  MapPin,
  Send,
  Trophy,
  UserCircle2,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { fmtGameDate, fmtGameTime } from "@/lib/utils/game-time";
import { byQualifiedVenueLabel, qualifiedVenueLabel } from "@/lib/venues/venue-label";
import { fetchSeasonDivisionLocks } from "@/lib/schedule/division-lock";
import {
  acceptEnabled,
  anonymousHref,
  buildMemberPayload,
  defaultDivisionMap,
  gameBlockers,
  hostDivisions,
  identityLabel,
  isoToLocalDatetime,
  readiness,
  remainingLabel,
  summarizeChoices,
  teamsForHostGame,
  unmappedCount,
  weHost,
  type DivisionMap,
  type GameChoice,
  type HostGame,
  type OurDivision,
  type OurSeason,
  type OurTeam,
  type OurVenue,
} from "@/lib/interleague/signed-in-accept";

export type SignedInMembership = { org_id: string; org_name: string };

export type SignedInIdentity = {
  fullName: string | null;
  email: string | null;
  orgName: string;
  orgId: string;
};

const INPUT =
  "h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20 disabled:bg-gray-50 disabled:text-gray-400";
const LABEL = "text-[11px] font-medium uppercase tracking-wide text-gray-400";

/**
 * "Signed in as Jen Moreno · Westside Little League", an org switcher when
 * the person belongs to more than one org, and the escape hatch. Rendered on
 * the form AND on the own-invite refusal screen.
 */
export function InviteIdentityBar({
  token,
  identity,
  memberships,
}: {
  token: string;
  identity: SignedInIdentity;
  memberships: SignedInMembership[];
}) {
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  async function switchOrg(orgId: string) {
    if (orgId === identity.orgId) return;
    setSwitching(true);
    setSwitchError(null);
    try {
      const res = await fetch("/api/orgs/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org_id: orgId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSwitchError(data.error ?? "Couldn't switch organization.");
        setSwitching(false);
        return;
      }
      window.location.reload();
    } catch (err) {
      setSwitchError(err instanceof Error ? err.message : "Couldn't switch organization.");
      setSwitching(false);
    }
  }

  return (
    <div
      data-testid="invite-identity-bar"
      className="mb-6 flex flex-col gap-2 rounded-xl border border-[#0C1F3F]/10 bg-white px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 items-center gap-2">
        <UserCircle2 className="h-4 w-4 flex-shrink-0 text-[#22C55E]" />
        <p className="truncate text-sm text-[#0C1F3F]">
          {identityLabel(identity.fullName, identity.email, identity.orgName)}
        </p>
        {memberships.length > 1 && (
          <select
            aria-label="Switch organization"
            value={identity.orgId}
            disabled={switching}
            onChange={(e) => switchOrg(e.target.value)}
            className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-xs text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none"
          >
            {memberships.map((m) => (
              <option key={m.org_id} value={m.org_id}>
                {m.org_name}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="flex items-center gap-3 text-xs">
        {switchError && <span className="text-red-600">{switchError}</span>}
        <Link
          href={anonymousHref(token)}
          className="whitespace-nowrap font-medium text-gray-500 underline-offset-2 hover:text-[#0C1F3F] hover:underline"
        >
          Not you? Respond without signing in
        </Link>
      </div>
    </div>
  );
}

interface Props {
  token: string;
  senderName: string;
  /** The host LEAGUE (partner card name). */
  hostLeagueName: string;
  /** The HOST's season label, for the intro sentence. */
  seasonLabel: string;
  games: HostGame[];
  identity: SignedInIdentity;
  memberships: SignedInMembership[];
  seasons: OurSeason[];
  defaultSeasonId: string | null;
}

type Loaded = { divisions: OurDivision[]; teams: OurTeam[]; venues: OurVenue[] };

function seasonOptionLabel(s: OurSeason): string {
  return s.season && s.season !== s.name ? `${s.name} · ${s.season}` : s.name;
}

export function SignedInInviteForm({
  token,
  senderName,
  hostLeagueName,
  seasonLabel,
  games,
  identity,
  memberships,
  seasons,
  defaultSeasonId,
}: Props) {
  const [seasonId, setSeasonId] = useState<string | null>(
    defaultSeasonId ?? seasons[0]?.id ?? null,
  );
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [divisionMap, setDivisionMap] = useState<DivisionMap>({});
  const [choices, setChoices] = useState<Record<string, GameChoice>>(() => {
    const init: Record<string, GameChoice> = {};
    for (const g of games) {
      init[g.id] = {
        action: "accept",
        team_id: null,
        venue_id: null,
        proposed_iso: isoToLocalDatetime(g.proposed_scheduled_at ?? g.scheduled_at),
      };
    }
    return init;
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<
    | { kind: "submitted"; created: number; accepted: number; countered: number; declined: number }
    | { kind: "declined_all" }
    | null
  >(null);
  const [declineModalOpen, setDeclineModalOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [decliningAll, setDecliningAll] = useState(false);

  // ── Load our season's divisions (with locks), teams and venues ──
  const load = useCallback(async () => {
    if (!seasonId) {
      setLoaded({ divisions: [], teams: [], venues: [] });
      setDivisionMap({});
      return;
    }
    setLoading(true);
    setLoadError(null);
    const supabase = createClient();
    try {
      const [divRes, teamRes, venueRes, locks] = await Promise.all([
        supabase.from("divisions").select("id, name").eq("league_id", seasonId).order("name"),
        supabase
          .from("teams")
          .select("id, name, division_id")
          .eq("league_id", seasonId)
          .order("name"),
        supabase
          .from("venues")
          .select("id, name, location:locations(name)")
          .eq("owner_id", identity.orgId)
          .order("name"),
        // Fails LOUD on a read error — an unreadable lock must never render
        // as "unlocked" (see division-lock.ts).
        fetchSeasonDivisionLocks(supabase, seasonId),
      ]);
      if (divRes.error) throw new Error(`Couldn't read your divisions: ${divRes.error.message}`);
      if (teamRes.error) throw new Error(`Couldn't read your teams: ${teamRes.error.message}`);
      if (venueRes.error) throw new Error(`Couldn't read your venues: ${venueRes.error.message}`);
      const divisions: OurDivision[] = ((divRes.data ?? []) as { id: string; name: string }[]).map(
        (d) => ({ id: d.id, name: d.name, locked: locks.get(d.id)?.locked ?? false }),
      );
      const teams = (teamRes.data ?? []) as OurTeam[];
      const venues = ((venueRes.data ?? []) as unknown as OurVenue[])
        .slice()
        .sort(byQualifiedVenueLabel);
      setLoaded({ divisions, teams, venues });
      setDivisionMap(defaultDivisionMap(games, divisions));
      // Ids belong to the season just loaded; clear stale picks.
      setChoices((prev) => {
        const next: Record<string, GameChoice> = {};
        for (const g of games) {
          const c = prev[g.id];
          next[g.id] = { ...c, team_id: null, venue_id: null };
        }
        return next;
      });
    } catch (err) {
      setLoaded(null);
      setLoadError(err instanceof Error ? err.message : "Couldn't load your season.");
    } finally {
      setLoading(false);
    }
  }, [seasonId, identity.orgId, games]);

  useEffect(() => {
    load();
  }, [load]);

  const divisions = loaded?.divisions ?? [];
  const teams = loaded?.teams ?? [];
  const venues = loaded?.venues ?? [];
  const ready = loaded
    ? readiness({ seasonCount: seasons.length, divisions, teams })
    : null;
  const hostDivs = useMemo(() => hostDivisions(games), [games]);
  const { homeGames, awayGames } = useMemo(() => {
    const home: HostGame[] = [];
    const away: HostGame[] = [];
    for (const g of games) (g.is_away ? away : home).push(g);
    return { homeGames: home, awayGames: away };
  }, [games]);

  const remaining = loaded ? unmappedCount(games, choices, divisionMap, divisions, teams) : games.length;
  const canAccept =
    !!loaded &&
    !loadError &&
    ready === "ready" &&
    acceptEnabled(games, choices, divisionMap, divisions, teams, submitting);
  const counts = summarizeChoices(games, choices);
  const selectedSeason = seasons.find((s) => s.id === seasonId) ?? null;

  function patch(id: string, partial: Partial<GameChoice>) {
    setChoices((prev) => ({ ...prev, [id]: { ...prev[id], ...partial } }));
  }

  function mapDivision(hostDivId: string, ourDivId: string) {
    setDivisionMap((prev) => ({ ...prev, [hostDivId]: ourDivId || null }));
    // A different division means different teams; clear the picks under it.
    setChoices((prev) => {
      const next = { ...prev };
      for (const g of games) {
        if (g.division.id === hostDivId) next[g.id] = { ...next[g.id], team_id: null };
      }
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canAccept || !seasonId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/invite/${encodeURIComponent(token)}/accept-as-member`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ league_id: seasonId, games: buildMemberPayload(games, choices) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }
      setSuccess({
        kind: "submitted",
        created: Number(data.created ?? 0),
        accepted: Number(data.accepted ?? 0),
        countered: Number(data.countered ?? 0),
        declined: Number(data.declined ?? 0),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Please try again.");
      setSubmitting(false);
    }
  }

  async function handleDeclineAll() {
    setDecliningAll(true);
    setError(null);
    try {
      const res = await fetch(`/api/invite/${encodeURIComponent(token)}/decline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: declineReason.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setDecliningAll(false);
        return;
      }
      setDeclineModalOpen(false);
      setSuccess({ kind: "declined_all" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Please try again.");
      setDecliningAll(false);
    }
  }

  const identityBar = (
    <InviteIdentityBar token={token} identity={identity} memberships={memberships} />
  );

  if (games.length === 0) {
    return (
      <>
        {identityBar}
        <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm">
          <h2 className="text-base font-semibold text-[#0C1F3F]">No games proposed yet</h2>
          <p className="mt-2 text-sm text-gray-500">
            {senderName} hasn&apos;t generated the season schedule yet. They&apos;ll re-send
            the invite once games are ready.
          </p>
        </div>
      </>
    );
  }

  if (success) {
    if (success.kind === "declined_all") {
      return (
        <>
          {identityBar}
          <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gray-100">
              <Ban className="h-7 w-7 text-gray-500" />
            </div>
            <h2 className="text-xl font-semibold text-[#0C1F3F]">Thanks for letting us know.</h2>
            <p className="mt-2 text-sm text-gray-600">
              {senderName} has been notified that {identity.orgName} is declining the invite.
            </p>
          </div>
        </>
      );
    }
    return (
      <>
        {identityBar}
        <div
          data-testid="signed-in-success"
          className="rounded-2xl border border-[#22C55E]/30 bg-white p-8 text-center shadow-sm"
        >
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#22C55E]/10">
            <Check className="h-7 w-7 text-[#22C55E]" />
          </div>
          <h2 className="text-xl font-semibold text-[#0C1F3F]">
            {success.created} game{success.created === 1 ? "" : "s"} added to{" "}
            {selectedSeason ? seasonOptionLabel(selectedSeason) : "your season"}
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            They&apos;re on your schedule now, with {hostLeagueName} as the partner league.
            Your scheduler treats them as real games, and moving one goes through a
            reschedule request so both leagues agree. {senderName} has been notified.
          </p>
          {success.countered > 0 && (
            <p className="mt-2 text-xs text-amber-600">
              {success.countered} game{success.countered === 1 ? "" : "s"} you suggested a
              different time for {success.countered === 1 ? "isn't" : "aren't"} on your
              schedule yet. {senderName} will review and email you; add{" "}
              {success.countered === 1 ? "it" : "them"} once a time is agreed.
            </p>
          )}
          {success.declined > 0 && (
            <p className="mt-2 text-xs text-gray-500">
              {success.declined} game{success.declined === 1 ? "" : "s"} you declined{" "}
              {success.declined === 1 ? "was" : "were"} removed from {senderName}&apos;s schedule.
            </p>
          )}
          <Link
            href="/dashboard/schedule"
            className="mt-5 inline-flex items-center rounded-lg bg-[#22C55E] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a]"
          >
            View your schedule
          </Link>
        </div>
      </>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {identityBar}

      <p className="text-sm text-gray-500">
        {senderName} pre-scheduled the games below against {identity.orgName} for{" "}
        {seasonLabel}. Accepting puts them on your own schedule as interleague games with{" "}
        {hostLeagueName}. For each one, pick your team and either accept the proposed slot
        or suggest a different time.
      </p>

      {/* ── Season picker ── */}
      <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-1">
          <label className={LABEL} htmlFor="signed-in-season">
            Add these games to
          </label>
          {seasons.length > 0 ? (
            <select
              id="signed-in-season"
              value={seasonId ?? ""}
              onChange={(e) => setSeasonId(e.target.value || null)}
              disabled={submitting}
              className={`${INPUT} max-w-md`}
            >
              {seasons.map((s) => (
                <option key={s.id} value={s.id}>
                  {seasonOptionLabel(s)}
                </option>
              ))}
            </select>
          ) : (
            <EmptyState
              title="You don't have a season yet"
              body={`Create a season in ${identity.orgName} first, then come back to this link to add the games. You can also respond without signing in.`}
              link={{ href: "/dashboard/leagues/new", label: "Create a season" }}
              token={token}
            />
          )}
        </div>

        {loading && (
          <p className="mt-3 flex items-center gap-2 text-xs text-gray-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading your divisions and teams…
          </p>
        )}
        {loadError && (
          <div className="mt-3 flex flex-col gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
            <span>{loadError}</span>
            <button
              type="button"
              onClick={() => load()}
              className="self-start text-xs font-semibold underline underline-offset-2"
            >
              Retry
            </button>
          </div>
        )}
        {loaded && !loadError && ready === "no_divisions" && (
          <EmptyState
            title={`No divisions in ${selectedSeason ? seasonOptionLabel(selectedSeason) : "that season"} yet`}
            body="Add a division and its teams first, then come back to this link. You can also respond without signing in."
            link={{ href: "/dashboard/divisions", label: "Set up divisions" }}
            token={token}
          />
        )}
        {loaded && !loadError && ready === "no_teams" && (
          <EmptyState
            title={`No teams in ${selectedSeason ? seasonOptionLabel(selectedSeason) : "that season"} yet`}
            body="Add your teams first, then come back to this link. You can also respond without signing in."
            link={{ href: "/dashboard/teams", label: "Add teams" }}
            token={token}
          />
        )}

        {/* ── Division mapping: one picker per host division ── */}
        {loaded && !loadError && ready === "ready" && (
          <div className="mt-5 flex flex-col gap-3">
            <p className="text-xs text-gray-500">
              Which of your divisions plays each of {senderName}&apos;s? Matching names are
              pre-selected; a locked division can&apos;t take new games until it&apos;s unlocked.
            </p>
            {hostDivs.map((hd) => {
              const chosen = divisionMap[hd.id] ?? "";
              const ours = divisions.find((d) => d.id === chosen) ?? null;
              const teamCount = ours ? teams.filter((t) => t.division_id === ours.id).length : 0;
              return (
                <div key={hd.id} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                  <span className="text-sm font-medium text-[#0C1F3F] sm:w-40">{hd.name}</span>
                  <select
                    aria-label={`Your division for ${hd.name}`}
                    data-testid={`division-map-${hd.id}`}
                    value={chosen}
                    onChange={(e) => mapDivision(hd.id, e.target.value)}
                    disabled={submitting}
                    className={`${INPUT} sm:max-w-xs`}
                  >
                    <option value="">Pick a division…</option>
                    {divisions.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                        {d.locked ? " — locked" : ""}
                      </option>
                    ))}
                  </select>
                  {ours && ours.locked && (
                    <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                      <Lock className="h-3 w-3" /> locked
                    </span>
                  )}
                  {ours && !ours.locked && teamCount === 0 && (
                    <span className="text-xs text-amber-600">
                      No teams in {ours.name} yet —{" "}
                      <Link href="/dashboard/teams" className="underline underline-offset-2">
                        add teams
                      </Link>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {homeGames.length > 0 && (
        <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-[#22C55E]" />
            <h2 className="text-base font-semibold text-[#0C1F3F]">
              Games hosted by {senderName}
            </h2>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            You&apos;ll travel to play these games at {senderName}&apos;s venues.
          </p>
          <div className="mt-5 flex flex-col gap-3">
            {homeGames.map((g) => (
              <SignedInGameRow
                key={g.id}
                game={g}
                choice={choices[g.id]}
                ready={ready === "ready" && !loadError}
                teamOptions={teamsForHostGame(g, divisionMap, teams)}
                venues={venues}
                blockers={loaded ? gameBlockers(g, choices[g.id], divisionMap, divisions, teams) : []}
                disabled={submitting}
                onChange={(partial) => patch(g.id, partial)}
              />
            ))}
          </div>
        </section>
      )}

      {awayGames.length > 0 && (
        <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-[#22C55E]" />
            <h2 className="text-base font-semibold text-[#0C1F3F]">
              Games hosted by {identity.orgName}
            </h2>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            {senderName}&apos;s teams will travel to your venue. Pick the field you&apos;ll host
            at and adjust the date/time if needed.
          </p>
          <div className="mt-5 flex flex-col gap-3">
            {awayGames.map((g) => (
              <SignedInGameRow
                key={g.id}
                game={g}
                choice={choices[g.id]}
                ready={ready === "ready" && !loadError}
                teamOptions={teamsForHostGame(g, divisionMap, teams)}
                venues={venues}
                blockers={loaded ? gameBlockers(g, choices[g.id], divisionMap, divisions, teams) : []}
                disabled={submitting}
                onChange={(partial) => patch(g.id, partial)}
              />
            ))}
          </div>
        </section>
      )}

      <div className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        {counts.countered > 0 && (
          <p className="text-xs text-amber-600">
            A game you suggest a different time for isn&apos;t added to your schedule now.{" "}
            {senderName} will review your suggestion and email you; add the game yourself once a
            time is agreed.
          </p>
        )}
        {loaded && ready === "ready" && remaining > 0 && (
          <p data-testid="remaining-label" className="text-xs text-amber-600">
            {remainingLabel(remaining)}.
          </p>
        )}
        {loaded && ready === "ready" && remaining === 0 && counts.accepted + counts.countered === 0 && (
          <p className="text-xs text-amber-600">
            Every game is set to decline — use &ldquo;Decline this invite&rdquo; below instead.
          </p>
        )}
        {error && (
          <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        )}
        <button
          type="submit"
          data-testid="signed-in-accept"
          disabled={!canAccept}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#22C55E] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {submitting
            ? "Adding to your schedule…"
            : `Accept and add ${counts.accepted} game${counts.accepted === 1 ? "" : "s"} to my schedule`}
        </button>
        <p className="text-center text-[11px] text-gray-400">
          You can only submit a response once. Counter-proposed games stay tentative until{" "}
          {senderName} confirms.
        </p>
      </div>

      <div className="text-center">
        <button
          type="button"
          onClick={() => {
            setDeclineReason("");
            setDeclineModalOpen(true);
          }}
          className="text-xs font-medium text-gray-400 underline-offset-2 hover:text-red-500 hover:underline"
        >
          Decline this invite
        </button>
      </div>

      {declineModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) =>
            e.target === e.currentTarget && !decliningAll && setDeclineModalOpen(false)
          }
        >
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-50">
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                </div>
                <h2 className="text-base font-semibold text-[#0C1F3F]">Decline this invite?</h2>
              </div>
              <button
                type="button"
                onClick={() => setDeclineModalOpen(false)}
                disabled={decliningAll}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-col gap-4 px-6 py-5">
              <p className="text-sm text-gray-600">
                Are you sure you want to decline this interleague invitation? This will cancel
                all proposed games. Nothing is added to your schedule.
              </p>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-gray-600">
                  Reason for declining <span className="text-gray-400">(optional)</span>
                </label>
                <textarea
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                  placeholder="A short note to share with the league admin…"
                  rows={3}
                  className="resize-none rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-[#0C1F3F] placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
                />
              </div>
              {error && (
                <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setDeclineModalOpen(false)}
                  disabled={decliningAll}
                  className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-700 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeclineAll}
                  disabled={decliningAll}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-600 disabled:opacity-50"
                >
                  {decliningAll ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Ban className="h-3.5 w-3.5" />
                  )}
                  {decliningAll ? "Declining…" : "Decline invite"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}

function EmptyState({
  title,
  body,
  link,
  token,
}: {
  title: string;
  body: string;
  link: { href: string; label: string };
  token: string;
}) {
  return (
    <div
      data-testid="signed-in-empty-state"
      className="mt-2 rounded-xl border border-amber-200 bg-amber-50/50 p-4"
    >
      <p className="text-sm font-semibold text-[#0C1F3F]">{title}</p>
      <p className="mt-1 text-sm text-gray-600">{body}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
        <Link
          href={link.href}
          className="inline-flex items-center rounded-lg bg-[#0C1F3F] px-3 py-1.5 font-semibold text-white transition-colors hover:bg-[#0C1F3F]/90"
        >
          {link.label}
        </Link>
        <Link
          href={anonymousHref(token)}
          className="font-medium text-gray-500 underline-offset-2 hover:text-[#0C1F3F] hover:underline"
        >
          Respond without signing in
        </Link>
      </div>
    </div>
  );
}

interface RowProps {
  game: HostGame;
  choice: GameChoice;
  ready: boolean;
  teamOptions: OurTeam[];
  venues: OurVenue[];
  blockers: ReturnType<typeof gameBlockers>;
  disabled: boolean;
  onChange: (partial: Partial<GameChoice>) => void;
}

function SignedInGameRow({
  game,
  choice,
  ready,
  teamOptions,
  venues,
  blockers,
  disabled,
  onChange,
}: RowProps) {
  const isCounter = choice.action === "counter";
  const isDeclined = choice.action === "decline";
  const hosting = weHost(game);
  const counterLabel = hosting ? "Suggest different date" : "Suggest different time";
  const acceptLabel = hosting ? "Accept this date" : "Accept";
  const lockBlocker = blockers.find((b) => b.kind === "locked") ?? null;

  const containerClass = isDeclined
    ? "rounded-xl border p-4 transition-colors border-gray-200 bg-gray-100/60"
    : isCounter
      ? "rounded-xl border p-4 transition-colors border-amber-200 bg-amber-50/40"
      : "rounded-xl border p-4 transition-colors border-gray-100 bg-gray-50/60";

  return (
    <div className={containerClass} data-testid={`signed-in-game-${game.id}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p
            className={`text-sm font-semibold ${
              isDeclined ? "text-gray-400 line-through" : "text-[#0C1F3F]"
            }`}
          >
            {game.home_team.name}
            <span className="mx-1.5 text-xs font-bold uppercase tracking-wider text-gray-400">
              {hosting ? "AT" : "vs"}
            </span>
            <span className={isDeclined ? "text-gray-400" : "text-gray-600"}>your team</span>
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            {game.division.name} · {fmtGameDate(game.scheduled_at)}, {fmtGameTime(game.scheduled_at)}
            {game.venue && !hosting && <> · {qualifiedVenueLabel(game.venue)}</>}
            {hosting && <> · at your venue</>}
          </p>
        </div>
        {isDeclined && (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-600">
            <Ban className="h-3 w-3" />
            Declining
          </span>
        )}
      </div>

      {!isDeclined && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className={LABEL}>Your team</label>
            <select
              aria-label={`Your team for ${game.home_team.name}`}
              data-testid={`team-select-${game.id}`}
              value={choice.team_id ?? ""}
              onChange={(e) => onChange({ team_id: e.target.value || null })}
              disabled={disabled || !ready || teamOptions.length === 0}
              className={INPUT}
            >
              <option value="">
                {!ready
                  ? "Set up your season first"
                  : teamOptions.length === 0
                    ? "Pick a division above first"
                    : "Pick your team…"}
              </option>
              {teamOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          {hosting && (
            <div className="flex flex-col gap-1">
              <label className={LABEL}>Your field</label>
              <select
                aria-label={`Your field for ${game.home_team.name}`}
                data-testid={`venue-select-${game.id}`}
                value={choice.venue_id ?? ""}
                onChange={(e) => onChange({ venue_id: e.target.value || null })}
                disabled={disabled || !ready || venues.length === 0}
                className={INPUT}
              >
                <option value="">
                  {venues.length === 0 ? "No venues yet — add one on the Venues page" : "Pick your field…"}
                </option>
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {qualifiedVenueLabel(v)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-col gap-2">
        <div className="inline-flex w-full flex-wrap rounded-lg border border-gray-200 bg-white p-1 sm:w-auto">
          <button
            type="button"
            onClick={() => onChange({ action: "accept" })}
            disabled={disabled}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors sm:flex-none ${
              choice.action === "accept"
                ? "bg-[#22C55E] text-white"
                : "text-gray-500 hover:text-[#0C1F3F]"
            }`}
          >
            {acceptLabel}
          </button>
          <button
            type="button"
            onClick={() => onChange({ action: "counter" })}
            disabled={disabled}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors sm:flex-none ${
              isCounter ? "bg-amber-500 text-white" : "text-gray-500 hover:text-[#0C1F3F]"
            }`}
          >
            {counterLabel}
          </button>
          <button
            type="button"
            onClick={() => onChange({ action: "decline" })}
            disabled={disabled}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors sm:flex-none ${
              isDeclined ? "bg-red-500 text-white" : "text-gray-500 hover:text-red-500"
            }`}
          >
            Decline this game
          </button>
        </div>

        {isCounter && (
          <div className="flex flex-col gap-1">
            <label className={LABEL}>Your proposed {hosting ? "date and time" : "time"}</label>
            <input
              type="datetime-local"
              value={choice.proposed_iso}
              onChange={(e) => onChange({ proposed_iso: e.target.value })}
              disabled={disabled}
              className={`${INPUT} max-w-xs`}
            />
          </div>
        )}

        {lockBlocker && !isDeclined && (
          <p
            data-testid={`lock-notice-${game.id}`}
            className="inline-flex items-center gap-1.5 text-xs text-amber-600"
          >
            <Lock className="h-3 w-3 flex-shrink-0" />
            {lockBlocker.message}
          </p>
        )}
      </div>
    </div>
  );
}
