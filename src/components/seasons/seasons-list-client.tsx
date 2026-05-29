"use client";

// Client side of /dashboard/leagues (the "Seasons" page). The server page
// owns the auto-archive UPDATE + the SELECT; this file just renders the tab
// strip, the cards, and the ••• menu that triggers the shared archive /
// unarchive modals. URL drives tab state via ?tab=archived so it's linkable.

import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { MoreVertical, Plus, Trophy } from "lucide-react";
import type { League } from "@/types/database";
import {
  ArchiveSeasonModal,
  UnarchiveSeasonModal,
} from "@/components/seasons/archive-modals";
import { deriveSeasonStatus } from "@/lib/seasons/derived-status";
import { UpgradeModal } from "@/components/plan/upgrade-cta";
import type { Plan } from "@/lib/plan/limits";
import { planLabel } from "@/lib/plan/labels";

type Tab = "active" | "archived";

interface Props {
  /** Already partitioned by the server; this component just renders. */
  leagues: League[];
  initialTab: Tab;
  activeSeasonCount: number;
  activeSeasonLimit: number;
  plan: Plan;
}

export function SeasonsListClient({
  leagues,
  initialTab,
  activeSeasonCount,
  activeSeasonLimit,
  plan,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [modal, setModal] = useState<
    | { kind: "archive" | "unarchive"; league: League }
    | null
  >(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const atCap =
    activeSeasonLimit !== -1 && activeSeasonCount >= activeSeasonLimit;

  function setTabAndUrl(next: Tab) {
    setTab(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === "active") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const active = leagues.filter((l) => !l.archived_at);
  const archived = leagues.filter((l) => !!l.archived_at);
  const visible = tab === "active" ? active : archived;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#0C1F3F]">Seasons</h1>
          <p className="mt-0.5 text-sm text-gray-500">Manage your seasons across sports.</p>
        </div>
        <div className="flex items-center gap-3">
          {activeSeasonLimit !== -1 ? (
            <p className="text-xs text-gray-500">
              {activeSeasonCount} of {activeSeasonLimit}{" "}
              {activeSeasonLimit === 1 ? "active season" : "active seasons"} ·{" "}
              <span className="font-medium text-gray-700">{planLabel(plan)} plan</span>
            </p>
          ) : null}
          {atCap ? (
            <button
              type="button"
              onClick={() => setUpgradeOpen(true)}
              className="inline-flex cursor-default items-center gap-2 rounded-lg bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-500"
              title={`You've reached your ${planLabel(plan)} plan active-season limit of ${activeSeasonLimit}.`}
            >
              <Plus className="h-4 w-4" />
              New season
            </button>
          ) : (
            <Link
              href="/dashboard/leagues/new"
              className="inline-flex items-center gap-2 rounded-lg bg-[#22C55E] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a]"
            >
              <Plus className="h-4 w-4" />
              New season
            </Link>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-gray-100">
        <TabButton
          label="Active"
          count={active.length}
          selected={tab === "active"}
          onClick={() => setTabAndUrl("active")}
        />
        <TabButton
          label="Archived"
          count={archived.length}
          selected={tab === "archived"}
          onClick={() => setTabAndUrl("archived")}
        />
      </div>

      {visible.length === 0 ? (
        <EmptyState tab={tab} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((league) => (
            <SeasonCard
              key={league.id}
              league={league}
              onArchive={() => setModal({ kind: "archive", league })}
              onUnarchive={() => setModal({ kind: "unarchive", league })}
            />
          ))}
        </div>
      )}

      {modal?.kind === "archive" && (
        <ArchiveSeasonModal
          seasonId={modal.league.id}
          seasonName={modal.league.name}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === "unarchive" && (
        <UnarchiveSeasonModal
          seasonId={modal.league.id}
          seasonName={modal.league.name}
          endDate={modal.league.end_date}
          onClose={() => setModal(null)}
        />
      )}

      {upgradeOpen ? (
        <UpgradeModal
          cap="activeSeasons"
          limit={activeSeasonLimit}
          currentPlan={plan}
          onClose={() => setUpgradeOpen(false)}
        />
      ) : null}
    </div>
  );
}

// ── Tab pill ─────────────────────────────────────────────────────────────────

function TabButton({
  label,
  count,
  selected,
  onClick,
}: {
  label: string;
  count: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative -mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
        selected
          ? "border-[#22C55E] text-[#0C1F3F]"
          : "border-transparent text-gray-500 hover:text-[#0C1F3F]"
      }`}
    >
      {label}
      <span
        className={`inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
          selected ? "bg-[#22C55E]/10 text-[#16a34a]" : "bg-gray-100 text-gray-500"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────

function SeasonCard({
  league,
  onArchive,
  onUnarchive,
}: {
  league: League;
  onArchive: () => void;
  onUnarchive: () => void;
}) {
  const status = deriveSeasonStatus(league);
  const isArchived = !!league.archived_at;

  return (
    <div className="group relative flex flex-col gap-3 rounded-xl border border-gray-100 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
      {/* The entire card stays clickable via an overlaying Link; the menu
          button (positioned above) intercepts clicks for itself. */}
      <Link
        href={`/dashboard/leagues/${league.id}`}
        className="absolute inset-0 rounded-xl"
        aria-label={`Open ${league.name}`}
      />
      <div className="relative flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="truncate font-semibold text-[#0C1F3F]">{league.name}</h3>
          <p className="text-sm text-gray-400">
            {league.sport} · {league.season}
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${status.pillClass}`}
          >
            {status.label}
          </span>
          <CardActionMenu
            isArchived={isArchived}
            onArchive={onArchive}
            onUnarchive={onUnarchive}
          />
        </div>
      </div>
    </div>
  );
}

// ── ••• Menu ──────────────────────────────────────────────────────────────────

function CardActionMenu({
  isArchived,
  onArchive,
  onUnarchive,
}: {
  isArchived: boolean;
  onArchive: () => void;
  onUnarchive: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Close on outside click / Esc.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={(e) => {
          // Stop the click from bubbling through the overlaying Link.
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Season actions"
        className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-[#0C1F3F]"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-9 z-10 min-w-[10rem] rounded-lg border border-gray-100 bg-white py-1 shadow-lg"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              if (isArchived) onUnarchive();
              else onArchive();
            }}
            className="block w-full px-3 py-1.5 text-left text-sm text-[#0C1F3F] hover:bg-gray-50"
          >
            {isArchived ? "Unarchive season" : "Archive season"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Empty states ─────────────────────────────────────────────────────────────

function EmptyState({ tab }: { tab: Tab }) {
  if (tab === "archived") {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-white px-6 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
          <Trophy className="h-5 w-5 text-gray-300" />
        </div>
        <p className="mt-4 font-semibold text-[#0C1F3F]">No archived seasons</p>
        <p className="mt-1.5 max-w-xs text-sm text-gray-400">
          Past seasons land here automatically once their end date passes, or
          you can archive one manually from its ••• menu.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-white px-6 py-20 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#0C1F3F]/6">
        <Trophy className="h-6 w-6 text-[#0C1F3F]/40" />
      </div>
      <h3 className="mt-5 font-semibold text-[#0C1F3F]">No active seasons</h3>
      <p className="mt-1.5 max-w-xs text-sm text-gray-400">
        Create your first season to start building your schedule.
      </p>
      <Link
        href="/dashboard/leagues/new"
        className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[#22C55E] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a]"
      >
        <Plus className="h-4 w-4" />
        Create a season
      </Link>
    </div>
  );
}
