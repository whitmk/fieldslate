"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  DEFAULT_GAME_DURATION_MINS,
  findUmpireConflict,
  formatConflictTime,
  type GameTimeInfo,
} from "@/lib/umpires/conflicts";

export type UmpireOption = { id: string; name: string };

export type SlotAssignment = {
  id: string;        // game_umpires.id
  umpire_id: string;
  umpire_name: string;
  role: string;
};

export type UmpireSlotsGame = {
  id: string;
  scheduled_at: string;
  duration_minutes?: number; // falls back to default if missing
  home_team_name: string;
  away_team_name: string;
};

interface Props {
  game: UmpireSlotsGame;
  roles: string[];                 // ordered role labels for this division
  assignments: SlotAssignment[];   // existing rows for this game
  umpires: UmpireOption[];         // roster for the season
  layout?: "stacked" | "inline";   // "inline" = one row per slot; "stacked" = vertical
  compact?: boolean;               // smaller text/padding
}

export function UmpireSlots({
  game,
  roles,
  assignments,
  umpires,
  layout = "stacked",
  compact = false,
}: Props) {
  const router = useRouter();
  const [errorByRole, setErrorByRole] = useState<Record<string, string>>({});
  const [pendingRole, setPendingRole] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Clear error when user navigates away/clicks elsewhere.
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node) &&
        Object.keys(errorByRole).length > 0
      ) {
        setErrorByRole({});
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [errorByRole]);

  if (roles.length === 0) return null;

  const candidate: GameTimeInfo = {
    id: game.id,
    scheduled_at: game.scheduled_at,
    duration_minutes: game.duration_minutes ?? DEFAULT_GAME_DURATION_MINS,
    home_team_name: game.home_team_name,
    away_team_name: game.away_team_name,
  };

  async function handleChange(role: string, nextUmpireId: string) {
    setPendingRole(role);
    setErrorByRole((prev) => {
      const next = { ...prev };
      delete next[role];
      return next;
    });

    const supabase = createClient();
    const existing = assignments.find((a) => a.role === role);

    // Empty selection — delete the existing row if there is one.
    if (nextUmpireId === "") {
      if (existing) {
        const { error } = await supabase
          .from("game_umpires")
          .delete()
          .eq("id", existing.id);
        if (error) {
          setErrorByRole({ [role]: error.message });
          setPendingRole(null);
          return;
        }
      }
      setPendingRole(null);
      router.refresh();
      return;
    }

    // Conflict check before persisting.
    const conflict = await findUmpireConflict(nextUmpireId, candidate);
    if (conflict) {
      const umpName =
        umpires.find((u) => u.id === nextUmpireId)?.name ?? "This umpire";
      setErrorByRole({
        [role]: `${umpName} is already assigned to ${conflict.home_team_name} vs ${conflict.away_team_name} at ${formatConflictTime(conflict.scheduled_at)}.`,
      });
      setPendingRole(null);
      return;
    }

    if (existing) {
      const { error } = await supabase
        .from("game_umpires")
        .update({ umpire_id: nextUmpireId } as never)
        .eq("id", existing.id);
      if (error) {
        setErrorByRole({ [role]: humanizeUniqueViolation(error.message) });
        setPendingRole(null);
        return;
      }
    } else {
      const { error } = await supabase
        .from("game_umpires")
        .insert([{ game_id: game.id, umpire_id: nextUmpireId, role }] as never[]);
      if (error) {
        setErrorByRole({ [role]: humanizeUniqueViolation(error.message) });
        setPendingRole(null);
        return;
      }
    }

    setPendingRole(null);
    router.refresh();
  }

  const inputHeight = compact ? "h-8" : "h-9";
  const inputText = compact ? "text-xs" : "text-sm";

  return (
    <div ref={containerRef} className={`flex flex-col gap-2 ${compact ? "" : ""}`}>
      {roles.map((role) => {
        const current = assignments.find((a) => a.role === role);
        const err = errorByRole[role];
        const isPending = pendingRole === role;

        return (
          <div key={role} className="flex flex-col gap-1">
            <div
              className={`flex items-center gap-2 ${
                layout === "inline" ? "flex-row" : "flex-row"
              }`}
            >
              <span
                className={`flex-shrink-0 font-medium text-gray-500 ${
                  compact ? "w-14 text-[11px]" : "w-16 text-xs"
                }`}
              >
                {role}
              </span>
              <div className="relative flex-1">
                <select
                  value={current?.umpire_id ?? ""}
                  disabled={isPending}
                  onChange={(e) => handleChange(role, e.target.value)}
                  className={`${inputHeight} ${inputText} w-full rounded-lg border border-gray-200 bg-white px-2 pr-7 text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20 disabled:opacity-50`}
                >
                  <option value="">— Unassigned —</option>
                  {umpires.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
                {isPending && (
                  <Loader2 className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-gray-400" />
                )}
              </div>
            </div>
            {err && (
              <div className="ml-[72px] flex items-start gap-1.5 text-[11px] text-red-600">
                <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />
                <span>{err}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function humanizeUniqueViolation(msg: string): string {
  // The database has two unique indexes on (game_id, umpire_id) and (game_id, role).
  // The role index is enforced via update path, but be defensive.
  if (/duplicate key|unique/i.test(msg)) {
    return "Slot already filled — refresh to see the latest assignments.";
  }
  return msg;
}
