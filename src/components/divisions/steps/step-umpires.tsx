"use client";

import { UserCheck } from "lucide-react";
import type { WizardData } from "../wizard-types";

interface Props {
  data: WizardData;
  update: (patch: Partial<WizardData>) => void;
}

const MAX_UMPIRES = 4;

function defaultRoleLabel(index: number, total: number): string {
  if (total <= 1) return "Umpire";
  if (index === 0) return "Plate";
  if (total === 2) return "Field";
  // 3+ umpires: Plate, Base 1, Base 2, Base 3
  return `Base ${index}`;
}

function syncRoles(prevRoles: string[], nextCount: number): string[] {
  const roles: string[] = [];
  for (let i = 0; i < nextCount; i++) {
    roles.push(prevRoles[i] ?? defaultRoleLabel(i, nextCount));
  }
  return roles;
}

export function StepUmpires({ data, update }: Props) {
  const count = data.umpires_per_game;
  const roles = data.umpire_roles;

  function handleCountChange(nextCount: number) {
    const clamped = Math.max(0, Math.min(MAX_UMPIRES, nextCount));
    update({
      umpires_per_game: clamped,
      umpire_roles: syncRoles(roles, clamped),
    });
  }

  function handleRoleChange(index: number, value: string) {
    const next = [...roles];
    next[index] = value;
    update({ umpire_roles: next });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-lg font-semibold text-[#0C1F3F]">Umpire requirements</h3>
        <p className="mt-0.5 text-sm text-gray-500">
          Set how many umpires this division needs per game, and what role each one plays.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-gray-700">Umpires per game</label>
        <input
          type="number"
          min={0}
          max={MAX_UMPIRES}
          value={count}
          onChange={(e) =>
            handleCountChange(parseInt(e.target.value, 10) || 0)
          }
          className="h-11 w-32 rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
        />
        <p className="text-xs text-gray-400">
          0 means no umpires are required for this division. Max {MAX_UMPIRES}.
        </p>
      </div>

      {count > 0 ? (
        <div className="flex flex-col gap-3 rounded-xl border border-gray-100 bg-white p-4">
          <div className="flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-gray-400" />
            <p className="text-sm font-semibold text-[#0C1F3F]">Roles</p>
          </div>
          <p className="text-xs text-gray-500">
            Label each umpire position. These labels appear on the schedule when umpires are assigned.
          </p>
          <div className="flex flex-col gap-2.5">
            {roles.map((role, idx) => (
              <div key={idx} className="flex items-center gap-3">
                <span className="w-6 flex-shrink-0 text-xs font-semibold text-gray-400 tabular-nums">
                  {idx + 1}.
                </span>
                <input
                  type="text"
                  value={role}
                  onChange={(e) => handleRoleChange(idx, e.target.value)}
                  placeholder={defaultRoleLabel(idx, count)}
                  className="h-10 flex-1 rounded-lg border border-gray-200 px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
                />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2.5 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
          <UserCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
          <p className="text-sm text-gray-600">
            No umpires required. You can come back later and bump this up if officials are needed.
          </p>
        </div>
      )}
    </div>
  );
}
