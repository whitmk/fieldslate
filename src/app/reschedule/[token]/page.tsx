import { createClient } from "@/lib/supabase/server";
import {
  RescheduleForm,
  RescheduleNotFound,
  type RescheduleRequestPayload,
} from "@/components/interleague/reschedule-form";
import { InviteHeader, InviteFooter } from "@/components/interleague/invite-shell";

export const dynamic = "force-dynamic";

export default async function PublicReschedulePage({
  params,
}: {
  params: { token: string };
}) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc(
    // @ts-expect-error — RPC isn't in generated types
    "get_reschedule_request_by_token",
    { p_token: params.token },
  );

  if (error || !data) {
    return (
      <Shell>
        <RescheduleNotFound />
      </Shell>
    );
  }

  const payload = data as RescheduleRequestPayload;
  if (payload.request.status !== "pending") {
    return (
      <Shell>
        <RescheduleNotFound message="This reschedule request has already been resolved." />
      </Shell>
    );
  }

  const senderName =
    payload.sender?.full_name?.trim() ||
    payload.sender?.email ||
    "The FieldSlate admin";
  const seasonLabel = payload.season.season
    ? `${payload.season.name} · ${payload.season.season}`
    : payload.season.name;

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <InviteHeader senderName={senderName} seasonLabel={seasonLabel} />
      <main className="flex-1">
        <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
          <p className="mb-4 text-sm text-gray-500">
            {senderName} is asking to move this interleague game. Review the
            change and either accept, propose a different time, or decline.
          </p>
          <RescheduleForm token={params.token} payload={payload} />
        </div>
      </main>
      <InviteFooter />
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <InviteHeader />
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">{children}</div>
      </main>
      <InviteFooter />
    </div>
  );
}
