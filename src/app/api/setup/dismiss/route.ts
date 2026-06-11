// Marks first-run setup as dismissed for the calling user, ending the
// (dashboard) layout's auto-redirect to /setup. The flag lives on the
// caller's own profiles row (org == owner's profile), so the existing
// "Users can update own profile" RLS policy (0001) scopes the write.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { error } = await supabase
    .from("profiles")
    .update({ setup_dismissed: true })
    .eq("id", user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
