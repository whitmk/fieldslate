import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { TOKEN_SHAPE } from "@/lib/contact-verify/rules";

// The confirm page's data (0126). GET only READS the link
// (contact_verify_peek) — a mail scanner that opens links can never confirm
// an address. POST confirms it (contact_verify_confirm: single use). The token
// is the credential; only its sha256 is stored. No caching; a read error →
// 503, never "this link isn't working".
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };

async function call(fn: "contact_verify_peek" | "contact_verify_confirm", token: string) {
  if (!TOKEN_SHAPE.test(token)) return NextResponse.json({ status: "unknown" }, { headers: NO_STORE });
  const { data, error } = await createAdminClient().rpc(fn as never, { p_token: token } as never);
  if (error) {
    console.error(`[contact verify] ${fn} failed:`, error.message);
    return NextResponse.json({ status: "error" }, { status: 503, headers: { ...NO_STORE, "Retry-After": "60" } });
  }
  return NextResponse.json(data, { headers: NO_STORE });
}

export async function GET(_request: Request, { params }: { params: { token: string } }) {
  return call("contact_verify_peek", params.token);
}

export async function POST(_request: Request, { params }: { params: { token: string } }) {
  return call("contact_verify_confirm", params.token);
}
