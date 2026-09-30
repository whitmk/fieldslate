"use client";

import { useEffect, useRef, useState } from "react";
import { Clock, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { ORG_TIMEZONES, findOrgTimezone } from "@/lib/calendar/timezones";

// The org's timezone (profiles.timezone, 0099). Written ONLY through the
// set_org_timezone function: the column is not granted to signed-in users
// and 0098's trigger would refuse a direct write. Game times themselves are
// wall-clock text and are NOT converted by this — it labels them in the team
// calendar feed and decides what "today" is for link expiry.

type Toast = { kind: "error" | "success"; message: string; id: number };

interface Props {
  orgId: string;
  initialTimezone: string;
}

export function OrgTimezoneCard({ orgId, initialTimezone }: Props) {
  const [timezone, setTimezone] = useState(initialTimezone);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    },
    [],
  );

  function notify(kind: Toast["kind"], message: string) {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    setToast({ kind, message, id: Date.now() });
    toastTimerRef.current = window.setTimeout(
      () => {
        setToast(null);
        toastTimerRef.current = null;
      },
      kind === "error" ? 8000 : 4000,
    );
  }

  async function handleChange(next: string) {
    if (next === timezone || !findOrgTimezone(next)) return;
    const previous = timezone;
    setTimezone(next);
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.rpc(
      // @ts-expect-error — RPC isn't in generated types (0099)
      "set_org_timezone",
      { p_org_id: orgId, p_timezone: next },
    );
    setSaving(false);
    if (error) {
      setTimezone(previous);
      notify("error", "Couldn't save the timezone. Please try again.");
      return;
    }
    notify("success", `Timezone set to ${findOrgTimezone(next)?.label ?? next}.`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Timezone</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex max-w-md flex-col gap-3">
          <label htmlFor="org-timezone" className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-gray-400">
            <Clock className="h-4 w-4 text-gray-400" />
            Where your league plays
          </label>
          <div className="flex items-center gap-3">
            <select
              id="org-timezone"
              value={timezone}
              disabled={saving}
              onChange={(e) => handleChange(e.target.value)}
              className="h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20 disabled:opacity-60"
            >
              {ORG_TIMEZONES.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.label} ({z.id})
                </option>
              ))}
            </select>
            {saving && <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-gray-400" />}
          </div>
          <p className="text-xs text-gray-500">
            Used to label game times in team calendar feeds and to decide when a
            season&apos;s calendar links expire. Game times you enter are never
            converted.
          </p>
          {toast && (
            <p
              key={toast.id}
              className={`flex items-center gap-2 text-xs font-medium ${
                toast.kind === "error" ? "text-red-600" : "text-[#16a34a]"
              }`}
            >
              {toast.kind === "error" ? (
                <AlertTriangle className="h-3.5 w-3.5" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              {toast.message}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
