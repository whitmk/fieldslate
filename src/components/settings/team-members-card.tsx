import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/orgs/context";

type MemberRow = {
  user_id: string;
  role: "owner" | "admin";
  added_at: string;
  full_name: string | null;
  email: string;
};

function initials(name: string | null, email: string): string {
  const source = (name && name.trim()) || email;
  const parts = source.split(/[\s@]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

export async function TeamMembersCard({ userId }: { userId: string }) {
  const supabase = createClient();
  const orgId = await getCurrentOrgId(supabase, userId);

  const { data: members } = await supabase
    .from("organization_members")
    .select("user_id, role, added_at")
    .eq("org_id", orgId);

  const userIds = (members ?? []).map((m) => m.user_id);

  // Today, the only member is the owner themselves — so the profile lookup
  // is just for the calling user, which our RLS already allows. When Chunk B
  // adds other admins, profiles RLS will need to broaden to "anyone in your
  // org can read your profile" or we'll need an RPC.
  const { data: profiles } = userIds.length
    ? await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", userIds)
    : { data: [] as { id: string; full_name: string | null; email: string }[] };

  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));

  const rows: MemberRow[] = (members ?? []).map((m) => {
    const p = byId.get(m.user_id);
    return {
      user_id: m.user_id,
      role: (m.role === "owner" ? "owner" : "admin") as MemberRow["role"],
      added_at: m.added_at,
      full_name: p?.full_name ?? null,
      email: p?.email ?? "",
    };
  });

  rows.sort((a, b) => {
    if (a.role !== b.role) return a.role === "owner" ? -1 : 1;
    return a.added_at.localeCompare(b.added_at);
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Team</CardTitle>
        <p className="text-sm text-gray-500">
          People with admin access to this organization.
        </p>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y divide-gray-100">
          {rows.map((m) => (
            <li
              key={m.user_id}
              className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[#22C55E]/15 ring-1 ring-[#22C55E]/30">
                  <span className="text-xs font-semibold text-[#16a34a]">
                    {initials(m.full_name, m.email)}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">
                    {m.full_name?.trim() || m.email || "Unknown"}
                  </p>
                  {m.full_name && m.email ? (
                    <p className="truncate text-xs text-gray-500">{m.email}</p>
                  ) : null}
                </div>
              </div>
              <span
                className={
                  m.role === "owner"
                    ? "inline-flex flex-shrink-0 items-center rounded-full bg-[#0C1F3F] px-2.5 py-0.5 text-xs font-medium text-white"
                    : "inline-flex flex-shrink-0 items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700"
                }
              >
                {m.role === "owner" ? "Owner" : "Admin"}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-gray-500">
          Invitation flow coming soon. For now, you&rsquo;re the only admin.
        </p>
      </CardContent>
    </Card>
  );
}
