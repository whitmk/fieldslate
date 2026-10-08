"use client";

// "Record where it was played" wiring shared by EVERY entry point — the
// Schedule page's row "…" menu and phone card (one GameActionsMenu), the
// calendar popover, the league page's rained-out card and the division
// panel's rained-out row. One hook, so no entry point renders the modal itself
// (sim:record-played [S1] counts render sites) and none can skip the router.
//
// `offered(game)` decides whether a surface shows the action at all: rained
// out or scheduled, original date today or earlier in the LEAGUE's timezone.
// The timezone is read once, after mount — never during render, so server and
// browser markup match (the hydration rule in CLAUDE.md, "Week-by-field view
// mode"). Until it arrives, nothing is offered.

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { UpgradeModal } from "@/components/plan/upgrade-cta";
import { RecordPlayedModal } from "@/components/schedule/record-played-modal";
import { todayInTimezone } from "@/lib/utils/org-today";
import {
  RECORD_PLAYED_UPGRADE_FEATURE,
  recordPlayedOffered,
  routeRecordPlayed,
  type RecordPlayedGame,
} from "@/lib/schedule/record-played";

export type RecordPlayedNotice = { gameId: string; message: string };

export function useRecordPlayed({
  leagueId,
  canRecord,
  onDone,
}: {
  /** The season the surface shows; its org's timezone defines "today". */
  leagueId: string | null;
  /** Pro or Elite (isProPlus) — Free gets the upsell. */
  canRecord: boolean;
  onDone?: () => void;
}): {
  /** Whether to show the action for this game. False until "today" is known. */
  offered: (game: RecordPlayedGame) => boolean;
  /** Route a click. Returns true when it produced a notice rather than
   *  opening something, so a popover can stay open to show it. */
  open: (game: RecordPlayedGame & { id: string }) => boolean;
  notice: RecordPlayedNotice | null;
  clearNotice: () => void;
  modals: ReactNode;
} {
  const router = useRouter();
  const [today, setToday] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [notice, setNotice] = useState<RecordPlayedNotice | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  useEffect(() => {
    if (!leagueId) return;
    let stale = false;
    const supabase = createClient();
    void (async () => {
      const { data: league } = await supabase
        .from("leagues")
        .select("owner_id")
        .eq("id", leagueId)
        .maybeSingle();
      const ownerId = (league as { owner_id: string } | null)?.owner_id;
      if (!ownerId) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("timezone")
        .eq("id", ownerId)
        .maybeSingle();
      const tz = (profile as { timezone: string } | null)?.timezone;
      if (!tz || stale) return;
      try {
        setToday(todayInTimezone(tz));
      } catch {
        // An unreadable timezone offers nothing — the action stays hidden
        // rather than guessing a day.
      }
    })();
    return () => {
      stale = true;
    };
  }, [leagueId]);

  function offered(game: RecordPlayedGame): boolean {
    return today !== null && recordPlayedOffered(game, today);
  }

  function open(game: RecordPlayedGame & { id: string }): boolean {
    const route = routeRecordPlayed(game, { canRecord });
    switch (route.kind) {
      case "open":
        setNotice(null);
        setTargetId(game.id);
        return false;
      case "upgrade":
        setNotice(null);
        setUpgradeOpen(true);
        return false;
      case "blocked":
        setNotice({ gameId: game.id, message: route.message });
        return true;
    }
  }

  const modals = (
    <>
      {targetId && (
        <RecordPlayedModal
          gameId={targetId}
          onClose={() => setTargetId(null)}
          onSaved={() => {
            setTargetId(null);
            router.refresh();
            onDone?.();
          }}
        />
      )}
      {upgradeOpen && (
        <UpgradeModal
          mode="feature"
          feature={RECORD_PLAYED_UPGRADE_FEATURE}
          onClose={() => setUpgradeOpen(false)}
        />
      )}
    </>
  );

  return { offered, open, notice, clearNotice: () => setNotice(null), modals };
}
