"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays, X, Copy, Check, Loader2, RefreshCw, Power, Lock, AlertTriangle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { calendarUrls, coachMessage, CALENDAR_HELP_PATH } from "@/lib/calendar/links";
import type { Plan } from "@/lib/plan/limits";

// The per-team "Calendar" dialog on the Teams page. It never CREATES a link:
// links are created automatically when a division is locked (0099). It only
// shows and copies the current link, regenerates it, or turns it off / on —
// each through its SECURITY DEFINER function, never a table write.

export type TeamCalendarLink = { token: string; status: "active" | "off" } | null;

interface Props {
  teamId: string;
  teamName: string;
  orgName: string | null;
  seasonName: string | null;
  plan: Plan;
  /** Whether the team's division is locked right now. The feed serves only
   *  while it is; a link can exist on an unlocked division (it was locked
   *  once) and is then paused, not dead. */
  divisionLocked: boolean;
  link: TeamCalendarLink;
}

type Confirm = "regenerate" | "off" | null;

function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    window.setTimeout(() => setState("idle"), 2000);
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex flex-shrink-0 items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-[#0C1F3F] hover:text-[#0C1F3F]"
      aria-label={label}
    >
      {state === "copied" ? <Check className="h-3 w-3 text-[#22C55E]" /> : <Copy className="h-3 w-3" />}
      {state === "copied" ? "Copied" : state === "failed" ? "Select & copy" : "Copy"}
    </button>
  );
}

export function TeamCalendarLinkButton(props: Props) {
  const { teamId, teamName, orgName, seasonName, plan, divisionLocked } = props;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<TeamCalendarLink>(props.link);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [error, setError] = useState<string | null>(null);

  const paid = plan !== "free";

  async function call(fn: "regenerate_team_calendar_link" | "set_team_calendar_link_enabled", args: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    // @ts-expect-error — RPCs aren't in generated types (0099)
    const { data, error: err } = await supabase.rpc(fn, args);
    setBusy(false);
    setConfirm(null);
    if (err) {
      setError(
        err.message.includes("plan_required")
          ? "Calendar links need the Pro or Elite plan."
          : err.message.includes("link_off")
            ? "This calendar is turned off. Turn it on to get a new link."
            : "That didn't work. Please try again.",
      );
      return;
    }
    const result = data as { status: "active" | "off"; token?: string } | null;
    if (result?.status === "off") setLink({ token: link?.token ?? "", status: "off" });
    else if (result?.status === "active" && result.token) setLink({ token: result.token, status: "active" });
    router.refresh();
  }

  function close() {
    if (busy) return;
    setOpen(false);
    setConfirm(null);
    setError(null);
  }

  const urls = link?.status === "active" ? calendarUrls(link.token) : null;
  const message =
    link?.status === "active"
      ? coachMessage({ teamName, orgName, seasonName, token: link.token })
      : "";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Team calendar link"
        title="Team calendar link"
        className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 text-xs font-medium text-gray-600 transition-colors hover:border-[#0C1F3F] hover:text-[#0C1F3F] md:h-auto md:w-auto md:gap-1.5 md:px-2.5 md:py-1.5"
      >
        <CalendarDays className="h-4 w-4 md:h-3 md:w-3" />
        <span className="hidden md:inline">Calendar</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={close}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="team-calendar-title"
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <div>
                <h2 id="team-calendar-title" className="font-semibold text-[#0C1F3F]">
                  {teamName} calendar
                </h2>
                <p className="text-xs text-gray-400">
                  A link parents add to their phone once. It updates when games move.
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                disabled={busy}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-col gap-4 px-6 py-5">
              {!paid ? (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Team calendar links are part of the Pro and Elite plans.
                </p>
              ) : !link ? (
                <div className="flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-3 text-sm text-gray-600">
                  <Lock className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
                  <p>
                    This team doesn&apos;t have a calendar link yet. Links are created
                    automatically when you <span className="font-medium">lock the division&apos;s schedule</span>
                    {" "}on its schedule panel — that&apos;s the signal the schedule is ready for parents.
                  </p>
                </div>
              ) : link.status === "off" ? (
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-gray-600">
                    This team&apos;s calendar is <span className="font-medium">turned off</span>. Anyone who
                    added the old link sees a &ldquo;turned off&rdquo; message. Turning it back on issues a new link.
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => call("set_team_calendar_link_enabled", { p_team_id: teamId, p_enabled: true })}
                    className="inline-flex w-fit items-center gap-1.5 rounded-lg bg-[#0C1F3F] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0C1F3F]/90 disabled:opacity-60"
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
                    Turn calendar on
                  </button>
                </div>
              ) : (
                <>
                  {!divisionLocked && (
                    <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                      The division is unlocked, so this feed is paused: phones keep the last schedule
                      they fetched and update again once you lock it.
                    </p>
                  )}

                  <div className="flex flex-col gap-1.5">
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                      iPhone, iPad, Mac — one tap
                    </p>
                    <div className="flex items-center gap-2">
                      <a
                        href={urls!.webcal}
                        className="min-w-0 flex-1 truncate rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs text-[#0C1F3F] hover:underline"
                      >
                        {urls!.webcal}
                      </a>
                      <CopyButton text={urls!.webcal} label="Copy the webcal link" />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                      Google Calendar, Android, Outlook, Skylight — add from URL
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="min-w-0 flex-1 truncate rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs text-gray-700">
                        {urls!.https}
                      </code>
                      <CopyButton text={urls!.https} label="Copy the https link" />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                        Message for the coach to send families
                      </p>
                      <CopyButton text={message} label="Copy the message" />
                    </div>
                    <textarea
                      readOnly
                      value={message}
                      rows={9}
                      className="w-full resize-none rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs leading-relaxed text-gray-700"
                    />
                  </div>

                  <p className="text-xs text-gray-500">
                    Families see team names, dates, times and fields, plus a field&apos;s street address if
                    you&apos;ve entered one on the Venues page — nothing else. Playoff games aren&apos;t included
                    yet. Calendar apps refresh on their own schedule (Google
                    Calendar can take several hours), so same-day changes like rainouts should still come from
                    the league.{" "}
                    <a href={CALENDAR_HELP_PATH} target="_blank" rel="noreferrer" className="font-medium text-[#22C55E] hover:underline">
                      Setup instructions for parents
                    </a>
                  </p>

                  <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
                    {confirm === "regenerate" ? (
                      <ConfirmRow
                        text="The current link stops working immediately. Everyone will need the new one."
                        busy={busy}
                        onYes={() => call("regenerate_team_calendar_link", { p_team_id: teamId })}
                        onNo={() => setConfirm(null)}
                      />
                    ) : confirm === "off" ? (
                      <ConfirmRow
                        text="Parents' calendars stop updating and show that the calendar was turned off."
                        busy={busy}
                        onYes={() => call("set_team_calendar_link_enabled", { p_team_id: teamId, p_enabled: false })}
                        onNo={() => setConfirm(null)}
                      />
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setConfirm("regenerate")}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-[#0C1F3F] hover:text-[#0C1F3F] disabled:opacity-60"
                        >
                          <RefreshCw className="h-3 w-3" />
                          Regenerate link
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setConfirm("off")}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:border-red-300 disabled:opacity-60"
                        >
                          <Power className="h-3 w-3" />
                          Turn off
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}

              {error && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-600">{error}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ConfirmRow({
  text, busy, onYes, onNo,
}: { text: string; busy: boolean; onYes: () => void; onNo: () => void }) {
  return (
    <div className="flex w-full flex-col gap-2">
      <p className="text-xs text-gray-600">{text}</p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onYes}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#0C1F3F] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0C1F3F]/90 disabled:opacity-60"
        >
          {busy && <Loader2 className="h-3 w-3 animate-spin" />}
          Yes, do it
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onNo}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:border-[#0C1F3F] disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
