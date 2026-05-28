import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AlertTriangle, Building2, Mail } from "lucide-react";
import { OrgInviteAcceptForm } from "@/components/orgs/org-invite-accept-form";

export const dynamic = "force-dynamic";

type InvitationPayload = {
  id: string;
  org_id: string;
  email: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  expires_at: string;
  org_name: string;
  inviter_name: string;
};

function MessageShell({
  title,
  description,
  tone = "neutral",
  cta,
}: {
  title: string;
  description: string;
  tone?: "neutral" | "warn";
  cta?: { href: string; label: string };
}) {
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex h-14 max-w-3xl items-center px-4 sm:px-6">
          <Link href="/" className="text-sm font-semibold text-[#0C1F3F]">
            FieldSlate
          </Link>
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <div
            className={
              tone === "warn"
                ? "mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-amber-100"
                : "mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-gray-100"
            }
          >
            <AlertTriangle
              className={
                tone === "warn"
                  ? "h-5 w-5 text-amber-600"
                  : "h-5 w-5 text-gray-500"
              }
            />
          </div>
          <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
          <p className="mt-2 text-sm text-gray-600">{description}</p>
          {cta ? (
            <Link
              href={cta.href}
              className="mt-6 inline-flex items-center justify-center rounded-lg bg-[#22C55E] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a]"
            >
              {cta.label}
            </Link>
          ) : null}
        </div>
      </main>
    </div>
  );
}

export default async function OrgInvitePage({
  params,
}: {
  params: { token: string };
}) {
  const supabase = createClient();

  // SECURITY DEFINER RPC — readable by anon. Returns null on missing tokens.
  const { data: payload } = await supabase.rpc(
    "get_org_invitation_by_token" as never,
    { p_token: params.token } as never,
  );

  if (!payload) {
    return (
      <MessageShell
        title="Invitation not found"
        description="We couldn't find that invitation. The link may have been mistyped or the invitation may no longer exist."
        cta={{ href: "/login", label: "Go to FieldSlate" }}
      />
    );
  }

  const invite = payload as unknown as InvitationPayload;

  if (invite.status === "accepted") {
    return (
      <MessageShell
        title="Invitation already accepted"
        description={`You're already a member of ${invite.org_name}. Sign in to switch into it.`}
        cta={{ href: "/login", label: "Sign in" }}
      />
    );
  }
  if (invite.status === "revoked") {
    return (
      <MessageShell
        title="Invitation revoked"
        description="This invitation was revoked by the owner. Ask them to send a new one if this was unexpected."
        tone="warn"
      />
    );
  }
  if (invite.status === "expired") {
    return (
      <MessageShell
        title="Invitation expired"
        description="This invitation has expired. Ask the inviter to send a new one."
        tone="warn"
      />
    );
  }

  // Pending — check who's logged in.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const callerEmail = user?.email?.toLowerCase() ?? null;
  const targetEmail = invite.email.toLowerCase();
  const emailMatches = callerEmail !== null && callerEmail === targetEmail;

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex h-14 max-w-3xl items-center px-4 sm:px-6">
          <Link href="/" className="text-sm font-semibold text-[#0C1F3F]">
            FieldSlate
          </Link>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
          <div className="flex items-center gap-3 border-b border-gray-100 pb-5">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[#22C55E]/15 ring-1 ring-[#22C55E]/30">
              <Building2 className="h-5 w-5 text-[#16a34a]" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs uppercase tracking-wide text-gray-500">
                Admin invitation
              </p>
              <p className="truncate text-base font-semibold text-gray-900">
                {invite.org_name}
              </p>
            </div>
          </div>

          <p className="mt-5 text-sm text-gray-700">
            <span className="font-medium text-gray-900">
              {invite.inviter_name}
            </span>{" "}
            invited you to help manage{" "}
            <span className="font-medium text-gray-900">{invite.org_name}</span>{" "}
            on FieldSlate as an admin.
          </p>

          <div className="mt-4 flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
            <Mail className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
            <span className="truncate">Sent to {invite.email}</span>
          </div>

          {!user ? (
            <div className="mt-6">
              <p className="text-sm text-gray-600">
                Sign in or create a FieldSlate account to accept. Either way,
                use the email <strong>{invite.email}</strong> so the invitation
                matches.
              </p>
              <div className="mt-4 flex flex-col gap-2">
                <Link
                  href={{
                    pathname: "/login",
                    query: {
                      next: `/org-invite/${params.token}`,
                      email: invite.email,
                    },
                  }}
                  className="inline-flex items-center justify-center rounded-lg bg-[#22C55E] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a]"
                >
                  Sign in to accept
                </Link>
                <Link
                  href={{
                    pathname: "/signup",
                    query: {
                      next: `/org-invite/${params.token}`,
                      email: invite.email,
                    },
                  }}
                  className="inline-flex items-center justify-center rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                >
                  Create an account
                </Link>
              </div>
            </div>
          ) : !emailMatches ? (
            <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <p className="font-semibold">Email doesn&rsquo;t match</p>
              <p className="mt-1">
                You&rsquo;re signed in as <strong>{user.email}</strong>, but this
                invitation was sent to <strong>{invite.email}</strong>. Sign out
                and sign back in with the invited address to accept.
              </p>
              <Link
                href="/api/auth/signout"
                className="mt-3 inline-flex items-center justify-center rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100"
              >
                Sign out
              </Link>
            </div>
          ) : (
            <OrgInviteAcceptForm token={params.token} />
          )}
        </div>
      </main>
    </div>
  );
}
