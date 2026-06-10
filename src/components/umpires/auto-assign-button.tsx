"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserCheck, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { autoAssignUmpires } from "@/lib/umpires/auto-assign";
import { getOfficialTitlePluralLower } from "@/lib/utils/official-title";

interface Props {
  divisionId: string;
  seasonId: string;
  /** Hide the button entirely when the division doesn't require officials. */
  enabled: boolean;
  sport?: string | null;
  /** Fires after a successful run. Parents holding assignments in client
   *  state must re-fetch here — router.refresh() alone only reaches server
   *  components, so without this their selects keep stale values. */
  onAssigned?: () => void;
}

export function AutoAssignUmpiresButton({
  divisionId,
  seasonId,
  enabled,
  sport,
  onAssigned,
}: Props) {
  const officialsLower = getOfficialTitlePluralLower(sport);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    | { kind: "ok"; filled: number; skipped: number }
    | { kind: "err"; message: string }
    | null
  >(null);

  if (!enabled) return null;

  async function handleClick() {
    setBusy(true);
    setResult(null);
    const res = await autoAssignUmpires(divisionId, seasonId);
    setBusy(false);
    if (!res.success) {
      setResult({ kind: "err", message: res.error ?? "Auto-assign failed." });
      return;
    }
    setResult({ kind: "ok", filled: res.filled, skipped: res.skipped });
    router.refresh();
    onAssigned?.();
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        onClick={handleClick}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-[#22C55E] hover:text-[#22C55E] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <UserCheck className="h-4 w-4" />
        )}
        {busy ? `Assigning ${officialsLower}…` : `Auto-assign ${officialsLower}`}
      </button>

      {result?.kind === "ok" && (
        <span className="flex items-center gap-1.5 text-sm">
          {result.skipped === 0 && result.filled > 0 ? (
            <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-[#22C55E]" />
          ) : (
            <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-500" />
          )}
          <span className={result.skipped > 0 ? "text-amber-700" : "text-[#22C55E]"}>
            {result.filled === 0 && result.skipped === 0
              ? "Nothing to assign — all slots are already filled."
              : `${result.filled} slot${result.filled !== 1 ? "s" : ""} filled${
                  result.skipped > 0
                    ? ` · ${result.skipped} couldn't be filled without a conflict`
                    : ""
                }`}
          </span>
        </span>
      )}
      {result?.kind === "err" && (
        <span className="flex items-center gap-1.5 text-sm text-red-600">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {result.message}
        </span>
      )}
    </div>
  );
}
