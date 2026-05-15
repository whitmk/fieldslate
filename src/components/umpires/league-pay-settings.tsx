"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DollarSign, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface RoleRate {
  role: string;
  rate: number;
}

interface Props {
  leagueId: string;
  initialEnabled: boolean;
  initialMode: "per_umpire" | "per_role";
  availableRoles: string[];
  initialRoleRates: RoleRate[];
}

export function LeaguePaySettings({
  leagueId,
  initialEnabled,
  initialMode,
  availableRoles,
  initialRoleRates,
}: Props) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [mode, setMode] = useState<"per_umpire" | "per_role">(initialMode);
  const [roleRates, setRoleRates] = useState<Record<string, string>>(
    Object.fromEntries(initialRoleRates.map((r) => [r.role, String(r.rate)])),
  );
  const [savingRates, setSavingRates] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [changingMode, setChangingMode] = useState(false);

  async function handleToggle() {
    const newEnabled = !enabled;
    setToggling(true);
    setEnabled(newEnabled);
    const supabase = createClient();
    await supabase
      .from("leagues")
      .update({ pay_tracking_enabled: newEnabled } as never)
      .eq("id", leagueId);
    setToggling(false);
    router.refresh();
  }

  async function handleModeChange(newMode: "per_umpire" | "per_role") {
    if (newMode === mode) return;
    setChangingMode(true);
    setMode(newMode);
    const supabase = createClient();
    await supabase
      .from("leagues")
      .update({ pay_rate_mode: newMode } as never)
      .eq("id", leagueId);
    setChangingMode(false);
    router.refresh();
  }

  async function saveRoleRates() {
    setSavingRates(true);
    const supabase = createClient();
    const upserts = availableRoles.map((role) => ({
      season_id: leagueId,
      role,
      rate: parseFloat(roleRates[role] ?? "0") || 0,
    }));
    if (upserts.length > 0) {
      await supabase
        .from("umpire_role_rates")
        .upsert(upserts as never[], { onConflict: "season_id,role" });
    }
    setSavingRates(false);
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <DollarSign className="h-4 w-4 text-gray-400" />
        <h3 className="font-semibold text-[#0C1F3F]">Umpire pay tracking</h3>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-700">Enable pay tracking</p>
          <p className="text-xs text-gray-400">Show pay rates and totals throughout the umpire UI.</p>
        </div>
        <button
          onClick={handleToggle}
          disabled={toggling}
          aria-label={enabled ? "Disable pay tracking" : "Enable pay tracking"}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
            enabled ? "bg-[#22C55E]" : "bg-gray-200"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              enabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      {enabled && (
        <div className="mt-5 flex flex-col gap-4 border-t border-gray-50 pt-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-gray-700">Rate mode</span>
            <div className="flex w-full rounded-lg border border-gray-200 bg-gray-50 p-1">
              {(["per_umpire", "per_role"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  disabled={changingMode}
                  onClick={() => handleModeChange(m)}
                  className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-all disabled:opacity-60 ${
                    mode === m
                      ? "bg-white text-[#0C1F3F] shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {m === "per_umpire" ? "Per umpire" : "Per role"}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400">
              {mode === "per_umpire"
                ? "Each umpire has their own flat per-game rate. Set it on the Umpires page."
                : "Rates are set by role (e.g. Plate, Field). All umpires filling that role earn the same amount."}
            </p>
          </div>

          {mode === "per_role" && (
            <div className="flex flex-col gap-3">
              <span className="text-sm font-medium text-gray-700">Role rates</span>
              {availableRoles.length === 0 ? (
                <p className="text-xs text-gray-400">
                  No umpire roles are configured for this season&apos;s divisions yet.
                </p>
              ) : (
                <>
                  <div className="flex flex-col gap-2">
                    {availableRoles.map((role) => (
                      <div key={role} className="flex items-center gap-3">
                        <span className="w-20 text-sm text-gray-700">{role}</span>
                        <div className="flex items-center gap-1 rounded-lg border border-gray-200 px-2">
                          <span className="text-sm text-gray-400">$</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={roleRates[role] ?? ""}
                            onChange={(e) =>
                              setRoleRates((prev) => ({ ...prev, [role]: e.target.value }))
                            }
                            className="h-8 w-20 bg-transparent text-sm text-gray-900 focus:outline-none"
                            placeholder="0.00"
                          />
                        </div>
                        <span className="text-xs text-gray-400">per game</span>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={saveRoleRates}
                    disabled={savingRates}
                    className="mt-1 inline-flex w-fit items-center gap-2 rounded-lg bg-[#22C55E] px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:opacity-50"
                  >
                    {savingRates && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {savingRates ? "Saving…" : "Save rates"}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
