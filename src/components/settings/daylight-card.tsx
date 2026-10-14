"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Sunset } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { STATES_SORTED, STATE_NAMES, cityByIdOrNull, citiesInState } from "@/lib/sun/us-cities";
import { NEAR_SUNSET_MIN, timezoneMismatchLine } from "@/lib/daylight/flags";

// The league's city for sunset times and the daylight-flags switch (0109).
// Written ONLY through set_org_daylight: the two profiles columns are not
// granted to signed-in users and 0098's trigger would refuse a direct write.
// The city list is the free calculator's (src/lib/sun/us-cities.ts).

type Toast = { kind: "error" | "success"; message: string; id: number };

interface Props {
  orgId: string;
  initialCity: string | null;
  initialEnabled: boolean;
  /** The league's timezone setting, for the mismatch warning. Null if unread. */
  leagueTimezone: string | null;
  /** The settings could not be read — say so rather than showing defaults. */
  loadFailed: boolean;
}

export function DaylightCard({ orgId, initialCity, initialEnabled, leagueTimezone, loadFailed }: Props) {
  const [cityId, setCityId] = useState<string | null>(initialCity);
  const [enabled, setEnabled] = useState(initialEnabled);
  const known = cityByIdOrNull(cityId);
  const [stateCode, setStateCode] = useState<string>(known?.state ?? "");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    },
    [],
  );

  const cities = useMemo(() => (stateCode ? citiesInState(stateCode) : []), [stateCode]);
  const mismatch = known && leagueTimezone ? timezoneMismatchLine(known, leagueTimezone) : null;

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

  async function save(nextCity: string | null, nextEnabled: boolean, success: string) {
    const prevCity = cityId;
    const prevEnabled = enabled;
    setCityId(nextCity);
    setEnabled(nextEnabled);
    setSaving(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc(
      // @ts-expect-error — RPC isn't in generated types (0109)
      "set_org_daylight",
      { p_org_id: orgId, p_city: nextCity, p_enabled: nextEnabled },
    );
    setSaving(false);
    if (error || !data) {
      setCityId(prevCity);
      setEnabled(prevEnabled);
      notify("error", "Couldn't save. Please try again.");
      return;
    }
    notify("success", success);
  }

  if (loadFailed) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Daylight flags</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="flex items-center gap-2 text-sm text-red-600">
            <AlertTriangle className="h-4 w-4" />
            Couldn&apos;t load your daylight settings. Refresh to try again.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Daylight flags</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex max-w-md flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label htmlFor="daylight-state" className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-gray-400">
              <Sunset className="h-4 w-4 text-gray-400" />
              Location for sunset times
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                id="daylight-state"
                value={stateCode}
                disabled={saving}
                onChange={(e) => setStateCode(e.target.value)}
                className="h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20 disabled:opacity-60"
              >
                <option value="">State…</option>
                {STATES_SORTED.map((s) => (
                  <option key={s} value={s}>
                    {STATE_NAMES[s]}
                  </option>
                ))}
              </select>
              <select
                aria-label="City"
                value={known && known.state === stateCode ? known.id : ""}
                disabled={saving || !stateCode}
                onChange={(e) => {
                  const next = cityByIdOrNull(e.target.value);
                  if (next) void save(next.id, enabled, `Sunset times set to ${next.name}.`);
                }}
                className="h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20 disabled:opacity-60"
              >
                <option value="">City…</option>
                {cities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {saving && <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin self-center text-gray-400" />}
            </div>
            <p className="text-xs text-gray-500">
              Pick the nearest listed city. Sunset times can be off by a minute or two.
            </p>
            {cityId && !known && (
              <p className="text-xs font-medium text-amber-700">
                Your saved city isn&apos;t in the list anymore. Pick it again.
              </p>
            )}
            {known && (
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setStateCode("");
                  void save(null, enabled, "City cleared. No daylight flags will show.");
                }}
                className="self-start text-xs text-gray-500 underline-offset-2 hover:underline disabled:opacity-60"
              >
                Clear city
              </button>
            )}
            {mismatch && (
              <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                {mismatch}
              </p>
            )}
          </div>

          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={enabled}
              disabled={saving}
              onChange={(e) =>
                void save(cityId, e.target.checked, e.target.checked ? "Daylight flags are on." : "Daylight flags are off.")
              }
              className="mt-0.5 h-4 w-4 cursor-pointer rounded border-gray-300 text-[#22C55E] focus:ring-[#22C55E]/30"
            />
            <span className="flex flex-col">
              <span className="text-sm font-medium text-gray-700">Daylight flags</span>
              <span className="text-xs text-gray-500">
                Flag games on fields without lights that end after sunset, or within {NEAR_SUNSET_MIN} minutes
                of it. Only admins see the flags; they never block a save. Mark fields with lights on the
                Venues page.
              </span>
            </span>
          </label>

          {toast && (
            <p
              key={toast.id}
              className={`flex items-center gap-2 text-xs font-medium ${
                toast.kind === "error" ? "text-red-600" : "text-[#16a34a]"
              }`}
            >
              {toast.kind === "error" ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              {toast.message}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
