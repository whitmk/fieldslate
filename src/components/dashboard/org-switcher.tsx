"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, ChevronDown, Loader2 } from "lucide-react";
import type { Membership } from "@/lib/orgs/context";

interface Props {
  memberships: Membership[];
  currentOrgId: string;
}

// Switcher dropdown for the topbar. Clicking a different org POSTs to
// /api/orgs/select to write the fs_org_id cookie, then router.refresh()
// so every server component re-renders under the new org context. When
// the user has only one org the menu opens but selections are no-ops.
export function OrgSwitcher({ memberships, currentOrgId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current =
    memberships.find((m) => m.org_id === currentOrgId) ?? memberships[0];
  const onlyOne = memberships.length <= 1;

  async function selectOrg(orgId: string) {
    if (orgId === current?.org_id) {
      setOpen(false);
      return;
    }
    setSwitchingTo(orgId);
    try {
      const res = await fetch("/api/orgs/select", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org_id: orgId }),
      });
      if (!res.ok) {
        // Quietly fail and close — the user can retry. Avoids a brittle UI
        // toast layer we don't have yet.
        setSwitchingTo(null);
        setOpen(false);
        return;
      }
      // Navigate back to the dashboard root so a stale season-id search param
      // doesn't bleed across orgs, then refresh so server components re-fetch
      // under the new currentOrgId.
      setOpen(false);
      router.push("/dashboard");
      router.refresh();
    } finally {
      // setSwitchingTo cleared by the refresh/unmount; safety reset on any
      // unexpected exception.
      setSwitchingTo(null);
    }
  }

  if (!current) return null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-[220px] items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Building2 className="h-4 w-4 flex-shrink-0 text-white/60" />
        <span className="truncate">{current.org_name}</span>
        <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-white/40" />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-1 w-72 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
        >
          <div className="border-b border-gray-100 px-3 py-2">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
              Organization
            </p>
          </div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {memberships.map((m) => {
              const active = m.org_id === current.org_id;
              const busy = switchingTo === m.org_id;
              return (
                <li key={m.org_id}>
                  <button
                    type="button"
                    disabled={onlyOne || busy}
                    onClick={() => {
                      if (onlyOne) {
                        setOpen(false);
                        return;
                      }
                      void selectOrg(m.org_id);
                    }}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:hover:bg-transparent"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-gray-900">
                        {m.org_name}
                      </p>
                      <p className="text-xs capitalize text-gray-500">
                        {m.role}
                      </p>
                    </div>
                    {busy ? (
                      <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-gray-400" />
                    ) : active ? (
                      <Check className="h-4 w-4 flex-shrink-0 text-[#22C55E]" />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
          {onlyOne ? (
            <p className="border-t border-gray-100 px-3 py-2 text-xs text-gray-500">
              You only belong to one organization.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
