"use client";

import { useState } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";

// Default-closed disclosure wrapper for the Team scheduling constraints
// section on the Teams page. Header always shows; the body (passed as
// children) mounts only when expanded — so the section's own data fetch
// stays lazy until first open.
//
// The Elite gate lives in the server host, not here: the host passes either
// <TeamConstraintsSection /> or <FeatureLockedCard /> as children, so the
// gate travels with the content and this wrapper stays presentation-only.
//
// House rule (carried from the section it wraps): NO <form> element — the
// toggle is an explicit type="button".
export function TeamConstraintsCollapsible({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-6 py-4 text-left transition-colors hover:bg-gray-50/50"
      >
        <SlidersHorizontal className="h-4 w-4 flex-shrink-0 text-gray-400" />
        <h2 className="font-semibold text-[#0C1F3F]">Team Constraints</h2>
        <ChevronDown
          className={`ml-auto h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && (
        <div className="border-t border-gray-100 px-6 py-5">{children}</div>
      )}
    </div>
  );
}
