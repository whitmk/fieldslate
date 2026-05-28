// Org context helpers (server-side).
//
// In FieldSlate's v1 multi-admin model, an "org" is the user id of the
// original creator — there is no dedicated organizations table. A user can
// belong to multiple orgs (their own, plus any they were invited to as
// admin), and the currently-selected org is stored in a cookie so it
// persists across requests.
//
// Today, every user belongs to exactly one org (their own), so the
// selection is effectively trivial. The cookie/helper shape is in place
// now so Chunk B (invitations) can flip a user between orgs without a UI
// or data-fetch rewrite.

import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";

export const ORG_COOKIE_NAME = "fs_org_id";

export type OrgRole = "owner" | "admin";

export interface Membership {
  org_id: string;
  role: OrgRole;
  /** Display name for the org — owner's org_name → owner's full_name →
   *  owner's email. Resolved at fetch time so the switcher doesn't have
   *  to join again. */
  org_name: string;
  /** Is this the user's own (created-by-them) org? Useful for sorting
   *  the switcher so the user's primary org leads. */
  is_own: boolean;
}

type ServerClient = SupabaseClient<Database>;

/**
 * Returns every org the user is a member of, with a resolved display name.
 * Empty array means something is wrong (RLS misconfigured, or the user's
 * signup hook never ran). Callers should treat that as a fatal error.
 */
export async function listMemberships(
  supabase: ServerClient,
  userId: string,
): Promise<Membership[]> {
  const { data: memberships } = await supabase
    .from("organization_members")
    .select("org_id, role, added_at")
    .eq("user_id", userId)
    .order("added_at", { ascending: true });

  if (!memberships || memberships.length === 0) return [];

  const orgIds = memberships.map((m) => m.org_id);
  const { data: ownerProfiles } = await supabase
    .from("profiles")
    .select("id, org_name, full_name, email")
    .in("id", orgIds);

  const byId = new Map(
    (ownerProfiles ?? []).map((p) => [p.id, p as { id: string; org_name: string | null; full_name: string | null; email: string }]),
  );

  return memberships.map((m) => {
    const p = byId.get(m.org_id);
    const name =
      p?.org_name?.trim() ||
      p?.full_name?.trim() ||
      p?.email ||
      "Untitled organization";
    return {
      org_id: m.org_id,
      role: (m.role === "owner" ? "owner" : "admin") as OrgRole,
      org_name: name,
      is_own: m.org_id === userId,
    };
  });
}

/**
 * Resolves the org_id the caller should be acting under.
 *
 * Priority:
 *   1. Cookie value, IF the user is a member of that org.
 *   2. The user's own org (where org_id = user_id and role = 'owner').
 *   3. The first membership we can find.
 *   4. Falls back to userId — only reachable if memberships are broken,
 *      so subsequent RLS will deny and the page will fail closed.
 */
export async function getCurrentOrgId(
  supabase: ServerClient,
  userId: string,
  memberships?: Membership[],
): Promise<string> {
  const mems = memberships ?? (await listMemberships(supabase, userId));
  const cookieValue = cookies().get(ORG_COOKIE_NAME)?.value;

  if (cookieValue && mems.some((m) => m.org_id === cookieValue)) {
    return cookieValue;
  }

  const owned = mems.find((m) => m.is_own && m.role === "owner");
  if (owned) return owned.org_id;

  return mems[0]?.org_id ?? userId;
}
