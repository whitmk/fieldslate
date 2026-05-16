import { createClient } from "@/lib/supabase/server";
import { InviteForm, type PendingGame } from "@/components/interleague/invite-form";
import { InviteHeader, InviteFooter } from "@/components/interleague/invite-shell";
import { AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";

type InvitePayload = {
  invite: {
    id: string;
    token: string;
    status: string;
    personal_note: string | null;
    created_at: string;
    recipient_email: string;
  };
  sender: { full_name: string | null; email: string | null } | null;
  org: { id: string; name: string } | null;
  season: {
    id: string;
    name: string;
    season: string | null;
    start_date: string | null;
    end_date: string | null;
  } | null;
  games: PendingGame[];
};

export default async function PublicInvitePage({
  params,
}: {
  params: { token: string };
}) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc(
    // @ts-expect-error — RPC isn't in generated types
    "get_interleague_invite_by_token",
    { p_token: params.token },
  );

  if (error || !data) {
    return <InviteNotFound />;
  }

  const payload = data as InvitePayload;
  if (payload.invite.status !== "pending") {
    return <InviteNotFound />;
  }

  const senderName =
    (payload.sender?.full_name && payload.sender.full_name.trim()) ||
    payload.sender?.email ||
    "the FieldSlate admin";

  const seasonLabel = payload.season
    ? payload.season.season
      ? `${payload.season.name} · ${payload.season.season}`
      : payload.season.name
    : "this season";

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

          <InviteForm
            token={payload.invite.token}
            senderName={senderName}
            seasonLabel={seasonLabel}
            orgName={payload.org?.name ?? "your league"}
            games={payload.games}
          />
        </div>
      </main>

      <InviteFooter />
    </div>
  );
}

function InviteNotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <InviteHeader />
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-yellow-50">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
          </div>
          <h1 className="text-lg font-semibold text-[#0C1F3F]">
            Invite not found or no longer active
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            This invite link may have expired, been withdrawn, or already been
            responded to. Reach out to the league admin who sent it to you for a
            new link.
          </p>
        </div>
      </main>
      <InviteFooter />
    </div>
  );
}
