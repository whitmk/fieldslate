"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

// `icon` is a rendered element (e.g. <LayoutGrid className="…" />), NOT a
// component type — this component is a Client boundary and a bare component
// function cannot be serialized across it from the Server host. Elements can.

// Generic default-configurable disclosure wrapper for Reports panels. Same
// pattern as TeamConstraintsCollapsible / ActivityLogCollapsible — a header
// button with a rotating chevron; the body (children) mounts only when open.
// Generalized here (title / subtitle / icon / defaultOpen props) so the three
// Reports panels can share one disclosure instead of each hand-rolling a header.
//
// House rule carried from the pattern it reuses: NO <form> element — the
// toggle is an explicit type="button".
//
// The panel supplies the card chrome and the header title, so content hosted
// inside it should render "bare" (no duplicate outer card / title of its own).
export function CollapsiblePanel({
  title,
  subtitle,
  icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-6 py-4 text-left transition-colors hover:bg-gray-50/50"
      >
        {icon}
        <h3 className="font-semibold text-[#0b1c39]">{title}</h3>
        {subtitle && (
          <span className="hidden text-xs text-gray-400 sm:inline">
            {subtitle}
          </span>
        )}
        <ChevronDown
          className={`ml-auto h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && (
        <div className="border-t border-gray-100">{children}</div>
      )}
    </div>
  );
}
