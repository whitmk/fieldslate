"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Check, ChevronDown, Loader2 } from "lucide-react";
import type { ActiveSeason } from "@/lib/seasons/context";

interface Props {
  /** Active seasons of the current org, most recently created first. */
  seasons: ActiveSeason[];
  currentSeasonId: string | null;
}

// Season switcher for the topbar, beside the org switcher and matching its
// visual pattern. Selecting a season POSTs to /api/seasons/select to write
// the fs_season_id cookie, then router.refresh() so server components
// re-render under the new season — no navigation, the user stays on the
// current page. (Pages start consuming the selection in Chunk B; until
// then this just persists it.)
export function SeasonSwitcher({ seasons, currentSeasonId }: Props) {
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

  // Zero active seasons: disabled label, no menu.
  if (seasons.length === 0) {
    return (
      <span className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium text-white/40">
        <CalendarDays className="h-4 w-4 flex-shrink-0" />
        <span className="hidden sm:inline">No active seasons</span>
      </span>
    );
  }

  const current =
    seasons.find((s) => s.id === currentSeasonId) ?? seasons[0];
  const onlyOne = seasons.length <= 1;

  async function selectSeason(seasonId: string) {
    if (seasonId === current.id) {
      setOpen(false);
      return;
    }
    setSwitchingTo(seasonId);
    try {
      const res = await fetch("/api/seasons/select", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ season_id: seasonId }),
      });
      if (!res.ok) {
        // Quietly fail and close — the user can retry. Mirrors the org
        // switcher's behavior.
        setSwitchingTo(null);
        setOpen(false);
        return;
      }
      // Stay on the current page — just refresh so server components
      // re-fetch under the new season.
      setOpen(false);
      router.refresh();
    } finally {
      setSwitchingTo(null);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-[130px] items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white sm:max-w-[200px]"
        aria-haspopup="menu"
        aria-expanded={open}
        title={current.season ? `${current.name} · ${current.season}` : current.name}
      >
        <CalendarDays className="h-4 w-4 flex-shrink-0 text-white/60" />
        <span className="truncate">{current.name}</span>
        <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-white/40" />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-1 w-72 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
        >
          <div className="border-b border-gray-100 px-3 py-2">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
              Season
            </p>
          </div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {seasons.map((s) => {
              const active = s.id === current.id;
              const busy = switchingTo === s.id;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (onlyOne) {
                        setOpen(false);
                        return;
                      }
                      void selectSeason(s.id);
                    }}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:hover:bg-transparent"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-gray-900">{s.name}</p>
                      <p className="truncate text-xs text-gray-500">
                        {[s.sport, s.season].filter(Boolean).join(" · ")}
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
              You only have one active season.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
