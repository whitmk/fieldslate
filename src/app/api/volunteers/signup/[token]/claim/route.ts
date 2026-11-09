import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runVolunteerDrain } from "@/lib/volunteers/drain-runner";
import {
  LINK_TOKEN,
  clientIp,
  hashKey,
  parseClaimBody,
  publicConfig,
  verifyTurnstile,
} from "@/lib/volunteers/public-server";

// Take a volunteer spot (0121, volunteer_claim; a snack shack shift since 0122). Order: config (fail closed)
// → link shape → body shape → Turnstile → hashes → the database, which
// decides everything else and rate-limits. The reply is the database's
// status (and the position on success) — nothing else. After a claim the
// outbox is drained a little so the confirmation doesn't wait for the cron;
// a failed send there is retried by the cron.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request, { params }: { params: { token: string } }) {
  const config = publicConfig(process.env);
  if (!config) {
    console.error("[volunteer signup] TURNSTILE_SECRET_KEY or VOLUNTEER_HASH_SALT is not configured");
    return NextResponse.json({ status: "unavailable" }, { status: 503, headers: NO_STORE });
  }
  if (!LINK_TOKEN.test(params.token)) {
    return NextResponse.json({ status: "unknown" }, { headers: NO_STORE });
  }
  const body = parseClaimBody(await request.json().catch(() => null));
  if (!body) {
    return NextResponse.json({ status: "invalid_input" }, { status: 400, headers: NO_STORE });
  }
  const ip = clientIp(request.headers);
  if (!(await verifyTurnstile(config.turnstileSecret, body.turnstileToken, ip, fetch))) {
    return NextResponse.json({ status: "captcha" }, { headers: NO_STORE });
  }

  const { data, error } = await createAdminClient().rpc(
    "volunteer_claim" as never,
    {
      p_token: params.token,
      p_game_id: body.gameId,
      p_role_id: body.roleId,
      p_for_team_id: body.forTeamId,
      p_division_id: body.divisionId,
      p_team_id: body.teamId,
      p_first_initial: body.firstInitial,
      p_last_name: body.lastName,
      p_email: body.email,
      p_adult: body.adult,
      p_ip_hash: hashKey(config.hashSalt, `ip:${ip}`),
      p_email_hash: hashKey(config.hashSalt, `email:${body.email.trim().toLowerCase()}`),
      p_confirm_overlap: body.confirmOverlap,
      // 0122: sent only for a shift, so a game claim is exactly 0121's call.
      ...(body.blockId ? { p_block_id: body.blockId } : {}),
    } as never,
  );
  if (error) {
    console.error("[volunteer signup] claim failed:", error.message);
    return NextResponse.json({ status: "error" }, { status: 503, headers: NO_STORE });
  }
  const reply = (data ?? {}) as { status?: unknown; position?: unknown };
  if (reply.status === "claimed") {
    await runVolunteerDrain({ limit: 5 }).catch((e) => console.error("[volunteer signup] drain after claim failed:", e));
  }
  return NextResponse.json(
    { status: typeof reply.status === "string" ? reply.status : "error", position: typeof reply.position === "number" ? reply.position : undefined },
    { headers: NO_STORE },
  );
}
