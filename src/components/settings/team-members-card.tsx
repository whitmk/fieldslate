// Server wrapper that fetches the active members + pending invitations for
// the current org and hands them off to the interactive client child. Owner
// vs. admin gates which actions the client renders.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/orgs/context";
import { TeamMembersClient, type TeamMember, type PendingInvite } from "./team-members-client";
import { getOrgPlan } from "@/lib/plan/get-org-plan";

export async function TeamMembersCard({ userId }: { userId: string }) {
  const supabase = createClient();
  const orgId = await getCurrentOrgId(supabase, userId);

  const [
    { data: members },
    { data: invitations },
    plan,
  ] = await Promise.all([
    supabase
      .from("organization_members")
      .select("user_id, role, added_at")
      .eq("org_id", orgId),
    supabase
      .from("organization_invitations")
      .select("id, email, status, created_at, expires_at")
      .eq("org_id", orgId)
      .eq("status", "pending")
      .order("created_at", { ascending: true }),
    getOrgPlan(supabase, orgId),
  ]);

  const userIds = (members ?? []).map((m) => m.user_id);
  const { data: profiles } = userIds.length
    ? await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", userIds)
    : { data: [] as { id: string; full_name: string | null; email: string }[] };

  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));

  const memberRows: TeamMember[] = (members ?? []).map((m) => {
    const p = byId.get(m.user_id);
    return {
      user_id: m.user_id,
      role: (m.role === "owner" ? "owner" : "admin") as TeamMember["role"],
      added_at: m.added_at,
      full_name: p?.full_name ?? null,
      email: p?.email ?? "",
    };
  });
  memberRows.sort((a, b) => {
    if (a.role !== b.role) return a.role === "owner" ? -1 : 1;
    return a.added_at.localeCompare(b.added_at);
  });

  const pendingRows: PendingInvite[] = (invitations ?? []).map((inv) => ({
    id: inv.id,
    email: inv.email,
    created_at: inv.created_at,
    expires_at: inv.expires_at,
  }));

  const callerIsOwner =
    memberRows.find((m) => m.user_id === userId)?.role === "owner";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Team</CardTitle>
        <p className="text-sm text-gray-500">
          People with admin access to this organization.
        </p>
      </CardHeader>
      <CardContent>
        <TeamMembersClient
          members={memberRows}
          pendingInvites={pendingRows}
          callerUserId={userId}
          callerIsOwner={callerIsOwner}
          plan={plan}
        />
      </CardContent>
    </Card>
  );
}
