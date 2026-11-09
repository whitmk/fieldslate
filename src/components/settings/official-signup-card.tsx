"use client";

// Settings → Officials sign-up (0124). Rendered ONLY for an org whose switch
// is on (loadOfficialSignup). Two writes, as the signed-in admin, through
// 0124's functions:
//   * contact email → set_official_signup_contact (blank clears it; refused
//                     while sign-up is on). Never defaults to an account email.
//   * on/off        → set_official_signup_enabled (on needs Elite + a contact)
// Every sentence comes from src/lib/officials-signup/words.ts.

import { useState } from "react";
import { Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import type { OfficialSignupState } from "@/lib/officials-signup/feature-state";
import * as W from "@/lib/officials-signup/words";

export function OfficialSignupCard({ orgId, data }: { orgId: string; data: OfficialSignupState }) {
  const [enabled, setEnabled] = useState(data.enabled);
  const [saved, setSaved] = useState(data.contactEmail);
  const [draft, setDraft] = useState(data.contactEmail ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const changed = draft.trim() !== (saved ?? "");
  const blocked = !enabled && !saved ? W.CARD_NEEDS_CONTACT : null;

  async function saveContact() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const { data: res, error: err } = await createClient().rpc(
      // @ts-expect-error — RPC isn't in the hand-maintained types (0124)
      "set_official_signup_contact",
      { p_org_id: orgId, p_email: draft },
    );
    setBusy(false);
    const r = res as { contact_email?: unknown } | null;
    if (err || !r || !("contact_email" in r)) {
      setError(W.adminErrorLine(err?.message, W.SOMETHING_WRONG));
      return;
    }
    setSaved(typeof r.contact_email === "string" ? r.contact_email : null);
    setDraft(typeof r.contact_email === "string" ? r.contact_email : "");
    setNotice(W.CARD_SAVED);
  }

  async function toggle() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const { data: res, error: err } = await createClient().rpc(
      // @ts-expect-error — RPC isn't in the hand-maintained types (0124)
      "set_official_signup_enabled",
      { p_org_id: orgId, p_enabled: !enabled },
    );
    setBusy(false);
    const r = res as { enabled?: unknown } | null;
    if (err || typeof r?.enabled !== "boolean") {
      setError(W.adminErrorLine(err?.message, W.SOMETHING_WRONG));
      return;
    }
    setEnabled(r.enabled);
    setNotice(W.CARD_SAVED);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{W.CARD_TITLE}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="max-w-2xl text-sm text-gray-500">{W.CARD_INTRO}</p>
        {!data.elite ? (
          <p className="mt-4 flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
            <Lock className="h-4 w-4 text-gray-400" />
            {W.CARD_NEEDS_ELITE}
          </p>
        ) : (
          <div className="mt-2 max-w-3xl divide-y divide-gray-100">
            <div className="py-4">
              <label htmlFor="official-contact" className="text-sm font-semibold text-gray-900">{W.CARD_CONTACT_LABEL}</label>
              <p className="mt-0.5 text-xs text-gray-500">{W.CARD_CONTACT_HINT}</p>
              <div className="mt-2 flex max-w-md flex-col gap-2 sm:flex-row">
                <input
                  id="official-contact"
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="umpires@yourleague.org"
                  className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  disabled={busy || !changed}
                  onClick={saveContact}
                  className="rounded-lg bg-[#0C1F3F] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  Save
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between gap-4 py-4">
              <div>
                <p className="text-sm font-semibold text-gray-900">{W.CARD_ON}</p>
                {blocked && <p className="mt-1 text-xs font-medium text-amber-700">{blocked}</p>}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                aria-label={W.CARD_ON}
                disabled={busy || blocked !== null}
                onClick={toggle}
                className={`relative h-6 w-11 flex-none rounded-full transition-colors disabled:opacity-60 ${enabled ? "bg-[#15803d]" : "bg-gray-300"}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${enabled ? "right-0.5" : "left-0.5"}`} />
              </button>
            </div>
            {(error || notice) && (
              <p className={`py-2 text-xs font-medium ${error ? "text-red-600" : "text-[#16a34a]"}`}>{error ?? notice}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
