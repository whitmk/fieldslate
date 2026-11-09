// The two writes a volunteer makes from their page — cancel a spot, keep a
// moved one — as one server handler. The token is the credential; the claim
// id must be a uuid; the database checks the claim is this volunteer's and,
// for a cancel, that the spot is more than 24 hours away. A cancel drains the
// outbox a little so its confirmation goes out at once.
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runVolunteerDrain } from "./drain-runner";
import { LINK_TOKEN } from "./public-server";

const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function manageAction(fn: "volunteer_cancel" | "volunteer_keep_spot", token: string, request: Request) {
  if (!LINK_TOKEN.test(token)) return NextResponse.json({ status: "unknown" }, { headers: NO_STORE });
  const body = (await request.json().catch(() => null)) as { claimId?: unknown } | null;
  const claimId = typeof body?.claimId === "string" && UUID.test(body.claimId) ? body.claimId : null;
  if (!claimId) return NextResponse.json({ status: "not_found" }, { status: 400, headers: NO_STORE });
  const { data, error } = await createAdminClient().rpc(fn as never, { p_token: token, p_claim_id: claimId } as never);
  if (error) {
    console.error(`[volunteer manage] ${fn} failed:`, error.message);
    return NextResponse.json({ status: "error" }, { status: 503, headers: NO_STORE });
  }
  const reply = (data ?? {}) as { status?: unknown; contact_email?: unknown };
  if (fn === "volunteer_cancel" && reply.status === "canceled") {
    await runVolunteerDrain({ limit: 5 }).catch((e) => console.error("[volunteer manage] drain after cancel failed:", e));
  }
  return NextResponse.json(
    { status: typeof reply.status === "string" ? reply.status : "error", contact_email: typeof reply.contact_email === "string" ? reply.contact_email : undefined },
    { headers: NO_STORE },
  );
}
