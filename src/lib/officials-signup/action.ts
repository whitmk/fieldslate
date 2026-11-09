// The two writes an official makes from their page — take a spot, drop one —
// as one server handler. The token is the credential; ids must be uuids; the
// database decides everything else (0124). A write that succeeded drains the
// outbox a little so its confirmation (and a drop's notice) goes out at once;
// the cron retries anything that fails.
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runOfficialsDrain } from "./drain-runner";
import { LINK_TOKEN, UUID } from "./page";

const NO_STORE = { "Cache-Control": "no-store" };

export async function officialAction(kind: "claim" | "drop", token: string, request: Request) {
  if (!LINK_TOKEN.test(token)) return NextResponse.json({ status: "unknown" }, { headers: NO_STORE });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const id = (k: string) => (typeof body?.[k] === "string" && UUID.test(body[k] as string) ? (body[k] as string) : null);

  const args =
    kind === "claim"
      ? id("gameId") && id("roleId") ? { p_token: token, p_game_id: id("gameId"), p_role_id: id("roleId") } : null
      : id("gameUmpireId") ? { p_token: token, p_game_umpire_id: id("gameUmpireId") } : null;
  if (!args) return NextResponse.json({ status: "not_found" }, { status: 400, headers: NO_STORE });

  const fn = kind === "claim" ? "official_claim" : "official_drop";
  const { data, error } = await createAdminClient().rpc(fn as never, args as never);
  if (error) {
    console.error(`[officials signup] ${fn} failed:`, error.message);
    return NextResponse.json({ status: "error" }, { status: 503, headers: NO_STORE });
  }
  const reply = (data ?? {}) as { status?: unknown; contact_email?: unknown };
  if (reply.status === "claimed" || reply.status === "dropped") {
    await runOfficialsDrain({ limit: 5 }).catch((e) => console.error(`[officials signup] drain after ${kind} failed:`, e));
  }
  return NextResponse.json(
    {
      status: typeof reply.status === "string" ? reply.status : "error",
      contact_email: typeof reply.contact_email === "string" ? reply.contact_email : undefined,
    },
    { headers: NO_STORE },
  );
}
