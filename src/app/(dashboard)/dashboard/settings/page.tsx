import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Profile } from "@/types/database";

export default async function SettingsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: rawProfile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user!.id)
    .single();
  const profile = rawProfile as Profile | null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">Manage your account and preferences.</p>
      </div>

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
          <div className="flex items-center justify-between rounded-lg border border-red-100 bg-red-50 p-4">
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
