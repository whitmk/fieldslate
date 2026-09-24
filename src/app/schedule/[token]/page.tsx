import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SITE_URL } from "@/lib/site";
import {
  ScheduleHeader,
  InviteFooter,
} from "@/components/interleague/invite-shell";
import { fmtGameDate, fmtGameTime } from "@/lib/utils/game-time";
import { qualifiedVenueLabel } from "@/lib/venues/venue-label";
import {
  AlertTriangle,
  Ban,
  CalendarDays,
  Check,
  Hourglass,
  Mail,
  MapPin,
  Printer,
  Share2,
  Sparkles,
  Users,
} from "lucide-react";
import { ScheduleGameActions } from "@/components/interleague/schedule-game-actions";
import {
  cancelledGameBadge,
  cancelledSectionHeading,
  cancelledSectionNote,
  canRequestReschedule,
  confirmedGameBadge,
  confirmedRespondHref,
  counteredGameLines,
  hostLeagueLabel,
  type RecipientCancelledGame,
  type RecipientConfirmedGame,
  type RecipientCounteredGame,
  type RecipientSender,
} from "@/lib/interleague/recipient-schedule";

export const dynamic = "force-dynamic";

type Game = RecipientConfirmedGame;

// Shape of get_interleague_schedule_by_token (migrations 0090/0092). `games`
// holds CONFIRMED games (scheduled or reschedule_pending); `countered_games`
// holds games this league answered with a different time that the host has not
// resolved; `cancelled_games` holds games called off. Both extra keys are
// optional only so a payload from before their migration still renders.
type SchedulePayload = {
  sender: RecipientSender;
  org: { name: string } | null;
  season: { name: string; season: string | null } | null;
  games: Game[];
  countered_games?: RecipientCounteredGame[];
  cancelled_games?: RecipientCancelledGame[];
};

const MONTH_LABEL_OPTS: Intl.DateTimeFormatOptions = {
  month: "long",
  year: "numeric",
};

function monthKey(iso: string): string {
  // "2026-05-23T09:00:00+00:00" → "2026-05"
  return iso.substring(0, 7);
}

function monthLabel(iso: string): string {
  const [year, month] = iso.substring(0, 7).split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", MONTH_LABEL_OPTS);
}

export default async function PublicSchedulePage({
  params,
}: {
  params: { token: string };
}) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc(
    // @ts-expect-error — RPC isn't in generated types
    "get_interleague_schedule_by_token",
    { p_token: params.token },
  );

  if (error || !data) {
    return <ScheduleNotFound />;
  }

  const payload = data as SchedulePayload;
  const seasonLabel = payload.season
    ? payload.season.season
      ? `${payload.season.name} · ${payload.season.season}`
      : payload.season.name
    : "this season";
  const orgName = payload.org?.name ?? "your league";
  const hostLabel = hostLeagueLabel(payload.sender);
  const countered = payload.countered_games ?? [];
  const cancelled = payload.cancelled_games ?? [];
  const nowMs = Date.now();

  // Group games by month for readability.
  const grouped = new Map<string, Game[]>();
  for (const g of payload.games) {
    const key = monthKey(g.scheduled_at);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(g);
  }
  const monthKeys = Array.from(grouped.keys()).sort();

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <ScheduleHeader seasonLabel={seasonLabel} />

      <main className="flex-1">
        <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
          <UpsellCard />

          {countered.length > 0 && (
            <section className="mt-8">
              <div className="mb-3 flex items-center gap-2">
                <Hourglass className="h-4 w-4 text-amber-600" />
                <h2 className="text-base font-semibold text-[#0C1F3F]">
                  Waiting on {hostLabel} ({countered.length})
                </h2>
              </div>
              <p className="mb-3 text-xs text-gray-500">
                You proposed a different time for these games. They aren&rsquo;t
                confirmed until {hostLabel} responds.
              </p>
              <div className="overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-sm">
                {countered.map((game, idx) => (
                  <CounteredRow
                    key={game.id}
                    game={game}
                    orgName={orgName}
                    hostLabel={hostLabel}
                    isLast={idx === countered.length - 1}
                  />
                ))}
              </div>
            </section>
          )}

          <section className="mt-8">
            <div className="mb-3 flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-[#0C1F3F]" />
              <h2 className="text-base font-semibold text-[#0C1F3F]">
                Confirmed games ({payload.games.length})
              </h2>
            </div>

            {payload.games.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
                No confirmed games yet — check back once games are finalized.
              </div>
            ) : (
              <div className="flex flex-col gap-6">
                {monthKeys.map((key) => (
                  <div key={key}>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                      {monthLabel(`${key}-01T00:00:00`)}
                    </p>
                    <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
                      {grouped.get(key)!.map((game, idx, arr) => (
                        <GameRow
                          key={game.id}
                          game={game}
                          orgName={orgName}
                          isLast={idx === arr.length - 1}
                          scheduleToken={params.token}
                          nowMs={nowMs}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {cancelled.length > 0 && (
            <section className="mt-8">
              <div className="mb-3 flex items-center gap-2">
                <Ban className="h-4 w-4 text-gray-400" />
                <h2 className="text-base font-semibold text-[#0C1F3F]">
                  {cancelledSectionHeading(cancelled.length)}
                </h2>
              </div>
              <p className="mb-3 text-xs text-gray-500">
                {cancelledSectionNote(hostLabel)}
              </p>
              <div className="overflow-hidden rounded-2xl border border-gray-200 bg-gray-50/60 shadow-sm">
                {cancelled.map((game, idx) => (
                  <CancelledRow
                    key={game.id}
                    game={game}
                    orgName={orgName}
                    isLast={idx === cancelled.length - 1}
                  />
                ))}
              </div>
            </section>
          )}

          <p className="mt-8 text-center text-xs text-gray-400">
            This schedule was shared by {seasonLabel} using FieldSlate.
          </p>
        </div>
      </main>

      <InviteFooter />
    </div>
  );
}

/** A cancelled game.
 *
 *  THREE SIGNALS, NONE OF THEM LOAD-BEARING ALONE: the section heading, a
 *  "Cancelled" badge, and struck-through greyed text. A partner skimming on a
 *  phone must not be able to mistake this for a game that is on — that misread
 *  is the whole defect (they drive to the field). There is deliberately no
 *  action here: nothing for them to accept, counter or reschedule.
 */
function CancelledRow({
  game,
  orgName,
  isLast,
}: {
  game: RecipientCancelledGame;
  orgName: string;
  isLast: boolean;
}) {
  const ourTeam = game.home_team.name;
  const theirTeam = game.external_team_name ?? "TBD";
  const venueName = game.venue ? qualifiedVenueLabel(game.venue) : null;

  return (
    <div
      className={`flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between ${
        isLast ? "" : "border-b border-gray-200/70"
      }`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex w-20 flex-shrink-0 flex-col text-sm">
          <span className="font-semibold text-gray-400 line-through">
            {fmtGameDate(game.scheduled_at)}
          </span>
          <span className="text-xs text-gray-400 line-through">
            {fmtGameTime(game.scheduled_at)}
          </span>
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-400 line-through">
            {theirTeam}
            <span className="mx-1.5 text-xs font-bold uppercase tracking-wider text-gray-300">
              vs
            </span>
            {ourTeam}
          </p>
          <p className="mt-0.5 truncate text-xs text-gray-400">
            {game.division.name} · {orgName}
            {venueName ? ` · ${venueName}` : ""}
          </p>
        </div>
      </div>

      <div className="flex flex-shrink-0 items-center gap-3 sm:flex-col sm:items-end sm:gap-1">
        <span className="inline-flex items-center rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-600">
          {cancelledGameBadge()}
        </span>
      </div>
    </div>
  );
}

function CounteredRow({
  game,
  orgName,
  hostLabel,
  isLast,
}: {
  game: RecipientCounteredGame;
  orgName: string;
  hostLabel: string;
  isLast: boolean;
}) {
  const lines = counteredGameLines(game, hostLabel);
  const theirTeam = game.external_team_name ?? "Your team";
  return (
    <div
      className={`flex flex-col gap-1 px-5 py-4 ${isLast ? "" : "border-b border-amber-50"}`}
    >
      <p className="truncate text-sm font-semibold text-[#0C1F3F]">
        {theirTeam}
        <span className="mx-1.5 text-xs font-bold uppercase tracking-wider text-gray-400">
          vs
        </span>
        {game.home_team.name}
      </p>
      <p className="text-xs text-gray-500">
        {game.division.name} · {orgName}
      </p>
      {lines.hostProposal && (
        <p className="text-sm font-semibold text-blue-800">{lines.hostProposal}</p>
      )}
      <p className={`text-sm ${lines.hostProposal ? "text-gray-500" : "font-medium text-amber-800"}`}>
        {lines.yourProposal}
      </p>
      <p className="text-xs text-gray-400">
        {lines.original}
        {lines.round > 1 ? ` · Round ${lines.round}` : ""}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
            lines.waitingOnYou ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"
          }`}
        >
          {lines.status}
        </span>
        {lines.respondHref && (
          <a
            href={lines.respondHref}
            className="inline-flex items-center rounded-lg bg-[#22C55E] px-3 py-1 text-xs font-semibold text-white hover:bg-[#16a34a]"
          >
            Respond
          </a>
        )}
      </div>
    </div>
  );
}

function GameRow({
  game,
  orgName,
  isLast,
  scheduleToken,
  nowMs,
}: {
  game: Game;
  orgName: string;
  isLast: boolean;
  scheduleToken: string;
  nowMs: number;
}) {
  const ourTeam = game.home_team.name;
  const theirTeam = game.external_team_name ?? "TBD";
  // From the recipient's perspective:
  //   our `is_away = true` → the recipient hosts. So for them it's HOME.
  //   our `is_away = false` → we host. So for them it's AWAY.
  const recipientIsHome = game.is_away;
  const venueName = game.venue
    ? qualifiedVenueLabel(game.venue)
    : game.is_away
      ? game.proposed_venue_name ?? "Your venue"
      : "TBD";
  const badge = confirmedGameBadge(game.status);
  const respondHref = confirmedRespondHref(game);

  return (
    <div
      className={`flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between ${
        isLast ? "" : "border-b border-gray-50"
      }`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex w-20 flex-shrink-0 flex-col text-sm">
          <span className="font-semibold text-[#0C1F3F]">
            {fmtGameDate(game.scheduled_at)}
          </span>
          <span className="text-xs text-gray-400">
            {fmtGameTime(game.scheduled_at)}
          </span>
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[#0C1F3F]">
            {theirTeam}
            <span className="mx-1.5 text-xs font-bold uppercase tracking-wider text-gray-400">
              vs
            </span>
            {ourTeam}
          </p>
          <p className="mt-0.5 truncate text-xs text-gray-500">
            {game.division.name} · {orgName}
          </p>
        </div>
      </div>

      <div className="flex flex-shrink-0 items-center gap-3 sm:flex-col sm:items-end sm:gap-1">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
            recipientIsHome
              ? "bg-[#22C55E]/10 text-[#16a34a]"
              : "bg-blue-50 text-blue-600"
          }`}
        >
          {recipientIsHome ? "Home" : "Away"}
        </span>
        <span className="inline-flex items-center gap-1 text-xs text-gray-500">
          <MapPin className="h-3 w-3" />
          {venueName}
        </span>
        {badge && (
          <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700">
            {badge}
          </span>
        )}
        {respondHref && (
          <a
            href={respondHref}
            className="inline-flex items-center rounded-lg bg-[#22C55E] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#16a34a]"
          >
            Respond
          </a>
        )}
        {canRequestReschedule(game, nowMs) && (
          <ScheduleGameActions
            scheduleToken={scheduleToken}
            game={{
              id: game.id,
              scheduled_at: game.scheduled_at,
              is_away: game.is_away,
              external_team_name: game.external_team_name,
              proposed_venue_name: game.proposed_venue_name,
              home_team: game.home_team,
              division: game.division,
              venue: game.venue,
              interleague_org: { name: orgName },
            }}
          />
        )}
      </div>
    </div>
  );
}

function UpsellCard() {
  const features = [
    { icon: Printer, label: "Print your schedule as a PDF" },
    { icon: Share2, label: "Export to Sports Connect (CSV)" },
    { icon: Users, label: "Share with your coaches and parents" },
    { icon: CalendarDays, label: "Manage future interleague games easily" },
    { icon: Mail, label: "Get reminder emails before each game" },
  ];

  return (
    <section className="overflow-hidden rounded-2xl border border-[#22C55E]/30 bg-gradient-to-br from-[#22C55E]/5 to-white p-6 shadow-sm sm:p-8">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-[#22C55E]" />
        <h2 className="text-base font-semibold text-[#0C1F3F]">
          Want more from FieldSlate?
        </h2>
      </div>
      <ul className="mt-4 flex flex-col gap-2">
        {features.map(({ icon: Icon, label }) => (
          <li key={label} className="flex items-center gap-2 text-sm text-[#0C1F3F]">
            <Icon className="h-3.5 w-3.5 text-[#22C55E]" />
            {label}
          </li>
        ))}
      </ul>
      <div className="mt-5">
        <Link
          href={`${SITE_URL}/signup?promo=INTERLEAGUE&utm_source=interleague_schedule&utm_medium=upsell`}
          className="inline-flex items-center gap-2 rounded-lg bg-[#22C55E] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a]"
        >
          <Check className="h-4 w-4" />
          Sign up — 20% off your first season
        </Link>
      </div>
    </section>
  );
}

function ScheduleNotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <ScheduleHeader seasonLabel="this season" />
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-yellow-50">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
          </div>
          <h1 className="text-lg font-semibold text-[#0C1F3F]">
            Schedule not found
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            This link may have expired or been revoked. Reach out to the league
            admin who shared it for a fresh link.
          </p>
        </div>
      </main>
      <InviteFooter />
    </div>
  );
}
