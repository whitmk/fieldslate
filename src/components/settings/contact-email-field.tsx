"use client";

// The league contact email in Settings, with confirmation (0126) — ONE
// component, used by the volunteer sign-ups card and the officials sign-up
// card. Every rule and sentence is src/lib/contact-verify/rules.ts.
//
//   * The address IN USE is the confirmed one (the settings table only ever
//     holds a confirmed address). A new one waits until the link emailed to
//     it is clicked; until then emails keep using the address in use.
//   * Save and send / Resend → POST /api/contact-verify/send (the server mints
//     the link; the browser never sees it).
//   * Cancel / Remove → contact_email_remove, as the signed-in admin.
//   * The waiting state is read after mount (contact_verify_state) and again on
//     "I've confirmed it — check again". A failed read says so — it never
//     reads as "nothing waiting".
// No <form>: buttons are type="button" (the card may sit inside one).

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import * as R from "@/lib/contact-verify/rules";

export function ContactEmailField({
  orgId,
  kind,
  initialContact,
  switchOn,
  inputId,
  title,
  detail,
  placeholder,
  onConfirmedChange,
}: {
  orgId: string;
  kind: R.ContactKind;
  initialContact: string | null;
  switchOn: boolean;
  inputId: string;
  title: string;
  detail: string;
  placeholder: string;
  onConfirmedChange: (contact: string | null) => void;
}) {
  const [state, setState] = useState<R.ContactState | null>(null);
  const [stateFailed, setStateFailed] = useState(false);
  const [contact, setContact] = useState(initialContact);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; line: string } | null>(null);
  const [nowMs, setNowMs] = useState<number | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await createClient().rpc(
      // @ts-expect-error — RPC isn't in the hand-maintained types (0126)
      "contact_verify_state",
      { p_org_id: orgId, p_kind: kind },
    );
    const s = error ? null : R.readContactState(data);
    setNowMs(Date.now());
    if (!s) {
      setStateFailed(true);
      return;
    }
    setStateFailed(false);
    setState(s);
    setContact(s.contactEmail);
    onConfirmedChange(s.contactEmail);
  }, [orgId, kind, onConfirmedChange]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(email: string | null) {
    setBusy(true);
    setMsg(null);
    let status = 0;
    let body: unknown = null;
    try {
      const res = await fetch("/api/contact-verify/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, kind, email }),
      });
      status = res.status;
      body = await res.json().catch(() => null);
    } catch {
      status = 0;
    }
    const out = R.sendOutcome(status, body);
    setMsg(out);
    if (out.ok) setDraft("");
    await load();
    setBusy(false);
  }

  async function remove(what: "pending" | "contact") {
    setBusy(true);
    setMsg(null);
    const { data, error } = await createClient().rpc(
      // @ts-expect-error — RPC isn't in the hand-maintained types (0126)
      "contact_email_remove",
      { p_org_id: orgId, p_kind: kind, p_what: what },
    );
    const okReply = !error && (data as { status?: unknown } | null)?.status === "removed";
    setMsg(okReply ? { ok: true, line: what === "pending" ? R.CANCELLED : R.REMOVED } : { ok: false, line: R.errorLine(error?.message) });
    await load();
    setBusy(false);
  }

  const pending = state?.pending ?? null;
  const fmt: R.DateFmt = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const lines = pending && nowMs !== null ? R.pendingLines(pending, fmt) : null;
  const resendWhy = pending && nowMs !== null ? R.resendBlocked(pending, nowMs) : null;

  return (
    <div className="py-4">
      <label htmlFor={inputId} className="text-sm font-semibold text-gray-900">{title}</label>
      <p className="mt-0.5 text-xs text-gray-500">{detail}</p>
      <p className="mt-1 text-xs text-gray-500">{R.CONFIRM_RULE}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        {contact ? (
          <>
            <span className="text-gray-500">{R.IN_USE}:</span>
            <span className="break-all font-medium text-gray-900">{contact}</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-[#15803d]">
              <Check className="h-3 w-3" /> {R.CONFIRMED_TAG}
            </span>
            <button
              type="button"
              disabled={busy || switchOn}
              title={switchOn ? R.REMOVE_WHILE_ON : undefined}
              onClick={() => remove("contact")}
              className="min-h-[36px] px-1 text-xs font-semibold text-red-700 hover:underline disabled:text-gray-400 disabled:no-underline"
            >
              {R.REMOVE_CONTACT}
            </button>
          </>
        ) : (
          <span className="text-gray-500">{R.NO_CONTACT}</span>
        )}
      </div>

      {stateFailed && <p className="mt-2 text-xs font-medium text-red-600">{R.STATE_FAILED}</p>}

      {pending && lines && (
        <div
          className={`mt-3 rounded-lg border p-3 ${lines.tone === "red" ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}
          data-contact-pending
        >
          <p className="break-all text-sm font-semibold text-gray-900">{lines.title}</p>
          <p className="mt-0.5 text-xs text-gray-700">{lines.detail}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy || resendWhy !== null}
              onClick={() => send(null)}
              className="min-h-[36px] rounded-lg bg-[#0C1F3F] px-3 text-xs font-semibold text-white disabled:opacity-50"
            >
              {pending.sentAt ? R.RESEND : R.SEND_FIRST}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => remove("pending")}
              className="min-h-[36px] rounded-lg border border-gray-300 bg-white px-3 text-xs font-semibold text-gray-700 disabled:opacity-50"
            >
              {R.CANCEL_PENDING}
            </button>
            {pending.sentAt && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void load()}
                className="min-h-[36px] px-1 text-xs font-semibold text-[#0C1F3F] hover:underline disabled:opacity-50"
              >
                {R.CHECK_AGAIN}
              </button>
            )}
          </div>
          {resendWhy && <p className="mt-1 text-xs text-gray-600">{resendWhy}</p>}
        </div>
      )}

      <div className="mt-3 flex max-w-md flex-col gap-2 sm:flex-row">
        <input
          id={inputId}
          type="email"
          autoComplete="email"
          maxLength={254}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={contact ? "New address" : placeholder}
          className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          type="button"
          disabled={busy || !R.saveDraftAllowed(draft, state)}
          onClick={() => send(draft)}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#0C1F3F] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {R.SAVE_AND_SEND}
        </button>
      </div>

      {msg && <p className={`mt-2 text-xs font-medium ${msg.ok ? "text-[#16a34a]" : "text-red-600"}`}>{msg.line}</p>}
    </div>
  );
}
