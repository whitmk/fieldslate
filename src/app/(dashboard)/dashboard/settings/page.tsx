import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OrgNameCard } from "@/components/settings/org-name-card";
import { TeamMembersCard } from "@/components/settings/team-members-card";
import { OrgTimezoneCard } from "@/components/settings/org-timezone-card";
import { PublicScheduleCard, type PublicScheduleCardData } from "@/components/settings/public-schedule-card";
import { getOrgPlan } from "@/lib/plan/get-org-plan";
import { DEFAULT_ORG_TIMEZONE } from "@/lib/calendar/timezones";
import type { Profile } from "@/types/database";
import { getCurrentOrgId } from "@/lib/orgs/context";

export default async function SettingsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const currentOrgId = await getCurrentOrgId(supabase, user!.id);

  const [{ data: rawProfile }, { data: firstLeague }, { data: orgRow }] = await Promise.all([
    // Reading the caller's OWN profile row stays scoped to user.id — that's
    // their personal profile (name, email), not org-scoped data.
    supabase.from("profiles").select("*").eq("id", user!.id).single(),
    supabase
      .from("leagues")
      .select("name")
      .eq("owner_id", currentOrgId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    // The timezone is ORG-scoped: it lives on the org owner's row, which an
    // invited admin can read (org-mate SELECT policy) but not write — the
    // card saves through set_org_timezone.
    supabase.from("profiles").select("timezone, org_name").eq("id", currentOrgId).maybeSingle(),
  ]);
  const plan = await getOrgPlan(currentOrgId);
  const publicSchedule = await loadPublicScheduleCard(supabase, currentOrgId);
  const profile = rawProfile as Profile | null;
  const orgTimezone =
    (orgRow as { timezone: string } | null)?.timezone ?? DEFAULT_ORG_TIMEZONE;
  const orgName = (orgRow as { org_name: string | null } | null)?.org_name ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">Manage your account and preferences.</p>
      </div>

      <OrgNameCard
        userId={user!.id}
        initialOrgName={profile?.org_name ?? null}
        fallbackName={firstLeague?.name ?? null}
      />

      <TeamMembersCard userId={user!.id} />

      <OrgTimezoneCard orgId={currentOrgId} initialTimezone={orgTimezone} />

      <PublicScheduleCard orgId={currentOrgId} orgName={orgName} plan={plan} data={publicSchedule} />

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4 max-w-md">
            <Input
              id="fullName"
              label="Full name"
              type="text"
              defaultValue={profile?.full_name ?? ""}
              placeholder="Your name"
            />
            <Input
              id="email"
              label="Email"
              type="email"
              defaultValue={user?.email ?? ""}
              disabled
            />
            <div className="pt-2">
              <Button type="submit" size="sm">Save changes</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Danger Zone</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 rounded-lg border border-red-100 bg-red-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">Delete account</p>
              <p className="text-xs text-gray-500">Permanently remove your account and all data.</p>
            </div>
            <Button variant="destructive" size="sm">Delete account</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// The Public schedule card's data (0105). Every read is checked: one failure
// renders "couldn't load" on the card, never a half-filled card that would
// show, say, every park as not-home.
async function loadPublicScheduleCard(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
): Promise<PublicScheduleCardData> {
  const [link, parks, loneFields, seasons] = await Promise.all([
    supabase
      .from("public_schedule_links" as never)
      .select("token, enabled")
      .eq("org_id", orgId)
      .maybeSingle(),
    supabase
      .from("locations")
      .select("id, name, is_home_park, venues(count)")
      .eq("owner_id", orgId)
      .order("name"),
    supabase
      .from("venues")
      .select("id, name")
      .eq("owner_id", orgId)
      .is("location_id", null)
      .order("name"),
    supabase
      .from("leagues")
      .select("id, name, start_date, divisions(id, name, locked)")
      .eq("owner_id", orgId)
      .is("archived_at", null)
      .order("start_date", { ascending: true, nullsFirst: false }),
  ]);
  if (link.error || parks.error || loneFields.error || seasons.error) {
    console.error("[settings] public schedule card read failed:",
      link.error?.message ?? parks.error?.message ?? loneFields.error?.message ?? seasons.error?.message);
    return { ok: false };
  }
  const linkRow = link.data as { token: string; enabled: boolean } | null;
  return {
    ok: true,
    link: linkRow ? { token: linkRow.token, enabled: linkRow.enabled } : null,
    parks: (parks.data as unknown as { id: string; name: string; is_home_park: boolean; venues: { count: number }[] }[]).map((p) => ({
      id: p.id,
      name: p.name,
      isHome: p.is_home_park,
      fieldCount: p.venues?.[0]?.count ?? 0,
    })),
    loneFields: (loneFields.data ?? []) as { id: string; name: string }[],
    seasons: (seasons.data as unknown as { id: string; name: string; divisions: { id: string; name: string; locked: boolean }[] }[]).map((s) => ({
      id: s.id,
      name: s.name,
      divisions: [...(s.divisions ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    })),
  };
}
