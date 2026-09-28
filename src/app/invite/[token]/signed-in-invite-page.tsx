// The SIGNED-IN branch of the public invite page (Interleague Case A).
//
// A plain async function returning JSX — not a component — so the page can
// `await` it and the whole tree stays synchronously renderable (the golden
// harness renders the page with renderToStaticMarkup, which cannot resolve an
// async component). The anonymous branch in page.tsx is untouched.
//
// Gathers, under the signed-in user's own RLS: their memberships and current
// org, whether the invite's season is visible to them (it is iff they belong
// to the SENDING org — the refusal case, live on the founder's own accounts
// today), their active seasons, and their display name. Everything else the
// form needs (divisions, teams, venues, locks) is per-season and loads in the
// browser when a season is picked.

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { AlertTriangle } from "lucide-react";
import type { Database } from "@/types/database";
import { getCurrentOrgId, listMemberships } from "@/lib/orgs/context";
import { getCurrentSeasonId, listActiveSeasons } from "@/lib/seasons/context";
import { hostLeagueName, type HostGame } from "@/lib/interleague/signed-in-accept";
import { InviteHeader, InviteFooter } from "@/components/interleague/invite-shell";
import {
  InviteIdentityBar,
  SignedInInviteForm,
  type SignedInIdentity,
  type SignedInMembership,
} from "@/components/interleague/signed-in-invite-form";

/** The payload get_interleague_invite_by_token returns (see page.tsx). */
export type InvitePayload = {
  invite: {
    id: string;
    token: string;
    status: string;
    personal_note: string | null;
    created_at: string;
    updated_at: string;
    recipient_email: string;
    /** 0090: this invite's own live-schedule token; null until accepted. */
    schedule_token?: string | null;
  };
  scheduled_game_count: number;
  /** 0090: games the recipient countered that the host hasn't resolved. */
  countered_game_count?: number;
  /** 0097: org_name is the host LEAGUE (additive key). */
  sender: { full_name: string | null; email: string | null; org_name?: string | null } | null;
  org: { id: string; name: string } | null;
  season: {
    id: string;
    name: string;
    season: string | null;
    start_date: string | null;
    end_date: string | null;
  } | null;
  games: HostGame[];
};

export async function renderSignedInInvite(params: {
  supabase: SupabaseClient<Database>;
  user: User;
  token: string;
  payload: InvitePayload;
  senderName: string;
  seasonLabel: string;
}) {
  const { supabase, user, token, payload, senderName, seasonLabel } = params;

  const memberships = await listMemberships(supabase, user.id);
  const currentOrgId = await getCurrentOrgId(supabase, user.id, memberships);
  const current = memberships.find((m) => m.org_id === currentOrgId) ?? null;

  const [{ data: profile }, { data: ownSeason }, seasons] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    // Visible under the caller's RLS iff they are a member of the SENDING org.
    payload.season
      ? supabase.from("leagues").select("id").eq("id", payload.season.id).maybeSingle()
      : Promise.resolve({ data: null }),
    listActiveSeasons(supabase, currentOrgId),
  ]);
  const defaultSeasonId = await getCurrentSeasonId(supabase, currentOrgId, seasons);

  const identity: SignedInIdentity = {
    fullName: (profile as { full_name: string | null } | null)?.full_name ?? null,
    email: user.email ?? null,
    orgName: current?.org_name ?? "your organization",
    orgId: currentOrgId,
  };
  const switcher: SignedInMembership[] = memberships.map((m) => ({
    org_id: m.org_id,
    org_name: m.org_name,
  }));

  if (ownSeason) {
    return (
      <div className="flex min-h-screen flex-col bg-gray-50">
        <InviteHeader senderName={senderName} seasonLabel={seasonLabel} />
        <main className="flex-1">
          <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
            <InviteIdentityBar token={token} identity={identity} memberships={switcher} />
            <div
              data-testid="own-invite-refusal"
              className="rounded-2xl border border-amber-200 bg-white p-8 text-center shadow-sm"
            >
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-50">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
              </div>
              <h1 className="text-lg font-semibold text-[#0C1F3F]">
                You&apos;re signed into the league that sent this invite
              </h1>
              <p className="mt-2 text-sm text-gray-500">
                {identity.orgName} is the league that sent these games, so accepting here
                would put them on its own schedule. If you also run the league that received
                the invite, switch to it above. Otherwise, respond without signing in.
              </p>
            </div>
          </div>
        </main>
        <InviteFooter plain />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <InviteHeader senderName={senderName} seasonLabel={seasonLabel} />

      <main className="flex-1">
        <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
          {payload.invite.personal_note && (
            <div className="mb-6 rounded-xl border-l-4 border-[#22C55E] bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                A note from {senderName}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-[#0C1F3F]">
                {payload.invite.personal_note}
              </p>
            </div>
          )}

          <SignedInInviteForm
            token={token}
            senderName={senderName}
            hostLeagueName={hostLeagueName(payload.sender)}
            seasonLabel={seasonLabel}
            games={payload.games}
            identity={identity}
            memberships={switcher}
            seasons={seasons.map((s) => ({ id: s.id, name: s.name, season: s.season }))}
            defaultSeasonId={defaultSeasonId}
          />
        </div>
      </main>

      <InviteFooter plain />
    </div>
  );
}
